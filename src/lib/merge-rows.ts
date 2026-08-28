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

/** 대표 행 선택에 쓰는 최소 형태 — 병합 엔진의 큰 타입을 여기까지 끌고 오지 않는다 */
export interface RowLike {
  content: string;
  date: string;
  place: string;
  attendee: string;
}

/** 앞자리부터 사전식 비교. 양수면 a가 앞선다 */
function compare(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

/**
 * 비교용 압축 — 공백·문장부호만 턴다. **괄호 안 글자는 남긴다.**
 *
 * 중복 판정(`normalizeForCompare`)은 괄호를 통째로 버리지만 — 「진행(10건)」과 「진행(8건)」을
 * 같은 업무로 묶으려면 그래야 한다 — 여기서는 정반대다. 어느 줄이 **더 말하고 있는가**를
 * 재는 자리라, 괄호 안이야말로 세어야 할 것이다.
 */
const squash = (s: string) => s.replace(/[\s·,./\-–—~"'“”‘’()[\]]/g, '').toLowerCase();

/**
 * HM-36 — 합쳐진 묶음에서 **문서에 남길 한 줄**을 고른다.
 * 원문 중 하나를 고르는 것이지 새로 쓰는 것이 아니다.
 *
 * 순서대로 본다:
 *
 *   1. **다른 줄의 내용을 통째로 품고 있는가.** 품고 있으면 그 줄을 남겨도 잃는 말이 없다
 *   2. 채워진 칸 수 (일자·장소·참석자)
 *   3. 내용 길이
 *   4. 그래도 같으면 먼저 온 것 — 제출자 순서를 흔들지 않는다
 *
 * **1이 2보다 앞서는 이유.** 처음엔 칸 수만 셌고, 그래서 이런 일이 났다
 * (2026-08-27 AI홍보전략실):
 *
 *   김민정  온라인 홍보 콘텐츠 제작 및 등록(유튜브 1건, SNS 1건)   일자 없음
 *   장혜정  온라인 홍보 콘텐츠 제작 및 등록(유튜브 1건)            일자 8/27
 *
 * 칸 수로는 장혜정이 이기고, **「SNS 1건」이 문서에서 사라졌다.** 그런데 이 부서의 작성
 * 안내에는 「상시 반복 업무는 일자를 공란으로 둡니다」라고 적혀 있다 — **일자 공란은
 * 정상이고 내용이 빠지는 것은 손실이다.** 비어 있는 것이 정상인 칸을 근거로 실제 내용을
 * 버리면 안 된다.
 *
 * 서로 품지 못하는 경우(「(10건)」과 「(8건)」)는 어느 쪽도 더 말하지 않으므로 2로 넘어간다.
 * 그때는 무엇을 고르든 한쪽을 잃는데, 그건 기계가 정할 일이 아니라서
 * **수합 관리 화면이 두 줄을 나란히 보여주고 사람이 고친다** (HM-36 화면).
 */
export function pickRepresentative<T extends RowLike>(members: readonly T[]): T {
  const squashed = members.map((m) => squash(m.content));
  /** 나 말고 다른 줄의 내용을 몇 개나 품고 있는가 */
  const covers = (i: number) =>
    squashed.reduce((n, other, j) => (j !== i && other && squashed[i].includes(other) ? n + 1 : n), 0);

  const rank = (m: T, i: number): [number, number, number] => {
    const cells = [m.content, m.date, m.place, m.attendee].filter((x) => x.trim()).length;
    return [covers(i), cells, m.content.trim().length];
  };

  let best = 0;
  let bestRank = rank(members[0], 0);
  for (let i = 1; i < members.length; i++) {
    const r = rank(members[i], i);
    // 앞자리부터 사전식으로. 전부 같으면 바꾸지 않는다 = 먼저 온 것을 지킨다
    if (compare(r, bestRank) > 0) {
      best = i;
      bestRank = r;
    }
  }
  return members[best];
}

/**
 * HM-36 — 남긴 줄이 버린 줄의 **말을 다 담고 있는가.**
 *
 * 화면이 「빠짐」이라고 쓰려면 정말 빠졌어야 한다. 「…(유튜브 1건)」은
 * 「…(유튜브 1건, SNS 1건)」 안에 통째로 들어 있으므로 그 사람 내용은 하나도 안 빠졌다 —
 * 거기에 「빠짐」을 붙이면, 확인할 것이 없는데 확인하라고 부르는 셈이다.
 * (그런 표시가 쌓이면 정작 진짜 빠진 것도 안 본다.)
 *
 * 괄호 안까지 세는 `squash`로 비교한다. 일자·장소 같은 다른 칸은 보지 않는다 —
 * 이 함수가 답하는 것은 「내용이 빠졌는가」 하나다.
 */
export function contentCovered(kept: string, dropped: string): boolean {
  const d = squash(dropped);
  return d.length > 0 && squash(kept).includes(d);
}
