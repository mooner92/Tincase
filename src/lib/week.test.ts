// S-02 §5 테스트 사양. ID는 스펙과 1:1 (WS-T01~T22).
// 전 케이스는 명시적 인스턴트로 작성 — 실행 TZ와 무관해야 한다 (WS-T17/T18은 test:tz 스크립트로).
import { describe, expect, it } from 'vitest';
import {
  currentWeek,
  deadlineFor,
  describeWeek,
  formatDeadlineKo,
  isLocked,
  mondayOf,
  toKstIso,
  validateDeadlinePolicy,
} from './week';

/** KST 벽시계 → 인스턴트 */
const kst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h - 9, mi, s, ms));

const DEFAULT = { deadlineDow: 2, deadlineTime: '14:00' }; // 화 14:00
const WED = { deadlineDow: 3, deadlineTime: '15:00' };

describe('라벨 계산 (WS-02/03)', () => {
  it('[WS-T01] 2026-08-03(월) → 8월 1주차', () => {
    expect(describeWeek(kst(2026, 8, 3)).label).toBe('8월 1주차');
  });
  it('[WS-T02] 2026-08-10(월) → 8월 2주차 (실데이터 검증)', () => {
    const w = describeWeek(kst(2026, 8, 10));
    expect(w.label).toBe('8월 2주차');
    expect(w.isoKey).toBe('2026-W33');
  });
  it('[WS-T03] 2026-08-17(월) → 8월 3주차 (원 스펙 명시 예시)', () => {
    expect(describeWeek(kst(2026, 8, 17)).label).toBe('8월 3주차');
  });
  it('[WS-T04] 2026-08-31(월) → 8월 5주차', () => {
    expect(describeWeek(kst(2026, 8, 31)).label).toBe('8월 5주차');
  });
  it('[WS-T05] 2026-09-07(월) → 9월 1주차', () => {
    expect(describeWeek(kst(2026, 9, 7)).label).toBe('9월 1주차');
  });
});

describe('주 소속 판정 (WS-01)', () => {
  it('[WS-T06] 2026-08-13(목) 15:30 → 8월 2주차', () => {
    expect(currentWeek(kst(2026, 8, 13, 15, 30)).label).toBe('8월 2주차');
  });
  it('[WS-T07] 2026-08-16(일) 23:59 → 8월 2주차 (일요일은 직전 월요일 주)', () => {
    expect(currentWeek(kst(2026, 8, 16, 23, 59)).label).toBe('8월 2주차');
  });
  it('[WS-T08] 2026-08-17(월) 00:00:00 → 8월 3주차 (경계)', () => {
    expect(currentWeek(kst(2026, 8, 17, 0, 0, 0)).label).toBe('8월 3주차');
  });
  it('[WS-T09] 2026-08-16(일) 23:59:59.999 → 8월 2주차 (경계 직전)', () => {
    expect(currentWeek(kst(2026, 8, 16, 23, 59, 59, 999)).label).toBe('8월 2주차');
  });
});

describe('월 경계 (WS-04)', () => {
  it('[WS-T10] 2026-09-02(수) → 8월 5주차 (월요일 8/31이 8월)', () => {
    expect(currentWeek(kst(2026, 9, 2, 12)).label).toBe('8월 5주차');
  });
  it('[WS-T11] 2026-03-01(일) → 2월 4주차 (2/23 주)', () => {
    expect(currentWeek(kst(2026, 3, 1, 12)).label).toBe('2월 4주차');
  });
});

describe('마감 판정 (WS-06/13)', () => {
  const slot = { opensAt: mondayOf(kst(2026, 8, 12)) }; // 8/10(월) 주

  it('[WS-T12] 월 00:00:00 → 열림', () => {
    expect(isLocked(slot, DEFAULT, kst(2026, 8, 10, 0, 0, 0))).toBe(false);
  });
  it('[WS-T13] 화 13:59:59 → 열림', () => {
    expect(isLocked(slot, DEFAULT, kst(2026, 8, 11, 13, 59, 59))).toBe(false);
  });
  it('[WS-T14] 화 14:00:00 정각 → 열림 (`>` 비교 — 정각은 허용)', () => {
    expect(isLocked(slot, DEFAULT, kst(2026, 8, 11, 14, 0, 0))).toBe(false);
  });
  it('[WS-T15] 화 14:00:01 → 잠김', () => {
    expect(isLocked(slot, DEFAULT, kst(2026, 8, 11, 14, 0, 1))).toBe(true);
  });
  it('[WS-T16] 일 23:59:59 → 잠김', () => {
    expect(isLocked(slot, DEFAULT, kst(2026, 8, 16, 23, 59, 59))).toBe(true);
  });
  it('[WS-T20] dow=3 15:00 부서 · 수 14:59 → 열림', () => {
    expect(isLocked(slot, WED, kst(2026, 8, 12, 14, 59))).toBe(false);
  });
  it('[WS-T21] dow=3 15:00 부서 · 수 15:00:01 → 잠김', () => {
    expect(isLocked(slot, WED, kst(2026, 8, 12, 15, 0, 1))).toBe(true);
  });
  it('[WS-T22] 유효 정책에서 deadlineFor는 항상 opensAt 이후', () => {
    for (let dow = 1; dow <= 7; dow++) {
      for (const t of ['00:00', '09:30', '14:00', '23:59']) {
        const pol = { deadlineDow: dow, deadlineTime: t };
        if (validateDeadlinePolicy(pol) !== null) continue; // 퇴화 정책(월 00:00)은 저장 거부 대상
        const dl = deadlineFor(slot, pol);
        expect(dl.getTime()).toBeGreaterThan(slot.opensAt.getTime());
        expect(dl.getTime()).toBeLessThan(slot.opensAt.getTime() + 7 * 86400_000);
      }
    }
  });

  it('[DM-10] 퇴화·무효 정책은 검증기가 거부한다', () => {
    expect(validateDeadlinePolicy({ deadlineDow: 1, deadlineTime: '00:00' })).not.toBeNull();
    expect(validateDeadlinePolicy({ deadlineDow: 0, deadlineTime: '14:00' })).not.toBeNull();
    expect(validateDeadlinePolicy({ deadlineDow: 8, deadlineTime: '14:00' })).not.toBeNull();
    expect(validateDeadlinePolicy({ deadlineDow: 2, deadlineTime: '25:00' })).not.toBeNull();
    expect(validateDeadlinePolicy({ deadlineDow: 2, deadlineTime: '14:00' })).toBeNull();
    expect(validateDeadlinePolicy({ deadlineDow: 1, deadlineTime: '00:01' })).toBeNull();
  });
});

describe('시간대 견고성 (WS-07/T19)', () => {
  it('[WS-T19] UTC 2026-08-09T15:00Z (= KST 8/10 00:00) → 8월 2주차 열림', () => {
    const t = new Date('2026-08-09T15:00:00.000Z');
    const w = currentWeek(t);
    expect(w.label).toBe('8월 2주차');
    expect(isLocked({ opensAt: w.opensAt }, DEFAULT, t)).toBe(false);
  });
  it('opensAt은 KST 자정 정각 인스턴트다', () => {
    const w = currentWeek(kst(2026, 8, 13, 12));
    expect(w.opensAt.toISOString()).toBe('2026-08-09T15:00:00.000Z');
  });
});

describe('속성 테스트 (S-02 §5.6)', () => {
  it('∀t: mondayOf(t)는 KST 월요일 00:00이고, t는 그 주 안에 있다', () => {
    // 2026년 전체를 7시간 단위로 훑는다 (경계 다수 포함)
    for (let ms = kst(2026, 1, 1).getTime(); ms < kst(2027, 1, 1).getTime(); ms += 7 * 3600_000) {
      const t = new Date(ms);
      const m = mondayOf(t);
      expect(m.getTime()).toBeLessThanOrEqual(t.getTime());
      expect(t.getTime() - m.getTime()).toBeLessThan(7 * 86400_000);
      const w = describeWeek(m);
      expect(w.weekOfMonth).toBeGreaterThanOrEqual(1);
      expect(w.weekOfMonth).toBeLessThanOrEqual(5);
      // 월요일 00:00 KST인지: 그 인스턴트의 KST 시·분이 0이고 +1일 마감이 성립
      const period = 7 * 86400_000;
      const mod = (((m.getTime() - kst(2026, 1, 5).getTime()) % period) + period) % period;
      expect(mod).toBe(0); // 2026-01-05(월) 기준 7일 격자 위에 있다
    }
  });
});

describe('isoKey 경계 (WS-09)', () => {
  it('연 경계 주차 키가 ISO 8601과 일치한다', () => {
    // 알려진 ISO 값들 (외부 달력으로 검증된 고정값)
    expect(describeWeek(kst(2024, 12, 30)).isoKey).toBe('2025-W01'); // 12/30(월)이 2025-W01
    expect(describeWeek(kst(2026, 1, 5)).isoKey).toBe('2026-W02');   // 2026-01-01(목) → 1/5는 W02
    expect(describeWeek(kst(2025, 12, 29)).isoKey).toBe('2026-W01'); // 12/29(월)이 2026-W01
    expect(describeWeek(kst(2026, 12, 28)).isoKey).toBe('2026-W53'); // 2026년은 53주
    expect(describeWeek(kst(2027, 1, 4)).isoKey).toBe('2027-W01');
  });
  it('연속된 월요일의 isoKey는 전부 서로 다르고 단조 진행한다', () => {
    const seen = new Set<string>();
    let m = mondayOf(kst(2024, 1, 1));
    for (let i = 0; i < 160; i++) { // 약 3년
      const key = describeWeek(m).isoKey;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      m = new Date(m.getTime() + 7 * 86400_000);
    }
  });
});

describe('표시 유틸', () => {
  it('formatDeadlineKo — "8월 11일(화) 14:00"', () => {
    const dl = deadlineFor({ opensAt: mondayOf(kst(2026, 8, 12)) }, DEFAULT);
    expect(formatDeadlineKo(dl)).toBe('8월 11일(화) 14:00');
  });
  it('toKstIso — +09:00 오프셋 (API-04)', () => {
    expect(toKstIso(new Date('2026-08-11T05:00:00.000Z'))).toBe('2026-08-11T14:00:00+09:00');
  });
});
