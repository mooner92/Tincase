// RH-31 — 표의 데이터 줄을 **종류별 원형 줄**에서 다시 짠다.
//
// 연구 본부 양식은 테두리 굵기·배경을 셀마다 다른 테두리 설정으로 그린다(머리 · 가운데 · 마지막 줄 · 과제 줄 하늘색).
// `resizeTable`처럼 마지막 줄 하나를 복제하면 줄마다 아래 굵은 선이 생기고, 칸 수가 다른 줄(과제 4칸 · 항목 6칸)은 만들 수 없다.
// 그래서 양식의 데이터 줄 하나하나를 **원형**으로 보고, 내보낼 줄마다 어느 원형을 복제할지 고른다. 새 레코드를 지어내지 않는다(HM-ABS).
import { TAG, paraText, type HwpRecord } from './record';
import { HwpWriteError, clearShrinkToFit, locateTables, normalizeCharShape, setCellText, type CellSpan, type TableSpan } from './writer';

const TBL_ROWS = 4;
const TBL_ROWSIZE = 18;
const LH_ROW = 10;

export interface ProtoRow {
  /** 양식 표의 데이터 줄 번호(머리줄 = 0, 첫 데이터 줄 = 1) */
  proto: number;
  /** 칸 번호(열 주소) → 글자. 없는 칸은 비운다 */
  texts: Readonly<Record<number, string>>;
  /** 이 줄의 강조 칸 — `emphasisShapeId`가 있을 때만 */
  emphasisCol?: number;
}

export interface RebuildOptions {
  emphasisShapeId?: number | null;
}

function rowCells(t: TableSpan, row: number): CellSpan[] {
  return t.cells.filter((c) => c.row === row).sort((a, b) => a.col - b.col);
}

/** 셀의 첫 글자 구간 서식 — 원형 셀의 「보통 모양」이다 */
function firstCharShape(recs: readonly HwpRecord[], cell: CellSpan): number | null {
  for (let k = cell.start; k < cell.end; k++) {
    if (recs[k].tag === TAG.PARA_CHAR_SHAPE && recs[k].data.length >= 8) return recs[k].data.readUInt32LE(4);
  }
  return null;
}

/**
 * `tableOrdinal`번째 표의 데이터 줄을 `rows`대로 다시 짜고 글자를 채운다. 머리줄은 그대로 둔다.
 * `rows`가 비면 원형 줄을 모두 지운 표(머리줄만)가 된다 — 호출자가 빈 표기를 넣어 막는다(RH-33).
 */
export function rebuildRows(recs: HwpRecord[], tableOrdinal: number, rows: readonly ProtoRow[], opts: RebuildOptions = {}): void {
  const t = locateTables(recs)[tableOrdinal];
  if (!t) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  if (t.rows < 2) throw new HwpWriteError(`${tableOrdinal + 1}번째 표에 원형 줄이 없습니다`);

  const protos = new Map<number, HwpRecord[][]>();
  for (let r = 1; r < t.rows; r++) {
    const cells = rowCells(t, r);
    if (cells.length === 0) throw new HwpWriteError(`${tableOrdinal + 1}번째 표 ${r}번 줄에 셀이 없습니다`);
    protos.set(
      r,
      cells.map((c) => recs.slice(c.start, c.end).map((x) => ({ ...x, data: Buffer.from(x.data) }))),
    );
  }
  for (const row of rows) {
    if (!protos.has(row.proto)) throw new HwpWriteError(`원형 줄 ${row.proto}이 표에 없습니다 (데이터 줄 ${t.rows - 1}개)`);
  }

  const data = t.cells.filter((c) => c.row >= 1);
  const from = Math.min(...data.map((c) => c.start));
  const to = Math.max(...data.map((c) => c.end));

  const built: HwpRecord[] = [];
  const sizes: number[] = [];
  rows.forEach((row, i) => {
    const cells = protos.get(row.proto)!;
    sizes.push(cells.length);
    for (const cell of cells) {
      for (const rec of cell) {
        const d = Buffer.from(rec.data);
        if (rec.tag === TAG.LIST_HEADER) d.writeUInt16LE(i + 1, LH_ROW);
        built.push({ ...rec, data: d });
      }
    }
  });
  recs.splice(from, to - from, ...built);

  const old = recs[t.tableIdx].data;
  const headerSize = old.readUInt16LE(TBL_ROWSIZE);
  const head = Buffer.from(old.subarray(0, TBL_ROWSIZE));
  head.writeUInt16LE(rows.length + 1, TBL_ROWS);
  const rowSizes = Buffer.alloc((rows.length + 1) * 2);
  rowSizes.writeUInt16LE(headerSize, 0);
  sizes.forEach((n, i) => rowSizes.writeUInt16LE(n, (i + 1) * 2));
  const tail = old.subarray(TBL_ROWSIZE + t.rows * 2);
  recs[t.tableIdx] = { ...recs[t.tableIdx], data: Buffer.concat([head, rowSizes, tail]) };

  const again = locateTables(recs).find((x) => x.tableIdx === t.tableIdx);
  if (!again) throw new HwpWriteError('표 재탐색에 실패했습니다');

  // 뒤에서부터 채운다 — 빈 칸에 글자 레코드가 생기면 뒤쪽 인덱스만 밀린다(writer fillTable과 같은 이유)
  const ordered = again.cells.filter((c) => c.row >= 1).sort((a, b) => b.start - a.start);
  for (const cell of ordered) {
    const row = rows[cell.row - 1];
    clearShrinkToFit(recs, cell.start);
    const emph = row.emphasisCol === cell.col && opts.emphasisShapeId != null;
    const shape = emph ? opts.emphasisShapeId! : firstCharShape(recs, cell);
    if (shape !== null) normalizeCharShape(recs, cell, shape);
    setCellText(recs, cell, row.texts[cell.col] ?? '');
  }
}

/** 표 하나의 셀 글자를 (줄, 칸) 주소로 바꾼다 — 줄 수는 그대로. 자문회의·평가 실적처럼 줄이 정해진 표에 쓴다 */
export function setCellsAt(recs: HwpRecord[], tableOrdinal: number, values: ReadonlyMap<string, string>): void {
  const t = locateTables(recs)[tableOrdinal];
  if (!t) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  const ordered = [...t.cells].sort((a, b) => b.start - a.start);
  for (const cell of ordered) {
    const v = values.get(`${cell.row}:${cell.col}`);
    if (v === undefined) continue;
    clearShrinkToFit(recs, cell.start);
    const shape = firstCharShape(recs, cell);
    if (shape !== null) normalizeCharShape(recs, cell, shape);
    setCellText(recs, cell, v);
  }
}

/** 셀 글자 읽기 — 다시 읽기 점검(RH-36)과 자문회의 줄 이름 찾기에 쓴다 */
export function cellText(recs: readonly HwpRecord[], cell: CellSpan): string {
  const parts: string[] = [];
  for (let k = cell.start; k < cell.end; k++) if (recs[k].tag === TAG.PARA_TEXT) parts.push(paraText(recs[k].data));
  return parts.join('\n');
}
