// HM-25 · NT-10 — 마감 스케줄러. 서버 기동 시 1회 등록된다 (Next.js instrumentation).
//
// 목요일 하루가 이 순서로 흘러간다 (AI홍보전략실 기준):
//   전날 11:45  미제출자에게 «내일이 마감이에요»                      (NT-41)
//   13:00       미제출자에게 «아직 안 냈어요»                          (NT-10)
//   14:00       마감 — 제출 잠김                                       (WS-06)
//   14:01       자동 병합 — 줄에 넣고, 줄의 일꾼이 하나씩               (HM-25·HM-35·HM-60)
//   ~14:15      운영자·기획조정실 담당에게 «병합 점검» 요약              (HM-54)
//   14:10       실/팀장에게 «검토 부탁드려요» · 실패면 담당자에게 경보  (NT-40)
//   14:30       담당자에게 «최종 확인하고 제출해주세요»                (NT-40)
//   15:00       대외업무 마감
//
// 외부 cron이 아니라 앱 안에서 도는 이유: 목요일 14:00 마감을 지키는 게 이 제품의 전부인데,
// 그걸 호스트 crontab에 맡기면 배포·이관 때 조용히 빠진다. 앱과 함께 살고 함께 죽는 편이 낫다.
//
// **주기가 1분인 이유 (HM-35).** 위 시각들은 분 단위로 정해져 있는데, 5분 주기로는
// «14:01 시작»을 맞출 수 없다 — 컨테이너가 언제 떴느냐에 따라 병합이 14:01~14:06
// 아무 데서나 시작하고, 늦게 걸리면 14:10 검토 알림까지 4분밖에 안 남는다.
// 병합은 모델 호출까지 수십 초~수 분이 걸리므로 그 4분은 부족할 수 있다.
//
// 1분 주기가 비싸지 않은 이유: 각 작업이 **창 밖이면 질의 한 번에 빠져나온다.**
// 부서 목록 조회 3회 + 부서당 순수 계산이 전부이고, 실제 일은 하루에 몇 분뿐이다.

const INTERVAL_MS = 60 * 1000;

export async function register() {
  // 빌드 단계·엣지 런타임에서는 돌지 않는다
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  /*
   * OPS-06 · OPS-46 — 환경 검사를 **기동할 때** 한다. env.ts는 처음 읽힐 때 검사하는데, 스케줄러가 꺼진 서버(테스트 11112)는
   * 첫 요청이 올 때까지 아무도 읽지 않았다 — 「시험 서버가 실제 메신저로」 같은 설정이 첫 알림 때에야 드러난다. 잘못이면 여기서 끝난다.
   */
  await import('./server/env');

  /*
   * HM-55 — 기동할 때 남은 병합 실행(running)을 **모두** 치운다 — 병합을 돌리는 프로세스는 이것 하나라, 뜨기 전에 시작한
   * 실행은 살아 있을 수 없다. 10분을 기다리면 끊긴 부서가 그동안 「이미 병합 중」으로 막힌다. 스케줄러가 꺼진 서버도 —
   * [지금 병합]만 쓰는 테스트 서버에도 재시작에 끊긴 기록이 남는다. 그 뒤로는 스케줄러가 매분 10분 넘은 것을 치운다.
   */
  try {
    const { recoverStaleMergeRuns } = await import('./server/merge/inflight');
    await recoverStaleMergeRuns(new Date(), { atBoot: true });
  } catch (e) {
    console.error('[merge] 기동 시 멈춘 실행 회수 실패', e);
  }
  /*
   * HM-59e — 줄도 같다. 기동할 때 `running` 작업은 모두 죽은 것이다 — 한 번 잡혔던 것은 다시 대기(맨 앞), 두 번째면 실패.
   * 그리고 일꾼을 깨운다 — 스케줄러가 꺼진 서버도(재시작 전에 [지금 병합]으로 넣은 작업이 이어 돈다). 기다리지 않는다.
   * 켜진 서버는 알림 고리(HM-60c)를 건 뒤에 깨운다 — 고리 없이 끝난 작업의 안내가 다음 주기까지 밀리지 않게.
   */
  const { bindMergeWorkerRoot, kickMergeQueue, recoverMergeJobs } = await import('./server/merge/queue');
  try {
    // HM-59d — 일꾼은 요청 밖의 맥락에서 세운다 — [지금 병합] 요청이 깨워도 그 요청의 저장소가 일꾼에 따라가지 않게(queue.ts)
    const { AsyncLocalStorage } = await import('node:async_hooks');
    bindMergeWorkerRoot(AsyncLocalStorage.snapshot());
    await recoverMergeJobs(new Date(), { atBoot: true });
  } catch (e) {
    console.error('[merge] 기동 시 줄 작업 회수 실패', e);
  }

  if (process.env.MERGE_SCHEDULER === 'off') {
    void kickMergeQueue();
    console.log('[merge] 스케줄러 꺼짐 (MERGE_SCHEDULER=off)');
    return;
  }

  const { warmModelAtBoot } = await import('./server/merge/warmup');
  const { mergePauseState } = await import('./server/merge/pause');
  const { installMergeQueueHooks, makeSchedulerTick } = await import('./server/scheduler');

  /*
   * NT-32 — 기동할 때마다 **알림이 켜진 부서를 로그에 찍는다.**
   *
   * 「다른 부서는 꺼져 있겠지」를 믿고 넘어가면, 실수로 켠 날에도 아무도 모른다.
   * 알림은 잘못 나가면 되돌릴 수 없으므로, 지금 무엇이 켜져 있는지는 **매번 보여야 한다**.
   */
  try {
    const { prisma } = await import('./server/db');
    const { messengerStatus } = await import('./server/messenger');
    const on = await prisma.division.findMany({ where: { notifyEnabled: true }, select: { nameKo: true } });
    const total = await prisma.division.count();
    const st = messengerStatus();
    console.log(
      `[알림] ${st.enabled ? `켜짐 (수신 허용: ${st.allow})` : `꺼짐 — ${st.reason}`} · ` +
        `발송 부서 ${on.length}/${total}개: ${on.map((d) => d.nameKo).join(', ') || '없음'}`,
    );
  } catch (e) {
    console.error('[알림] 설정 확인 실패', e);
  }

  /*
   * HM-44 — 기한부 일시정지 상태를 **기동할 때 한 번 보여 준다.**
   * 「지금 무엇이 꺼져 있나」는 로그를 뒤지지 않고도 보여야 한다 (NT-32와 같은 이유).
   */
  {
    const st = mergePauseState(new Date());
    if (st.paused && st.until) console.log(`[merge] 자동 병합 일시정지 — ${st.until.toISOString()}까지 (그 뒤 저절로 재개)`);
    else if (st.paused) console.error(`[merge] ${st.reason} — 자동 병합을 멈춘 채로 둔다`);
  }

  /*
   * HM-53 (2026-10-08 — 상주) — 기동하자마자 모델을 올려 둔다. 마감까지 기다리면 그 사이의 [지금 병합]이 모델을 올리는
   * 25~46초를 떠안는다. 모든 호출이 keep_alive -1을 붙이므로 한 번 올리면 내려가지 않는다. 기다리지 않는다 — 올리는 데
   * 수십 초가 걸리고, 그동안 기동은 계속 간다. 일시정지(HM-44) 중이면 데우지 않는다(warmup.ts).
   */
  void warmModelAtBoot().catch((e) => console.error('[merge] 기동 데우기 오류', e));

  /*
   * HM-60 (2026-10-08 2단계) — 한 주기는 server/scheduler.ts에 있다. 판정해서 줄에 넣기만 하고 바로 끝난다 — 병합은 줄의 일꾼이 한다.
   * 일꾼이 부서 하나를 끝낼 때마다 · 줄이 빌 때 병합 안내와 점검 요약을 다시 본다(HM-50 · HM-54) — 그 고리는 여기서만 건다.
   */
  installMergeQueueHooks();
  void kickMergeQueue();
  const tick = makeSchedulerTick();

  // 기동 직후 한 번 — 컨테이너가 마감 시각에 재시작됐다면 바로 따라잡는다
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS).unref?.();
  console.log(`[merge] 자동 병합 스케줄러 등록 (${INTERVAL_MS / 60000}분 주기)`);
}
