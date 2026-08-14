// HM-19/25 — 병합 실행 기록 + 마감 자동 실행.
//
// 목표 시나리오: **목요일 14:10에 들어오면 이미 되어 있다.**
// 그래서 병합은 버튼이 아니라 마감이 시킨다. 버튼은 재실행용이다.

import { prisma } from '../db';
import { runMerge, MergeUnavailable, MergeFailed, type MergeOutcome } from './index';
import { effectiveDeadline } from '../worklog';

export interface MergeRunResult {
  runId: string;
  status: 'succeeded' | 'failed';
  errorText: string | null;
  outcome: MergeOutcome | null;
}

/**
 * 병합 1회 + `MergeRun` 기록.
 * 던지지 않는다 — 실패도 결과다. 화면이 원인을 보여주고 담당자가 재실행할 수 있어야 한다.
 */
export async function runMergeRecorded(
  divisionId: string,
  weekSlotId: string,
  trigger: 'auto' | 'manual',
): Promise<MergeRunResult> {
  const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId } });
  const run = await prisma.mergeRun.create({
    data: {
      divisionId,
      weekSlotId,
      status: 'running',
      sourceIds: '[]',
      // DM-13 — 실행 시점 설정을 그대로 박제한다. 나중에 설정이 바뀌어도 이 결과의 근거는 남는다
      ruleSnapshot: JSON.stringify({
        trigger,
        categories: division.mergeCategories,
        dedupe: division.mergeDedupe,
        dropNotes: division.mergeDropNotes,
        guidance: division.mergeRuleText,
      }),
    },
  });

  try {
    const outcome = await runMerge(divisionId, weekSlotId);
    await prisma.mergeRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        outputPath: outcome.outputRelPath,
        sourceIds: JSON.stringify(outcome.sourceIds),
        rowCounts: JSON.stringify(outcome.rowCounts),
        warnings: JSON.stringify(outcome.warnings),
        finishedAt: new Date(),
      },
    });
    return { runId: run.id, status: 'succeeded', errorText: null, outcome };
  } catch (e) {
    const known = e instanceof MergeUnavailable || e instanceof MergeFailed;
    const errorText = known ? (e as Error).message : `예상치 못한 오류 (${(e as Error).message})`;
    await prisma.mergeRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorText, finishedAt: new Date() },
    });
    if (!known) console.error('[merge] 예상치 못한 실패', e);
    return { runId: run.id, status: 'failed', errorText, outcome: null };
  }
}

/**
 * HM-25 — 마감이 지난 주차를 부서별로 **1회** 자동 병합.
 *
 * 조용히 넘어가는 경우 (경고도 남기지 않는다):
 * - 마감 전 · 이미 성공한 실행이 있음 · 제출 0건 · 양식 없음
 *   → 빈 병합본이나 무의미한 실패 기록을 남기지 않는다.
 */
export async function runDueMerges(now = new Date()): Promise<{ ran: number; skipped: number }> {
  const slot = await prisma.weekSlot.findFirst({
    where: { opensAt: { lte: now } },
    orderBy: { opensAt: 'desc' },
  });
  if (!slot) return { ran: 0, skipped: 0 };

  const divisions = await prisma.division.findMany({ where: { isActive: true } });
  let ran = 0;
  let skipped = 0;

  for (const division of divisions) {
    if (now < effectiveDeadline(slot, division)) {
      skipped++;
      continue; // 아직 마감 전
    }
    const done = await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded' },
    });
    if (done) {
      skipped++;
      continue; // 이미 되어 있다 — 재실행은 담당자가 버튼으로
    }
    const submissions = await prisma.submission.count({
      where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true },
    });
    if (submissions === 0) {
      skipped++;
      continue; // 낸 사람이 없으면 만들 것도 없다
    }

    const result = await runMergeRecorded(division.id, slot.id, 'auto');
    ran++;
    if (result.status === 'failed') {
      console.warn(`[merge] 자동 병합 실패 — ${division.nameKo} / ${slot.isoKey}: ${result.errorText}`);
    }
  }
  return { ran, skipped };
}
