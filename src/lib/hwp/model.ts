// S-08 L2 — 레코드 스트림 → 표 모델 (HM-09~13).
// 셀은 좌→우·상→하 평탄 나열 (HM-12). 셀 = LIST_HEADER + nPara개의 문단 블록.
import { HwpRecord, TAG, paraText } from './record';

export interface HwpCell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  /** 칸 너비 (HWPUNIT = 1/7200 inch). 붙여넣기용 표 폭을 양식에서 그대로 가져오는 데 쓴다 */
  width: number;
  /** 다중 문단은 \n으로 join (HM-13) */
  text: string;
  /**
   * HM-37 — 이 셀 글자에 쓰인 **서식번호들**. 색은 여기 없다 —
   * 번호를 색으로 바꾸려면 DocInfo가 필요하고, 그건 이 층이 모르는 것이다.
   * 그래서 번호만 올려 보내고 해석은 reader가 한다.
   */
  shapeIds: number[];
}

export interface HwpTable {
  rows: number;
  cols: number;
  cells: HwpCell[]; // 평탄. (row, col)로 정렬됨
}

function ctrlId(data: Buffer): string {
  if (data.length < 4) return '';
  // CTRL_HEADER id는 4바이트 역순 ASCII (실측: 'tbl ', 'secd', 'cold')
  return Buffer.from([data[3], data[2], data[1], data[0]]).toString('latin1');
}

/** 한 섹션의 레코드에서 표를 등장 순서대로 추출 */
export function extractTables(records: readonly HwpRecord[]): HwpTable[] {
  const tables: HwpTable[] = [];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.tag !== TAG.CTRL_HEADER || ctrlId(r.data) !== 'tbl ') continue;

    const ctrlLevel = r.level;
    // 컨트롤 서브트리 범위: level > ctrlLevel 인 동안
    let end = i + 1;
    while (end < records.length && records[end].level > ctrlLevel) end++;

    // TABLE 레코드 (rows/cols)
    let rows = 0;
    let cols = 0;
    const cells: HwpCell[] = [];
    let current: { cell: Omit<HwpCell, 'text' | 'shapeIds'>; paras: string[]; shapeIds: Set<number> } | null =
      null;

    const flush = () => {
      if (!current) return;
      cells.push({ ...current.cell, text: current.paras.join('\n'), shapeIds: [...current.shapeIds] });
      current = null;
    };

    for (let j = i + 1; j < end; j++) {
      const s = records[j];
      if (s.tag === TAG.TABLE && s.level === ctrlLevel + 1 && rows === 0) {
        if (s.data.length >= 8) {
          rows = s.data.readUInt16LE(4);
          cols = s.data.readUInt16LE(6);
        }
      } else if (s.tag === TAG.LIST_HEADER && s.level === ctrlLevel + 1) {
        flush();
        if (s.data.length >= 16) {
          current = {
            cell: {
              col: s.data.readUInt16LE(8),
              row: s.data.readUInt16LE(10),
              colSpan: s.data.readUInt16LE(12),
              rowSpan: s.data.readUInt16LE(14),
              width: s.data.length >= 20 ? s.data.readUInt32LE(16) : 0,
            },
            paras: [],
            shapeIds: new Set<number>(),
          };
        }
      } else if (s.tag === TAG.PARA_TEXT && current) {
        current.paras.push(paraText(s.data));
      } else if (s.tag === TAG.PARA_CHAR_SHAPE && current) {
        // (글자위치, 서식번호) 8바이트 쌍의 목록
        for (let o = 0; o + 8 <= s.data.length; o += 8) current.shapeIds.add(s.data.readUInt32LE(o + 4));
      } else if (s.tag === TAG.CTRL_HEADER && ctrlId(s.data) === 'tbl ') {
        // 셀 안 중첩 표 — 이 양식엔 없어야 정상. 방어적으로 그 서브트리는 건너뛴다.
        let k = j + 1;
        while (k < end && records[k].level > s.level) k++;
        j = k - 1;
      }
    }
    flush();

    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    tables.push({ rows, cols, cells });
    i = end - 1;
  }

  return tables;
}

/** (row, col) 격자로 편 2차원 뷰. 빈 셀은 '' */
export function tableGrid(t: HwpTable): string[][] {
  const grid: string[][] = Array.from({ length: t.rows }, () => Array(t.cols).fill(''));
  for (const c of t.cells) {
    if (c.row < t.rows && c.col < t.cols) grid[c.row][c.col] = c.text;
  }
  return grid;
}

/**
 * 첫 행의 칸 너비 목록 (HWPUNIT). 표를 다른 데 붙여넣을 때 **양식과 같은 비율**로
 * 만들기 위해 쓴다 — 폭을 코드에 박아 두면 부서가 양식을 바꾸는 순간 어긋난다.
 */
export function columnWidths(t: HwpTable): number[] {
  return t.cells
    .filter((c) => c.row === 0)
    .sort((a, b) => a.col - b.col)
    .map((c) => c.width);
}
