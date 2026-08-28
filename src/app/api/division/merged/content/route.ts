// GET·PUT /api/division/merged/content — 병합본 **보기·고치기** (API-48~51).
//
// 왜 필요한가: 담당자는 병합본을 받아 한글로 열고, 표를 복사해 취합게시판에 붙여넣는다.
// 그 과정에서 이상한 행 하나를 고치려고 한글을 여는 것이 유일한 이유가 된다.
// 화면에서 보고 고칠 수 있으면 한글을 열 일이 없다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, requireOwnManager, resolveTargetDivision, requireMergedAccess, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { readStoredFile, writeFileAtomic } from '@/server/storage';
import { readWorklog, TABLE_TITLES, TABLE_COLUMNS } from '@/lib/hwp/reader';
import { tableGrid, columnWidths } from '@/lib/hwp/model';
import { composeMergedHwp } from '@/server/merge';
import { boardTitle } from '@/lib/docname';
import { slotKind, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

import { BUCKETS, rowNo } from '@/lib/merge-rows';
const MAX_CELL = 500;
const MAX_ROWS = 200;

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

  const parsed = readWorklog(await readStoredFile(run.outputPath!));
  await audit(scope.user.email, 'preview', division.id, `merged:${slot.isoKey}`);

  return json({
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
        // TACP-17 — 머리행을 뺀 본문과 나란하다. 권한이 없으면 아예 없다 (undefined)
        ...(canSeeAuthors ? { authors: authorsFor(run.reviewJson, BUCKETS[i], grid.slice(1)) } : {}),
      };
    }),
  });
});

/** API-50 — 담당자가 고친 내용으로 병합본을 **다시 쓴다**. 원본 제출물은 건드리지 않는다 */
export const PUT = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as
    | { isoKey?: string; tables?: { key: string; rows: string[][] }[] }
    | null;
  if (!body?.tables) throw new HttpError(422, 'invalid_request', '표 내용이 없습니다.');

  // TACP-6 — 쓰기는 신원의 부서에만. 슬러그로 남의 부서 병합본을 고칠 수 없다
  const scope = await requireOwnManager(req.headers);
  rateLimit(`merged-edit:${scope.user.email}`, 20, 60_000);
  const { division, slot, run } = await locate(req, null, body.isoKey ?? null);

  const template = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } });
  if (!template) throw new HttpError(422, 'no_template', '부서 양식이 없어 다시 쓸 수 없습니다.');

  const clean = (v: unknown) =>
    String(v ?? '')
      .split('')
      .filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\t')
      .join('')
      .trim()
      .slice(0, MAX_CELL);

  const tableRows = { achievements: [] as string[][], plans: [] as string[][], notes: [] as string[][] };
  for (const t of body.tables) {
    const key = BUCKETS.find((b) => b === t.key);
    if (!key) continue;
    // ABS-5 — 구분 채번은 언제나 시스템이 다시 만든다. 사람이 고친 번호는 버린다.
    // 화면도 같은 `rowNo`를 부른다 — 저장 전에 보여준 번호가 저장 후와 어긋나지 않는다
    tableRows[key] = (t.rows ?? [])
      .slice(0, MAX_ROWS)
      .map((r) => [clean(r[1]), clean(r[2]), clean(r[3]), clean(r[4])])
      .filter((r) => r.some(Boolean))
      .map((r, i) => [rowNo(key, i), ...r]);
  }

  const composed = composeMergedHwp(await readStoredFile(template.filePath), tableRows);
  await writeFileAtomic(run.outputPath!, composed.bytes);

  const rowCounts = {
    achievements: tableRows.achievements.length,
    plans: tableRows.plans.length,
    notes: tableRows.notes.length,
  };
  await prisma.mergeRun.update({
    where: { id: run.id },
    data: { rowCounts: JSON.stringify(rowCounts), finishedAt: new Date() },
  });
  await audit(scope.user.email, 'merge', division.id, `merged:${slot.isoKey}`, { action: 'edit', rowCounts });

  return json({ ok: true, rowCounts, warnings: composed.warnings });
});
