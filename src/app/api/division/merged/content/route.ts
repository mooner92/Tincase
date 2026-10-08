// GET·PUT /api/division/merged/content — 병합본 **보기·고치기** (API-48~51).
//
// 왜 필요한가: 담당자는 병합본을 받아 한글로 열고, 표를 복사해 취합게시판에 붙여넣는다.
// 그 과정에서 이상한 행 하나를 고치려고 한글을 여는 것이 유일한 이유가 된다.
// 화면에서 보고 고칠 수 있으면 한글을 열 일이 없다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, requireOwnManager, resolveTargetDivision, requireMergedAccess, isReviewer, unitEditorRole, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { readStoredFile, sha256, writeFileAtomic } from '@/server/storage';
import { readWorklog, TABLE_TITLES, TABLE_COLUMNS } from '@/lib/hwp/reader';
import { tableGrid, columnWidths } from '@/lib/hwp/model';
import { composeMergedHwp } from '@/server/merge';
import { boardTitle } from '@/lib/docname';
import { slotKind, toKstIso } from '@/lib/week';
import { alreadyApproved, latestReview, recordReview, requireViewedVersion, titled, worklogRows } from '@/server/merge/review';
import { freeze, supersededSince, withUnitLock } from '@/server/rollup/handoff';
import { laterAfterUnit, onUnitVersionChanged } from '@/server/rollup/auto';
import { handoffHint } from '@/server/rollup/state';
import { decidesForUnit, lastEditor, withEdit } from '@/server/merge/edits';
import { cleanCell } from '@/server/worklog-doc';
import { diffWorklog } from '@/lib/merge-diff';

export const dynamic = 'force-dynamic';

import { BUCKETS, rowNo } from '@/lib/merge-rows';
const MAX_ROWS = 200;
const TABLE_NAME: Record<string, string> = { achievements: '실적', plans: '계획', notes: '특이사항' };

async function locate(req: NextRequest, slugParam: string | null, isoKey: string | null) {
  const scope = await requireScope(req.headers);
  const { division } = await resolveTargetDivision(scope, slugParam); // TACP-7
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) throw new HttpError(404, 'not_found', '아직 병합본이 없습니다.');
  return { scope, division, slot, run };
}

/**
 * TACP-17 — 표별 작성자. **권한자에게만 계산한다** (호출부가 판정한 뒤 부른다).
 *
 * 병합 시점에는 행 순서와 작성자가 나란했지만, 그 뒤 담당자가 행을 지우거나 고치면
 * 정렬이 어긋난다. 그래서 두 단계로 되찾는다:
 *
 *   1. 행 수가 같으면 → 인덱스 그대로 (수정이 없었거나 내용만 고친 경우)
 *   2. 다르면 → **내용 대조**. 지워진 행 때문에 밀린 나머지는 이걸로 다시 붙는다
 *
 * 어느 쪽으로도 못 찾은 행은 **빈 배열**이다 — 모르는 것을 아는 척하지 않는다.
 * 담당자가 새로 써 넣은 행에는 원래 작성자가 없는 게 맞다.
 */
function authorsFor(
  reviewJson: string | null,
  key: 'achievements' | 'plans' | 'notes',
  rows: string[][],
): string[][] {
  const empty = () => rows.map(() => [] as string[]);
  if (!reviewJson) return empty();

  let stored: { c: string; a: string[] }[] = [];
  try {
    const parsed = JSON.parse(reviewJson) as { rowAuthors?: Record<string, { c: string; a: string[] }[]> };
    stored = parsed.rowAuthors?.[key] ?? [];
  } catch {
    return empty(); // 옛 실행에는 rowAuthors가 없다 — 조용히 비운다
  }
  if (stored.length === 0) return empty();
  if (stored.length === rows.length) return rows.map((_, i) => stored[i]?.a ?? []);

  // 행 수가 달라졌다 → **병합 당시 내용**으로 다시 붙인다.
  // 같은 내용이 여럿이면 앞에서부터 한 번씩 쓴다 (중복 행도 각자 작성자가 있다)
  const byContent = new Map<string, string[][]>();
  for (const s of stored) {
    const c = s.c.trim();
    if (!c) continue;
    const list = byContent.get(c);
    if (list) list.push(s.a);
    else byContent.set(c, [s.a]);
  }
  return rows.map((r) => byContent.get((r[1] ?? '').trim())?.shift() ?? []);
}

export const GET = handler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const { scope, division, slot, run } = await locate(req, q.get('division'), q.get('isoKey'));
  await requireMergedAccess(scope, division.id); // TACP §3.2 — 병합본은 부서원 모두 (TACP-15)
  rateLimit(`merged-view:${scope.user.email}`, 40, 60_000);

  /*
   * TACP-17 — 작성자는 **부서 문서 담당자(lead·head)와 readAll에게만.**
   *
   * 화면에서 숨기는 게 아니라 **응답에 담지 않는다.** 숨기기는 개발자 도구로 뚫리고,
   * 그 순간 «부서원은 남이 뭘 냈는지 모른다»(TACP-11)가 거짓말이 된다.
   */
  const canSeeAuthors = (division.id === scope.division.id && scope.isManager) || scope.readAll;

  const bytes = await readStoredFile(run.outputPath!);
  const parsed = readWorklog(bytes);
  await audit(scope.user.email, 'preview', division.id, `merged:${slot.isoKey}`);

  return json({
    // HM-47 — 지금 보는 **판**. 저장·승인할 때 그대로 돌려보낸다 — 그 사이 바뀌었으면 409 (requireViewedVersion)
    runId: run.id,
    sha256: sha256(bytes),
    // HM-47 — 승인 상태와 [승인] 버튼. 버튼은 이 부서의 head에게만 (TACP-16).
    // API-58 — 승인자 이름·바뀐 줄은 작성자(TACP-17)와 같은 사람에게만 담는다. 부서원 홈의 읽기 전용 드로어는 어차피 그리지 않는다
    review: canSeeAuthors ? await latestReview(division.id, slot.id) : null,
    canApprove: division.id === scope.division.id && isReviewer(scope),
    // RU-80 — 3단계에서 승인이 곧 제출이면 받는 곳(「기획경영본부」·「총괄」). 부서장의 [승인] 옆 설명과, 승인 뒤 담당자가 고칠 때의 한 줄이 이것을 쓴다
    handoffTo: await handoffHint(division.id),
    title: boardTitle(slot.month, slot.label, division.nameKo, slotKind(slot)),
    slot: { isoKey: slot.isoKey, label: slot.label, year: slot.year, kind: slotKind(slot) },
    editedAt: toKstIso(run.finishedAt ?? run.startedAt),
    canSeeAuthors,
    tables: parsed.tables.slice(0, 3).map((t, i) => {
      /*
       * UX-03 — **내용이 빈 행은 보내지 않는다.**
       *
       * 빈 표는 `fillTable([])`이 머리행만 남기지만 hwp 구조상 빈 행 하나가 남고,
       * 화면에는 「1행」이라 적힌 표에 빈 줄로 보인다 — «뭔가 잘못됐나»로 읽힌다.
       *
       * 화면이 아니라 **여기서** 거르는 이유: 드로어의 수정·삭제가 행 번호로 원본 배열을
       * 짚기 때문에(`ri + 1`), 화면에서만 거르면 **엉뚱한 행이 고쳐진다.**
       * 걸러진 격자를 그대로 내려보내면 그 대응이 어긋날 일이 없다.
       */
      const full = tableGrid(t);
      const grid = [full[0] ?? [], ...full.slice(1).filter((r) => r.slice(1).some((c) => c.trim()))];
      return {
        key: BUCKETS[i],
        title: TABLE_TITLES[i] ?? `표 ${i + 1}`,
        columns: [...TABLE_COLUMNS],
        rows: grid,
        // API-53 — 붙여넣기용 표 폭. **양식에서 그대로 읽는다** (HWPUNIT).
        // 코드에 비율을 박아 두면 부서가 양식을 바꾸는 순간 어긋난다
        widths: columnWidths(t),
        /*
         * HM-37 — 행별 강조(파란색). 본문과 나란하다.
         *
         * `worklog[bucket]`은 위 `grid` 필터와 **같은 조건**으로 빈 행을 뺀 목록이라
         * 자리가 어긋나지 않는다 (reader.gridToRows). 다른 조건으로 걸렀다면 여기서
         * 한 칸씩 밀렸을 것이다 — 그러면 엉뚱한 줄이 파랗게 보인다.
         */
        emphasis: (parsed.worklog[BUCKETS[i]] ?? []).map((r) => r.emphasis === true),
        // TACP-17 — 머리행을 뺀 본문과 나란하다. 권한이 없으면 아예 없다 (undefined)
        ...(canSeeAuthors ? { authors: authorsFor(run.reviewJson, BUCKETS[i], grid.slice(1)) } : {}),
      };
    }),
  });
});

/** API-50 — 담당자가 고친 내용으로 병합본을 **다시 쓴다**. 원본 제출물은 건드리지 않는다 */
export const PUT = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as
    | {
        isoKey?: string;
        /** HM-47 — 화면에서 본 판 (GET이 준 그대로) */
        runId?: string;
        sha256?: string;
        tables?: { key: string; rows: string[][]; emphasis?: boolean[] }[];
      }
    | null;
  if (!body?.tables) throw new HttpError(422, 'invalid_request', '표 내용이 없습니다.');

  // TACP-6 — 쓰기는 신원의 부서에만. 슬러그로 남의 부서 병합본을 고칠 수 없다
  const scope = await requireOwnManager(req.headers);
  rateLimit(`merged-edit:${scope.user.email}`, 20, 60_000);
  const located = await locate(req, null, body.isoKey ?? null);
  const { division, slot } = located;
  const reviewer = isReviewer(scope);
  // TACP-23 v1.7.2 — 고친 기록에 남길 역할. 부서장 없는 단위에서 operator의 저장은 위로 가지 않는다 (결정 b)
  const role = unitEditorRole(scope);

  // RU-75 — 같은 (부서, 주차)의 승인·수정 저장·비상구는 줄을 선다. 둘이 같은 판을 보고 거의 동시에 저장하면
  // 뒤의 것이 409를 못 받고 앞의 것을 덮던 틈이 함께 닫힌다(HM-T144)
  const saved = await withUnitLock(division.id, slot.id, async () => {
    // 잠금을 쥔 뒤에 다시 본다 — 줄을 서는 사이 앞의 저장·병합이 판을 바꿨을 수 있다
    const run = (await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    })) ?? located.run;

    // HM-47 — 연 뒤에 다시 병합했거나 누가 저장했으면 덮어쓰지 않는다. 부서장의 저장은 승인이라 더더욱
    const current = await readStoredFile(run.outputPath!);
    const currentSha = sha256(current);
    requireViewedVersion(run, currentSha, body);

    const template = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } });
    if (!template) throw new HttpError(422, 'no_template', '부서 양식이 없어 다시 쓸 수 없습니다.');

    // 줄바꿈은 남기고, 길면 자르지 않고 422 — 웹 작성·첨삭과 같은 규칙이다 (worklog-doc `cleanCell`)
    const clean = (v: unknown, key: string, i: number) => cleanCell(v, `${TABLE_NAME[key] ?? ''} ${i + 1}번째 줄`);

    const tableRows = { achievements: [] as string[][], plans: [] as string[][], notes: [] as string[][] };
    const rowEmphasis = { achievements: [] as boolean[], plans: [] as boolean[], notes: [] as boolean[] };
    for (const t of body.tables ?? []) {
      const key = BUCKETS.find((b) => b === t.key);
      if (!key) continue;
      // ABS-5 — 구분 채번은 언제나 시스템이 다시 만든다. 사람이 고친 번호는 버린다.
      // 화면도 같은 `rowNo`를 부른다 — 저장 전에 보여준 번호가 저장 후와 어긋나지 않는다
      /*
       * HM-37 — 강조를 **행과 같이** 걸러낸다. 빈 행을 버리면서 강조 배열만 그대로 두면
       * 한 칸씩 밀려서, 담당자가 한 줄 지웠을 뿐인데 엉뚱한 줄이 파랗게 나간다.
       */
      const kept = (t.rows ?? [])
        .slice(0, MAX_ROWS)
        .map((r, i) => ({
          cells: [clean(r[1], key, i), clean(r[2], key, i), clean(r[3], key, i), clean(r[4], key, i)],
          emphasis: t.emphasis?.[i] === true,
        }))
        .filter((r) => r.cells.some(Boolean));
      tableRows[key] = kept.map((r, i) => [rowNo(key, i), ...r.cells]);
      rowEmphasis[key] = kept.map((r) => r.emphasis);
    }

    // HM-47 — 무엇이 바뀌었나는 **덮어쓰기 전에** 읽어 둔다.
    // HM-49 — 담당자 저장도 센다: 다시 병합하면 누가 고쳤든 사라지므로, 덮기 전에 물을 근거가 있어야 한다
    const beforeRows = worklogRows(current);

    // HM-46 — 고쳐 저장한 병합본에도 부서명이 맨 위에 있어야 한다 (자동 병합과 같은 경로)
    const composed = composeMergedHwp(
      await readStoredFile(template.filePath),
      tableRows,
      rowEmphasis,
      division.nameKo,
    );
    const savedSha = sha256(composed.bytes);
    // HM-47 — 바뀐 것 없이 다시 저장했고 이 판은 이미 승인했다 — 승인·알림을 또 만들지 않는다
    // (그 승인 뒤 비상구로 다른 판이 위에 가 있으면 같은 판이라도 새 결정이다 — RU-T131)
    const sameApproved =
      reviewer && savedSha === currentSha && (await alreadyApproved(run, savedSha)) && !(await supersededSince(division.id, slot.id, 'unit', savedSha));
    /*
     * RU-73 · HM-47 — **부서장의 저장은 곧 승인이다.** 승인한 바이트는 병합본을 덮기 **전에** 불변 파일로 남긴다 —
     * 여기서 실패하면 아무것도 바뀌지 않은 채 500이다(승인 없는 수정도, 바이트 없는 승인도 남지 않는다). 병합본 쓰기가 그 뒤에
     * 실패하면 남는 것은 가리키는 곳 없는 불변 파일 하나다(해가 없다).
     */
    const frozen = reviewer && !sameApproved ? await freeze(division.slug, slot, 'unit', composed.bytes) : null;
    await writeFileAtomic(run.outputPath!, composed.bytes);

    const rowCounts = {
      achievements: tableRows.achievements.length,
      plans: tableRows.plans.length,
      notes: tableRows.notes.length,
    };
    // 바뀐 곳은 저장한 파일을 다시 읽어 계산한다 — 화면이 보낸 것이 아니라 문서에 실제로 들어간 것
    const changes = diffWorklog(beforeRows, worklogRows(composed.bytes));
    const savedAt = new Date();
    /*
     * 2026-10-08 결정 b — 「누가 마지막으로 이 파일을 썼나」를 남긴다. 부서장 없는 단위는 그 판이 그 단위의 결론일 때만 위로 간다(syncUnit).
     *   · 바뀐 곳이 있으면 지금처럼 한 줄 (HM-49의 「고친 곳」)
     *   · 바뀐 곳은 없어도 바이트가 바뀌었으면 `places: 0` 한 줄 — 그 바이트를 쓴 사람이 남아야 한다
     *   · lead가 운영자가 마지막으로 고친 판을 그대로 저장하면 `places: 0` 한 줄 — 그 판을 받아들인 것이다(그래야 올라간다)
     * `places: 0`은 HM-49의 셈(`editEntries`)에 들지 않는다 — 아무것도 안 바꾼 저장으로 [다시 병합]이 멈추지 않는다.
     */
    const adopt = role === 'lead' && !decidesForUnit(lastEditor(run.reviewJson));
    const record = changes.length > 0 || savedSha !== currentSha || adopt;
    await prisma.mergeRun.update({
      where: { id: run.id },
      data: {
        rowCounts: JSON.stringify(rowCounts),
        finishedAt: savedAt,
        ...(record && {
          reviewJson: withEdit(run.reviewJson, {
            by: reviewer ? titled(scope.user) : scope.user.name,
            role,
            at: savedAt.toISOString(),
            places: changes.length,
          }),
        }),
      },
    });
    await audit(scope.user.email, 'merge', division.id, `merged:${slot.isoKey}`, { action: 'edit', rowCounts, places: changes.length });

    /*
     * HM-47 — **부서장의 저장은 곧 승인이다.** 계정의 역할로 판정한다 — 담당자의 저장은 승인이 아니다(위로 가지 않는다, RU-T124).
     */
    let approved: { summary: string; notified: number; unchanged?: boolean } | null = null;
    let handedOff: { target: string; at: Date; submissionId: string } | null = null;
    if (reviewer) {
      if (!frozen) {
        approved = { summary: (await latestReview(division.id, slot.id))?.summary ?? '', notified: 0, unchanged: true };
      } else {
        const r = await recordReview({ scope, run, slot, kind: 'edit', changes, frozen });
        handedOff = r.handedOff;
        approved = { summary: (await latestReview(division.id, slot.id))?.summary ?? '', notified: r.notified.sent };
      }
    }
    return { run, rowCounts, warnings: composed.warnings, approved, handedOff, savedSha, changed: savedSha !== currentSha || adopt, places: changes.length };
  });

  if (saved.handedOff) {
    laterAfterUnit(division.id, slot, { cause: `unit_handoff:${saved.handedOff.submissionId}`, causedBy: scope.user.email });
  } else if (!reviewer && saved.changed) {
    // RU-72 — 담당자의 저장은 승인이 아니다. 부서장 없는 단위의 마감 뒤 최종본이면 그것이 곧 넘김(H1), 부서장 있는 단위는 NT-52.
    // 운영자의 저장도 여기로 오지만 syncUnit이 고친 기록의 역할을 보고 올리지 않는다(H2 — 결정 b). 판정을 한 곳(상태)에 두어야
    // 스케줄러의 맞추기가 같은 판을 다르게 보지 않는다. 잠금 밖에서 — 맞추기가 같은 잠금을 다시 쥔다
    await onUnitVersionChanged(division.id, slot, { cause: `edit:${saved.run.id}`, causedBy: scope.user.email, reason: { kind: 'edit', places: saved.places } });
  }

  // 저장한 판 — 화면이 이어서 고치거나 승인할 때 이것을 보낸다
  return json({
    ok: true,
    rowCounts: saved.rowCounts,
    warnings: saved.warnings,
    approved: saved.approved,
    handedOff: saved.handedOff ? { target: saved.handedOff.target, at: saved.handedOff.at } : null,
    runId: saved.run.id,
    sha256: saved.savedSha,
  });
});
