// HM-27 순수 계층 — 분류 정렬.
// classify.ts(모델 호출)와 분리한 이유는 dedupe.ts와 같다: 정렬 규칙이 맞는지는
// 네트워크·env 없이 확인돼야 한다.

/** 부서가 정한 분류에 속하지 않는 업무 */
export const OTHER = '기타';

/**
 * 분류 순서대로 재배치. **같은 분류 안에서는 원래 순서를 그대로 둔다** (ABS-6 —
 * 작성자가 정한 순서를 규칙이 섞지 않는다).
 * 기타는 언제나 맨 뒤 — 분류에 없는 업무가 앞에 오면 부서 규칙이 무의미해진다.
 */
export function sortByCategory<T>(
  items: readonly T[],
  categoryOf: (item: T) => string,
  categories: readonly string[],
): T[] {
  const rank = new Map(categories.map((c, i) => [c, i]));
  const last = categories.length;
  return items
    .map((item, i) => ({ item, i, r: rank.get(categoryOf(item)) ?? last }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

/** HM-48 — 날짜를 못 읽은 줄의 자리 */
export type UndatedPlace = 'last' | 'first';

/**
 * HM-48 — 일자 순 재배치. **안정 정렬**이고, 키는 이 순서로 본다:
 *
 *   1. 분류 순번 (`category`를 줬을 때만) — 일자는 **분류 안에서** 정렬된다.
 *      부서가 정한 묶음(HM-27)을 날짜가 흩어 놓으면 분류를 정한 뜻이 사라진다
 *   2. 날짜 있음/없음 — `undated`가 정한 쪽에 날짜 없는 줄을 모은다
 *   3. 날짜 키 (같은 날은 시각까지 — `dateKey`)
 *   4. 원래 순서 — 같은 날·날짜 없는 줄끼리는 제출자 순 → 각자 적은 순서가 남는다 (ABS-6)
 *
 * 글자는 건드리지 않는다. 최악의 경우가 「자리가 틀림」이다 — 분류 정렬과 같은 이유로 안전하다.
 */
export function sortByDate<T>(
  items: readonly T[],
  dateOf: (item: T) => number | null,
  undated: UndatedPlace,
  category?: { of: (item: T) => string; order: readonly string[] },
): T[] {
  const rank = new Map((category?.order ?? []).map((c, i) => [c, i]));
  const last = rank.size;
  // 날짜 없는 줄이 뒤면 1, 앞이면 -1 — 날짜 있는 줄(0)과의 앞뒤만 정한다
  const side = undated === 'last' ? 1 : -1;
  return items
    .map((item, i) => {
      const key = dateOf(item);
      return {
        item,
        i,
        r: category ? (rank.get(category.of(item)) ?? last) : 0,
        u: key === null ? side : 0,
        k: key ?? 0,
      };
    })
    .sort((a, b) => a.r - b.r || a.u - b.u || a.k - b.k || a.i - b.i)
    .map((x) => x.item);
}
