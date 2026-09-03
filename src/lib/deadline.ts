// DM-20 — 마감 **잠시 열기**. 늦게 낸 사람을 담당자가 받아 주는 유일한 길이다.
//
// ── 왜 「대신 올려 주기」가 아닌가 ──────────────────────────
// 담당자가 남의 이름으로 파일을 올리게 하면 **기록이 두 갈래로 갈린다**:
// 「누구 것인가」와 「누가 올렸나」. 화면 어디 한 곳에서 그 표시를 빠뜨리는 순간
// 기록이 거짓말을 하고, 그건 되돌릴 수 없다. 마감을 열면 **낸 사람이 자기 이름으로**
// 내므로 그 갈림 자체가 생기지 않는다.
//
// ── 잊어도 닫힌다 ★ ────────────────────────────────────────
// 열어 두고 잊는 것이 이 기능의 유일한 위험이다 — 그러면 마감이 사실상 없어진다.
// 그래서 여는 것이 아니라 **「언제까지」를 정하는 것**으로 만들었다. 시각이 지나면
// 아무도 손대지 않아도 닫힌다. 사람이 기억해야 지켜지는 규칙은 언젠가 안 지켜진다.
import { isLocked, type DeadlinePolicy } from './week';

/** 한 번 열 때 주는 시간. 대외 마감(15:00)까지 손쓸 수 있는 만큼 */
export const OPEN_MINUTES = 30;

/** 열림 기록 — DB 모델에서 필요한 것만 */
export interface SlotOpen {
  openUntil: Date;
  openedBy: string;
}

/** 지금 열려 있는가. 기록이 없거나 시각이 지났으면 닫힌 것이다 */
export function isOpenNow(open: SlotOpen | null | undefined, now: Date = new Date()): boolean {
  return !!open && now.getTime() <= open.openUntil.getTime();
}

/**
 * 제출이 막혀 있는가 — **마감 판정의 단일 진입점**.
 *
 * `isLocked`를 화면·API가 각자 부르면, 열기 기능을 붙일 때 한 곳을 빠뜨린다.
 * 빠뜨린 곳이 화면이면 「낼 수 있는데 못 낸다고 나오고」, 서버면 「열었는데 안 받는다」다.
 * 둘 다 조용한 실패라 이 함수 하나만 부르게 한다.
 */
export function isSubmissionLocked(
  slot: { opensAt: Date },
  division: DeadlinePolicy,
  open: SlotOpen | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isLocked(slot, division, now)) return false;
  return !isOpenNow(open, now);
}

/**
 * HM-34 — 이 주차의 **마감 이벤트 시각**. 자동 병합이 이 시각을 기준으로 돈다.
 *
 * 열었다 닫으면 **새 마감 이벤트**다. 그렇게 보지 않으면, 열어서 받은 늦은 제출이
 * 병합본에 안 들어간다 — 이미 성공한 병합이 있어서 자동 병합이 건너뛰기 때문이다.
 * 담당자가 [다시 병합]을 기억해서 눌러야 하는데, 그건 사람이 기억해야 지켜지는 규칙이다.
 *
 * 열려 있는 동안에는 `openUntil`이 아직 미래라 병합이 돌지 않는다 — 받는 중에 만들 이유가 없다.
 */
export function mergeGate(deadline: Date, open: SlotOpen | null | undefined): Date {
  if (!open) return deadline;
  return open.openUntil.getTime() > deadline.getTime() ? open.openUntil : deadline;
}
