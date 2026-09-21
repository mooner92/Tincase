// WS-14 — **이 주차만의 마감 예외.**
//
// 2026-09-21 주는 추석 연휴로 전사 마감이 목 14:00 → **수 14:00**으로 당겨졌다.
// 부서 설정(deadlineDow)을 고쳤다 되돌리는 방식은 두 가지로 틀린다:
//   1. 되돌리는 일이 사람 기억에 남는다 — 잊으면 다음 주 마감이 통째로 틀린다
//   2. 부서 설정은 **지난 주차의 마감까지 소급해** 바꾼다 (마감은 그때그때 계산된다)
// 그래서 예외를 주차에 싣는다. 주차가 끝나면 예외도 같이 끝난다.
import { describe, expect, it } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { deadlineFor, dayBeforeAt, isLocked, KST } from '@/lib/week';
import { isSubmissionLocked } from '@/lib/deadline';
import { LAST_CALL_MINUTES } from '@/server/notify/deadline-reminder';
import { MERGE_DELAY_MINUTES } from '@/server/merge/run';

function kst(d: Date): string {
  const k = new TZDate(d.getTime(), KST);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][k.getDay()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getMonth() + 1}/${k.getDate()}(${dow}) ${p(k.getHours())}:${p(k.getMinutes())}`;
}

/** AI홍보전략실 기본 정책 — 목 14:00 */
const 부서 = { deadlineDow: 4, deadlineTime: '14:00' };

/** 2026-09-21(월) 개시 = 추석 주간 */
const 이번주 = { opensAt: new TZDate(2026, 8, 21, 0, 0, 0, 0, KST) as unknown as Date };
/** 2026-09-28(월) 개시 = 그 다음 주 */
const 다음주 = { opensAt: new TZDate(2026, 8, 28, 0, 0, 0, 0, KST) as unknown as Date };

const 추석예외 = { deadlineDowOverride: 3, deadlineTimeOverride: '14:00' };

describe('WS-14 주차별 마감 예외', () => {
  it('[WS-T50] 예외가 없으면 부서 기본값 — 목 14:00', () => {
    expect(kst(deadlineFor(이번주, 부서))).toBe('9/24(목) 14:00');
  });

  it('[WS-T51] 예외가 있으면 그것이 이긴다 — 수 14:00', () => {
    expect(kst(deadlineFor({ ...이번주, ...추석예외 }, 부서))).toBe('9/23(수) 14:00');
  });

  it('[WS-T52] **다음 주로 새지 않는다** — 이 파일의 존재 이유다', () => {
    // 예외는 이번 주 슬롯 행에만 있다. 다음 주 슬롯은 예외를 모른다
    expect(kst(deadlineFor({ ...이번주, ...추석예외 }, 부서))).toBe('9/23(수) 14:00');
    expect(kst(deadlineFor(다음주, 부서))).toBe('10/1(목) 14:00');
  });

  it('[WS-T53] 지난 주차도 안 흔들린다 — 부서 설정을 고쳤다면 소급됐을 것이다', () => {
    const 지난주 = { opensAt: new TZDate(2026, 8, 14, 0, 0, 0, 0, KST) as unknown as Date };
    expect(kst(deadlineFor(지난주, 부서))).toBe('9/17(목) 14:00');
  });

  it('[WS-T54] 요일만·시각만 따로 당길 수 있다', () => {
    expect(kst(deadlineFor({ ...이번주, deadlineDowOverride: 3 }, 부서))).toBe('9/23(수) 14:00');
    expect(kst(deadlineFor({ ...이번주, deadlineTimeOverride: '11:00' }, 부서))).toBe('9/24(목) 11:00');
  });

  it('[WS-T55] null·undefined는 예외가 아니다 — 기본값으로 떨어진다', () => {
    expect(kst(deadlineFor({ ...이번주, deadlineDowOverride: null, deadlineTimeOverride: null }, 부서)))
      .toBe('9/24(목) 14:00');
  });

  it('[WS-T56] 이상한 예외 값은 조용히 넘어가지 않고 던진다', () => {
    expect(() => deadlineFor({ ...이번주, deadlineDowOverride: 0 }, 부서)).toThrow();
    expect(() => deadlineFor({ ...이번주, deadlineDowOverride: 8 }, 부서)).toThrow();
    expect(() => deadlineFor({ ...이번주, deadlineTimeOverride: '25:00' }, 부서)).toThrow();
    expect(() => deadlineFor({ ...이번주, deadlineTimeOverride: '1400' }, 부서)).toThrow();
  });
});

/**
 * 마감을 세는 곳이 여럿이라, **예외를 아는 곳과 모르는 곳이 갈리는 것**이 진짜 위험이다
 * (TACP-12). 「화면은 수요일 마감인데 서버는 목요일에 잠그는」 상태는 조용하다.
 */
describe('WS-14 예외가 잠금 판정까지 따라온다', () => {
  const 슬롯 = { ...이번주, ...추석예외 };
  const 수요일_14시_1분 = new Date(new TZDate(2026, 8, 23, 14, 1, 0, 0, KST).getTime());
  const 수요일_13시 = new Date(new TZDate(2026, 8, 23, 13, 0, 0, 0, KST).getTime());

  it('[WS-T57] 수 14:00을 넘기면 잠긴다 — 목요일까지 열려 있지 않다', () => {
    expect(isLocked(슬롯, 부서, 수요일_13시)).toBe(false);
    expect(isLocked(슬롯, 부서, 수요일_14시_1분)).toBe(true);
    // 예외가 없었다면 수요일 14:01에도 열려 있다 — 이 대비가 예외가 먹혔다는 증거다
    expect(isLocked(이번주, 부서, 수요일_14시_1분)).toBe(false);
  });

  it('[WS-T58] 제출 잠금 단일 진입점도 예외를 안다', () => {
    expect(isSubmissionLocked(슬롯, 부서, null, 수요일_14시_1분)).toBe(true);
    // 담당자가 열어 두면 예외 주차에도 똑같이 받아 준다 (DM-20)
    const 열림 = { openUntil: new Date(new TZDate(2026, 8, 23, 14, 30, 0, 0, KST).getTime()), openedBy: 'x' };
    expect(isSubmissionLocked(슬롯, 부서, 열림, 수요일_14시_1분)).toBe(false);
  });
});

/**
 * 사용자가 실제로 요구한 것: 「알림 일정을 하루씩 앞당겨야 할 듯」.
 * 상수를 손대지 않고 **마감만 옮기면 전 일정이 따라오는지**를 본다.
 */
describe('WS-14 예외 주간의 전체 일정', () => {
  const 마감 = deadlineFor({ ...이번주, ...추석예외 }, 부서);

  it('[WS-T59] 마감이 수 14:00이다', () => {
    expect(kst(마감)).toBe('9/23(수) 14:00');
  });

  it('[WS-T60] 하루 전 알림이 **화** 11:45로 따라온다 — 상수를 고치지 않았다', () => {
    expect(kst(dayBeforeAt(마감, '11:45'))).toBe('9/22(화) 11:45');
  });

  it('[WS-T61] 1시간 전·최후·병합 시작이 전부 수요일로 따라온다', () => {
    expect(kst(new Date(마감.getTime() - 60 * 60_000))).toBe('9/23(수) 13:00');
    expect(kst(new Date(마감.getTime() - LAST_CALL_MINUTES * 60_000))).toBe('9/23(수) 13:50');
    expect(kst(new Date(마감.getTime() + MERGE_DELAY_MINUTES * 60_000))).toBe('9/23(수) 14:01');
  });
});
