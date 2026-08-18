// S-02 §5 테스트 사양. ID는 스펙과 1:1 (WS-T01~T22).
// 전 케이스는 명시적 인스턴트로 작성 — 실행 TZ와 무관해야 한다 (WS-T17/T18은 test:tz 스크립트로).
import { describe, expect, it } from 'vitest';
import {
  currentWeek,
  deadlineFor,
  describeWeek,
  formatDeadlineKo,
  isLocked,
  isMonthlyWeek,
  mondayOf,
  monthlyMondayOf,
  slotKind,
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


// ── WS-14/15 월간 주차 (사용자가 준 2026년 5·6월 달력이 정본이다) ──
describe('월간 주차 (WS-T23~T28)', () => {
  const kindOf = (y: number, mo: number, d: number) => describeWeek(kst(y, mo, d)).kind;

  it('[WS-T23] 2026년 5월 — 4·11·18일은 주간, 25일 주가 월간 (5/31이 일요일이라 그 주로 딱 끝난다)', () => {
    expect(kindOf(2026, 5, 4)).toBe('weekly');
    expect(kindOf(2026, 5, 11)).toBe('weekly');
    expect(kindOf(2026, 5, 18)).toBe('weekly');
    expect(kindOf(2026, 5, 25)).toBe('monthly');
    // 주차 번호는 그대로다 — 월간이라고 5주차가 되지 않는다
    expect(describeWeek(kst(2026, 5, 25)).label).toBe('5월 4주차');
  });

  it('[WS-T24] 2026년 6월 — 1·8·15·22일은 주간, 29일 주가 월간 (6/30 화요일, 주는 7월로 넘어간다)', () => {
    for (const d of [1, 8, 15, 22]) expect(kindOf(2026, 6, d)).toBe('weekly');
    expect(kindOf(2026, 6, 29)).toBe('monthly');
    expect(describeWeek(kst(2026, 6, 29)).label).toBe('6월 5주차');
  });

  it('[WS-T25] 달을 넘어가도 **월요일이 있는 달**의 월간이다', () => {
    // 6/29(월)~7/5(일) 주는 7월 날짜를 5일이나 포함하지만 6월 월간이다
    const w = describeWeek(kst(2026, 6, 29));
    expect(w.month).toBe(6);
    expect(w.kind).toBe('monthly');
    // 7월의 1주차는 7/6부터 시작한다
    expect(describeWeek(kst(2026, 7, 6)).label).toBe('7월 1주차');
    expect(describeWeek(kst(2026, 7, 6)).kind).toBe('weekly');
  });

  it('[WS-T26] 어느 달이든 월간 주는 **정확히 하나**다 (2026년 12개월 전수)', () => {
    for (let mo = 1; mo <= 12; mo++) {
      const monthlies: number[] = [];
      // 그 달에 있는 모든 월요일을 훑는다
      for (let d = 1; d <= 31; d++) {
        const t = kst(2026, mo, d);
        if (new Date(t.getTime() + 9 * 3600_000).getUTCMonth() + 1 !== mo) continue; // 달 넘어감
        if (mondayOf(t).getTime() !== t.getTime()) continue; // 월요일만
        if (isMonthlyWeek(t)) monthlies.push(d);
      }
      expect(monthlies, `${mo}월`).toHaveLength(1);
    }
  });

  it('[WS-T27] 월간 주에는 그 달의 마지막 날이 들어 있다 (2026년 전수)', () => {
    for (let mo = 1; mo <= 12; mo++) {
      const last = new Date(Date.UTC(2026, mo, 0)).getUTCDate();
      const mondayOfLastDay = mondayOf(kst(2026, mo, last));
      expect(isMonthlyWeek(mondayOfLastDay), `${mo}월 ${last}일`).toBe(true);
    }
  });

  it('[WS-T28] slotKind는 저장된 슬롯(월요일)만으로 판정한다', () => {
    expect(slotKind({ opensAt: kst(2026, 5, 25) })).toBe('monthly');
    expect(slotKind({ opensAt: kst(2026, 5, 18) })).toBe('weekly');
    expect(slotKind({ opensAt: kst(2026, 2, 23) })).toBe('monthly'); // 2/28(토)이 든 주
  });
});


// ── 장기 불변식 (WS-T29~T31) ────────────────────────────────
// "몇 년이 지나도 유지되는가"에 답하는 테스트다. 로직에 연도가 박혀 있으면 여기서 깨진다.
describe('장기 불변식 — 2020~2060 전수 (WS-T29~T31)', () => {
  const FROM = 2020;
  const TO = 2060; // 41년 × 12달 = 492개월

  /** 그 달에 있는 모든 월요일(1일~말일) */
  const mondaysIn = (y: number, mo: number): number[] => {
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const out: number[] = [];
    for (let d = 1; d <= last; d++) {
      const t = kst(y, mo, d);
      if (mondayOf(t).getTime() === t.getTime()) out.push(d);
    }
    return out;
  };

  it('[WS-T29] 모든 달에 월간 주가 **정확히 하나**', () => {
    const bad: string[] = [];
    for (let y = FROM; y <= TO; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const n = mondaysIn(y, mo).filter((d) => isMonthlyWeek(kst(y, mo, d))).length;
        if (n !== 1) bad.push(`${y}-${mo}: ${n}개`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('[WS-T30] 월간 주에는 그 달의 **말일**이 들어 있다 (윤년 2/29 포함)', () => {
    const bad: string[] = [];
    for (let y = FROM; y <= TO; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const monday = monthlyMondayOf(y, mo);
        const sunday = monday.getTime() + 6 * 86400_000;
        const lastDayT = kst(y, mo, last).getTime();
        if (!isMonthlyWeek(monday)) bad.push(`${y}-${mo} 월요일이 월간이 아님`);
        if (lastDayT < monday.getTime() || lastDayT > sunday) bad.push(`${y}-${mo} 말일이 주 밖`);
      }
    }
    expect(bad).toEqual([]);
    // 윤년 표본 — 2/29가 월간 주 안에 있어야 한다
    for (const y of [2024, 2028, 2032, 2048]) {
      const monday = monthlyMondayOf(y, 2);
      expect(new Date(Date.UTC(y, 1, 29, -9)).getTime()).toBeGreaterThanOrEqual(monday.getTime());
      expect(describeWeek(monday).kind).toBe('monthly');
    }
  });

  it('[WS-T31] 주차 번호는 늘 1~5이고, 한 달의 월요일은 4개 또는 5개다', () => {
    const bad: string[] = [];
    for (let y = FROM; y <= TO; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const ms = mondaysIn(y, mo);
        if (ms.length < 4 || ms.length > 5) bad.push(`${y}-${mo} 월요일 ${ms.length}개`);
        ms.forEach((d, i) => {
          const w = describeWeek(kst(y, mo, d));
          if (w.weekOfMonth !== i + 1) bad.push(`${y}-${mo}-${d} 주차 ${w.weekOfMonth} ≠ ${i + 1}`);
          if (w.month !== mo || w.year !== y) bad.push(`${y}-${mo}-${d} 소속 달 어긋남`);
        });
        // 마지막 월요일이 곧 월간 주다
        expect(describeWeek(kst(y, mo, ms[ms.length - 1])).kind, `${y}-${mo}`).toBe('monthly');
      }
    }
    expect(bad).toEqual([]);
  });
});
