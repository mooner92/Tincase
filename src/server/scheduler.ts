// HM-25 · HM-60 — 스케줄러 한 주기(틱). instrumentation이 1분마다 부른다.
//
// 2026-10-08 2단계 — **틱은 병합을 기다리지 않는다.** 예전 틱은 마감이 지난 부서를 그 자리에서 차례로 병합했다(`for … await`).
// 13개 부서를 10월 속도(부서당 65~125초)로 병합하면 루프가 15시를 넘기고, 그동안 틱이 다시 돌지 못해 3단계 알림
// (14:45 「승인 막는 부서장」 · 15:00 「본부 준비」, 창 12분)과 안전망(3단계 맞추기)이 통째로 밀렸다(검토의 P1).
// 이제 틱은 판정해서 줄에 넣기만 하고(runDueMerges → enqueueMerge) 바로 끝난다. 병합은 줄의 일꾼(merge/queue.ts)이 한다.
//
// 한 파일로 떼어 낸 이유: 「틱이 막히지 않는다」를 시험이 직접 돌려 봐야 한다 — instrumentation의 register()는 setInterval을 걸어 시험하기 어렵다.
import { runDueReminders } from './notify/deadline-reminder';
import { runDueMergeNotices } from './notify/merge-notices';
import { runDueMergeBatchNotices } from './notify/merge-batch';
import { runDueRollupNotices } from './rollup/notices';
import { runDueRollupSync } from './rollup/auto';
import { coalesce } from './rollup/lock';
import { runDueMerges } from './merge/run';
import { kickMergeQueue, recoverMergeJobs, setMergeQueueHooks } from './merge/queue';
import { warmModelIfDue } from './merge/warmup';
import { mergePauseState } from './merge/pause';

/** 알림이 실패해도 병합은 돌아야 한다 — 본업이 남의 사정에 멈추지 않게 따로 감싼다 */
export async function runReminders(now: Date = new Date()): Promise<void> {
  try {
    const sent = await runDueReminders(now);
    for (const r of sent) {
      const when = { deadline_1d: '마감 하루 전', deadline_1h: '마감 1시간 전', deadline_10m: '마감 10분 전' }[r.kind];
      console.log(`[알림] ${when} — ${r.division} ${r.isoKey}: ${r.sent}/${r.targets}명 발송`);
    }
  } catch (e) {
    console.error('[알림] 마감 전 알림 오류', e);
  }
}

/**
 * HM-60c — 병합 안내(NT-40)와 「병합 점검」 요약(HM-54)은 **한 번에 하나.** 틱과 일꾼(작업 하나 끝날 때마다 · 줄이 빌 때) 두 곳에서 부르므로
 * `coalesce`로 묶는다 — 돌고 있으면 「한 번 더」만 표시한다. 같은 알림이 두 번 나가지 않게 하는 막이는 그대로 NotifyLog다.
 * 일시정지(HM-44) 중이면 판정하지 않는다 — 「병합 일시정지」는 병합 안내도 멈춘다(pause.ts).
 */
export function runMergeNotices(): Promise<void> {
  return coalesce('merge-notices', null, async () => {
    if (mergePauseState(new Date()).paused) return;
    try {
      for (const r of await runDueMergeNotices()) {
        console.log(
          `[알림] ${r.kind} — ${r.division} ${r.isoKey}(${r.status}): ${r.sent}/${r.targets}명` + (r.blocked ? ` · 허용목록 밖 ${r.blocked}명` : ''),
        );
      }
    } catch (e) {
      console.error('[알림] 병합 안내 오류', e);
    }
    try {
      for (const r of await runDueMergeBatchNotices()) console.log(`[알림] ${r.kind} — 기준 ${r.deadline.toISOString()}: ${r.sent}/${r.targets}명`);
    } catch (e) {
      console.error('[알림] 병합 점검 요약 오류', e);
    }
  });
}

/**
 * HM-60c — 줄의 일꾼에 알림 고리를 건다. **스케줄러가 켜진 서버만** — 꺼진 서버(테스트 · 시연)에서는 병합이 끝나도 알림을 판정하지 않는다
 * (예전에도 [지금 병합]은 알림을 판정하지 않았다 — 판정은 스케줄러의 몫이었다).
 * HM-50 — 부서 하나가 끝날 때마다 다시 본다(뒤 부서를 기다리지 않는다). HM-54 — 줄이 빈 순간에도.
 */
export function installMergeQueueHooks(): void {
  setMergeQueueHooks({ afterEach: () => runMergeNotices(), afterDrain: () => runMergeNotices() });
}

/**
 * 한 주기. 돌려준 함수는 겹쳐 돌지 않는다(앞 주기가 아직이면 이번 주기는 건너뛴다). 던지지 않는다 — 스케줄러는 절대 죽지 않는다.
 *
 * 순서: 마감 전 알림 → 3단계 맞추기 → 3단계 알림 → (일시정지면 여기서 끝) → 데우기 → 줄 회수 → 판정 · 넣기 → 병합 안내 · 점검 요약.
 * 어느 것도 병합을 기다리지 않는다 — 그래서 매분 제때 돈다(HM-60a).
 */
export function makeSchedulerTick(): () => Promise<void> {
  let running = false;
  // 멈춰 있는 동안 1분마다 같은 줄을 찍지 않는다 — 한 시간에 한 번이면 «살아서 멈춰 있다»가 보인다
  let pauseLoggedAt = 0;

  return async () => {
    if (running) return;
    running = true;
    try {
      await runReminders();

      /*
       * RU-72 — 3단계 자동 진행의 **안전망**. 넘김·조립은 승인 요청과 화면 열기가 이미 맞춘다 — 여기는 그것들이 놓친 것
       * (요청 뒤 프로세스 종료 등)을 따라잡을 뿐이다. 알림보다 먼저 — 알림이 맞춘 상태를 보게.
       */
      try {
        await runDueRollupSync();
      } catch (e) {
        console.error('[자동] 3단계 맞추기 오류', e);
      }

      /*
       * RU-54~57 — 3단계 알림. 병합 일시정지(HM-44) **앞에서** 돈다 — 실장·본부장의 승인과 그 뒤의 넘김은 사람의 결정에서 나오므로
       * 자동 병합이 멈춰 있어도 계속된다. 병합 줄과도 상관없다 — 줄이 15시를 넘겨 돌아도 14:45 · 15:00 창을 놓치지 않는다(HM-60a).
       */
      try {
        for (const r of await runDueRollupNotices()) console.log(`[알림] ${r.kind}: ${r.sent}/${r.targets}명`);
      } catch (e) {
        console.error('[알림] 3단계 알림 오류', e);
      }

      /*
       * HM-44 — 멈춰 있으면 **여기서 끝난다.** 마감 전 알림·3단계 알림은 위에서 이미 돌았다 —
       * 그게 「병합 일시정지」와 「스케줄러 정지」의 차이다. 제출은 계속 받고 재촉도 하되,
       * 병합본을 새로 만들지도 「검토해 주세요」를 보내지도 않는다. 줄의 자동 작업은 대기로 남는다(HM-59d).
       */
      const pause = mergePauseState(new Date());
      if (pause.paused) {
        const now = Date.now();
        if (now - pauseLoggedAt > 60 * 60_000) {
          pauseLoggedAt = now;
          if (pause.until) console.log(`[merge] 일시정지 중 — ${pause.until.toISOString()}까지`);
          else console.error(`[merge] ${pause.reason} — 멈춘 채로 둔다`);
        }
        return; // finally에서 running이 풀린다
      }

      // HM-53 — 마감 10분 전이면 모델을 다시 올린다(모델 서버가 재시작했거나 밀려났으면). 기다리지 않는다
      void warmModelIfDue(new Date()).catch((e) => console.error('[merge] 모델 데우기 오류', e));

      // HM-59e — lease가 지난 줄 작업을 회수한다(일꾼이 매달린 경우). 회수한 것은 아래에서 깨우는 일꾼이 잇는다
      try {
        await recoverMergeJobs(new Date());
      } catch (e) {
        console.error('[merge] 줄 작업 회수 오류', e);
      }

      // HM-60a — 판정해서 줄에 넣기만 한다. 병합을 기다리지 않는다
      const { queued } = await runDueMerges(new Date());
      if (queued > 0) console.log(`[merge] 자동 병합 ${queued}건 줄에 넣음`);
      // 넣은 것이 없어도 깨운다 — 일시정지가 풀려 남은 자동 작업 · 회수한 작업이 있을 수 있다. 기다리지 않는다
      void kickMergeQueue();

      // 병합이 없던 주기에도 돈다 — +30분 안내 · +15분 점검처럼 병합과 무관하게 창이 오는 것이 있다
      await runMergeNotices();
    } catch (e) {
      // 스케줄러는 절대 죽지 않는다 — 다음 주기에 다시 시도한다
      console.error('[merge] 스케줄러 오류', e);
    } finally {
      running = false;
    }
  };
}
