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

import type { Division, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { runMerge, MergeUnavailable, MergeFailed, type MergeOutcome } from './index';
import { mergeGateOf } from '../deadline';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { latestEdits } from './edits';
import { ruleSnapshotOf } from './rule-snapshot';
import { noticeMergeHeld } from '../notify/merge-notices';

/** HM-35 — 마감 후 이만큼 지나서 시작한다. 마감 정각에 들어온 제출이 커밋될 시간 */
export const MERGE_DELAY_MINUTES = 1;

/**
 * HM-43 — 연속 실패 n번째 뒤 **다음 시도까지 기다리는 분**.
 * 되는 실패(모델 시간 초과)는 곧 낫고, 안 되는 실패(제출물 문제)는 사람이 봐야 한다.
 */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 30] as const;

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
      // 시작·끝 시각을 같은 시계(앱)로 찍는다. 기본값 now()는 DB 엔진의 시계라, 끝난 시각(finishedAt)과
      // 다른 시계가 섞이면 「마감 뒤에 시작했나」(HM-34)와 「언제 끝났나」(HM-50)를 시험에서 맞춰 볼 수 없다
      startedAt: new Date(),
      status: 'running',
      sourceIds: '[]',
      // DM-13 — 실행 시점 설정을 그대로 박제한다. 나중에 설정이 바뀌어도 이 결과의 근거는 남는다.
      // 목록은 ruleSnapshotOf 하나가 정한다 — 2026-10-08부터 분류 순서뿐이다(나머지는 고정값, HM-51)
      ruleSnapshot: JSON.stringify({ trigger, ...ruleSnapshotOf(division) }),
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

/** HM-49 — 같은 닫힘을 1분마다 다시 찍지 않는다 (프로세스 안에서만 — 알림의 중복은 NotifyLog가 막는다) */
const heldLogged = new Set<string>();

/**
 * HM-49 — 사람이 고친 **최종본**이면 자동 재병합을 멈춘다. 멈췄으면 참.
 *
 * 여기 오는 것은 「마감 뒤 최종본이 기준 시각 이후에는 없다」일 때다. 마감 열기가 닫혀 기준이 뒤로 밀렸거나(DM-20),
 * 아직 최종본을 만들지 않았거나. 앞의 경우에 그 최종본을 부서장·담당자가 고쳤으면 다시 병합이 수정을 통째로 지운다 —
 * 그 파일은 같은 경로에 덮여 어디에도 남지 않는다. 그래서 멈추고, 늦게 낸 사람이 있으면 담당자에게 고르게 한다(NT-51).
 *
 * 마감 **전** 미리보기는 고쳤어도 지키지 않는다 — 마감은 이벤트이고 최종본은 반드시 한 번 만든다(HM-34).
 */
async function holdForEdits(division: Division, slot: WeekSlot, gate: Date): Promise<boolean> {
  const latest = await latestEdits(division.id, slot.id);
  if (!latest?.edits) return false;
  if (latest.run.startedAt < effectiveDeadline(slot, division)) return false; // 미리보기 (HM-34)

  // 병합본에 안 들어간 최신 제출 — 마감 뒤 알림의 「병합한 뒤에 n명이 더 냈어요」와 같은 계산 (merge-notices)
  const used = new Set<string>(JSON.parse(latest.run.sourceIds) as string[]);
  const late = (
    await prisma.submission.findMany({
      where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true },
      select: { id: true },
    })
  ).filter((x) => !used.has(x.id)).length;

  const key = `${division.id}:${slot.id}:${gate.getTime()}`;
  if (!heldLogged.has(key)) {
    heldLogged.add(key);
    console.log(
      `[merge] 자동 재병합 보류 — ${division.nameKo} / ${slot.isoKey}: 사람이 고친 병합본(${latest.edits.places}곳)` +
        (late > 0 ? `, 늦게 낸 ${late}명 미반영 — 담당자가 [다시 병합]으로 고른다` : ', 더 낸 사람 없음'),
    );
  }
  if (late > 0) {
    // 알림이 실패해도 멈춘 것은 그대로다 — 덮지 않는 것이 본업이고, 화면(edits·stale)이 같은 사실을 보인다
    try {
      const r = await noticeMergeHeld({ division, slot, gate, late, edits: latest.edits });
      if (r) console.log(`[알림] merge_held — ${r.division} ${r.isoKey}: ${r.sent}/${r.targets}명`);
    } catch (e) {
      console.error('[알림] 재병합 보류 안내 실패', e);
    }
  }
  return true;
}

export interface DueMergeOptions {
  /**
   * HM-50 — 부서 하나를 병합할 때마다 부른다. 스케줄러는 여기서 병합 안내·마감 전 알림을 다시 판정한다 —
   * 13개 부서를 다 병합할 때까지 기다리면 먼저 끝난 부서의 검토 요청 창이 지나간다. 실패해도 병합은 계속 간다.
   */
  afterEach?: () => Promise<void>;
}

/**
 * HM-25 — 마감이 지난 주차를 부서별로 **1회** 자동 병합.
 *
 * 조용히 넘어가는 경우 (경고도 남기지 않는다):
 * - 마감 +1분 전 · **최종본이 이미 있음**(마감 후 성공) · 제출 0건 · 양식 없음
 *   → 빈 병합본이나 무의미한 실패 기록을 남기지 않는다.
 * - 사람이 고친 최종본 (HM-49) — 로그 한 줄, 늦게 낸 사람이 있으면 담당자에게 알림
 */
export async function runDueMerges(now = new Date(), opts: DueMergeOptions = {}): Promise<{ ran: number; skipped: number }> {
  /*
   * HM-45 — **이번 주 슬롯을 보장한다.** 예전에는 «가장 최근 슬롯»을 그냥 집어 왔다.
   *
   * 슬롯은 누가 화면을 열 때 만들어지므로(WS-11 지연 생성), 새 주가 시작된 직후 아무도
   * 접속하지 않았으면 **지난 주 슬롯**이 잡힌다. 그 슬롯의 마감은 이미 지났으니
   * «마감했는데 최종 병합이 없네» 판정이 서서 **지난 주 문서를 다시 만든다** —
   * 실장이 고쳐서 내보낸 그 문서를.
   *
   * 지금까지 안 터진 것은 알림 경로가 매 분 슬롯을 만들어 줬기 때문이다(NT-13).
   * 그런데 그 경로는 메신저가 꺼져 있으면 **슬롯을 만들기 전에 빠져나간다.**
   * 병합이 남의 기능의 부작용에 기대고 있는 셈이라 여기서 직접 보장한다.
   */
  const slot = await ensureCurrentSlot(now);

  const divisions = await prisma.division.findMany({ where: { isActive: true } });
  let ran = 0;
  let skipped = 0;

  for (const division of divisions) {
    /*
     * DM-20 — 담당자가 마감을 잠시 열었으면 **닫히는 시각이 새 마감 이벤트**다.
     * 열려 있는 동안에는 돌지 않고(받는 중에 만들 이유가 없다), 닫히면 1분 뒤 한 번 돈다.
     * 그래야 늦게 받은 제출이 병합본에 들어간다 — 담당자가 [다시 병합]을 기억할 필요가 없다.
     */
    const deadline = await mergeGateOf(division, slot);
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
    /*
     * HM-49 — 마감 열기가 닫혀 기준이 밀렸는데 그 전 최종본을 사람이 고쳤으면 **덮지 않는다.**
     * 2026-10-08 리뷰: 14:10 실장 수정 → 14:20 마감 열기 → 14:51 자동 재병합이 실장 수정을 통째로 지웠다.
     */
    if (await holdForEdits(division, slot, deadline)) {
      skipped++;
      continue;
    }
    /*
     * HM-43 — **같은 이유로 계속 실패하면 간격을 벌린다.**
     *
     * 2026-09-03에 자동 병합이 1분마다 여덟 번 실패했다. 원인은 한 사람의 칸에 든
     * 줄바꿈이었고, 재시도로는 절대 낫지 않는 종류였다. 그런데도 1분마다 같은 일을 하며
     * 로그를 채웠다 — 정작 봐야 할 「무엇이 잘못됐나」가 그 안에 묻힌다.
     *
     * 그렇다고 한 번 실패하고 포기하면 안 된다: 모델 호출 시간 초과처럼 **다음에는 되는**
     * 실패도 있다. 그래서 끄지 않고 **뒤로 미룬다** — 1·5·15·30분, 그 뒤로는 30분마다.
     * 담당자는 그동안 [지금 병합]으로 언제든 직접 돌릴 수 있다 (그 길은 막지 않는다).
     */
    const failures = await prisma.mergeRun.count({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'failed', startedAt: { gte: deadline } },
    });
    if (failures > 0) {
      const last = await prisma.mergeRun.findFirst({
        where: { divisionId: division.id, weekSlotId: slot.id, startedAt: { gte: deadline } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true },
      });
      if (last?.status === 'failed') {
        const waitMin = RETRY_BACKOFF_MINUTES[Math.min(failures - 1, RETRY_BACKOFF_MINUTES.length - 1)];
        if (now.getTime() - last.startedAt.getTime() < waitMin * 60_000) {
          skipped++;
          continue;
        }
      }
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
      console.warn(
        `[merge] 자동 병합 실패(${failures + 1}회) — ${division.nameKo} / ${slot.isoKey}: ${result.errorText}`,
      );
    }
    // HM-50 — 이 부서의 안내는 뒤 부서들을 기다리지 않는다
    if (opts.afterEach) {
      try {
        await opts.afterEach();
      } catch (e) {
        console.error('[merge] 병합 뒤 알림 판정 오류', e);
      }
    }
  }
  return { ran, skipped };
}
