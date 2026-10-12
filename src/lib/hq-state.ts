// RU-82 — 본부 상태 기계(12 §2a)의 이름과, 본부장이 지금 [검토 완료 · 승인]할 판이 있는지의 판정.
// 서버(현황판·시험)와 화면(클라이언트 카드) 양쪽에서 읽으므로 lib에 둔다 — 둘이 따로 적으면 「버튼은 보이는데 서버는 409」처럼 갈라진다.

/** Q0 비어 있음 · Q1 준비됨·승인 전 · Q2 승인·총괄로 감 · Q3 보낸 뒤 바뀜 · Q4 승인 없이 감 · Qf 만들기 실패 */
export type HqStateCode = 'Q0' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Qf';

/**
 * RU-55 (2026-10-08 결정 d) — 본부장이 지금 승인할 판이 있나: 마지막으로 만든 본부본이 승인 전(Q1)·보낸 뒤 바뀜(Q3)·승인 없이 감(Q4).
 * 다시 이어 붙이기가 **실패한** 상태(Qf)여도 그 전에 만든 마지막 본부본(`lastGood`)은 승인할 수 있다 — 실패를 고치는 동안 본부장이 아무것도
 * 못 하면 기한에 본부가 통째로 빈다(비상구는 lead의 것이다). 승인은 그래도 본 판(runId·sha)에만 붙는다(서버 `approveHq`).
 */
export function hqApprovable(s: { state: HqStateCode; lastGood: HqStateCode }): boolean {
  const v = s.state === 'Qf' ? s.lastGood : s.state;
  return v === 'Q1' || v === 'Q3' || v === 'Q4';
}
