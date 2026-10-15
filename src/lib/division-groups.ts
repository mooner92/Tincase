// PG-95 (2026-10-14) — 운영 화면 부서 표를 **조직도 모양**으로 늘어놓는다. 30개 부서가 한 줄로 쭉 뜨면 찾기도 보기도 어렵다
// (운영자: 「찾고, 보기 편하게」). 묶음은 ERP 「상위부서」(`parentKo` — 인원 최신화가 매주 맞춘다)를 따라 올라간 **최상위 단위**,
// 순서는 서버가 준 순서(= 등록 순서 = ERP 인원 현황 순서 = 조직도 순서)를 그대로 쓴다.
//
// 본부처럼 산하가 있는 최상위 단위는 그 부서 줄이 묶음의 머리가 되고 산하 실이 한 칸 들여 붙는다. 산하가 없는 단위(임원실 등)는 머리 줄 하나다.
// 검색·거르기로 산하 실만 맞으면 그 본부 줄을 **맥락으로** 함께 보인다(흐리게) — 어느 본부의 실인지 알아야 한다.
// 고치는 줄은 거르기와 상관없이 남는다(PG-94 — 값을 바꾸는 순간 줄이 사라지면 저장이 안 된 것처럼 보인다).

/** ERP 「상위부서」의 맨 위 — 이 이름이면 최상위 단위다 (lib/org-groups와 같은 값) */
const ORG_ROOT = '한국환경연구원';

export interface DivisionLike {
  id: string;
  nameKo: string;
  slug: string;
  parentKo: string;
  isActive: boolean;
  memberCount: number;
}

export type ShowFilter = 'all' | 'on' | 'off';

export interface ShownDivision<T> {
  row: T;
  /** 0 = 최상위 단위(본부·센터·본부 밖 단위) · 1 = 산하 실 */
  depth: 0 | 1;
  /** 산하가 있는 최상위 단위 — 묶음의 머리 */
  head: boolean;
  /** 거르기에는 안 맞지만 산하 실이 맞아 맥락으로 보이는 머리 줄 */
  context: boolean;
  /** 머리 줄에만 — 산하 실 수 · 그중 켜진 수 · 묶음 전체 인원(머리 포함) */
  summary?: { units: number; active: number; members: number };
}

/** 검색 비교용 — 띄어쓰기·대소문자를 가리지 않는다(「기후 대기」로도 찾게) */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export function arrangeDivisions<T extends DivisionLike>(
  rows: readonly T[],
  opts: { q: string; show: ShowFilter },
  editingId: string | null,
): ShownDivision<T>[] {
  const byName = new Map(rows.map((r) => [r.nameKo, r]));
  const topOf = (r: T): T => {
    let cur = r;
    const seen = new Set<string>();
    while (cur.parentKo !== ORG_ROOT && byName.has(cur.parentKo) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byName.get(cur.parentKo)!;
    }
    return cur;
  };
  const kidsOf = new Map<string, T[]>();
  const tops: T[] = [];
  for (const r of rows) {
    const top = topOf(r);
    if (top.id === r.id) tops.push(r);
    else kidsOf.set(top.id, [...(kidsOf.get(top.id) ?? []), r]);
  }

  const q = norm(opts.q);
  const byQuery = (r: T) => !q || norm(r.nameKo).includes(q) || r.slug.toLowerCase().includes(q);
  const byShow = (r: T) => opts.show === 'all' || (opts.show === 'on') === r.isActive;
  const editing = (r: T) => r.id === editingId;

  const out: ShownDivision<T>[] = [];
  for (const top of tops) {
    const kids = kidsOf.get(top.id) ?? [];
    // 본부 이름으로 찾으면 그 본부의 실을 다 보인다(거르기는 그대로) — 「기획경영본부」를 찾는 사람은 그 아래가 궁금하다
    const topHit = byQuery(top);
    const shownKids = kids.filter((k) => editing(k) || (byShow(k) && (topHit || byQuery(k))));
    const topSelf = editing(top) || (byShow(top) && topHit);
    if (!topSelf && shownKids.length === 0) continue;
    out.push({
      row: top,
      depth: 0,
      head: kids.length > 0,
      context: !topSelf,
      ...(kids.length > 0 && {
        summary: {
          units: kids.length,
          active: kids.filter((k) => k.isActive).length,
          members: kids.reduce((n, k) => n + k.memberCount, top.memberCount),
        },
      }),
    });
    for (const k of shownKids) out.push({ row: k, depth: 1, head: false, context: false });
  }
  return out;
}

/** 거르기 칸의 수 — 불러오기 전에는 그리지 않는다(PG-64) */
export function showCounts(rows: readonly { isActive: boolean }[]): Record<ShowFilter, number> {
  const on = rows.filter((r) => r.isActive).length;
  return { all: rows.length, on, off: rows.length - on };
}
