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
/**
 * HM-42 — **문서에 넣을 수 있는 글자만 남긴다.** writer의 마지막 방어선이다.
 *
 * HWP 본문에서 1유닛이 아닌 제어 문자(탭 9, 그 밖의 0~31)를 그냥 써 넣으면, 한글은 그것을
 * **8유닛짜리 컨트롤의 머리**로 읽는다 — 뒤 글자 일곱 개를 통째로 삼키거나 문단이 깨진다.
 * 눈에 보이지 않는 글자라 화면에서는 멀쩡해 보이고, 병합 자체 점검(HM-22)에서야
 * 「내용이 다르다」로 터진다. 2026-09-03에 줄바꿈으로 그 주 병합이 멈춘 것이 그 종류였다.
 *
 * 그래서 **낱개로 막지 않고 여기서 한 번에** 거른다. 위층이 무엇을 보내든
 * 「넣은 대로 다시 읽힌다」가 성립하게 만드는 것이 이 함수의 일이다 (`[HM-T95]`).
 *
 *   줄바꿈(10)  남긴다 — 한 칸에 두 줄을 적는 것은 정상이다 (HM-39)
 *   탭(9)       공백으로 — 표 칸에서 탭은 뜻이 없고, 그대로 두면 문서가 깨진다
 *   그 밖 0~31  버린다
 */
export function sanitizeCellText(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c === 10) out += '\n';
    else if (c === 9) out += ' ';
    else if (c < 32) continue;
    else out += ch;
  }
  return out;
}

export function setCellText(recs: HwpRecord[], cell: CellSpan, text: string): number {
  /*
   * HM-28 — **줄 배치 캐시(PARA_LINE_SEG)를 버린다.**
   *
   * 이 레코드는 "이 문단은 몇 줄이고 각 줄이 몇 번째 글자에서 시작해 폭이 얼마인가"를
   * 미리 계산해 둔 것이다. 글자만 바꾸고 이 값을 그대로 두면 한글은 **옛 글자 기준의
   * 줄 배치로** 새 글자를 그린다 — 긴 글이 한 줄에 욱여넣어지며 자간이 무너지고 글자가
   * 겹친다 (병합본의 «메가프로젝트 … 참석 및 지원» 행이 그랬다).
   *
   * 글꼴 폭을 모르므로 다시 계산할 수는 없다. 대신 **지운다** — 캐시가 없으면 한글이
   * 열 때 직접 계산하고, 칸 폭을 넘는 글은 자연스럽게 다음 줄로 넘어간다(칸이 아래로 늘어난다).
   */
  let removed = 0;
  for (let k = cell.end - 1; k >= cell.start; k--) {
    if (recs[k].tag === TAG.PARA_LINE_SEG) {
      recs.splice(k, 1);
      removed++;
    }
  }
  /*
   * ★ PARA_HEADER는 **뒤따르는 레코드의 개수를 자기 안에 들고 있다.**
   *   12-13 charShapeCount · 14-15 rangeTagCount · **16-17 lineAlignCount(줄 수)**
   *
   * 레코드만 지우고 이 수를 그대로 두면 한글이 "있어야 할 줄 정보가 없다"고 보고
   * **문서 손상**으로 판정한다 (실측: 문단 78개 중 35개 불일치 → 열리지 않음).
   * 빈 셀의 PARA_TEXT 때(HM-11a)와 같은 부류의 실수다 — 라이브러리는 그냥 읽지만
   * 한글은 자기 안의 앞뒤가 맞는지 본다.
   */
  if (removed > 0) {
    for (let k = cell.start; k < cell.end - removed && k < recs.length; k++) {
      if (recs[k].tag !== TAG.PARA_HEADER || recs[k].data.length < 18) continue;
      const d = Buffer.from(recs[k].data);
      d.writeUInt16LE(0, 16); // lineAlignCount = 0 → 한글이 열 때 다시 계산한다
      recs[k] = { ...recs[k], data: d };
    }
  }
  // 지운 만큼 이 셀의 끝이 당겨졌다. 이 경계를 지키지 않으면 빈 칸을 처리할 때
  // **다음 셀의 PARA_TEXT를 잡아** 남의 글자를 고치게 된다
  const end = cell.end - removed;

  let headerIdx = -1;
  let textIdx = -1;
  for (let k = cell.start; k < end; k++) {
    if (recs[k].tag === TAG.PARA_HEADER && headerIdx < 0) headerIdx = k;
    if (recs[k].tag === TAG.PARA_TEXT && textIdx < 0) textIdx = k;
  }
  if (headerIdx < 0) throw new HwpWriteError(`셀(${cell.row},${cell.col})에 PARA_HEADER가 없습니다`);

  const PARA_MARK = '\r'; // 0x000D — 문단 끝 (실측)
  let delta = -removed; // 레코드 수 변화 — LINE_SEG 삭제분부터 센다

  if (text === '') {
    // ★ 빈 칸에는 PARA_TEXT 레코드가 **없어야 한다** (원본 양식 실측: 빈 셀 20개 전부 없음).
    // 문단끝 표시만 든 빈 레코드를 넣으면 한글이 문서를 손상으로 판정한다 —
    // 라이브러리·LibreOffice는 그대로 읽어서 이 실수가 오래 드러나지 않았다.
    if (textIdx >= 0) {
      recs.splice(textIdx, 1);
      delta -= 1;
    }
    setNChars(recs, headerIdx, 1); // 빈 문단도 글자 수는 1 (문단끝 몫)
    return delta;
  }

  let tail = PARA_MARK;
  if (textIdx < 0) {
    // 빈 칸에 글자를 넣는다 — PARA_TEXT는 UTF-16LE 글자뿐이고 서식은
    // PARA_CHAR_SHAPE가 들고 있어서 새로 만들어도 안전하다.
    textIdx = headerIdx + 1;
    recs.splice(textIdx, 0, {
      tag: TAG.PARA_TEXT,
      level: recs[headerIdx].level + 1,
      data: Buffer.alloc(0),
      extended: false,
    });
    delta += 1;
  } else {
    // 문단 끝 제어 문자는 원본 그대로 유지하고 본문만 교체
    const old = recs[textIdx].data.toString('ucs2');
    let bodyLen = old.length;
    while (bodyLen > 0 && old.charCodeAt(bodyLen - 1) < 32) bodyLen--;
    tail = old.slice(bodyLen);
  }

  const next = Buffer.from(sanitizeCellText(text) + tail, 'ucs2');
  recs[textIdx] = { ...recs[textIdx], data: next };
  setNChars(recs, headerIdx, next.length / 2);
  return delta; // 레코드 수 변화 — 호출자가 인덱스를 다시 잡아야 한다
}

/** 글자 수 갱신. 최상위 플래그 비트는 보존한다 — 안 고치면 한글이 문단을 잘라 읽는다 */
function setNChars(recs: HwpRecord[], headerIdx: number, count: number): void {
  const d = Buffer.from(recs[headerIdx].data);
  const flag = d.readUInt32LE(0) & NCHARS_FLAG;
  d.writeUInt32LE((flag | count) >>> 0, 0);
  recs[headerIdx] = { ...recs[headerIdx], data: d };
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
/**
 * HM-29 — 그 표의 **'보통' 글자 서식 id**를 문서 자신에게서 찾는다.
 *
 * 양식의 예시 행은 «제10차 인사위원회»처럼 **기울임 서식**으로 적혀 있다(실측: CharShape 15).
 * 그 행을 덮어써서 채우면 우리 글자도 기울임으로 나온다 — 실제 병합본이 그랬다.
 *
 * 하드코딩하지 않고 구분 열(col 0)의 서식을 쓴다. 거기엔 「1-1」 같은 번호만 들어가서
 * 강조를 줄 이유가 없는 칸이라, **그 문서의 보통 서식**이 거기 있다 (실측: CharShape 14 —
 * 15와 같은 글꼴에 기울임만 빠진 것).
 */
function plainCharShapeOf(recs: HwpRecord[], t: TableSpan): number | null {
  for (const cell of t.cells) {
    if (cell.col !== 0 || cell.row < 1) continue;
    for (let k = cell.start; k < cell.end; k++) {
      if (recs[k].tag === TAG.PARA_CHAR_SHAPE && recs[k].data.length >= 8) {
        return recs[k].data.readUInt32LE(4);
      }
    }
  }
  return null;
}

/**
 * HM-37 — 그 표의 **보통 서식** 번호. 강조 서식을 만들 때 «무엇을 복제할지»가 이것이다.
 * 병합·작성 경로가 DocInfo를 고치려면 이 번호를 먼저 알아야 해서 밖으로 연다.
 */
export function plainShapeIdOf(recs: readonly HwpRecord[], tableOrdinal: number): number | null {
  const t = locateTables(recs)[tableOrdinal];
  return t ? plainCharShapeOf(recs as HwpRecord[], t) : null;
}

/** 그 셀의 모든 글자 구간을 한 가지 서식으로 통일한다 (기울임·굵게가 섞여 들어오지 않게) */
function normalizeCharShape(recs: HwpRecord[], cell: CellSpan, shapeId: number): void {
  for (let k = cell.start; k < cell.end && k < recs.length; k++) {
    if (recs[k].tag !== TAG.PARA_CHAR_SHAPE) continue;
    const d = Buffer.from(recs[k].data);
    for (let o = 0; o + 8 <= d.length; o += 8) d.writeUInt32LE(shapeId, o + 4);
    recs[k] = { ...recs[k], data: d };
  }
}

/**
 * HM-30 — 셀 속성의 **«셀 크기에 맞춰 글자 줄이기»** 비트를 끈다.
 *
 * 양식의 예시 행 셀에는 이 비트가 켜져 있다 (실측: LIST_HEADER attr `0x04000020`,
 * 빈 행은 `0x00000020`). 켜져 있으면 한글이 칸을 넘는 글을 **줄바꿈하지 않고 장평을 줄여**
 * 한 줄에 욱여넣는다 — 글자가 겹쳐 보이던 원인이다.
 *
 * 끄면 칸 폭을 넘는 글은 다음 줄로 넘어가고 칸이 아래로 늘어난다.
 */
const CELL_SHRINK_TO_FIT = 0x04000000;

function clearShrinkToFit(recs: HwpRecord[], headerIdx: number): void {
  const r = recs[headerIdx];
  if (r.tag !== TAG.LIST_HEADER || r.data.length < 8) return;
  const attr = r.data.readUInt32LE(4);
  if (!(attr & CELL_SHRINK_TO_FIT)) return;
  const d = Buffer.from(r.data);
  d.writeUInt32LE(attr & ~CELL_SHRINK_TO_FIT, 4);
  recs[headerIdx] = { ...r, data: d };
}

/** HM-37 — 강조 행에 쓸 서식. `fillTable` 밖에서 DocInfo에 만들어 번호로 넘긴다 */
export interface FillOptions {
  /** 행별 강조 여부 (rows와 같은 길이·순서) */
  emphasis?: readonly boolean[];
  /** 강조 행의 내용 칸에 쓸 서식번호. null이면 강조를 적용하지 않는다 */
  emphasisShapeId?: number | null;
}

/** 내용 칸 — 강조는 여기에만 건다 */
const CONTENT_COL = 1;

export function fillTable(
  recs: HwpRecord[],
  tableOrdinal: number,
  rows: readonly (readonly string[])[],
  opts: FillOptions = {},
): void {
  const found = locateTables(recs)[tableOrdinal];
  if (!found) throw new HwpWriteError(`${tableOrdinal + 1}번째 표가 없습니다`);
  const t = resizeTable(recs, found, rows.length);
  const plain = plainCharShapeOf(recs, t);

  const ordered = [...t.cells].filter((c) => c.row >= 1).sort((a, b) => b.start - a.start);
  for (const cell of ordered) {
    const text = rows[cell.row - 1]?.[cell.col] ?? '';
    clearShrinkToFit(recs, cell.start); // cell.start = 그 셀의 LIST_HEADER

    /*
     * HM-37 — 강조는 **내용 칸에만** 건다.
     *
     * 규칙이 「주요 사항에는 파란색으로 작성」이고, 그 «사항»은 내용 칸에 적힌 글이다.
     * 일자·장소까지 물들이면 강조가 아니라 그 줄이 통째로 다른 문서처럼 보인다.
     * 읽을 때도 내용 칸만 보므로(reader.rowEmphasis) 양쪽 판정이 같은 자리를 가리킨다.
     */
    const emph =
      cell.col === CONTENT_COL &&
      opts.emphasis?.[cell.row - 1] === true &&
      opts.emphasisShapeId != null;
    const shape = emph ? opts.emphasisShapeId! : plain;

    if (shape !== null && shape !== undefined) normalizeCharShape(recs, cell, shape);
    setCellText(recs, cell, text);
  }
}

/**
 * 원본 파일의 모든 것(서식·글꼴·미리보기·스크립트)을 유지한 채
 * BodyText 섹션만 갈아 끼운다.
 *
 * HM-37 — `docInfo`를 주면 그것도 갈아 끼운다. 강조 서식을 새로 만들었을 때만 필요하다.
 * 안 주면 원본 그대로 둔다 — **바꿀 이유가 없으면 건드리지 않는다**가 이 함수의 원칙이다.
 */
export function packHwp(original: Buffer, sections: readonly Buffer[], docInfo?: Buffer): Buffer {
  const cf = CFB.read(original, { type: 'buffer' });
  sections.forEach((sec, n) => {
    CFB.utils.cfb_add(cf, `/BodyText/Section${n}`, deflateRawSync(sec, { level: 9 }));
  });
  if (docInfo) CFB.utils.cfb_add(cf, '/DocInfo', deflateRawSync(docInfo, { level: 9 }));
  // 센티널을 떼어낸다 -- 한글이 낯선 스트림을 만나면 문서를 열지 못한다 (HM-08a)
  return stripCfbSentinel(Buffer.from(CFB.write(cf, { type: 'buffer' }) as Uint8Array));
}

/** 편의 함수 — 섹션 레코드를 열고 고친 뒤 되돌려 준다 */
export function editSection(sectionBytes: Buffer, edit: (recs: HwpRecord[]) => void): Buffer {
  const recs = parseRecords(sectionBytes);
  edit(recs);
  return serializeRecords(recs);
}


// -- cfb 센티널 제거 (HM-08a) --------------------------------
//
// `cfb`(SheetJS) 라이브러리는 쓸 때마다 4바이트짜리 표식 스트림을 강제로 넣는다
// (`seed_cfb`). 자기 라이브러리로 만든 파일임을 표시하는 용도인데,
// **한글은 이 낯선 스트림을 만나면 문서를 열지 못한다** (실측).
//
// OLE 디렉터리는 적록 트리지만 이 파일들은 실제로 오른쪽으로만 이어진 목록이라,
// 센티널을 가리키는 포인터를 그 다음 항목으로 넘기고 항목을 지우면 끝난다.
// 트리 재균형이 필요한 형태(왼쪽 자식이 있는 경우)면 **건드리지 않고 그대로 둔다** --
// 잘못 이어 붙인 디렉터리는 파일을 통째로 못 읽게 만든다.

const SENTINEL_NAME = String.fromCharCode(1) + 'Sh33tJ5';
const DIR_ENTRY = 128;
const OFF = { nameLen: 64, type: 66, left: 68, right: 72, child: 76 } as const;

/** 디렉터리 엔트리가 실제로 놓인 파일 오프셋들 (FAT 체인을 따라간다) */
function dirEntryOffsets(buf: Buffer): number[] {
  const sectorSize = 1 << buf.readUInt16LE(30);
  const numFat = buf.readUInt32LE(44);
  const sectorAt = (n: number) => (n + 1) * sectorSize;

  const fat: Buffer[] = [];
  for (let i = 0; i < numFat; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s >= 0xfffffffa) break;
    fat.push(buf.subarray(sectorAt(s), sectorAt(s) + sectorSize));
  }
  const fatBuf = Buffer.concat(fat);
  const next = (n: number) => (n * 4 + 4 <= fatBuf.length ? fatBuf.readUInt32LE(n * 4) : 0xfffffffe);

  const offsets: number[] = [];
  let sec = buf.readUInt32LE(48);
  const seen = new Set<number>();
  while (sec < 0xfffffffa && !seen.has(sec)) {
    seen.add(sec);
    for (let k = 0; k < sectorSize; k += DIR_ENTRY) offsets.push(sectorAt(sec) + k);
    sec = next(sec);
  }
  return offsets;
}

/**
 * 센티널 스트림을 디렉터리에서 떼어낸다. 떼어내지 못하면 원본을 그대로 돌려준다
 * (실패해도 파일이 나빠지지는 않는다).
 */
export function stripCfbSentinel(input: Buffer): Buffer {
  const buf = Buffer.from(input);
  const offsets = dirEntryOffsets(buf);

  const nameOf = (o: number) => {
    const len = buf.readUInt16LE(o + OFF.nameLen);
    if (len < 2 || len > 64) return '';
    return buf.subarray(o, o + len - 2).toString('utf16le');
  };

  const target = offsets.findIndex((o) => buf[o + OFF.type] !== 0 && nameOf(o) === SENTINEL_NAME);
  if (target < 0) return input; // 이미 없다

  const to = offsets[target];
  const left = buf.readInt32LE(to + OFF.left);
  const right = buf.readInt32LE(to + OFF.right);
  if (left !== -1) return input; // 트리 재균형이 필요한 형태 -- 손대지 않는다

  // 센티널을 가리키던 포인터를 그 다음 항목으로 넘긴다
  let relinked = false;
  for (const [i, o] of offsets.entries()) {
    if (i === target || buf[o + OFF.type] === 0) continue;
    for (const field of [OFF.left, OFF.right, OFF.child] as const) {
      if (buf.readInt32LE(o + field) === target) {
        buf.writeInt32LE(right, o + field);
        relinked = true;
      }
    }
  }
  if (!relinked) return input; // 아무도 안 가리키면 우리가 구조를 잘못 읽은 것이다

  buf.fill(0, to, to + DIR_ENTRY); // 미사용 항목 (type 0)
  buf.writeInt32LE(-1, to + OFF.left);
  buf.writeInt32LE(-1, to + OFF.right);
  buf.writeInt32LE(-1, to + OFF.child);
  return buf;
}


/**
 * 문서 **맨 끝**에 본문 문단 하나를 덧붙인다 (병합일자 등).
 *
 * 표는 건드리지 않는다. 새 레코드를 지어내지도 않는다 — 기존 본문 문단을 통째로 복제해
 * 글자만 바꾼다 (HM-03과 같은 원리).
 *
 * **맨 끝에만** 붙이는 이유: 문서의 첫 문단에는 구역 정의 컨트롤이 들어 있어서
 * 그 앞이나 사이에 끼워 넣으면 구조가 어긋난다. 끝은 뒤따르는 것이 없어 안전하다.
 *
 * 복제할 문단은 **스스로 찾는다** — 위치를 인자로 받으면 표 편집으로 인덱스가 밀린 뒤에
 * 엉뚱한 것을 복제한다 (실제로 겪었다).
 */
export function appendBodyParagraph(recs: HwpRecord[], text: string): void {
  // 레벨 0 문단 중 **컨트롤이 딸리지 않고 글자가 있는** 마지막 것을 고른다.
  // 표가 딸린 문단을 복제하면 표까지 통째로 복제된다.
  let proto: { start: number; end: number } | null = null;
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].tag !== TAG.PARA_HEADER || recs[i].level !== 0) continue;
    let end = i + 1;
    while (end < recs.length && recs[end].level > 0) end++;
    const block = recs.slice(i, end);
    if (block.some((r) => r.tag === TAG.CTRL_HEADER)) continue;
    if (!block.some((r) => r.tag === TAG.PARA_TEXT)) continue;
    proto = { start: i, end };
  }
  if (!proto) throw new HwpWriteError('복제할 본문 문단을 찾지 못했습니다');

  const copy: HwpRecord[] = recs
    .slice(proto.start, proto.end)
    .map((r) => ({ ...r, data: Buffer.from(r.data) }));
  const base = recs.length;
  recs.push(...copy);

  // 글자 교체는 셀과 규칙이 같다 (빈 글자면 PARA_TEXT를 두지 않는다 — HM-11a)
  setCellText(recs, { row: -1, col: -1, start: base, end: recs.length }, text);
}
