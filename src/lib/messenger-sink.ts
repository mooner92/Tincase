// NT-56 · OPS-46 — 가짜 알림 수신함(더미 메신저)의 **판정**. 순수 함수만 둔다 — env.ts(기동 검사)와 서버(문·클라이언트)가 같이 쓴다.
//
// 왜 있는가: v2 전환(2026-10-12) 전 주말에 알림을 「실제로 보내 보지 않고」 끝까지 시험해야 한다. 메신저 API는 사람 화면에 팝업을
// 띄우므로 시험 서버는 지금까지 메신저를 껐고(RU-41), 그래서 **어느 알림이 누구에게 언제 가는지는 운영에서 처음 보였다.**
// 수신함은 같은 앱 안의 주소다 — 클라이언트(messenger.ts)가 보내는 폼을 그대로 받아 적고, 밖으로는 아무것도 나가지 않는다.
//
// 문은 둘 다 열려야 열린다: 시험·시연 서버(`TINCASE_ENV` test·demo) **그리고** 명시 스위치(`MESSENGER_SINK=on`).
// 운영에는 `TINCASE_ENV`가 없다 — 운영에서 수신함 주소가 보이면 서버가 뜨지 않는다(sinkBootProblem).

/** 수신함 경로. 호스트·포트는 컨테이너 안팎에서 달라 경로로만 알아본다 */
export const SINK_PATH = '/api/dev/messenger-sink';

/**
 * 알림 종류를 수신함에 알리는 머리. 진짜 메신저는 받는 필드가 정해져 있어(messenger.md §6 — 16개 필드 일치) 폼에 넣지 않는다.
 * 머리도 **수신함으로 갈 때만** 붙인다 — 운영 메신저가 받는 요청은 바이트 하나 달라지지 않는다.
 */
export const SINK_KIND_HEADER = 'x-tincase-kind';

export interface SinkEnv {
  TINCASE_ENV?: string;
  MESSENGER_SINK?: string;
  MESSENGER_URL?: string;
}

/** 시험·시연 서버인가 (RU-43·47의 띠와 같은 값) */
export function isTrialEnv(tincaseEnv: string | undefined): boolean {
  return tincaseEnv === 'test' || tincaseEnv === 'demo';
}

/** 수신함 문이 열려 있나 — 시험·시연 서버 **그리고** `MESSENGER_SINK=on` */
export function sinkOpen(e: SinkEnv): boolean {
  return isTrialEnv(e.TINCASE_ENV) && e.MESSENGER_SINK === 'on';
}

/** 이 메신저 주소가 수신함인가 */
export function isSinkUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === SINK_PATH;
  } catch {
    return false;
  }
}

/**
 * OPS-46 — 기동 거부 사유. 없으면 null. 셋 다 「조용히 엉뚱한 곳으로 가는」 설정이다:
 *   ① 운영(시험·시연 아님)인데 메신저 주소가 수신함 — 실제 사람에게 가야 할 알림이 아무에게도 안 간다
 *   ② 시험·시연 서버인데 메신저 주소가 수신함이 아닌 곳 — 가짜·사본 데이터에서 실제 사람에게 팝업이 뜬다(RU-41이 막던 것)
 *   ③ 수신함 주소인데 문이 닫혀 있다 — 알림마다 404로 실패하고, 시험한 사람은 「알림이 안 간다」를 앱 잘못으로 읽는다
 */
export function sinkBootProblem(e: SinkEnv): string | null {
  const trial = isTrialEnv(e.TINCASE_ENV);
  const url = e.MESSENGER_URL ?? '';
  if (isSinkUrl(url) && !trial) {
    return `MESSENGER_URL이 가짜 알림 수신함(${SINK_PATH})인데 시험·시연 서버가 아닙니다(TINCASE_ENV=${e.TINCASE_ENV || '없음'}) — 운영 알림이 아무에게도 가지 않습니다.`;
  }
  if (trial && url && !isSinkUrl(url)) {
    return `시험·시연 서버(TINCASE_ENV=${e.TINCASE_ENV})의 MESSENGER_URL이 가짜 알림 수신함이 아닙니다 — 실제 사람에게 알림이 갑니다. 비우거나 수신함 주소(${SINK_PATH})로.`;
  }
  if (isSinkUrl(url) && e.MESSENGER_SINK !== 'on') {
    return `MESSENGER_URL이 가짜 알림 수신함인데 MESSENGER_SINK=on이 아닙니다 — 알림마다 404로 실패합니다.`;
  }
  return null;
}

/** NotifyLog 종류의 앞부분 — `ru_org_ready:<사람>` → `ru_org_ready`. 수신함 화면의 거르기와 리허설 판정이 쓴다 */
export function kindBase(kind: string): string {
  return kind.split(':')[0] ?? '';
}

/** 수신함 화면의 종류 이름 — NotifyLog 종류 앞부분(kindBase) 기준. 모르는 종류는 코드값 그대로 보인다 */
export const SINK_KIND_LABEL: Record<string, string> = {
  deadline_1d: '하루 전',
  deadline_1h: '1시간 전',
  deadline_10m: '10분 전',
  merge_review: '검토 요청',
  merge_missing: '병합본 없음',
  merge_done: '제출 안내',
  merge_held: '재병합 보류',
  merge_approved: '승인 완료',
  merge_reapprove: '다시 승인',
  ru_unit_due_soon: '실·팀장 15분 전',
  ru_hq_ready: '본부본 준비',
  ru_hq_complete: '본부본 다 모임',
  ru_hq_reapprove: '본부본 다시 승인',
  ru_hq_due_soon: '본부장 15분 전',
  ru_org_ready: '전사본 준비',
  ru_org_complete: '전사본 다 들어옴',
  ru_org_changed: '받은 전사본 바뀜',
  ru_hq_failed: '본부본 실패',
  ru_org_failed: '전사본 실패',
  forgot: '비밀번호 재설정',
  setup_link: '설정 링크',
};
