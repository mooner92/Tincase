// S-08 L4 — 표 편집 + 파일 재조립 (HM-16).
//
// 설계 원칙: **새로 만들지 않고 고친다.**
// 서식·글꼴·테두리·여백은 전부 원본 레코드가 들고 있다. 행을 늘릴 때도 새 레코드를
// 지어내지 않고 **같은 표의 기존 데이터 행을 통째로 복제**한 뒤 좌표와 글자만 바꾼다.
// 그래서 서식이 깨질 여지가 구조적으로 없다 (HM-ABS).
//
// 바이트 레이아웃 근거: docs/research/001-hwp-format-findings.md §4 (실측)
//
//   TABLE 레코드
//     0..3   속성        4..5  행 수      6..7  열 수      8..9  셀 간격
//     10..17 안쪽 여백   18..  행별 셀 수 (2B × 행 수)     +4B  테두리·영역
//
//   LIST_HEADER 레코드 (= 셀 하나)
//     0..1 문단 수   8..9 열   10..11 행   12..13 열병합   14..15 행병합
//     16..19 너비    20..23 높이
//
//   PARA_HEADER 레코드
//     0..3 글자 수 (최상위 비트는 플래그 — 반드시 보존)

import * as CFB from 'cfb';
import { deflateRawSync } from 'node:zlib';
import { HwpRecord, TAG, parseRecords, serializeRecords } from './record';

const TBL_ROWS = 4;
const TBL_COLS = 6;
const TBL_ROWSIZE = 18;
const LH_COL = 8;
const LH_ROW = 10;
const NCHARS_FLAG = 0x80000000;

export class HwpWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HwpWriteError';
  }
}

/** 한 셀이 차지하는 레코드 구간 [start, end) — start는 LIST_HEADER */
interface CellSpan {
  row: number;
  col: number;
  start: number;
  end: number;
}

export interface TableSpan {
  /** TABLE 레코드 위치 */
  tableIdx: number;
  /** 컨트롤 서브트리 끝 (exclusive) */
  end: number;
  rows: number;
  cols: number;
  cells: CellSpan[];
}

function ctrlId(data: Buffer): string {
  if (data.length < 4) return '';
  return Buffer.from([data[3], data[2], data[1], data[0]]).toString('latin1');
}

/** 섹션 레코드에서 표들의 구조를 등장 순서대로 잡는다 */
export function locateTables(recs: readonly HwpRecord[]): TableSpan[] {
  const out: TableSpan[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.tag !== TAG.CTRL_HEADER || ctrlId(r.data) !== 'tbl ') continue;

    let end = i + 1;
    while (end < recs.length && recs[end].level > r.level) end++;

    const tableIdx = recs.findIndex((x, k) => k > i && k < end && x.tag === TAG.TABLE);
    if (tableIdx < 0) continue;

    const cells: CellSpan[] = [];
    for (let k = tableIdx + 1; k < end; k++) {
      if (recs[k].tag !== TAG.LIST_HEADER) continue;
      let stop = k + 1;
      while (stop < end && recs[stop].tag !== TAG.LIST_HEADER) stop++;
      cells.push({
        col: recs[k].data.readUInt16LE(LH_COL),
        row: recs[k].data.readUInt16LE(LH_ROW),
        start: k,
        end: stop,
      });
    }
    out.push({
      tableIdx,
      end,
      rows: recs[tableIdx].data.readUInt16LE(TBL_ROWS),
      cols: recs[tableIdx].data.readUInt16LE(TBL_COLS),
      cells,
    });
  }
  return out;
}

/**
 * 셀의 글자를 바꾼다. 문단 끝 표시(CR 등)는 원본 꼬리를 그대로 이어붙여 보존한다.
 * PARA_HEADER의 글자 수도 같이 고친다 — 안 고치면 한글이 문단을 잘라 읽는다.
 */
export function setCellText(recs: HwpRecord[], cell: CellSpan, text: string): number {
  let headerIdx = -1;
  let textIdx = -1;
  for (let k = cell.start; k < cell.end; k++) {
    if (recs[k].tag === TAG.PARA_HEADER && headerIdx < 0) headerIdx = k;
    if (recs[k].tag === TAG.PARA_TEXT && textIdx < 0) textIdx = k;
  }
  if (headerIdx < 0) throw new HwpWriteError(`셀(${cell.row},${cell.col})에 PARA_HEADER가 없습니다`);

  // 빈 셀에는 PARA_TEXT 레코드 자체가 없다 (실측). 이때만 새로 만든다 —
  // PARA_TEXT는 UTF-16LE 글자뿐이고 서식은 PARA_CHAR_SHAPE가 들고 있어서 안전하다.
  const PARA_MARK = '\r'; // 0x000D — 채워진 셀의 꼬리와 동일 (실측)
  let inserted = 0;
  let tail = PARA_MARK;
  if (textIdx < 0) {
    textIdx = headerIdx + 1;
    recs.splice(textIdx, 0, {
      tag: TAG.PARA_TEXT,
      level: recs[headerIdx].level + 1,
      data: Buffer.alloc(0),
      extended: false,
    });
    inserted = 1;
  } else {
    // 문단 끝 제어 문자는 원본 그대로 유지하고 본문만 교체
    const old = recs[textIdx].data.toString('ucs2');
    let bodyLen = old.length;
    while (bodyLen > 0 && old.charCodeAt(bodyLen - 1) < 32) bodyLen--;
    tail = old.slice(bodyLen);
  }

  const next = Buffer.from(text + tail, 'ucs2');
  recs[textIdx] = { ...recs[textIdx], data: next };

  // 글자 수 갱신 — 안 고치면 한글이 문단을 잘라 읽는다. 최상위 플래그 비트는 보존
  const d = Buffer.from(recs[headerIdx].data);
  const flag = d.readUInt32LE(0) & NCHARS_FLAG;
  d.writeUInt32LE((flag | (next.length / 2)) >>> 0, 0);
  recs[headerIdx] = { ...recs[headerIdx], data: d };

  return inserted; // 레코드가 늘었으면 호출자가 인덱스를 다시 잡아야 한다
}

/**
 * 표의 데이터 행 수를 `targetDataRows`로 맞춘다 (머리글 행 1개는 항상 유지).
 * 늘릴 때는 **마지막 데이터 행을 복제**한다 — 서식·높이·테두리가 그대로 따라온다.
 * 줄일 때는 뒤에서부터 잘라낸다.
 *
 * 반환값은 레코드 배열이 바뀐 뒤의 새 TableSpan.
 */
export function resizeTable(recs: HwpRecord[], t: TableSpan, targetDataRows: number): TableSpan {
  const headerRows = 1;
  const target = Math.max(1, targetDataRows) + headerRows;
  if (target === t.rows) return t;

  if (target > t.rows) {
    const lastRow = t.rows - 1;
    const proto = t.cells.filter((c) => c.row === lastRow).sort((a, b) => a.col - b.col);
    if (proto.length === 0) throw new HwpWriteError('복제할 데이터 행을 찾지 못했습니다');

    // 마지막 셀 뒤에 이어 붙인다 (표 서브트리 안, 등장 순서 = 행 우선)
    const insertAt = Math.max(...proto.map((c) => c.end));
    const added: HwpRecord[] = [];
    for (let r = t.rows; r < target; r++) {
      for (const p of proto) {
        for (let k = p.start; k < p.end; k++) {
          const src = recs[k];
          const data = Buffer.from(src.data);
          if (src.tag === TAG.LIST_HEADER) data.writeUInt16LE(r, LH_ROW);
          added.push({ ...src, data });
        }
      }
    }
    recs.splice(insertAt, 0, ...added);
  } else {
    // 뒤쪽 행 제거 — 레코드 구간을 통째로 들어낸다
    const doomed = t.cells.filter((c) => c.row >= target);
    const from = Math.min(...doomed.map((c) => c.start));
    const to = Math.max(...doomed.map((c) => c.end));
    recs.splice(from, to - from);
  }

  // TABLE 레코드: 행 수 + 행별 셀 수 배열
  const old = recs[t.tableIdx].data;
  const cols = old.readUInt16LE(TBL_COLS);
  const head = Buffer.from(old.subarray(0, TBL_ROWSIZE));
  head.writeUInt16LE(target, TBL_ROWS);
  const rowSizes = Buffer.alloc(target * 2);
  for (let r = 0; r < target; r++) {
    // 기존 행은 원래 값을, 새 행은 열 수를 그대로 쓴다 (병합 셀 없는 양식 전제)
    rowSizes.writeUInt16LE(r < t.rows ? old.readUInt16LE(TBL_ROWSIZE + r * 2) : cols, r * 2);
  }
  const tail = old.subarray(TBL_ROWSIZE + t.rows * 2);
  recs[t.tableIdx] = { ...recs[t.tableIdx], data: Buffer.concat([head, rowSizes, tail]) };

  const relocated = locateTables(recs);
  const same = relocated.find((x) => x.tableIdx === t.tableIdx);
  if (!same) throw new HwpWriteError('표 재탐색에 실패했습니다');
  return same;
}

/**
 * 표 하나를 통째로 채운다 — 병합 엔진이 실제로 쓰는 진입점.
 * `rows[r][c]`가 데이터 r행 c열의 글자. 행 수는 여기에 맞춰 자동으로 늘고 준다.
 *
 * 셀을 **뒤에서부터** 채우는 이유: 빈 셀에 PARA_TEXT를 새로 넣으면 뒤쪽 인덱스가
 * 밀린다. 역순으로 가면 아직 안 건드린 셀의 위치는 항상 그대로다.
 */
export function fillTable(recs: HwpRecord[], tableOrdinal: number, rows: readonly (readonly string[])[]): void {
  const found = locateTables(recs)[tableOrdinal];
  if (!found) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  const t = resizeTable(recs, found, rows.length);

  const ordered = [...t.cells].filter((c) => c.row >= 1).sort((a, b) => b.start - a.start);
  for (const cell of ordered) {
    const text = rows[cell.row - 1]?.[cell.col] ?? '';
    setCellText(recs, cell, text);
  }
}

/**
 * 원본 파일의 모든 것(서식·글꼴·미리보기·스크립트)을 유지한 채
 * BodyText 섹션만 갈아 끼운다.
 */
export function packHwp(original: Buffer, sections: readonly Buffer[]): Buffer {
  const cf = CFB.read(original, { type: 'buffer' });
  sections.forEach((sec, n) => {
    CFB.utils.cfb_add(cf, `/BodyText/Section${n}`, deflateRawSync(sec, { level: 9 }));
  });
  return Buffer.from(CFB.write(cf, { type: 'buffer' }) as Uint8Array);
}

/** 편의 함수 — 섹션 레코드를 열고 고친 뒤 되돌려 준다 */
export function editSection(sectionBytes: Buffer, edit: (recs: HwpRecord[]) => void): Buffer {
  const recs = parseRecords(sectionBytes);
  edit(recs);
  return serializeRecords(recs);
}
