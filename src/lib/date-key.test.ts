// HM-48 — 일자 칸 읽기. 실제 최종 취합본에 나온 꼴을 그대로 넣는다.
import { describe, expect, it } from 'vitest';
import { dateKey, firstDate } from './date-key';

/** 9월 주 (2026년). 연도 넘김이 일어나지 않는 평범한 주 */
const SEP = { year: 2026, month: 9 };
const DEC = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };

/** 읽은 날짜를 「연-월-일 시:분」으로 — 실패 메시지가 바로 읽히게 */
function show(cell: string, week = SEP): string | null {
  const d = firstDate(cell, week);
  if (!d) return null;
  const ymd = `${d.year}-${d.month}-${d.day}`;
  if (d.minutes === null) return ymd;
  return `${ymd} ${Math.floor(d.minutes / 60)}:${String(d.minutes % 60).padStart(2, '0')}`;
}

describe('HM-48 일자 칸 → 첫 날짜', () => {
  it('[HM-T120] 실제 보고서의 꼴 — 첫 날짜, 기간은 시작일, 기한은 그날', () => {
    const cases: [string, string][] = [
      ['9/30', '2026-9-30'],
      ['9/30(목)', '2026-9-30'],
      ['9/29~10/2', '2026-9-29'],
      ['9/29(화)~10/2(금)', '2026-9-29'],
      ['9/29~30', '2026-9-29'],
      ['~10/2', '2026-10-2'],
      ['~ 10/2(금)', '2026-10-2'],
      ['9/30, 10/2', '2026-9-30'],
      ['9/30(목),\n10/2(금)', '2026-9-30'], // 한 칸에 여러 줄 (HM-13)
      ['8.28', '2026-8-28'],
      ['8. 28.(목)', '2026-8-28'],
      ['9월 7일', '2026-9-7'],
      ['9월7일(월)', '2026-9-7'],
      ['9월 7~8일', '2026-9-7'],
      ['2026.9.30', '2026-9-30'],
      ['2026-09-30', '2026-9-30'],
      ['2026년 9월 30일', '2026-9-30'],
      ['계속(9/1~)', '2026-9-1'],
      ['\uFF19\uFF0F\uFF13\uFF10', '2026-9-30'], // 전각 9/30 — 한글에서 붙여 넣으면 섞여 온다 (UI-T90 때문에 이스케이프로)
    ];
    for (const [cell, want] of cases) expect(show(cell), JSON.stringify(cell)).toBe(want);
  });

  it('[HM-T121] 날짜 없음 — 상시·계속·집계성, 달만 있는 것, 읽을 수 없는 것', () => {
    const undated = ['', '  ', '-', '미정', '상시', '계속', '(계속)', '매주 월', '매월 10일', '10월 중', '9월 2주차', '수시', '3/4분기', '1/4 분기'];
    for (const cell of undated) {
      expect(firstDate(cell, SEP), JSON.stringify(cell)).toBeNull();
      expect(dateKey(cell, SEP), JSON.stringify(cell)).toBeNull();
    }
  });

  it('[HM-T122] 같은 날의 시각 — 그날 안에서 시각 순, 시각 없는 줄이 그날 맨 앞', () => {
    expect(show('10/1 14:00')).toBe('2026-10-1 14:00');
    expect(show('10/1(수) 14:00~16:00')).toBe('2026-10-1 14:00');
    expect(show('10/1(수) 오후 2시')).toBe('2026-10-1 14:00');
    expect(show('10/1 9시 30분')).toBe('2026-10-1 9:30');
    // 「10/1, 10/2」의 10은 시각이 아니다
    expect(show('10/1, 10/2')).toBe('2026-10-1');
    // 점 꼴의 끝 점 뒤에도 시각을 읽는다 (「8. 28.(목)」 꼴)
    expect(show('10. 1.(수) 14:00')).toBe('2026-10-1 14:00');
    // 「2시간」은 길이다 · 오전 12시는 자정
    expect(show('10/1 2시간')).toBe('2026-10-1');
    expect(show('10/1 오전 12시')).toBe('2026-10-1 0:00');
    expect(show('10/1 오후 12시')).toBe('2026-10-1 12:00');

    const k = (c: string) => dateKey(c, SEP)!;
    expect(k('10/1')).toBeLessThan(k('10/1 00:00')); // 시각 없는 줄 → 그날 맨 앞
    expect(k('10/1 09:00')).toBeLessThan(k('10/1 14:00'));
    expect(k('10/1 23:59')).toBeLessThan(k('10/2'));
    expect(k('9/30')).toBeLessThan(k('10/1'));
  });

  it('[HM-T123] 연도 넘김 — 12월 주의 1월은 다음 해, 반년 넘게 뒤의 달은 지난 해', () => {
    expect(show('1/5', DEC)).toBe('2027-1-5');
    expect(show('12/30', DEC)).toBe('2026-12-30');
    expect(show('12/30', JAN)).toBe('2026-12-30');
    expect(show('1/5', JAN)).toBe('2027-1-5');
    // 해를 넘는 기간 — 시작일의 해
    expect(show('12/28~1/3', DEC)).toBe('2026-12-28');
    expect(show('12/28~1/3', JAN)).toBe('2026-12-28');
    // 12월 주의 연간 사업 — 이번 달까지 이어지면 올해 시작이다
    expect(show('1/2~12/31', DEC)).toBe('2026-1-2');
    expect(show('1. 2.~12. 31.', DEC)).toBe('2026-1-2'); // 점 꼴도 같다
    expect(show('1/5~1/9', DEC)).toBe('2027-1-5');
    // 앞으로는 그 한 달만 넘긴다 — 연초부터 이어진 사업이 흔하다
    expect(show('1/10~', { year: 2026, month: 8 })).toBe('2026-1-10');
    expect(show('2/3~', { year: 2026, month: 12 })).toBe('2026-2-3');
    // 뒤로는 반년 넘게 앞선 달이면 지난해 시작이다 — 1월 주의 「11/30~」이 날짜 있는 줄 맨 뒤로 가지 않게
    expect(show('11/30~', JAN)).toBe('2026-11-30');
    expect(show('12/1', { year: 2026, month: 2 })).toBe('2025-12-1');
    expect(show('9/15~', { year: 2026, month: 2 })).toBe('2025-9-15');
    expect(show('8/20', { year: 2026, month: 2 })).toBe('2026-8-20'); // 반년 이내는 같은 해
    expect(show('12/1', { year: 2026, month: 7 })).toBe('2026-12-1');
    expect(dateKey('11/30~', JAN)!).toBeLessThan(dateKey('1/5', JAN)!);
    // 연도를 적었으면 적은 대로
    expect(show('2027.1.5', SEP)).toBe('2027-1-5');
    // 키도 해를 따른다 — 12월 주에서 1/5가 12/30 뒤
    expect(dateKey('1/5', DEC)!).toBeGreaterThan(dateKey('12/30', DEC)!);
    expect(dateKey('12/30', JAN)!).toBeLessThan(dateKey('1/5', JAN)!);
  });

  it('[HM-T124] 없는 날짜는 날짜가 아니다 — 다음 날짜를 찾는다', () => {
    expect(firstDate('2/30', SEP)).toBeNull();
    expect(firstDate('13/1', SEP)).toBeNull();
    expect(show('13/1, 9/3')).toBe('2026-9-3');
    // 「26.9.30」의 「6.9」를 6월 9일로 읽지 않는다
    expect(show('26.9.30')).toBe('2026-9-30');
    // 윤년
    expect(show('2/29', { year: 2028, month: 2 })).toBe('2028-2-29');
    expect(firstDate('2/29', { year: 2026, month: 2 })).toBeNull();
  });
});
