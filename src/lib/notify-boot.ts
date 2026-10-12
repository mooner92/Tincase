// NT-32 — 기동 로그의 알림 한 줄. 순수 함수 — instrumentation.ts가 찍고 시험이 그 글을 본다(tests/ops-notify.test.ts).
//
// 「발송 부서」는 **쪽지가 실제로 갈 수 있는 부서**다 — 켜짐 그리고 부서 알림(NT-30). 예전에는 알림 스위치만 셌다. 스위치를 `/ops`에서
// 켜고 끄게 되면서(NT-61) 꺼진 부서에 미리 켜 둔 스위치가 생길 수 있고, 그 부서까지 세면 「발송 부서 3/30」이라 찍히는데 실제로 나가는 곳은 둘이다.
// 기동 로그는 「지금 무엇이 나가나」를 보는 자리라(LAUNCH-v2 ⑦) 실제와 다른 수는 거짓말이 된다. 미리 켜 둔 것은 지우지 않고 따로 적는다 —
// 그 부서를 켜는 순간 쪽지가 가기 시작하므로 알고 있어야 한다(LAUNCH-v2 9-5의 2).

export interface BootDivision {
  nameKo: string;
  isActive: boolean;
  notifyEnabled: boolean;
}

export interface BootMessenger {
  enabled: boolean;
  /** 수신 허용 — 「전원」 또는 n명 */
  allow: string;
  /** 꺼진 이유 */
  reason: string;
}

export function notifyBootLine(divisions: readonly BootDivision[], st: BootMessenger): string {
  const sending = divisions.filter((d) => d.isActive && d.notifyEnabled);
  const parked = divisions.filter((d) => !d.isActive && d.notifyEnabled);
  const names = (ds: readonly BootDivision[]) => ds.map((d) => d.nameKo).join(', ');
  return (
    `[알림] ${st.enabled ? `켜짐 (수신 허용: ${st.allow})` : `꺼짐 — ${st.reason}`} · ` +
    `발송 부서 ${sending.length}/${divisions.length}개: ${names(sending) || '없음'}` +
    (parked.length ? ` · 알림만 켠 꺼진 부서 ${parked.length}개: ${names(parked)}` : '')
  );
}
