// HM-38 — 글로 적은 **강조 표시**를 알아본다.
//
// ── 왜 필요한가 ─────────────────────────────────────────────
// 규칙은 「주요 사항에는 파란색으로 작성」이지만, 실제로는 이렇게 온다:
//
//   2026년 제4차 발간위원회 개최 **(하이라이트)**
//
// 2026-09-03에 실제로 들어온 줄이다. 웹 작성에 「공유」 버튼이 생긴 게 그날 10:27인데
// 이분은 08:43에 냈으니 **표시할 방법이 없었다.** 그래서 글로 적었다.
//
// 버튼이 생긴 뒤에도 이 습관은 남는다 — 한글로 작성해 올리는 사람에게는 버튼이 없고,
// 색을 칠하는 것보다 괄호를 치는 게 빠르다. 「앞으로는 색으로 쓰세요」로 해결될 일이 아니다.
//
// ── 왜 병합에서 처리하나 ────────────────────────────────────
// 담당자가 병합본에서 손으로 고칠 수도 있다. 그런데 그건 **[다시 병합] 한 번에 사라진다** —
// 원본에는 여전히 「(하이라이트)」가 있기 때문이다. 매주 같은 손질을 반복하게 된다.
// 병합이 알아보면 한 번만 정하면 되고, 다시 병합해도 같은 결과가 나온다.
//
// ── 왜 괄호가 있어야만 하나 ★ ──────────────────────────────
// 낱말만 보고 잡으면 **「하이라이트 영상 제작」이 걸린다.** 홍보 부서에서 충분히 나올 수 있는
// 업무명이고, 그러면 낱말이 지워지고(「영상 제작」) 엉뚱한 줄이 파래진다.
// 원문을 고치는 처분이라 오탐 값이 비싸다 — 그래서 **괄호로 감싼 것만** 잡는다.
// 「(하이라이트)」는 표시하려고 적은 것이지 업무 이름이 아니다.
//
// 이건 「없음」 탐지(HM-33)와 정반대의 판단이다. 거기서는 처분이 알림 한 줄이라 느슨하게
// 잡아도 안전했다. 여기서는 **글자를 지우므로** 좁게 잡는다. 처분이 판정의 넓이를 정한다.

/** 기본 낱말 — 실제로 들어온 것 하나. 없는 말을 미리 넣어 두지 않는다 */
export const DEFAULT_EMPHASIS_WORDS = ['하이라이트'] as const;

/** 부서 설정 문자열 → 낱말 목록. `emptyWords`와 같은 규칙이라 배우는 게 늘지 않는다 */
export function parseEmphasisWords(raw: string): string[] {
  return raw
    .split(/[,·/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 12);
}

/**
 * 괄호 안의 그 낱말만. 소괄호·대괄호·꺾쇠 — 사람이 실제로 쓰는 것들.
 *
 * 전각 괄호는 **이스케이프로 적는다** (`\uFF08` 등). 한글에서 친 글에는 전각이 흔히 섞이는데,
 * 소스에 그 글자를 그대로 두면 [UI-T90](화면에 전각 기호를 쓰지 않는다)이 잡는다.
 * 그 검사는 **그려지는 글자**를 막는 것이고 여기 것은 **찾을 글자**라 뜻이 다르지만,
 * 검사에 예외를 파는 것보다 이쪽을 escape로 적는 편이 싸다 — 예외는 언젠가 남용된다.
 */
const OPEN = '(\\[\u3014<\uFF08\uFF3B';
const CLOSE = ')\\]\u3015>\uFF09\uFF3D';

function markerPattern(word: string): RegExp {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[${OPEN}]\\s*${w}\\s*[${CLOSE}]`, 'g');
}

export interface StripResult {
  /** 표시를 뗀 내용 */
  content: string;
  /** 표시가 있었는가 */
  marked: boolean;
}

/**
 * HM-38 — 괄호로 감싼 강조 표시를 떼고, 있었는지 알려준다.
 *
 * 뗀 자리에 남는 공백도 정리한다 — 「개최 (하이라이트)」에서 낱말만 빼면
 * 「개최 」로 끝나고, 그 뒤쪽 공백이 문서에 그대로 들어간다.
 */
export function stripEmphasisMarker(content: string, words: readonly string[]): StripResult {
  if (words.length === 0) return { content, marked: false };
  let out = content;
  let marked = false;
  for (const w of words) {
    const re = markerPattern(w);
    if (re.test(out)) {
      marked = true;
      out = out.replace(markerPattern(w), ' ');
    }
  }
  if (!marked) return { content, marked: false };
  return { content: out.replace(/\s{2,}/g, ' ').trim(), marked: true };
}
