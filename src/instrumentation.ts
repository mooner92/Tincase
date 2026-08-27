// HM-25 · NT-10 — 마감 스케줄러. 서버 기동 시 1회 등록된다 (Next.js instrumentation).
//
// 목요일 하루가 이 순서로 흘러간다 (AI홍보전략실 기준):
//   전날 11:45  미제출자에게 «내일이 마감이에요»                      (NT-41)
//   13:00       미제출자에게 «아직 안 냈어요»                          (NT-10)
//   14:00       마감 — 제출 잠김                                       (WS-06)
//   14:01       자동 병합 시작                                         (HM-25·HM-35)
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
  if (process.env.MERGE_SCHEDULER === 'off') {
    console.log('[merge] 스케줄러 꺼짐 (MERGE_SCHEDULER=off)');
    return;
  }

  const { runDueMerges } = await import('./server/merge/run');
  const { runDueReminders } = await import('./server/notify/deadline-reminder');
  const { runDueMergeNotices } = await import('./server/notify/merge-notices');

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
          const when = r.kind === 'deadline_1d' ? '마감 하루 전' : '마감 1시간 전';
          console.log(`[알림] ${when} — ${r.division} ${r.isoKey}: ${r.sent}/${r.targets}명 발송`);
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
          console.log(
            `[알림] ${r.kind} — ${r.division} ${r.isoKey}(${r.status}): ${r.sent}/${r.targets}명` +
              (r.blocked ? ` · 허용목록 밖 ${r.blocked}명` : ''),
          );
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
