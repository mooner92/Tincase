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
