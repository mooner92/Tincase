// WS-19 — 기획조정실 공지 해석.
//
// 실제로 받은 공지 두 건을 그대로 넣는다. 해석이 틀리면 **전 부서의 마감**이 틀린다 —
// 그래서 꼴 변형보다 요일 대조·오후 추정·연도 경계 같은 「조용히 틀리는」 자리를 더 본다.
import { describe, expect, it } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { KST } from '@/lib/week';
import { parseDeadlineNotice, reasonOf } from '@/lib/deadline-notice';

const kst = (d: Date) => {
  const k = new TZDate(d.getTime(), KST);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${k.getFullYear()}-${z(k.getMonth() + 1)}-${z(k.getDate())}(${'일월화수목금토'[k.getDay()]}) ${z(k.getHours())}:${z(k.getMinutes())}`;
};
const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(new TZDate(y, mo - 1, d, h, mi, 0, 0, KST).getTime());

/** 2026-10-06(화) 17:36 — 한글날 연휴로 대외 마감이 수 15:00으로 당겨진 공지 */
const 한글날공지 = `★ 이번 주 주간업무 제출 기한은 10월 07(수) 오후 3시입니다. ★

(연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)



안녕하세요. 기획조정실입니다.

주간업무 작성 요청드립니다.`;

/** 2026-09-21(월) — 추석 연휴. 이때 대외 마감(14:00)을 부서 마감으로 잘못 넣었다 */
const 추석공지 = `★ 업무보고 작성 양식 변경이 추가되었으니, 아래의 본문을 확인 후 작성 요청드립니다.

★★★ 이번 주 주간업무 제출 기한은 09월 23(수) 오후 2시입니다. ★★★

(추석 연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)`;

describe('WS-19 공지 해석', () => {
  it('[WS-T62] ★ 한글날 공지 — 대외 수 15:00 → 부서 수 14:00', () => {
    const r = parseDeadlineNotice(한글날공지, at(2026, 10, 6, 17, 36));
    if (!r.ok) throw new Error(r.error);
    expect(kst(r.external)).toBe('2026-10-07(수) 15:00');
    expect(kst(r.department)).toBe('2026-10-07(수) 14:00');
    expect(r.reason).toBe('연휴 일정으로');
    expect(r.matched).toContain('10월 07(수) 오후 3시');
    expect(r.assumedPm).toBe(false);
  });

  it('[WS-T63] ★ 추석 공지 — 대외 수 14:00 → 부서 수 13:00 (9/22에 한 시간 틀렸던 그 경우)', () => {
    const r = parseDeadlineNotice(추석공지, at(2026, 9, 21, 12, 58));
    if (!r.ok) throw new Error(r.error);
    expect(kst(r.external)).toBe('2026-09-23(수) 14:00');
    expect(kst(r.department)).toBe('2026-09-23(수) 13:00');
    expect(r.reason).toBe('추석 연휴 일정으로');
  });

  it('[WS-T64] 꼴이 달라도 읽는다', () => {
    const now = at(2026, 10, 6, 9);
    const cases: [string, string][] = [
      ['제출 기한: 10월 7일(수) 15:00', '2026-10-07(수) 15:00'],
      ['마감 10/7(수) 15시', '2026-10-07(수) 15:00'],
      ['제출 기한은 10월 7일 수요일 오후 3시 30분입니다', '2026-10-07(수) 15:30'],
      ['제출 기한은 10월 7일(수) 오후 3시 반', '2026-10-07(수) 15:30'],
      ['제출기한 10.7(수) 오후2시', '2026-10-07(수) 14:00'],
    ];
    for (const [text, want] of cases) {
      const r = parseDeadlineNotice(text, now);
      expect(r.ok, text).toBe(true);
      if (r.ok) expect(kst(r.external), text).toBe(want);
    }
  });

  it('[WS-T65] 요일이 날짜와 어긋나면 **적용하지 않는다** — 공지의 오타를 전 부서 마감으로 만들지 않는다', () => {
    const r = parseDeadlineNotice('제출 기한은 10월 07(목) 오후 3시입니다', at(2026, 10, 6, 9));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('수요일');
      expect(r.error).toContain('목');
    }
  });

  it('[WS-T66] 「오전/오후」가 없으면 1~7시는 오후로 읽고, **그렇게 읽었다고 말한다**', () => {
    const r = parseDeadlineNotice('제출 기한은 10월 07(수) 3시', at(2026, 10, 6, 9));
    expect(r.ok && kst(r.external)).toBe('2026-10-07(수) 15:00');
    expect(r.ok && r.assumedPm).toBe(true);
    // 8시 이후는 그대로 — 오전 11시 마감은 있을 수 있다
    const r2 = parseDeadlineNotice('제출 기한은 10월 07(수) 11시', at(2026, 10, 6, 9));
    expect(r2.ok && kst(r2.external)).toBe('2026-10-07(수) 11:00');
    expect(r2.ok && r2.assumedPm).toBe(false);
  });

  it('[WS-T67] 연도는 오늘에서 가장 가까운 해 — 12월 말 공지의 1월 마감은 다음 해다', () => {
    const r = parseDeadlineNotice('제출 기한은 1월 4(월) 오후 3시', at(2026, 12, 28, 10));
    expect(r.ok && kst(r.external)).toBe('2027-01-04(월) 15:00');
    // 그 해의 1월 4일(일요일)로 읽었다면 요일 대조에서 걸렸을 것이다
  });

  it('[WS-T68] 이유는 공지에서 — 없으면 「기획조정실 공지에 따라」', () => {
    expect(reasonOf('(연휴 일정으로 인한 마감 기한이니)')).toBe('연휴 일정으로');
    expect(reasonOf('(시스템 점검으로 인한 조정)')).toBe('시스템 점검으로');
    expect(reasonOf('(추석 연휴로 인한)')).toBe('추석 연휴로');
    expect(reasonOf('설날 연휴라 하루 당깁니다')).toBe('연휴 일정으로');
    expect(reasonOf('이번 주 제출 기한은 수요일입니다')).toBe('기획조정실 공지에 따라');
  });

  it('[WS-T69] 날짜가 없으면 실패를 말하고, 여러 날짜가 있으면 「기한」 문장의 것을 고른다', () => {
    const none = parseDeadlineNotice('주간업무 작성 요청드립니다.', at(2026, 10, 6, 9));
    expect(none.ok).toBe(false);
    expect(parseDeadlineNotice('   ', at(2026, 10, 6, 9)).ok).toBe(false);

    const mixed = parseDeadlineNotice(
      '10월 1일(목) 오후 2시 회의 결과를 반영했습니다.\n★ 이번 주 제출 기한은 10월 07(수) 오후 3시입니다. ★',
      at(2026, 10, 6, 9),
    );
    expect(mixed.ok && kst(mixed.external)).toBe('2026-10-07(수) 15:00');
  });
});
