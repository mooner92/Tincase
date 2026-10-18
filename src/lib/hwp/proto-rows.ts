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
  /** 짧은 이름 칸(구분 · 줄 이름) — 「칸에 맞춰 글자 줄이기」를 켠다. 긴 내용 칸은 끈다(HM-30) */
  fitCols?: readonly number[];
}

/** 확장 컨트롤 문자(8칸, CTRL_HEADER가 딸린다) — 한글 문서 형식 표 6 */
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
const CELL_SHRINK_TO_FIT = 0x04000000;
const PARA_CS_COUNT = 12;

/**
 * 칸 문단에 딸린 컨트롤을 본체와 글자 속 자리 표시째 걷는다.
 *
 * 원본 취합본은 복붙하다 단 정의(`cold`) 같은 컨트롤이 칸 안에 딸려 들어온 것이 있다(2026-10-17 실측 — 평가 실적 「2건」 칸 등 9곳).
 * `setCellText`는 글자 속 자리 표시(8칸)를 지우지만 컨트롤 본체(CTRL_HEADER)는 남긴다 — 짝이 깨져 한글이 「파일을 여는 동안 오류」로 거부한다.
 * 쓰는 칸에는 표·그림이 없으므로(업무일지 칸은 글자뿐) 모두 걷는다.
 */
export function stripCellControls(recs: HwpRecord[], cell: CellSpan): void {
  const lv = recs[cell.start].level;
  for (let k = cell.end - 1; k > cell.start; k--) {
    if (recs[k].tag !== TAG.PARA_HEADER || recs[k].level !== lv) continue;
    let e = k + 1;
    while (e < recs.length && recs[e].level > lv) e++;
    let removed = false;
    for (let c = e - 1; c > k; c--) {
      if (recs[c].tag !== TAG.CTRL_HEADER || recs[c].level !== lv + 1) continue;
      let ce = c + 1;
      while (ce < recs.length && recs[ce].level > lv + 1) ce++;
      recs.splice(c, ce - c);
      removed = true;
    }
    if (!removed) continue;
    let te = k + 1;
    while (te < recs.length && recs[te].level > lv) te++;
    const ti = recs.findIndex((x, i) => i > k && i < te && x.tag === TAG.PARA_TEXT && x.level === lv + 1);
    if (ti < 0) continue;
    const d = recs[ti].data;
    const keep: Buffer[] = [];
    for (let i = 0; i + 2 <= d.length; ) {
      const code = d.readUInt16LE(i);
      if (EXTENDED.has(code)) {
        i += 16;
        continue;
      }
      keep.push(d.subarray(i, i + 2));
      i += 2;
    }
    recs[ti] = { ...recs[ti], data: Buffer.concat(keep) };
  }
}

/** 글자를 바꾼 뒤 — 새 글자 수를 넘는 서식 구간을 덜어낸다(첫 구간은 남긴다). 한글은 구간 수와 위치가 글자와 맞는지 본다 */
function tidyRuns(recs: HwpRecord[], cell: CellSpan): void {
  const lv = recs[cell.start].level;
  for (let k = cell.start + 1; k < cell.end && k < recs.length; k++) {
    if (recs[k].tag !== TAG.PARA_HEADER || recs[k].level !== lv) continue;
    const n = recs[k].data.readUInt32LE(0) & 0x7fffffff;
    let e = k + 1;
    while (e < recs.length && recs[e].level > lv) e++;
    const ci = recs.findIndex((x, i) => i > k && i < e && x.tag === TAG.PARA_CHAR_SHAPE && x.level === lv + 1);
    if (ci < 0) continue;
    const d = recs[ci].data;
    const keep: Buffer[] = [];
    for (let o = 0; o + 8 <= d.length; o += 8) if (o === 0 || d.readUInt32LE(o) < n) keep.push(d.subarray(o, o + 8));
    if (keep.length * 8 === d.length) continue;
    recs[ci] = { ...recs[ci], data: Buffer.concat(keep) };
    const h = Buffer.from(recs[k].data);
    h.writeUInt16LE(keep.length, PARA_CS_COUNT);
    recs[k] = { ...recs[k], data: h };
  }
}

/** 「칸에 맞춰 글자 줄이기」 켜기 */
export function setShrinkToFit(recs: HwpRecord[], headerIdx: number): void {
  const r = recs[headerIdx];
  if (r.tag !== TAG.LIST_HEADER || r.data.length < 8) return;
  const d = Buffer.from(r.data);
  d.writeUInt32LE((d.readUInt32LE(4) | CELL_SHRINK_TO_FIT) >>> 0, 4);
  recs[headerIdx] = { ...r, data: d };
}

/** 한 칸에 글자를 쓴다 — 컨트롤 걷기 · 서식 · 글자 · 구간 정리 순 */
function writeCell(recs: HwpRecord[], cell: CellSpan, text: string, shape: number | null, fit: boolean): void {
  stripCellControls(recs, cell);
  const again = { ...cell, end: nextCellEnd(recs, cell) };
  if (fit) setShrinkToFit(recs, again.start);
  else clearShrinkToFit(recs, again.start);
  if (shape !== null) normalizeCharShape(recs, again, shape);
  const delta = setCellText(recs, again, text);
  tidyRuns(recs, { ...again, end: again.end + delta });
}

/** 컨트롤을 걷어 레코드가 줄었을 수 있다 — 칸 끝을 다시 잡는다(다음 LIST_HEADER 또는 표 서브트리 끝) */
function nextCellEnd(recs: readonly HwpRecord[], cell: CellSpan): number {
  const lv = recs[cell.start].level;
  let k = cell.start + 1;
  while (k < recs.length && recs[k].level >= lv && recs[k].tag !== TAG.LIST_HEADER) k++;
  return k;
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
    const emph = row.emphasisCol === cell.col && opts.emphasisShapeId != null;
    const shape = emph ? opts.emphasisShapeId! : firstCharShape(recs, cell);
    writeCell(recs, cell, row.texts[cell.col] ?? '', shape, opts.fitCols?.includes(cell.col) ?? false);
  }
}

/** 표 하나의 셀 글자를 (줄, 칸) 주소로 바꾼다 — 줄 수는 그대로. 자문회의·평가 실적처럼 줄이 정해진 표에 쓴다 */
export function setCellsAt(recs: HwpRecord[], tableOrdinal: number, values: ReadonlyMap<string, string>, fitCols: readonly number[] = []): void {
  const t = locateTables(recs)[tableOrdinal];
  if (!t) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  const ordered = [...t.cells].sort((a, b) => b.start - a.start);
  for (const cell of ordered) {
    const v = values.get(`${cell.row}:${cell.col}`);
    if (v === undefined) continue;
    writeCell(recs, cell, v, firstCharShape(recs, cell), fitCols.includes(cell.col));
  }
}

/** 셀 글자 읽기 — 다시 읽기 점검(RH-36)과 자문회의 줄 이름 찾기에 쓴다 */
export function cellText(recs: readonly HwpRecord[], cell: CellSpan): string {
  const parts: string[] = [];
  for (let k = cell.start; k < cell.end; k++) if (recs[k].tag === TAG.PARA_TEXT) parts.push(paraText(recs[k].data));
  return parts.join('\n');
}

/** 머리줄 칸 모두에 「칸에 맞춰 글자 줄이기」 — 「구분」처럼 좁은 칸의 굵은 머리 글자가 두 줄로 꺾이지 않게(2026-10-17 한글에서 확인) */
export function fitHeaderRow(recs: HwpRecord[], tableOrdinal: number): void {
  const t = locateTables(recs)[tableOrdinal];
  if (!t) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  for (const c of t.cells) if (c.row === 0) setShrinkToFit(recs, c.start);
}
