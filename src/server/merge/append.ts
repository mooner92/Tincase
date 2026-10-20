// LE-20~34 — 늦게 낸 사람을 병합본 **맨 뒤에** 붙인다. 다시 병합하지 않는다 (ADR-0023).
//
// 다시 병합하면 담당자가 순서를 바꾸고 문장을 고친 것(HM-47)이 사라진다. 여기서는 모델·분류·중복 묶기를 돌리지 않고,
// 지금 병합본 파일의 행을 **그대로** 양식에 다시 쓴 뒤 각 표의 끝에 새 행만 더한다. 수정 저장(API-50)과 같은 조립 길(`composeMergedHwp`)이다.
import type { MergeRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, isReviewer, unitEditorRole, type Scope } from '../authz';
import { audit } from '../audit';
import { logger } from '../logger';
import { readStoredFile, sha256, writeFileAtomic } from '../storage';
import { readWorklog } from '@/lib/hwp/reader';
import { DEFAULT_EMPHASIS_WORDS, stripEmphasisMarker } from '@/lib/emphasis-marker';
import { BUCKETS, rowNo, type BucketKey } from '@/lib/merge-rows';
import { splitLate } from '@/lib/late';
import { composeMergedHwp } from './index';
import { orderPeople } from './rules';
import { activeMergeJob } from './queue';
import { requireViewedVersion, titled, worklogRows } from './review';
import { withEdit } from './edits';
import { withUnitLock } from '../rollup/handoff';
import { onUnitVersionChanged } from '../rollup/auto';

type Cells = { content: string; date: string; place: string; attendee: string; emphasis: boolean };

/** LE-31 — 붙일 사람이 없다. 409에 `detail`을 싣는다(`handler`는 HttpError의 detail을 모른다 — 라우트가 받아 응답한다) */
export class NothingToAppend extends HttpError {
  constructor(
    message: string,
    public readonly detail: { revised: string[]; skipped?: { name: string; reason: string }[] },
  ) {
    super(409, 'nothing_to_append', message);
  }
}

export interface AppendResult {
  appended: { name: string; achievements: number; plans: number; notes: number }[];
  skipped: { name: string; reason: string }[];
  rowCounts: Record<BucketKey, number>;
  runId: string;
  sha256: string;
}

function parseObject(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const sameCells = (a: Cells, b: Cells) =>
  a.content.trim() === b.content.trim() && a.date.trim() === b.date.trim() && a.place.trim() === b.place.trim() && a.attendee.trim() === b.attendee.trim();

export async function appendLate(scope: Scope, slot: WeekSlot, viewed: { runId?: unknown; sha256?: unknown }, now = new Date()): Promise<AppendResult> {
  const division = scope.division; // TACP-6 — 쓰기는 신원의 부서에만
  const reviewer = isReviewer(scope);
  const role = unitEditorRole(scope);

  const done = await withUnitLock(division.id, slot.id, async () => {
    // 잠금을 쥔 뒤에 다시 본다 — 줄을 서는 사이 앞의 저장·병합이 판을 바꿨을 수 있다 (API-50과 같다)
    const run: MergeRun | null = await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run?.outputPath) throw new HttpError(404, 'not_found', '아직 병합본이 없습니다.');

    const current = await readStoredFile(run.outputPath);
    const currentSha = sha256(current);
    requireViewedVersion(run, currentSha, viewed); // HM-47 — 화면이 본 판이 아니면 붙이지 않는다

    // 곧 새 병합본이 된다 — 그 위에 붙이면 새 병합본이 덮는다
    if (await activeMergeJob(division.id, slot.id)) throw new HttpError(409, 'merging', '병합이 진행 중이에요 — 끝난 뒤 다시 확인해 주세요.');

    let used: string[];
    try {
      const parsed = JSON.parse(run.sourceIds) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not array');
      used = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      throw new HttpError(500, 'append_failed', '병합 기록을 읽을 수 없어 붙이지 못했어요. 다시 병합해 주세요.');
    }

    const subs = await prisma.submission.findMany({
      where: { divisionId: division.id, weekSlotId: slot.id },
      include: { user: true },
    });
    const { candidates, revised } = splitLate(subs, new Set(used));
    if (candidates.length === 0) {
      throw new NothingToAppend('맨 뒤에 붙일 사람이 없어요.', { revised: revised.map((s) => s.user.name) });
    }

    const existing = worklogRows(current);
    const work: Record<BucketKey, Cells[]> = {
      achievements: existing.achievements.map((r) => ({ ...r })),
      plans: existing.plans.map((r) => ({ ...r })),
      notes: existing.notes.map((r) => ({ ...r })),
    };
    const before = { achievements: work.achievements.length, plans: work.plans.length, notes: work.notes.length };

    const info = parseObject(run.reviewJson);
    const stored = (info.rowAuthors ?? {}) as Partial<Record<BucketKey, { c: string; a: string[] }[]>>;
    const authors: Record<BucketKey, { c: string; a: string[] }[]> = {
      achievements: [...(stored.achievements ?? [])],
      plans: [...(stored.plans ?? [])],
      notes: [...(stored.notes ?? [])],
    };

    // LE-22 — 사람 순서는 병합과 같다(명단 순). 읽을 수 없는 파일은 그 사람만 건너뛴다 (HM-21)
    const ordered = orderPeople(candidates.map((s) => ({ ...s, name: s.user.name, sortOrder: s.user.sortOrder })));
    const appended: AppendResult['appended'] = [];
    const skipped: AppendResult['skipped'] = [];
    const takenIds: string[] = [];
    for (const sub of ordered) {
      let parsed;
      try {
        parsed = readWorklog(await readStoredFile(sub.filePath));
      } catch (e) {
        logger.warn({ err: (e as Error).message, submissionId: sub.id }, '[붙이기] 파일을 읽지 못해 건너뜀');
        skipped.push({ name: sub.name, reason: 'unreadable' });
        continue;
      }
      const count = { achievements: 0, plans: 0, notes: 0 };
      for (const bucket of BUCKETS) {
        for (const raw of parsed.worklog[bucket]) {
          // HM-38 — 글로 적은 강조 표시는 여기서 뗀다(병합과 같다)
          const stripped = stripEmphasisMarker(raw.content, DEFAULT_EMPHASIS_WORDS);
          const row: Cells = {
            content: stripped.content,
            date: raw.date,
            place: raw.place,
            attendee: raw.attendee,
            emphasis: raw.emphasis === true || stripped.marked,
          };
          // LE-24 — 네 칸이 같은 줄은 새로 만들지 않고 작성자만 더한다
          const at = work[bucket].findIndex((r) => sameCells(r, row));
          if (at >= 0) {
            const entry = authors[bucket].find((x) => x.c.trim() === work[bucket][at].content.trim());
            if (entry && !entry.a.includes(sub.name)) entry.a = [...entry.a, sub.name];
            continue;
          }
          work[bucket].push(row);
          authors[bucket].push({ c: row.content, a: [sub.name] });
          count[bucket]++;
        }
      }
      appended.push({ name: sub.name, ...count });
      takenIds.push(sub.id);
    }
    if (takenIds.length === 0) {
      throw new NothingToAppend('맨 뒤에 붙일 수 있는 제출이 없어요.', { revised: revised.map((s) => s.user.name), skipped });
    }

    const template = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } });
    if (!template) throw new HttpError(422, 'no_template', '부서 양식이 없어 붙일 수 없습니다.');

    const tableRows = { achievements: [] as string[][], plans: [] as string[][], notes: [] as string[][] };
    const rowEmphasis = { achievements: [] as boolean[], plans: [] as boolean[], notes: [] as boolean[] };
    for (const b of BUCKETS) {
      tableRows[b] = work[b].map((r, i) => [rowNo(b, i), r.content, r.date, r.place, r.attendee]);
      rowEmphasis[b] = work[b].map((r) => r.emphasis);
    }
    // RH-113 — 지금 병합본의 자문회의 줄(양식 ②)은 그대로 옮긴다
    const consultNow = readWorklog(current).consult?.[0]?.values ?? null;
    const composed = composeMergedHwp(await readStoredFile(template.filePath), tableRows, rowEmphasis, division.nameKo, consultNow);

    // LE-25 — 쓰기 전에 다시 읽어 확인한다: 앞부분은 기존 행 그대로, 전체는 기존 + 새 행. 아니면 쓰지 않는다
    const back = worklogRows(composed.bytes);
    for (const b of BUCKETS) {
      const ok = back[b].length === work[b].length && existing[b].every((r, i) => sameExact(r, back[b][i]));
      if (!ok) {
        logger.error({ divisionId: division.id, bucket: b }, '[붙이기] 기존 행이 달라져 쓰지 않음');
        throw new HttpError(500, 'append_failed', '붙인 결과가 기존 병합본과 맞지 않아 쓰지 않았어요. 다시 병합해 주세요.');
      }
    }

    const newSha = sha256(composed.bytes);
    await writeFileAtomic(run.outputPath, composed.bytes);

    const rowCounts = { achievements: work.achievements.length, plans: work.plans.length, notes: work.notes.length };
    const places = BUCKETS.reduce((n, b) => n + (work[b].length - before[b]), 0);
    const names = appended.map((a) => a.name);
    const record = Array.isArray(info.appended) ? (info.appended as unknown[]) : [];
    const missing = Array.isArray(info.missing) ? (info.missing as unknown[]).filter((m) => typeof m !== 'string' || !names.includes(m)) : [];
    const reviewJson = withEdit(
      JSON.stringify({ ...info, rowAuthors: authors, missing, appended: [...record, { at: now.toISOString(), people: names, rows: places }] }),
      { by: reviewer ? titled(scope.user) : scope.user.name, role, at: now.toISOString(), places },
    );
    await prisma.mergeRun.update({
      where: { id: run.id },
      data: {
        sourceIds: JSON.stringify([...new Set([...used, ...takenIds])]), // LE-29 — 이것 하나로 「늦게 낸 n명」이 모두 풀린다
        rowCounts: JSON.stringify(rowCounts),
        outputSha: newSha, // HM-56e
        finishedAt: now,
        reviewJson,
      },
    });
    await audit(scope.user.email, 'merge', division.id, `merged:${slot.isoKey}`, { action: 'append', people: names.length, rows: places, rowCounts });

    return { run, appended, skipped, rowCounts, sha: newSha };
  });

  // LE-30 — 승인이 아니다. 잠금 밖에서 — 맞추기가 같은 잠금을 다시 쥔다
  await onUnitVersionChanged(division.id, slot, {
    cause: `append:${done.run.id}`,
    causedBy: scope.user.email,
    reason: { kind: 'append', people: done.appended.length },
    now,
  });

  return { appended: done.appended, skipped: done.skipped, rowCounts: done.rowCounts, runId: done.run.id, sha256: done.sha };
}

const sameExact = (a: Cells, b: Cells) =>
  a.content === b.content && a.date === b.date && a.place === b.place && a.attendee === b.attendee && a.emphasis === b.emphasis;
