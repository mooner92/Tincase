// DM-20 — 마감 **잠시 열기**. 순수 판정만 본다 (DB는 통합 스위트에서).
//
// 이 기능의 위험은 하나다: **열어 두고 잊는 것.** 그러면 마감이 사실상 없어진다.
// 그래서 「연다」가 아니라 「언제까지」로 만들었고, 그 성질을 여기서 못박는다.
import { describe, expect, it } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { KST, deadlineFor } from '@/lib/week';
import { OPEN_MINUTES, isOpenNow, isSubmissionLocked, mergeGate } from '@/lib/deadline';

const 목14시마감 = { deadlineDow: 4, deadlineTime: '14:00' };
// 월 인덱스는 0부터 — 7이 8월이다. 2026-08-31(월) 개시 주차, 목요일은 9/3
const slot = { opensAt: new Date(new TZDate(2026, 7, 31, 0, 0, 0, 0, KST).getTime()) };
const 마감 = deadlineFor(slot, 목14시마감);
const at = (h: number, m: number) => new Date(new TZDate(2026, 8, 3, h, m, 0, 0, KST).getTime());

describe('DM-20 마감 잠시 열기', () => {
  it('[DM-T20] 열지 않으면 마감 뒤에는 못 낸다 — 원래 규칙 그대로', () => {
    expect(isSubmissionLocked(slot, 목14시마감, null, at(13, 59))).toBe(false);
    expect(isSubmissionLocked(slot, 목14시마감, null, at(14, 1))).toBe(true);
  });

  it('[DM-T21] 열어 두면 그 시각까지 낼 수 있다', () => {
    const open = { openUntil: at(14, 40), openedBy: '최명헌' };
    expect(isSubmissionLocked(slot, 목14시마감, open, at(14, 30))).toBe(false);
    expect(isSubmissionLocked(slot, 목14시마감, open, at(14, 40))).toBe(false); // 정각까지 (WS-06과 같은 결)
  });

  it('[DM-T22] **잊어도 닫힌다** — 시각이 지나면 저절로 잠긴다', () => {
    // 이 기능의 유일한 위험이 「열어 두고 잊는 것」이다. 사람이 기억해야 지켜지는 규칙은
    // 언젠가 안 지켜지므로, 여는 것이 아니라 「언제까지」를 정하는 것으로 만들었다
    const open = { openUntil: at(14, 40), openedBy: '최명헌' };
    expect(isSubmissionLocked(slot, 목14시마감, open, at(14, 41))).toBe(true);
    expect(isOpenNow(open, at(14, 41))).toBe(false);
  });

  it('[DM-T23] 마감 전이면 열림 여부와 무관하게 낼 수 있다', () => {
    const 지난주에_열었던것 = { openUntil: at(9, 0), openedBy: '최명헌' };
    expect(isSubmissionLocked(slot, 목14시마감, 지난주에_열었던것, at(11, 0))).toBe(false);
  });

  it('[DM-T24] 한 번 여는 시간은 대외 마감(15:00)까지 손쓸 만큼', () => {
    expect(OPEN_MINUTES).toBeGreaterThanOrEqual(15);
    expect(OPEN_MINUTES).toBeLessThanOrEqual(60);
  });
});

describe('DM-20 · HM-34 열었다 닫으면 새 마감 이벤트다', () => {
  /*
   * 이걸 안 하면 열어서 받은 늦은 제출이 **병합본에 안 들어간다** — 이미 성공한 병합이
   * 있어서 자동 병합이 건너뛰기 때문이다(HM-34). 그러면 담당자가 [다시 병합]을 기억해서
   * 눌러야 하는데, 그건 사람이 기억해야 지켜지는 규칙이다.
   */
  it('[DM-T25] 열지 않았으면 원래 마감이 그대로 기준이다', () => {
    expect(mergeGate(마감, null).getTime()).toBe(마감.getTime());
  });

  it('[DM-T26] 열어 두면 **닫히는 시각**이 새 기준이 된다', () => {
    const open = { openUntil: at(14, 40), openedBy: '최명헌' };
    expect(mergeGate(마감, open).getTime()).toBe(at(14, 40).getTime());
  });

  it('[DM-T27] 열려 있는 동안에는 병합이 돌지 않는다 — 받는 중에 만들 이유가 없다', () => {
    const open = { openUntil: at(14, 40), openedBy: '최명헌' };
    const gate = mergeGate(마감, open);
    expect(at(14, 20).getTime()).toBeLessThan(gate.getTime());
  });

  it('[DM-T28] 이미 지난 열림은 기준을 되돌리지 않는다', () => {
    // 마감보다 이른 시각에 닫힌 기록이 남아 있어도 마감이 앞당겨지면 안 된다
    const 옛것 = { openUntil: at(9, 0), openedBy: '최명헌' };
    expect(mergeGate(마감, 옛것).getTime()).toBe(마감.getTime());
  });
});
