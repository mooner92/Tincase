// HM-19/25 — 병합 실행 기록 + 마감 자동 실행.
//
// 목표 시나리오: **목요일 14:10에 들어오면 이미 되어 있다.**
// 그래서 병합은 버튼이 아니라 마감이 시킨다. 버튼은 재실행용이다.
//
// **마감은 이벤트다 (HM-34).** 14:00이 지나면 그 시각까지 제출된 것으로 **최종본을 반드시
// 한 번 만든다.** 그 전에 돌린 것은 몇 번을 돌렸든 미리보기이고, 최종본을 대신하지 못한다.
// 예전에는 «성공한 실행이 있으면 건너뛴다»여서 미리보기 한 번이 최종본을 통째로 삼켰다.
//
// **정각이 아니라 +1분에 시작한다 (HM-35).** 14:00:00에 이미 진행 중이던 업로드가
// 커밋되기 전에 병합이 소스를 읽으면, 제 시각에 낸 사람이 빠진 최종본이 나온다.
// 마감 판정(WS-06)은 «정각까지 허용»이라 14:00:00.000 업로드는 유효하다 — 그 요청이
// 파일 저장·DB 기록을 끝낼 시간을 주는 것이 1분이다. 사람에게는 보이지 않는 지연이고,
// 14:10 검토 알림까지 9분이 남으므로 병합이 쓸 시간도 줄지 않는다.

import { prisma } from '../db';
import { runMerge, MergeUnavailable, MergeFailed, type MergeOutcome } from './index';
import { effectiveDeadline } from '../worklog';

/** HM-35 — 마감 후 이만큼 지나서 시작한다. 마감 정각에 들어온 제출이 커밋될 시간 */
export const MERGE_DELAY_MINUTES = 1;

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
        // HM-26 — 화면이 "볼 곳"을 알려주려면 무엇을 합쳤는지 남아 있어야 한다
        reviewJson: JSON.stringify({
          groups: outcome.mergedGroups.map((g) => ({
            authors: g.authors,
            category: g.category,
            reason: g.reason,
            sources: g.sources,
            kept: g.row.content,
            // HM-36 — 화면이 «어느 줄이 들어갔나»를 글자 비교로 짐작하지 않게 한다
            keptIndex: g.keptIndex,
            identical: g.identical,
          })),
          model: outcome.model,
          categories: outcome.categories,
          missing: outcome.missing,
          // TACP-17 — 행 순서와 나란한 작성자. 화면에서만 쓰고 문서에는 넣지 않는다
          rowAuthors: outcome.rowAuthors,
          // HM-33 — 확인이 필요한 행. 알림과 화면이 같은 것을 읽는다
          flagged: outcome.flagged,
        }),
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
 * HM-34 — 이 부서·주차에 **최종본**이 이미 있는가.
 *
 * 최종본은 «마감 이후에 성공한 실행»이다. 마감 전에 돌린 것은 몇 번을 돌렸든 미리보기이고,
 * 최종본을 대신하지 못한다 — 미리보기 뒤에 낸 사람이 반드시 있기 때문이다.
 *
 * 이 판정이 `runDueMerges` 안에 인라인으로 있던 시절, 조건은 그냥 «성공한 게 있으면»이었고
 * 아무도 그걸 이상하다고 느끼지 못했다. 판정에 이름을 붙이면 틀린 게 보인다.
 */
export async function hasFinalMerge(
  divisionId: string,
  weekSlotId: string,
  deadline: Date,
): Promise<boolean> {
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId, status: 'succeeded', startedAt: { gte: deadline } },
    select: { id: true },
  });
  return !!run;
}

/**
 * HM-25 — 마감이 지난 주차를 부서별로 **1회** 자동 병합.
 *
 * 조용히 넘어가는 경우 (경고도 남기지 않는다):
 * - 마감 +1분 전 · **최종본이 이미 있음**(마감 후 성공) · 제출 0건 · 양식 없음
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
    const deadline = effectiveDeadline(slot, division);
    const startAt = new Date(deadline.getTime() + MERGE_DELAY_MINUTES * 60_000);
    if (now < startAt) {
      skipped++;
      continue; // 아직 마감 전이거나, 마감 정각 제출이 커밋될 틈을 주는 중 (HM-35)
    }
    /*
     * HM-34 — 예전 기준은 «성공한 실행이 하나라도 있으면 건너뛴다»였다. 그건 마감 전
     * 수동 실행 한 번에 무너진다 — 담당자가 «미리 한번 돌려보는» 건 아주 자연스러운
     * 행동인데, 그 한 번이 그 주 자동 병합을 조용히 껐다.
     *
     * 2026-08-27 AI홍보전략실에서 실제로 그랬다: 10:37 수동 병합(4명) → 13:29·13:33·13:49
     * 세 명이 제출 → **14:00 자동 병합이 스스로 빠짐** → 그런데 14:10 «검토 부탁드려요»는
     * 그대로 나가서, 실장은 세 명이 빠진 문서를 온전한 것으로 알고 받았다.
     * 알림이 낡은 문서를 «완성»이라고 가리키는 것 — 안 나가는 것보다 나쁘다.
     */
    if (await hasFinalMerge(division.id, slot.id, deadline)) {
      skipped++;
      continue; // 마감 후에 됐다 — 재실행은 담당자가 버튼으로
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
