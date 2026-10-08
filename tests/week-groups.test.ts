// PG-68·69 — 부서원 홈의 「지난 주차」: 어떤 주가 줄이 되고(PG-T92), 어떻게 달·해로 묶이나(PG-T93).
//
// 슬롯은 실제 주차 계산(describeWeek)으로 만든다 — 월요일의 달(WS-04)·월간 주(WS-14)·ISO 키가 실제와 같아야
// 「2026-W01은 2025년 12월」 같은 경계가 진짜로 시험된다. 모든 인스턴트는 KST 벽시계로 적는다 — 실행 TZ와 무관하다(test:tz).
import { describe, expect, it } from 'vitest';
import { describeWeek, mondayOf } from '@/lib/week';
import { groupPast, pickPastWeeks, yearFoldLabel, type MineLite, type PastWeek, type SlotLite } from '@/lib/week-groups';

const kst = (y: number, mo: number, d: number, h = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9));
const DAY = 86_400_000;

/** from(월요일 KST) 부터 n주 — 최신이 먼저 (DB 질의 순서와 같다) */
function slotsFrom(from: Date, n: number): SlotLite[] {
  const out: SlotLite[] = [];
  for (let i = 0; i < n; i++) {
    const w = describeWeek(new Date(from.getTime() + i * 7 * DAY));
    out.push({ id: w.isoKey, isoKey: w.isoKey, label: w.label, year: w.year, month: w.month, weekOfMonth: w.weekOfMonth, opensAt: w.opensAt });
  }
  return out.reverse();
}
const mineOf = (slotId: string, extra: Partial<MineLite> = {}): MineLite => ({
  id: `sub-${slotId}`,
  weekSlotId: slotId,
  divisionId: 'D',
  version: 1,
  uploadedAt: new Date(0),
  editedById: null,
  ...extra,
});

describe('[PG-T92] pickPastWeeks — 줄이 되는 주 (PG-68a)', () => {
  // 2026-08-03 ~ 2026-10-05 (10주). 이번 주 = 2026-W41(10월 1주차)
  const slots = slotsFrom(kst(2026, 8, 3), 10);
  const current = slots[0];
  const base = {
    slots,
    currentId: current.id,
    mine: [] as MineLite[],
    deptWeekIds: new Set<string>(),
    mergedWeekIds: new Set<string>(),
    divisionId: 'D',
    joinedMonday: mondayOf(kst(2026, 8, 20)), // 8월 3주차에 들어왔다
  };
  const keys = (r: PastWeek[]) => r.map((w) => w.isoKey);

  it('① 내 제출이 있는 주는 늘 줄 — 들어오기 전이어도, 근거가 없어도', () => {
    const r = pickPastWeeks({ ...base, mine: [mineOf('2026-W32')] });
    expect(keys(r)).toEqual(['2026-W32']);
  });

  it('② 병합본만 있는 주는 들어온 주부터 · ④ 근거 없는 주(연휴·사용 전)는 줄이 아니다', () => {
    const r = pickPastWeeks({ ...base, mergedWeekIds: new Set(['2026-W33', '2026-W34', '2026-W39']) });
    // W33(8/10)은 들어오기 전 — 내 「미제출」로 찍히지 않는다. W40처럼 아무 근거도 없는 주도 없다
    expect(keys(r)).toEqual(['2026-W39', '2026-W34']);
    expect(r.every((w) => w.mine === null && w.doc)).toBe(true);
  });

  it('③ 병합에 실패했어도 부서 제출이 있으면 줄이다 — 내가 안 냈다는 사실이 사라지지 않게', () => {
    const r = pickPastWeeks({ ...base, deptWeekIds: new Set(['2026-W38']) });
    expect(keys(r)).toEqual(['2026-W38']);
    expect(r[0].doc).toBe(false);
  });

  it('⑤ 이번 주는 줄이 아니다 — 카드에 있다', () => {
    const r = pickPastWeeks({ ...base, mine: [mineOf(current.id)], mergedWeekIds: new Set([current.id]) });
    expect(keys(r)).toEqual([]);
  });

  it('⑥ 다른 부서에 있을 때 낸 주는 doc=false — 지금 부서의 병합본에는 내 글이 없다', () => {
    const r = pickPastWeeks({
      ...base,
      mine: [mineOf('2026-W36', { divisionId: 'OLD' }), mineOf('2026-W37')],
      mergedWeekIds: new Set(['2026-W36', '2026-W37']),
    });
    expect(r.map((w) => [w.isoKey, w.doc])).toEqual([
      ['2026-W37', true],
      ['2026-W36', false],
    ]);
  });

  it('⑦ 담당자가 고친 판이면 edited=true — 고친 사람의 id는 밖으로 나가지 않는다 (PG-66e)', () => {
    const r = pickPastWeeks({ ...base, mine: [mineOf('2026-W37', { editedById: 'lead-secret-id' })] });
    expect(r[0].mine).toEqual({ id: 'sub-2026-W37', edited: true });
    expect(JSON.stringify(r)).not.toContain('lead-secret-id');
  });

  it('⑧ 월간 = 그 달 마지막 주 (WS-14 · slotKind)', () => {
    const r = pickPastWeeks({ ...base, mine: slots.slice(1).map((s) => mineOf(s.id)) });
    expect(r.filter((w) => w.monthly).map((w) => w.label)).toEqual(['9월 4주차', '8월 5주차']);
  });
});

/** 한 사람이 매주 낸 기록 — from 부터 now 주까지(now 주는 빼고). skip은 안 낸 주 */
function history(from: Date, now: Date, skip: string[] = []): PastWeek[] {
  const n = Math.round((mondayOf(now).getTime() - mondayOf(from).getTime()) / (7 * DAY)) + 1;
  const slots = slotsFrom(mondayOf(from), n);
  return pickPastWeeks({
    slots,
    currentId: slots[0].id,
    mine: slots.filter((s) => !skip.includes(s.isoKey)).map((s) => mineOf(s.id)),
    deptWeekIds: new Set(slots.map((s) => s.id)),
    mergedWeekIds: new Set(slots.map((s) => s.id)),
    divisionId: 'D',
    joinedMonday: mondayOf(from),
  });
}
const nowOf = (d: Date) => {
  const w = describeWeek(mondayOf(d));
  return { year: w.year, month: w.month };
};
/** 처음 보이는 줄 — 달 머리 + 해 구분선 + 펼친 달의 주 + 해 줄 (§3.4) */
const visibleLines = (g: ReturnType<typeof groupPast>) =>
  g.recent.length +
  g.recent.filter((m) => m.yearBreak !== null).length +
  g.recent.filter((m) => m.open).reduce((n, m) => n + m.weeks.length, 0) +
  g.older.length;

describe('[PG-T93] groupPast — 묶기와 접기 (PG-69)', () => {
  it('① 2026-W01(2025-12-29 주)은 2025년 12월 5주차 묶음, 2026-W53(2026-12-28 주)은 2026년 12월 4주차 — 월요일의 달', () => {
    const slots = slotsFrom(kst(2025, 12, 22), 55); // 이번 주 = 2027-01-04 — W53은 지난 주차다
    const w01 = slots.find((s) => s.isoKey === '2026-W01')!;
    const w53 = slots.find((s) => s.isoKey === '2026-W53')!;
    expect([w01.year, w01.month, w01.label]).toEqual([2025, 12, '12월 5주차']);
    expect([w53.year, w53.month, w53.label]).toEqual([2026, 12, '12월 4주차']);
    const past = pickPastWeeks({
      slots,
      currentId: slots[0].id,
      mine: [mineOf('2026-W01'), mineOf('2026-W53')],
      deptWeekIds: new Set(),
      mergedWeekIds: new Set(),
      divisionId: 'D',
      joinedMonday: kst(2025, 1, 1),
    });
    const g = groupPast(past, nowOf(slots[0].opensAt));
    const all = [...g.recent, ...g.older.flatMap((y) => y.months)];
    expect(all.find((m) => m.key === '2025-12')?.weeks.map((w) => w.isoKey)).toEqual(['2026-W01']);
    expect(all.find((m) => m.key === '2026-12')?.weeks.map((w) => w.isoKey)).toEqual(['2026-W53']);
  });

  it('② 월간은 그 달 마지막 점 · ⑧ 점은 오래된 것부터, done/total', () => {
    // 2026-10-08(목): 9월 = 1~4주차(9/28 주가 월간 — 8/31 주는 8월 5주차), 3주차(9/21)만 안 냈다
    const past = history(kst(2026, 8, 31), kst(2026, 10, 8), ['2026-W39']);
    const sep = groupPast(past, nowOf(kst(2026, 10, 8))).recent.find((m) => m.key === '2026-09')!;
    expect(sep.weeks.map((w) => w.label)).toEqual(['9월 4주차', '9월 3주차', '9월 2주차', '9월 1주차']);
    expect(sep.marks).toEqual([true, true, false, true]); // ●●○●
    expect(sep.weeks[0].monthly).toBe(true); // 맨 위(최신) = 마지막 점
    expect([sep.done, sep.total]).toEqual([3, 4]);
  });

  it('③ 창 = 이번 달 + 앞 11개 달, 해가 바뀌면 yearBreak 한 번 · ⑤ 펼침 = 줄 있는 최근 두 달(10월 첫 주에는 9월·8월)', () => {
    const now = kst(2026, 10, 8);
    const g = groupPast(history(kst(2025, 6, 2), now), nowOf(now));
    expect(g.recent.map((m) => m.key)).toEqual([
      '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01',
      '2025-12', '2025-11',
    ]);
    expect(g.recent.filter((m) => m.yearBreak !== null).map((m) => [m.key, m.yearBreak])).toEqual([['2025-12', 2025]]);
    expect(g.recent.filter((m) => m.open).map((m) => m.key)).toEqual(['2026-09', '2026-08']);
    // 창 밖(2025-06~10)은 해 줄 하나로 — 그 안의 달은 모두 접힘
    expect(g.older.map((y) => y.label)).toEqual(['2025년 6–10월']);
    expect(g.older[0].months.every((m) => !m.open && m.yearBreak === null)).toBe(true);
  });

  it('④ 옛 해 줄 이름 — 범위 · 한 해 전부면 해만 · 한 달이면 그 달', () => {
    expect(yearFoldLabel(2026, [12, 11, 10, 9, 8])).toBe('2026년 8–12월');
    expect(yearFoldLabel(2027, [12, 6, 1])).toBe('2027년');
    expect(yearFoldLabel(2026, [12])).toBe('2026년 12월');
  });

  it('⑥ 2027-01 첫 주면 2026-12가 맨 위 구분선 바로 아래에서 펼쳐진다 — 「12월」이 올해로 읽히지 않게', () => {
    const now = kst(2027, 1, 5); // 2027-01-04(월) 주
    const g = groupPast(history(kst(2026, 8, 3), now), nowOf(now));
    expect(g.recent[0].key).toBe('2026-12');
    expect(g.recent[0].yearBreak).toBe(2026);
    expect(g.recent.filter((m) => m.open).map((m) => m.key)).toEqual(['2026-12', '2026-11']);
  });

  it('⑦ 2028-11 — 2년 넘게 쌓여도 처음 보이는 줄은 22줄 안 (해 줄은 한 해에 하나씩만 는다)', () => {
    const now = kst(2028, 11, 15);
    const g = groupPast(history(kst(2026, 8, 3), now), nowOf(now));
    expect(g.older.map((y) => y.label)).toEqual(['2027년 1–11월', '2026년 8–12월']);
    expect(g.recent[0].key).toBe('2028-11');
    expect(visibleLines(g)).toBeLessThanOrEqual(22);
    // 해 줄의 수는 그해 달들의 합이다
    expect(g.older[1].total).toBe(g.older[1].months.reduce((n, m) => n + m.total, 0));
  });
});
