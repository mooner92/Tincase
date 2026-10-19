// RH-89 — 평가 실적 칸 모양. 제출본은 「8건」 · 「총 검토건수 42건」(= 나머지 합)이다(2026-10-15 취합본 환경평가본부).
// 작성 화면과 서버가 같은 것을 쓴다 — 화면이 보여 준 합계가 그대로 나간다.

const NUM = /^(\d+)\s*건?$/;

/** 「총 …」 칸(합계 자리)의 위치 — 없으면 -1 */
export const totalIndex = (labels: readonly string[]) => labels.findIndex((l) => /^총/.test(l.replace(/\s+/g, '')));

/** 나머지 칸의 합(「N건」). 숫자·「-」·빈칸이 아닌 값이 있거나 숫자가 하나도 없으면 null — 모르는 걸 더하지 않는다 */
export function evaluationTotal(labels: readonly string[], vals: readonly string[]): string | null {
  const t = totalIndex(labels);
  if (t < 0) return null;
  let sum = 0;
  let any = false;
  for (let i = 0; i < labels.length; i++) {
    if (i === t) continue;
    const v = (vals[i] ?? '').trim();
    if (v === '' || v === '-') continue;
    const m = NUM.exec(v);
    if (!m) return null;
    sum += Number(m[1]);
    any = true;
  }
  return any ? `${sum}건` : null;
}

/** 숫자만 적은 칸에 「건」을 붙이고, 합계 칸이 비었으면 나머지 합으로 채운다. 글자로 적은 것은 그대로 둔다 */
export function normalizeEvaluation(labels: readonly string[], vals: readonly string[]): string[] {
  const out = labels.map((_, i) => {
    const v = (vals[i] ?? '').trim();
    return /^\d+$/.test(v) ? `${v}건` : v;
  });
  const t = totalIndex(labels);
  if (t >= 0 && (out[t] === '' || out[t] === '-')) {
    const total = evaluationTotal(labels, out);
    if (total) out[t] = total;
  }
  return out;
}
