// RU-63·64 — 섹션 본문 정규화의 표 판정 규칙 (스펙 §11a 「RU-63 정규화 규칙」 R1~R6).
//
// 실제 최종 취합본으로 돌려 보니(2026-10-07) 정규화가 **멀쩡한 표를 고쳐 버린** 곳이 있었다 — 칸 수로 행 종류를,
// 열 수로 표 종류를 가른 탓이다. 그 꼴을 여기서 **합성한 레코드**로 다시 만든다:
//   · 실제 파일(fixtures/*.hwp)은 저장소에 없다(내부 문서) — 이 테스트는 CI에서도 돈다
//   · 칸 글자는 모두 지어낸 것이다(「과제 가」 「항목 1」 …) — 실명·실제 업무 내용 없음
// 레코드 꼴은 양식 실측(docs/research/001-hwp-format-findings.md §4)을 따른다: 표 문단(0) → CTRL_HEADER `tbl `(1)
// → TABLE(2) → 셀마다 LIST_HEADER(2) + 문단(2) + 글자(3). 빈 칸에는 PARA_TEXT가 없다(HM-11a).
import { describe, expect, it } from 'vitest';
import { paraText, serializeRecords, TAG, type HwpRecord } from '@/lib/hwp/record';
import { locateTables } from '@/lib/hwp/writer';
import { normalizeSectionBody } from '@/lib/hwp/normalize';

// ── 합성 레코드 ─────────────────────────────────────────────
interface CellSpec {
  text: string;
  col: number;
  colSpan?: number;
  rowSpan?: number;
  /** 칸 안의 문단들(Enter로 나눈 줄). 주면 text 대신 쓴다 */
  paras?: string[];
}

const rec = (tag: number, level: number, data: Buffer): HwpRecord => ({ tag, level, data, extended: false });

/** 문단 하나 — PARA_HEADER + (글자가 있으면) PARA_TEXT + PARA_CHAR_SHAPE. 글자 수는 문단 끝(CR) 몫까지 */
function paragraph(level: number, text: string): HwpRecord[] {
  const head = Buffer.alloc(24);
  head.writeUInt32LE(text.length + 1, 0);
  head.writeUInt16LE(1, 12); // 글자 모양 구간 1개
  const out = [rec(TAG.PARA_HEADER, level, head)];
  if (text) out.push(rec(TAG.PARA_TEXT, level + 1, Buffer.from(`${text}\r`, 'ucs2')));
  out.push(rec(TAG.PARA_CHAR_SHAPE, level + 1, Buffer.alloc(8)));
  return out;
}

/** 표 하나를 든 최상위 문단. rows[r] = 그 행에 **실제로 있는** 칸들(병합에 덮인 칸은 없다 — 한글 실측과 같다) */
function tableParagraph(cols: number, rows: CellSpec[][]): HwpRecord[] {
  const head = Buffer.alloc(24);
  head.writeUInt32LE(9, 0); // 표 컨트롤 8 + 문단 끝 1
  head.writeUInt32LE(0x800, 4); // 컨트롤 마스크 — 표(11번 컨트롤)
  head.writeUInt16LE(1, 12);
  const text = Buffer.alloc(18);
  text.writeUInt16LE(11, 0); // 확장 컨트롤 머리(8유닛)
  text.write('tbl ', 2, 'latin1');
  text.writeUInt16LE(11, 14);
  text.writeUInt16LE(13, 16);
  const ctrl = Buffer.alloc(44);
  Buffer.from('tbl ', 'latin1').reverse().copy(ctrl, 0); // 컨트롤 ID는 거꾸로 저장된다
  const table = Buffer.alloc(18 + rows.length * 2 + 4);
  table.writeUInt16LE(rows.length, 4);
  table.writeUInt16LE(cols, 6);
  rows.forEach((r, i) => table.writeUInt16LE(r.length, 18 + i * 2));
  const out: HwpRecord[] = [
    rec(TAG.PARA_HEADER, 0, head),
    rec(TAG.PARA_TEXT, 1, text),
    rec(TAG.PARA_CHAR_SHAPE, 1, Buffer.alloc(8)),
    rec(TAG.CTRL_HEADER, 1, ctrl),
    rec(TAG.TABLE, 2, table),
  ];
  rows.forEach((cells, r) => {
    for (const c of cells) {
      const paras = c.paras ?? [c.text];
      const lh = Buffer.alloc(34);
      lh.writeUInt16LE(paras.length, 0); // 칸 안 문단 수
      lh.writeUInt16LE(c.col, 8);
      lh.writeUInt16LE(r, 10);
      lh.writeUInt16LE(c.colSpan ?? 1, 12);
      lh.writeUInt16LE(c.rowSpan ?? 1, 14);
      out.push(rec(TAG.LIST_HEADER, 2, lh), ...paras.flatMap((p) => paragraph(2, p)));
    }
  });
  return out;
}

/** 병합 없는 행 — 글자를 0열부터 차례로 */
const plain = (...texts: string[]): CellSpec[] => texts.map((text, col) => ({ text, col }));

const clone = (rs: readonly HwpRecord[]) => rs.map((r) => ({ ...r, data: Buffer.from(r.data) }));

/** 표 하나를 [행][열] 글자로 — 병합에 덮인 자리는 없다 */
function grid(recs: readonly HwpRecord[], ti: number): Record<string, string>[] {
  const t = locateTables(recs)[ti];
  const out: Record<string, string>[] = Array.from({ length: t.rows }, () => ({}));
  for (const c of t.cells) {
    const parts: string[] = [];
    for (let k = c.start; k < c.end; k++) if (recs[k].tag === TAG.PARA_TEXT) parts.push(paraText(recs[k].data));
    out[c.row][c.col] = parts.join('\n').trim();
  }
  return out;
}
const column = (recs: readonly HwpRecord[], ti: number, col: number) => grid(recs, ti).map((r) => r[col]);

const HEAD5 = plain('구분', '업무실적 내용', '일자', '장소', '참석자');
const HEAD6: CellSpec[] = [
  { text: '구분', col: 0 },
  { text: '유형', col: 1 },
  { text: '과제명', col: 2, colSpan: 3 },
  { text: '책임자', col: 5 },
];
/** 6열 과제 행 — 과제명이 책임자 칸 앞까지 병합. dept=null이면 1열(구분)이 위에서 병합되어 칸이 없다 */
const project6 = (type: string, name: string, dept: string | null = ''): CellSpec[] => [
  ...(dept === null ? [] : [{ text: dept, col: 0 }]),
  { text: type, col: 1 },
  { text: name, col: 2, colSpan: 3 },
  { text: '책임 가', col: 5 },
];
/** 6열 항목 행 — withDept=false면 1열(구분)이 위에서 병합되어 칸이 없다 */
const item6 = (no: string, name: string, date: string, withDept = true): CellSpec[] => [
  ...(withDept ? [{ text: '', col: 0 }] : []),
  { text: no, col: 1 },
  { text: name, col: 2 },
  { text: date, col: 3 },
  { text: '장소 가', col: 4 },
  { text: '참석 가', col: 5 },
];

// ── 테스트 ───────────────────────────────────────────────────
describe('RU-63 R1 실형 5열 업무 표', () => {
  it('[RU-T60] 번호만 남은 빈 줄은 지우고, 남은 줄은 표 머리(1)에 맞춰 차례로 다시 매긴다', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(5, [
        HEAD5,
        plain('2-1', '업무 가', '10/1', '회의실', '참석 가'), // 다른 표에서 복사해 온 번호
        plain('1-2', '', '', '', ''), // 번호만 남은 줄
        plain('1-3', '-', '-', '-', '-'), // 「-」만 남은 줄
        plain('', '업무 나', '10/2', '', ''), // 번호를 안 단 줄
      ]),
    ];
    const r = normalizeSectionBody(recs);
    expect(column(recs, 0, 0)).toEqual(['구분', '1-1', '1-2']);
    expect(column(recs, 0, 1)).toEqual(['업무실적 내용', '업무 가', '업무 나']);
    expect(r.fixed).toEqual(['번호 2곳 다시 매김', '빈 줄 2개 삭제']);
    expect(r.warnings).toEqual([]);
    // 행을 들어낸 뒤에도 TABLE 레코드(행 수·행별 칸 수)와 칸의 행 번호가 맞는다 — 어긋나면 한글이 「손상」으로 본다
    const t = locateTables(recs)[0];
    expect(t.rows).toBe(3);
    expect(recs[t.tableIdx].data.length).toBe(18 + 3 * 2 + 4);
    expect([...new Set(t.cells.map((c) => c.row))]).toEqual([0, 1, 2]);
  });
});

describe('RU-63 R2 집계표는 업무 표가 아니다', () => {
  it('[RU-T61] 「※ 자문회의 실적」 5열 표 — 「-」뿐인 실의 줄을 지우지 않고, 「1건」을 일자 경고로 내지 않는다', () => {
    const recs = [
      ...paragraph(0, '※ 자문회의 실적'),
      ...tableParagraph(5, [
        plain('구분', '자문회의', '전문가 세미나', '포럼, 워크샵 등', '기타 회의'),
        plain('가실', '-', '-', '-', '-'),
        plain('나실', '1건', '-', '-', '-'),
        plain('다실', '-', '-', '-', '-'),
      ]),
    ];
    const before = serializeRecords(clone(recs));
    const r = normalizeSectionBody(recs);
    expect(serializeRecords(recs).equals(before)).toBe(true); // 한 바이트도 바뀌지 않는다
    expect(r).toEqual({ fixed: [], warnings: [] });
  });

  it('[RU-T61b] 표 제목(「1. 주요 업무실적」) 바로 뒤에 와도 집계표는 번호를 매기지 않는다', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(5, [plain('구분', '자문회의', '전문가 세미나', '포럼, 워크샵 등', '기타 회의'), plain('가실', '-', '-', '-', '-'), plain('계', '-', '-', '-', '-')]),
    ];
    const before = serializeRecords(clone(recs));
    expect(normalizeSectionBody(recs)).toEqual({ fixed: [], warnings: [] });
    expect(serializeRecords(recs).equals(before)).toBe(true);
  });
});

describe('RU-63 R3·R4 본부형 과제 표', () => {
  // 실측 꼴: 「구분」(실 이름)이 아래 여러 줄에 병합되면 그 아래 항목 행은 5칸, 과제 행은 3칸이 된다
  const mergedDeptRows = (nos: [string, string, string, string]): CellSpec[][] => [
    HEAD6,
    project6('기본', '과제 가', '가실'),
    [{ text: '', col: 0, rowSpan: 4 }, ...item6(nos[0], '항목 1', '9/21', false)],
    item6(nos[1], '항목 2', '9/22', false),
    project6('일반', '과제 나', null),
    item6(nos[2], '항목 3', '9/22', false),
    project6('수시', '과제 다', '나실'),
    item6(nos[3], '항목 4', '9/23'),
  ];

  it('[RU-T62] 「구분」 병합 아래의 항목 행(5칸)도 항목이다 — 맞는 번호 1-1…1-4는 그대로, 중복 번호를 만들지 않는다', () => {
    const recs = [...paragraph(0, '1. 주요 업무실적'), ...tableParagraph(6, mergedDeptRows(['1-1', '1-2', '1-3', '1-4']))];
    const before = serializeRecords(clone(recs));
    const r = normalizeSectionBody(recs);
    // 예전 판정(6칸 줄만 항목)은 1-1·1-4만 보고 1-4를 「1-2」로 바꿔 1-2가 둘이 됐다
    expect(column(recs, 0, 1)).toEqual(['유형', '기본', '1-1', '1-2', '일반', '1-3', '수시', '1-4']);
    expect(r.fixed).toEqual([]);
    expect(serializeRecords(recs).equals(before)).toBe(true);
  });

  it('[RU-T63] 어긋난 번호는 표 전체 연속으로 다시 매기고(Q7), 과제 행의 유형 칸은 손대지 않는다', () => {
    const recs = [...paragraph(0, '2. 주요 업무계획'), ...tableParagraph(6, mergedDeptRows(['1-1', '1-1', '', '2-9']))];
    const r = normalizeSectionBody(recs);
    expect(column(recs, 0, 1)).toEqual(['유형', '기본', '2-1', '2-2', '일반', '2-3', '수시', '2-4']);
    expect(column(recs, 0, 2)).toEqual(['과제명', '과제 가', '항목 1', '항목 2', '과제 나', '항목 3', '과제 다', '항목 4']);
    expect(r.fixed).toEqual(['번호 4곳 다시 매김']);
  });

  it('[RU-T64] 번호가 빈 줄 — 과제명이 책임자 칸 앞까지 병합된 줄(과제 행 꼴)은 번호를 달지 않는다', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(6, [HEAD6, project6('', '유형을 안 쓴 과제', '가실'), item6('', '항목 1', '9/21'), item6('1-7', '항목 2', '9/22')]),
    ];
    normalizeSectionBody(recs);
    expect(column(recs, 0, 1)).toEqual(['유형', '', '1-1', '1-2']);
  });

  it('[RU-T65] 7열 변형(일자 칸 두 칸 병합)도 같은 규칙으로 고친다', () => {
    const head: CellSpec[] = [
      { text: '구분', col: 0 },
      { text: '유형', col: 1 },
      { text: '과제명', col: 2, colSpan: 4 },
      { text: '책임자', col: 6 },
    ];
    const project = (type: string, dept: string): CellSpec[] => [
      { text: dept, col: 0 },
      { text: type, col: 1 },
      { text: '과제', col: 2, colSpan: 4 },
      { text: '책임 가', col: 6 },
    ];
    const itemWideDate = (no: string): CellSpec[] => [
      { text: '', col: 0 },
      { text: no, col: 1 },
      { text: '항목', col: 2 },
      { text: '9/22', col: 3, colSpan: 2 },
      { text: '장소 가', col: 5 },
      { text: '참석 가', col: 6 },
    ];
    const itemWideName = (no: string): CellSpec[] => [
      { text: '', col: 0 },
      { text: no, col: 1 },
      { text: '항목', col: 2, colSpan: 2 },
      { text: '9/22', col: 4 },
      { text: '장소 가', col: 5 },
      { text: '참석 가', col: 6 },
    ];
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(7, [head, project('기본', '가실'), itemWideDate('1-1'), itemWideDate('1-1'), project('수탁', ''), itemWideName(''), itemWideDate('3-2')]),
    ];
    const r = normalizeSectionBody(recs);
    expect(column(recs, 0, 1)).toEqual(['유형', '기본', '1-1', '1-2', '수탁', '1-3', '1-4']);
    expect(r.fixed).toEqual(['번호 3곳 다시 매김']);
  });

  it('[RU-T66] 머리행이 「구분|유형」이 아닌 6열 표는 본부형이 아니다 — 번호 칸으로 보이는 2열도 손대지 않는다', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(6, [plain('번호', '구분', '건명', '일자', '결과', '비고'), plain('1', '2-7', '건 가', '9/21', '-', '-'), plain('2', '', '건 나', '9/22', '-', '-')]),
    ];
    const before = serializeRecords(clone(recs));
    expect(normalizeSectionBody(recs).fixed).toEqual([]);
    expect(serializeRecords(recs).equals(before)).toBe(true);
  });
});

describe('RU-63 R5 머리행 이름 · RU-64 R6 일자 경고', () => {
  it('[RU-T67] 「업무 기간」→「일자」, 「업무 담당 또는 참석 인원」·「…참석자」→「참석자」 (칸 안 줄바꿈 무시)', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(5, [plain('구분', '업무실적 내용', '업무 기간', '장소', '업무 담당 또는\n참석 인원'), plain('1-1', '업무 가', '10/1', '', '')]),
      ...paragraph(0, '2. 주요 업무계획'),
      ...tableParagraph(5, [plain('구 분', '업무실적 내용', '업무기간', '장소', '업무 담당 또는 참석자'), plain('2-1', '업무 나', '10/8', '', '')]),
    ];
    const r = normalizeSectionBody(recs);
    expect(grid(recs, 0)[0]).toEqual({ 0: '구분', 1: '업무실적 내용', 2: '일자', 3: '장소', 4: '참석자' });
    expect(grid(recs, 1)[0]).toEqual({ 0: '구 분', 1: '업무실적 내용', 2: '일자', 3: '장소', 4: '참석자' });
    expect(r.fixed).toEqual(['머리행 이름 4곳 통일']);
  });

  it('[RU-T67b] 문단 둘로 나뉜 머리행 칸(Enter)은 건드리지 않는다 — 첫 문단만 바뀌어 「참석자⏎참석 인원」이 되지 않게', () => {
    const head: CellSpec[] = [
      { text: '구분', col: 0 },
      { text: '업무실적 내용', col: 1 },
      { text: '', col: 2, paras: ['업무', '기간'] },
      { text: '장소', col: 3 },
      { text: '', col: 4, paras: ['업무 담당 또는', '참석 인원'] },
    ];
    const recs = [...paragraph(0, '1. 주요 업무실적'), ...tableParagraph(5, [head, plain('1-1', '업무 가', '10/1', '', '')])];
    const r = normalizeSectionBody(recs);
    expect(grid(recs, 0)[0]).toEqual({ 0: '구분', 1: '업무실적 내용', 2: '업무\n기간', 3: '장소', 4: '업무 담당 또는\n참석 인원' });
    expect(r.fixed).toEqual([]);
  });

  it('[RU-T68] 일자 뒤의 시각(「10/1 14:00」 「10/2(목)10:00~12:00」)은 경고하지 않는다 — 시각 아닌 표기만 경고', () => {
    const recs = [
      ...paragraph(0, '1. 주요 업무실적'),
      ...tableParagraph(5, [
        HEAD5,
        plain('1-1', '업무 가', '10/1 14:00', '', ''),
        plain('1-2', '업무 나', '10/2(목)10:00~12:00', '', ''),
        plain('1-3', '업무 다', '9/30 14:00~10/1 12:00', '', ''),
        plain('1-4', '업무 라', '10/1,\n10/2 9:30', '', ''),
        plain('1-5', '업무 마', '10월 3일', '', ''),
      ]),
    ];
    const r = normalizeSectionBody(recs);
    expect(r.warnings).toEqual(['일자 표기 확인: 「10월 3일」']);
    expect(r.fixed).toEqual([]);
  });
});
