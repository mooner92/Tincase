// RH-39 — 긴 칸을 **한 줄 덜 쓰게** 자간을 조금 줄인다. 제출본에서 사람이 손으로 하던 일(10월 2주차 국토환경: 긴 항목 자간 -17~-21)을
// 도구가 맡는다. 한글의 실제 줄바꿈 계산은 글꼴 폭을 알아야 해서 여기서는 **어림**한다 — 한글·한자 = 1em, 그 밖(숫자·영문·기호·빈칸) = 0.5em.
// 어림이 틀릴 수 있어 여유(SAFETY)를 두고, 한 줄을 아낄 수 있을 때만, 바닥(FLOOR)까지만 줄인다 — 넘치면 손대지 않는다(지금처럼 줄이 늘 뿐).
import type { ShapeMetrics } from './charshape';

/** 사람이 줄인 범위의 바닥(원본 실측 -21) */
export const FLOOR = -22;
/** 어절 단위 줄바꿈·글꼴 폭 오차를 감안한 칸 폭 여유 */
const SAFETY = 0.94;

const wide = (ch: string) => /[ᄀ-ᇿ㄰-㆏가-힣一-鿿　-〿＀-￯]/.test(ch);

/** 한 줄(줄바꿈 없는 글)의 폭 — HWPUNIT */
function advance(text: string, m: ShapeMetrics, spacing: number): number {
  const em = (m.size * m.relSize) / 100;
  let w = 0;
  for (const ch of text) w += em * ((wide(ch) ? 1 : 0.5) * (m.ratio / 100) + spacing / 100);
  return w;
}

/** 칸에 몇 줄로 들어가나(어림) */
export function estimateLines(text: string, avail: number, m: ShapeMetrics, spacing: number): number {
  const usable = avail * SAFETY;
  return text.split('\n').reduce((a, seg) => a + Math.max(1, Math.ceil(advance(seg, m, spacing) / usable)), 0);
}

/**
 * 한 줄을 아낄 수 있으면 그 자간(가장 덜 줄인 값), 아니면 null. 이미 한 줄이거나, 바닥까지 줄여도 못 아끼면 null.
 * `avail`은 칸 폭에서 왼쪽·오른쪽 안 여백을 뺀 HWPUNIT.
 */
export function fitSpacing(text: string, avail: number, m: ShapeMetrics, floor = FLOOR): number | null {
  if (!text.trim() || avail <= 0 || m.size <= 0) return null;
  const now = estimateLines(text, avail, m, m.spacing);
  if (now <= 1) return null;
  for (let s = m.spacing - 1; s >= floor; s--) {
    if (estimateLines(text, avail, m, s) < now) return s;
  }
  return null;
}
