// HM-25 · NT-10 — 마감 스케줄러. 서버 기동 시 1회 등록된다 (Next.js instrumentation).
//
// 두 가지를 같은 주기로 돌린다:
//   마감 **1시간 전**  → 미제출자에게 알림 한 번 (NT-10)
//   마감 **후**        → 자동 병합 (HM-25)
//   마감 **20분 후**   → 담당자에게 «병합 끝났습니다» (NT-40)
//
// 외부 cron이 아니라 앱 안에서 도는 이유: 목요일 14:00 마감을 지키는 게 이 제품의 전부인데,
// 그걸 호스트 crontab에 맡기면 배포·이관 때 조용히 빠진다. 앱과 함께 살고 함께 죽는 편이 낫다.
//
// 주기가 5분인 이유: 마감 직후 10분 안에 완성되면 시나리오(14:10 도착)를 만족한다.
// 더 자주 돌려도 얻는 게 없고, `runDueMerges`가 이미 끝난 건 건너뛴다.

const INTERVAL_MS = 5 * 60 * 1000;

export async function register() {
  // 빌드 단계·엣지 런타임에서는 돌지 않는다
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.MERGE_SCHEDULER === 'off') {
    console.log('[merge] 스케줄러 꺼짐 (MERGE_SCHEDULER=off)');
    return;
  }

  const { runDueMerges } = await import('./server/merge/run');
  const { runDueReminders } = await import('./server/notify/deadline-reminder');
  const { runDueMergeNotices } = await import('./server/notify/merge-done');

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

  // 겹쳐 도는 걸 막는다. 한 번 실행이 5분을 넘길 수 있다 (부서 30개 × 모델 호출)
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // 알림이 실패해도 병합은 돌아야 한다 — 본업이 남의 사정에 멈추지 않게 따로 감싼다
      try {
        const sent = await runDueReminders();
        for (const r of sent) {
          console.log(`[알림] 마감 1시간 전 — ${r.division} ${r.isoKey}: ${r.sent}/${r.targets}명 발송`);
        }
      } catch (e) {
        console.error('[알림] 마감 전 알림 오류', e);
      }

      const { ran } = await runDueMerges();
      if (ran > 0) console.log(`[merge] 자동 병합 ${ran}건 실행`);

      // 병합 **뒤에** 돈다 — 같은 주기에서 방금 끝난 병합을 바로 알릴 수 있다.
      // 여기도 따로 감싼다: 알림이 실패해도 병합은 이미 끝났고, 그게 본업이다
      try {
        for (const r of await runDueMergeNotices()) {
          console.log(`[알림] 병합 안내 — ${r.division} ${r.isoKey}(${r.status}): ${r.sent}/${r.targets}명`);
        }
      } catch (e) {
        console.error('[알림] 병합 안내 오류', e);
      }
    } catch (e) {
      // 스케줄러는 절대 죽지 않는다 — 다음 주기에 다시 시도한다
      console.error('[merge] 스케줄러 오류', e);
    } finally {
      running = false;
    }
  };

  // 기동 직후 한 번 — 컨테이너가 마감 시각에 재시작됐다면 바로 따라잡는다
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS).unref?.();
  console.log(`[merge] 자동 병합 스케줄러 등록 (${INTERVAL_MS / 60000}분 주기)`);
}
