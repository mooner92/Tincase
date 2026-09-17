// HM-44 — 자동 병합을 **기한부로** 멈춘다.
//
// ── 왜 필요했나 ─────────────────────────────────────────────
// 2026-09-17, 담당자 출장으로 마감 **전에** 수동 병합하고 실장 수정본을 바로 제출했다.
// 그런데 마감 전 병합은 시스템이 「미리보기」로 본다(HM-34). 그래서 스케줄러를 그대로
// 두면 14:01에 자동 병합이 돌아 **실장 수정본을 덮는다.** 그날은 `MERGE_SCHEDULER=off`로
// 껐다.
//
// 문제는 **되살리는 일이 사람 기억에 남는다**는 것이다. 이 저장소는 그 형태의 규칙이
// 어떻게 되는지 이미 안다 — 내부망 IP를 한 번 지웠다가 커밋에 두 번 다시 들어갔고,
// 「마감을 열면 닫는 것도 기억해야 한다」는 30분 자동 닫힘으로 바꿨다(DM-20).
// 끄는 일과 켜는 일이 **같은 사람의 같은 결심**에 달려 있으면 언젠가 한쪽만 일어난다.
// 못 켜면 그 주는 자동 병합도, 병합 안내 알림도 통째로 조용히 사라진다.
//
// ── 그래서 ─────────────────────────────────────────────────
// 끌 때 **언제까지인지 같이 적는다.** 그 시각이 지나면 저절로 돌아온다.
// 켜는 것은 아무도 기억하지 않아도 된다.
//
//   MERGE_PAUSE_UNTIL="2026-09-21T09:00:00+09:00"
//
// ── 무엇이 멈추나 ★ ────────────────────────────────────────
// 멈추는 것: 자동 병합(runDueMerges) · 병합 안내 알림(검토·제출 요청)
// 도는 것:   마감 전 알림(하루 전·1시간 전·10분 전)
//
// 「병합 일시정지」라는 이름 그대로다. 마감 전 알림은 **제출을 받는 일**이라 병합과
// 무관하고, 멈출 이유가 없다. 게다가 그 경로가 매 분 이번 주 슬롯을 보장하므로(NT-13),
// 멈춰 있는 동안에도 주차가 따라온다 — 풀리는 순간 **새 주차**를 보고 있어야 안전하다.
//
// ── 값이 이상하면 ──────────────────────────────────────────
// 「멈춘 줄 알았는데 안 멈췄다」가 「안 도는 줄 알았는데 안 돌았다」보다 나쁘다.
// 앞은 남의 문서를 덮고, 뒤는 담당자가 버튼으로 복구한다. 그래서 **못 읽으면 멈춘다.**
// 대신 조용하지 않게 — 부르는 쪽이 매번 로그를 남긴다.

export type PauseState =
  | { paused: false }
  | { paused: true; until: Date }
  | { paused: true; until: null; reason: string };

/** 값이 없으면 안 멈춘다. 있으면 그 시각까지 멈춘다. 못 읽으면 계속 멈춘다. */
export function mergePauseState(now: Date, raw = process.env.MERGE_PAUSE_UNTIL): PauseState {
  const v = (raw ?? '').trim();
  if (!v) return { paused: false };

  const until = new Date(v);
  if (Number.isNaN(until.getTime())) {
    return { paused: true, until: null, reason: `MERGE_PAUSE_UNTIL을 시각으로 읽을 수 없음: ${v}` };
  }
  return now.getTime() < until.getTime() ? { paused: true, until } : { paused: false };
}

/** 지금 병합이 멈춰 있나 */
export function mergePaused(now: Date, raw = process.env.MERGE_PAUSE_UNTIL): boolean {
  return mergePauseState(now, raw).paused;
}
