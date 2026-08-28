// 병합본 **행**을 다루는 규칙. 화면과 서버가 **같은 코드**를 쓴다.
//
// 왜 공유하는가: 구분 번호(1-1, 2-3…)는 저장할 때 서버가 다시 매기고(ABS-5),
// 화면은 저장 전에 그 결과를 미리 보여줘야 한다 — 순서를 바꾸거나 행을 지운 뒤
// 「1-3, 1-1, 1-2」가 보이면 화면이 거짓을 말하는 것이기 때문이다.
//
// 두 곳에 같은 식을 적고 「같아야 한다」고 주석을 달아 두면 언젠가 한쪽만 바뀐다.
// 그래서 식을 하나만 두고 양쪽이 부른다.

/** 표 순서. 구분 번호의 앞자리가 여기서 나온다 (실적=1, 계획=2, 특이사항=3) */
export const BUCKETS = ['achievements', 'plans', 'notes'] as const;
export type BucketKey = (typeof BUCKETS)[number];

/**
 * ABS-5 — `i`번째 행의 구분 번호. 표 위치가 아니라 **`key`로** 앞자리를 구한다:
 * 표가 하나 빠진 채로 와도(특이사항 비우기 설정) 번호가 어긋나지 않는다.
 */
export function rowNo(key: string, i: number): string {
  return `${BUCKETS.indexOf(key as BucketKey) + 1}-${i + 1}`;
}

/**
 * CP-90 — `from`번째를 `to` 자리로 옮긴 **새 배열**. 원본은 건드리지 않는다.
 * 범위를 벗어나면 원본을 그대로 돌려준다 — 조용히 잘린 배열을 주는 것보다 낫다.
 *
 * 본문 행과 작성자 배열에 **같은 (from, to)로** 두 번 부르는 것이 이 함수의 쓰임이다.
 * 작성자는 행과 나란한 배열이라(TACP-17), 한쪽만 옮기면 한 칸씩 밀려 남의 이름이 붙는다.
 */
export function moveItem<T>(a: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...a];
  if (from < 0 || from >= a.length || to < 0 || to >= a.length) return [...a];
  const next = [...a];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
