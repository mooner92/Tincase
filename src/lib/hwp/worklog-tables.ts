// RH-110 · RH-111 — 실형 양식의 업무 표 셋과 「※ 자문회의 실적」 표. 양식 ②(지속센터)는 실형 표 셋 위에 자문회의 집계표 하나가 더 있다.
// 쓰기·병합은 표를 순번으로 채우므로(writer `fillTable`), 집계표를 건너뛴 순번을 여기 한 곳에서 정한다 — 집계표가 없는 양식은 지금과 같다(0·1·2).
// 집계표는 머리 줄로 알아본다: 「구분 | 자문회의 | 전문가 세미나 | …」(전사본 정리 RU-63 R2와 같은 판정).
import type { HwpRecord } from './record';
import { locateTables, type TableSpan } from './writer';
import { cellText, setCellsAt } from './proto-rows';

const sq = (s: string) => s.replace(/\s+/g, '');

/** 머리 줄 글자들이 자문회의 집계표인가 */
export const isConsultHeader = (head: readonly string[]): boolean => sq(head[0] ?? '') === '구분' && sq(head[1] ?? '') === '자문회의';

const headOf = (recs: readonly HwpRecord[], t: TableSpan) =>
  t.cells
    .filter((c) => c.row === 0)
    .sort((a, b) => a.col - b.col)
    .map((c) => cellText(recs, c));

/** 업무 표의 순번들(`locateTables` 기준) — 자문회의 집계표를 뺀 앞에서부터 */
export function worklogOrdinals(recs: readonly HwpRecord[]): number[] {
  return locateTables(recs)
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !isConsultHeader(headOf(recs, t)))
    .map(({ i }) => i);
}

/** 자문회의 집계표의 순번 — 없으면 null */
export function consultOrdinal(recs: readonly HwpRecord[]): number | null {
  const i = locateTables(recs).findIndex((t) => isConsultHeader(headOf(recs, t)));
  return i < 0 ? null : i;
}

/** RH-113 — 자문회의 표의 값 넷을 쓴다. `label`과 같은 줄이 있으면 그 줄, 없으면 첫 줄(양식 ②는 한 줄이다). 빈 값은 「-」 */
export function writeConsultRow(recs: HwpRecord[], values: readonly string[], label?: string): boolean {
  const ord = consultOrdinal(recs);
  if (ord === null) return false;
  const t = locateTables(recs)[ord];
  const rowOf = (r: number) => t.cells.find((c) => c.row === r && c.col === 0);
  let row = 1;
  if (label) {
    for (let r = 1; r < t.rows; r++) {
      const c = rowOf(r);
      if (c && sq(cellText(recs, c)) === sq(label)) row = r;
    }
  }
  const vals = new Map<string, string>();
  for (let c = 1; c <= 4; c++) vals.set(`${row}:${c}`, (values[c - 1] ?? '').trim() || '-');
  setCellsAt(recs, ord, vals);
  return true;
}
