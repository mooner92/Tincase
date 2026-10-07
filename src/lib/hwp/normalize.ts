// RU-63·64 — 옮겨 온 섹션 본문의 **정규화(자동 수정)와 검증(경고)**. 분석 §9·§10의 반복 오류를 도구가 맡는다.
//
// 자동 수정 (원본 서식은 그대로 — 칸 글자만 바꾸거나 빈 줄을 들어낸다):
//   · 표 번호 다시 매기기 — 실형 5열은 「표번호-순번」, 본부형 6열은 항목 행 번호를 표 전체 연속(분석 Q7 기본)
//   · 내용 없이 번호만 남은 줄 삭제 (5열 표, 병합 칸이 없을 때만)
//   · 비어 버린 3번 표에 「특이사항 없음」 한 줄 (분석 Q5 기본)
//   · 머리행 이름 통일 — 「업무 기간」→「일자」, 「업무 담당 또는 참석자」→「참석자」 (V10)
// 경고만 (사람이 확인):
//   · 양식 잔재 — `OO/OO` · `해당 과제 실적` · `개최건수(없을 시` · `OOO 실` (V3)
//   · 일자 표기 — `M/D` · `M/D~M/D` · `M/D~D` · `~M/D` · `M/D(요일)` · 쉼표 나열 밖의 것 (V8)
import { HwpRecord, paraText, TAG } from './record';
import { locateTables, setCellText, type TableSpan } from './writer';
import { titleBucket } from './rollup';

const LH = { COLSPAN: 12, ROWSPAN: 14, ROW: 10 } as const;
const TBL_ROWS = 4;
const TBL_ROWSIZE = 18;

type Cell = TableSpan['cells'][number];

function cellText(recs: readonly HwpRecord[], c: Cell): string {
  const parts: string[] = [];
  for (let k = c.start; k < c.end; k++) if (recs[k].tag === TAG.PARA_TEXT) parts.push(paraText(recs[k].data));
  return parts.join('\n').trim();
}
const spanOf = (recs: readonly HwpRecord[], c: Cell) => ({
  col: recs[c.start].data.readUInt16LE(LH.COLSPAN),
  row: recs[c.start].data.readUInt16LE(LH.ROWSPAN),
});

/** 표 바로 앞의 「1. 주요 업무실적」 같은 제목 — 번호 머리(1·2·3)를 정한다 */
function tablePrefixes(recs: readonly HwpRecord[]): Map<number, number> {
  const out = new Map<number, number>(); // TABLE 레코드 위치 → 머리 번호
  let last: number | null = null;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.tag === TAG.PARA_TEXT && r.level === 1) {
      const b = titleBucket(paraText(r.data).trim());
      if (b) last = b === 'achievements' ? 1 : b === 'plans' ? 2 : 3;
    }
    if (r.tag === TAG.TABLE && last !== null) {
      out.set(i, last);
      last = null;
    }
  }
  return out;
}

const NUM = /^\s*\d+\s*-\s*\d+\s*$/;
const RESIDUE = [/O{2,}\s*\/\s*O{2,}/i, /해당\s*과제\s*실적/, /개최\s*건수\s*\(\s*없을\s*시/, /O{3}\s*실/];
const DATE_OK = /^(\d{1,2}\/\d{1,2}(\([월화수목금토일]\))?(\s*~\s*(\d{1,2}\/)?\d{1,2}(\([월화수목금토일]\))?)?|~\s*\d{1,2}\/\d{1,2})(\s*,\s*\d{1,2}\/\d{1,2}(\([월화수목금토일]\))?)*$/;

/** 표 하나에서 r행을 들어낸다 (병합 칸이 없는 표만 부른다) */
function deleteRow(recs: HwpRecord[], t: TableSpan, row: number) {
  const doomed = t.cells.filter((c) => c.row === row);
  const from = Math.min(...doomed.map((c) => c.start));
  const to = Math.max(...doomed.map((c) => c.end));
  // 아래 행들의 행 번호를 하나씩 당긴다
  for (const c of t.cells) {
    if (c.row <= row) continue;
    const d = Buffer.from(recs[c.start].data);
    d.writeUInt16LE(c.row - 1, LH.ROW);
    recs[c.start] = { ...recs[c.start], data: d };
  }
  recs.splice(from, to - from);
  const old = recs[t.tableIdx].data;
  const rows = old.readUInt16LE(TBL_ROWS);
  const head = Buffer.from(old.subarray(0, TBL_ROWSIZE));
  head.writeUInt16LE(rows - 1, TBL_ROWS);
  const sizes: Buffer[] = [];
  for (let r = 0; r < rows; r++) if (r !== row) sizes.push(old.subarray(TBL_ROWSIZE + r * 2, TBL_ROWSIZE + r * 2 + 2));
  recs[t.tableIdx] = { ...recs[t.tableIdx], data: Buffer.concat([head, ...sizes, old.subarray(TBL_ROWSIZE + rows * 2)]) };
}

export interface NormalizeReport {
  /** 자동으로 고친 것 — 「번호 3곳」 「빈 줄 2개」 */
  fixed: string[];
  /** 사람이 볼 것 — 「양식 잔재 『OO/OO』」 「일자 『9월 7일』」 */
  warnings: string[];
}

/**
 * 섹션 본문 레코드를 **제자리에서** 고친다. 표를 다시 그리지 않는다 — 칸 글자와 빈 줄만.
 * 표 위치가 바뀌므로 표마다 다시 찾는다(뒤에서부터 고치면 앞 표의 위치는 그대로다).
 */
export function normalizeSectionBody(recs: HwpRecord[]): NormalizeReport {
  let renumbered = 0;
  let removed = 0;
  let filledNotes = 0;
  let headers = 0;
  const residue = new Set<string>();
  const dates = new Set<string>();

  // 양식 잔재 — 본문 전체 글자에서
  for (const r of recs) {
    if (r.tag !== TAG.PARA_TEXT) continue;
    const s = paraText(r.data);
    for (const re of RESIDUE) {
      const m = re.exec(s);
      if (m) residue.add(m[0]);
    }
  }

  const count = locateTables(recs).length;
  for (let ti = count - 1; ti >= 0; ti--) {
    let t = locateTables(recs)[ti];
    if (!t || t.rows < 1) continue;
    const prefixes = tablePrefixes(recs);
    const prefix = prefixes.get(t.tableIdx);
    const header = t.cells.filter((c) => c.row === 0).map((c) => cellText(recs, c));
    const isFive = t.cols === 5 && header[0]?.replace(/\s/g, '') === '구분';
    const isSix = t.cols === 6;

    if (isFive) {
      // 머리행 이름 통일 (V10)
      for (const c of t.cells.filter((x) => x.row === 0)) {
        const v = cellText(recs, c).replace(/\s+/g, ' ');
        const want = v === '업무 기간' ? '일자' : v === '업무 담당 또는 참석자' ? '참석자' : null;
        if (want) {
          setCellText(recs, c, want);
          headers++;
          t = locateTables(recs)[ti];
        }
      }
      const merged = t.cells.some((c) => {
        const s = spanOf(recs, c);
        return s.col > 1 || s.row > 1;
      });
      // 번호만 있는 빈 줄 삭제 — 뒤에서부터 (병합 칸 표는 건드리지 않는다)
      if (!merged) {
        for (let r = t.rows - 1; r >= 1; r--) {
          const cells = t.cells.filter((c) => c.row === r);
          if (cells.length === 0 || t.rows <= 2) continue;
          const body = cells.filter((c) => c.col >= 1).map((c) => cellText(recs, c));
          if (body.every((x) => !x || x === '-')) {
            deleteRow(recs, t, r);
            removed++;
            t = locateTables(recs)[ti];
          }
        }
      }
      // 3번 표가 비었으면 「특이사항 없음」 한 줄
      const dataRows = t.cells.filter((c) => c.row >= 1 && c.col === 1);
      if (prefix === 3 && dataRows.length >= 1 && dataRows.every((c) => !cellText(recs, c) || /^-+$/.test(cellText(recs, c)))) {
        const c = dataRows[0];
        if (cellText(recs, c) !== '특이사항 없음') {
          setCellText(recs, c, '특이사항 없음');
          filledNotes++;
          t = locateTables(recs)[ti];
        }
      }
      // 번호 다시 매기기 — 내용이 있는 줄만 차례로
      if (prefix) {
        let n = 0;
        const rows = [...new Set(t.cells.filter((c) => c.row >= 1).map((c) => c.row))].sort((a, b) => b - a);
        const order = [...rows].reverse();
        const want = new Map<number, string>();
        for (const r of order) {
          const content = t.cells.find((c) => c.row === r && c.col === 1);
          if (content && cellText(recs, content)) want.set(r, `${prefix}-${++n}`);
        }
        for (const r of rows) {
          const no = t.cells.find((c) => c.row === r && c.col === 0);
          const w = want.get(r);
          if (!no || !w) continue;
          if (cellText(recs, no) !== w) {
            setCellText(recs, no, w);
            renumbered++;
            t = locateTables(recs)[ti];
          }
        }
      }
      // 일자 표기 (경고만)
      for (const c of t.cells.filter((x) => x.row >= 1 && x.col === 2)) {
        const v = cellText(recs, c).replace(/\n/g, ' ').trim();
        // 양식 자리표시(`OO/OO`)는 잔재 경고가 이미 말한다 — 두 번 세지 않는다
        if (v && v !== '-' && !DATE_OK.test(v) && !RESIDUE.some((re) => re.test(v))) dates.add(v);
      }
    } else if (isSix && prefix && prefix <= 2) {
      // 본부형 6열 — 항목 행(6칸)의 번호 칸(1열)만, 표 전체 연속으로 (분석 Q7 기본). 과제 행(병합 4칸)은 손대지 않는다
      let n = 0;
      const rows = [...new Set(t.cells.map((c) => c.row))].filter((r) => r >= 1).sort((a, b) => a - b);
      const targets: { cell: Cell; text: string }[] = [];
      for (const r of rows) {
        const cells = t.cells.filter((c) => c.row === r);
        if (cells.length !== 6) continue; // 과제 행·머리행
        const no = cells.find((c) => c.col === 1);
        if (!no) continue;
        const cur = cellText(recs, no);
        if (!cur || NUM.test(cur)) targets.push({ cell: no, text: `${prefix}-${++n}` });
      }
      for (const x of targets.reverse()) {
        if (cellText(recs, x.cell) !== x.text) {
          setCellText(recs, x.cell, x.text);
          renumbered++;
        }
      }
    }
  }

  const fixed: string[] = [];
  if (renumbered) fixed.push(`번호 ${renumbered}곳 다시 매김`);
  if (removed) fixed.push(`빈 줄 ${removed}개 삭제`);
  if (filledNotes) fixed.push('빈 3번 표에 「특이사항 없음」');
  if (headers) fixed.push(`머리행 이름 ${headers}곳 통일`);
  const warnings: string[] = [];
  if (residue.size) warnings.push(`양식 잔재: ${[...residue].map((x) => `「${x}」`).join(' ')}`);
  if (dates.size) warnings.push(`일자 표기 확인: ${[...dates].slice(0, 4).map((x) => `「${x}」`).join(' ')}${dates.size > 4 ? ` 외 ${dates.size - 4}` : ''}`);
  return { fixed, warnings };
}
