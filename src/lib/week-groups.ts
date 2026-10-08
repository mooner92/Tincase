// PG-68·69 — 부서원 홈의 「지난 주차」: 어떤 주가 줄이 되고(pickPastWeeks), 어떻게 달·해로 묶이나(groupPast).
//
// DB·시계·TZ를 모른다. 달은 슬롯에 저장된 `year`·`month`(월요일의 달, WS-04)를 그대로 쓴다 —
// 화면이 날짜로 다시 세면 `2026-W01`(2025-12-29 주)이 1월로 넘어가 수합 관리·파일 이름과 갈라진다.
import { slotKind } from './week';

export interface SlotLite {
  id: string;
  isoKey: string;
  label: string;
  year: number;
  month: number;
  weekOfMonth: number;
  opensAt: Date;
}

export interface MineLite {
  id: string;
  weekSlotId: string;
  divisionId: string;
  version: number;
  uploadedAt: Date;
  editedById: string | null;
}

export interface PastWeek {
  isoKey: string;
  /** "9월 4주차" */
  label: string;
  year: number;
  month: number;
  weekOfMonth: number;
  /** WS-14 — 그 달 마지막 주(월간 업무일지) */
  monthly: boolean;
  /** 내 최신 판. 고친 사람의 id는 싣지 않는다 — 「고침」 여부만 (PG-66e) */
  mine: { id: string; edited: boolean } | null;
  /** 이 부서의 병합본을 열 수 있는 주 (§5.1) */
  doc: boolean;
}

/**
 * PG-68a — 줄이 되는 주.
 *
 *   내가 냈다(어느 부서에서 냈든 — AU-13)
 *   ∨ (이 부서에 제출이 하나라도 있다 ∨ 이 부서 성공 병합본이 있다) ∧ 내가 들어온 주부터
 *
 * 달력의 주를 전부 늘어놓지 않는 이유: 연휴·사용 전의 주가 「미제출」로 찍히면 기록이 거짓말을 한다.
 * 병합이 실패한 주도 이 부서에 제출이 있었으면 남는다 — 내가 안 냈다는 사실이 사라지지 않게.
 */
export function pickPastWeeks(i: {
  /** opensAt 내림차순, 이번 주 포함 */
  slots: SlotLite[];
  currentId: string;
  mine: MineLite[];
  deptWeekIds: ReadonlySet<string>;
  mergedWeekIds: ReadonlySet<string>;
  divisionId: string;
  /** mondayOf(user.createdAt) */
  joinedMonday: Date;
}): PastWeek[] {
  const current = i.slots.find((s) => s.id === i.currentId);
  const before = (s: SlotLite) => s.id !== i.currentId && (!current || s.opensAt.getTime() < current.opensAt.getTime());
  const mineOf = new Map(i.mine.map((m) => [m.weekSlotId, m]));
  const out: PastWeek[] = [];
  for (const s of i.slots) {
    if (!before(s)) continue; // 이번 주는 카드에 있다
    const m = mineOf.get(s.id) ?? null;
    const evidence = i.deptWeekIds.has(s.id) || i.mergedWeekIds.has(s.id);
    if (!m && !(evidence && s.opensAt.getTime() >= i.joinedMonday.getTime())) continue;
    out.push({
      isoKey: s.isoKey,
      label: s.label,
      year: s.year,
      month: s.month,
      weekOfMonth: s.weekOfMonth,
      monthly: slotKind(s) === 'monthly',
      mine: m && { id: m.id, edited: m.editedById !== null },
      // 옛 부서 시절에 낸 주의 [병합본]은 지금 부서의 것이라 내 글이 없다 — 두지 않는다
      doc: i.mergedWeekIds.has(s.id) && (!m || m.divisionId === i.divisionId),
    });
  }
  return out.sort((a, b) => b.year - a.year || b.month - a.month || b.weekOfMonth - a.weekOfMonth);
}

export interface MonthGroup {
  /** "2026-09" */
  key: string;
  year: number;
  month: number;
  /** 최신이 위 */
  weeks: PastWeek[];
  /** 낸 주 = true. 오래된 것부터(왼쪽 → 오른쪽) — 월간 주는 늘 마지막 점이다 */
  marks: boolean[];
  done: number;
  total: number;
  /** 처음 펼침 (69d) — 저장하지 않는다 */
  open: boolean;
  /** 이 달 위에 해 구분선을 둔다면 그 해 (69b) */
  yearBreak: number | null;
}

export interface YearFold {
  year: number;
  /** "2026년 8–12월" · "2027년" · "2026년 12월" */
  label: string;
  /** 최신이 위, 모두 접힘 */
  months: MonthGroup[];
  done: number;
  total: number;
}

export interface PastGroups {
  recent: MonthGroup[];
  older: YearFold[];
}

const monthIndex = (y: number, m: number) => y * 12 + (m - 1);

/** 69c — 해 줄 이름. 한 해를 다 덮으면 해만, 한 달뿐이면 그 달, 그 밖에는 범위 */
export function yearFoldLabel(year: number, months: number[]): string {
  const lo = Math.min(...months);
  const hi = Math.max(...months);
  if (lo === 1 && hi === 12) return `${year}년`;
  if (lo === hi) return `${year}년 ${lo}월`;
  return `${year}년 ${lo}–${hi}월`;
}

/**
 * PG-69 — 묶기와 접기.
 *
 *   최근 창 = 이번 주의 달 + 그 앞 11개 달. 달 줄로 늘어놓고, 창 안에서 해가 바뀌면 그 자리에 구분선 하나
 *   창보다 오래된 달 = 해마다 해 줄 하나(안에 그해 달 줄, 모두 접힘)
 *   처음 펼침 = 창 안에서 줄이 있는 최근 두 달
 *
 * 해 줄로 접는 이유: 몇 해가 지나도 첫 화면 줄 수가 늘지 않게(2년 뒤에도 22줄 안). 해 줄은 한 해에 하나씩만 는다.
 */
export function groupPast(weeks: PastWeek[], now: { year: number; month: number }, openRecent = 2): PastGroups {
  const byMonth = new Map<string, MonthGroup>();
  for (const w of weeks) {
    const key = `${w.year}-${String(w.month).padStart(2, '0')}`;
    let g = byMonth.get(key);
    if (!g) {
      g = { key, year: w.year, month: w.month, weeks: [], marks: [], done: 0, total: 0, open: false, yearBreak: null };
      byMonth.set(key, g);
    }
    g.weeks.push(w);
  }
  const months = [...byMonth.values()].sort((a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month));
  for (const g of months) {
    g.weeks.sort((a, b) => b.weekOfMonth - a.weekOfMonth);
    g.marks = [...g.weeks].reverse().map((w) => w.mine !== null);
    g.done = g.marks.filter(Boolean).length;
    g.total = g.weeks.length;
  }

  const floor = monthIndex(now.year, now.month) - 11;
  const recent = months.filter((g) => monthIndex(g.year, g.month) >= floor);
  recent.forEach((g, k) => {
    g.open = k < openRecent;
    // 맨 위 달이 지난해면(1월 첫 주) 그 위에 바로 구분선 — 「12월」이 올해 12월로 읽히지 않게
    const above = k === 0 ? now.year : recent[k - 1].year;
    g.yearBreak = g.year !== above ? g.year : null;
  });

  const olderByYear = new Map<number, MonthGroup[]>();
  for (const g of months.filter((g) => monthIndex(g.year, g.month) < floor)) {
    olderByYear.set(g.year, [...(olderByYear.get(g.year) ?? []), g]);
  }
  const older: YearFold[] = [...olderByYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, ms]) => ({
      year,
      label: yearFoldLabel(year, ms.map((m) => m.month)),
      months: ms,
      done: ms.reduce((n, m) => n + m.done, 0),
      total: ms.reduce((n, m) => n + m.total, 0),
    }));

  return { recent, older };
}
