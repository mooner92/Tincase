// WA-35 · WA-36a — 웹 작성의 시작점과 일자 예시.
import { describe, expect, it } from 'vitest';
import { composerStart, dateHint, sameRows } from './composer';

type Row = { content: string; date: string; place: string; attendee: string; emphasis?: boolean };
const blank = (): Row => ({ content: '', date: '', place: '', attendee: '', emphasis: false });
const row = (content: string, extra: Partial<Row> = {}): Row => ({ ...blank(), content, ...extra });
const submitted = {
  achievements: [row('실적 하나', { date: '10/6', emphasis: true }), row('실적 둘')],
  plans: [row('계획 하나')],
  notes: [],
};

describe('WA-35 — 「다시 작성」의 시작점', () => {
  it('[WA-T48] 임시본이 없으면 지금 낸 판 — 「공유」가 남고, 표마다 이어 적을 빈 줄 하나', () => {
    const { data, from } = composerStart<Row>(null, submitted, blank);
    expect(from).toBe('submission');
    expect(data.achievements.map((r) => r.content)).toEqual(['실적 하나', '실적 둘', '']);
    expect(data.achievements[0]).toMatchObject({ date: '10/6', emphasis: true });
    expect(data.plans.map((r) => r.content)).toEqual(['계획 하나', '']);
    expect(data.notes).toEqual([blank()]);
    // 받은 줄을 그대로 물려 쓰지 않는다 — 화면에서 고친 것이 원래 응답을 바꾸면 [다시 시작]이 고친 판으로 돌아간다
    data.achievements[0].content = '고침';
    expect(submitted.achievements[0].content).toBe('실적 하나');
  });

  it('[WA-T48] 내용 있는 임시본이 먼저다 — 적던 것을 지우지 않는다', () => {
    const draft = JSON.stringify({ achievements: [row('적던 것')], plans: [], notes: [] });
    const { data, from } = composerStart<Row>(draft, submitted, blank);
    expect(from).toBe('draft');
    expect(data.achievements[0].content).toBe('적던 것');
  });

  it('[WA-T48] 빈 임시본·깨진 임시본·옛 모양은 없는 것 — 예전 화면은 열기만 해도 빈 표를 써 두었다', () => {
    const empty = JSON.stringify({ achievements: [blank(), row('  ')], plans: [blank()], notes: [blank()] });
    expect(composerStart<Row>(empty, submitted, blank).from).toBe('submission');
    expect(composerStart<Row>('{not json', submitted, blank).from).toBe('submission');
    expect(composerStart<Row>(JSON.stringify({ achievements: 'x' }), submitted, blank).from).toBe('submission');
    expect(composerStart<Row>('null', submitted, blank).from).toBe('submission');
  });

  it('[WA-T48] 낸 판도 없으면(또는 비었으면) 빈 표 — 실적 3 · 계획 2 · 특이 1', () => {
    for (const s of [null, undefined, { achievements: [], plans: [], notes: [] }]) {
      const { data, from } = composerStart<Row>(null, s, blank);
      expect(from).toBe('blank');
      expect([data.achievements.length, data.plans.length, data.notes.length]).toEqual([3, 2, 1]);
    }
  });
});

describe('WA-36a — 일자 칸 예시는 이번 주 날짜', () => {
  // 2026-10-05(월) 00:00 KST = 2026-10-04T15:00Z
  const w41 = Date.UTC(2026, 9, 4, 15);

  it('[WA-T49] 이번 주 화요일 · 계획은 다음 주 화요일', () => {
    expect(dateHint(w41)).toBe('10/6');
    expect(dateHint(w41, 1)).toBe('10/13');
  });

  it('[WA-T49] 달·해가 바뀌는 주 — 2026-12-28(월) 주의 화요일은 12/29, 다음 주는 1/5', () => {
    const w53 = Date.UTC(2026, 11, 27, 15);
    expect(dateHint(w53)).toBe('12/29');
    expect(dateHint(w53, 1)).toBe('1/5');
    const sep = Date.UTC(2026, 8, 27, 15); // 2026-09-28(월)
    expect(dateHint(sep)).toBe('9/29');
    expect(dateHint(sep, 1)).toBe('10/6');
  });
});

describe('WA-37 — 「바뀌었나」는 내용으로', () => {
  const start = composerStart<Row>(null, submitted, blank).data;
  const clone = () => JSON.parse(JSON.stringify(start)) as typeof start;

  it('[WA-T51] 한 글자 쳤다 지우면 같다 · 끝의 빈 줄과 앞뒤 공백은 보지 않는다', () => {
    const typed = clone();
    typed.achievements[0].content = '실적 하나x';
    expect(sameRows(start, typed)).toBe(false);
    typed.achievements[0].content = '실적 하나';
    expect(sameRows(start, typed)).toBe(true);

    const padded = clone();
    padded.plans.push(blank(), blank());
    padded.achievements[1].content = '  실적 둘 ';
    expect(sameRows(start, padded)).toBe(true);
  });

  it('[WA-T51] 「공유」를 켜거나 일자·장소를 바꾸면 다르다 — 문서가 달라진다', () => {
    const shared = clone();
    shared.plans[0].emphasis = true;
    expect(sameRows(start, shared)).toBe(false);
    const dated = clone();
    dated.achievements[1].date = '10/7';
    expect(sameRows(start, dated)).toBe(false);
    const moved = clone();
    moved.achievements.reverse();
    expect(sameRows(start, moved)).toBe(false); // 순서도 문서다
  });
});
