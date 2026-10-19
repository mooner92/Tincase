// RH-30~36 — 연구 본부·센터 양식(③ 본부·센터형 · ④ 환경평가형) 만들기.
//
// 본부본은 hwp를 이어 붙여 만들지 않는다 — 실마다 쓴 과제·항목을 본부 순서로 늘어놓아 본부 양식 한 벌에 바로 쓴다.
// 양식은 원본 취합본에서 떼어 만든다(`buildHqTemplate`) — 서식은 원본 레코드가 들고 있고 우리는 줄을 고르고 글자만 바꾼다.
import * as CFB from 'cfb';
import { openHwp } from './ole';
import { parseRecords, serializeRecords, type HwpRecord } from './record';
import { HwpWriteError, locateTables, normalizeCharShape, ownControls, ownText, packHwp, setParagraphText, stripCfbSentinel, topParagraphs, type TableSpan } from './writer';
import { TAG } from './record';
import { BLUE, charShapeColors, ensureColorShape, isEmphasis } from './charshape';
import { fixLastFlags, renumberTables } from './orgdoc';
import { cellText, fitHeaderRow, rebuildRows, setCellsAt, type ProtoRow } from './proto-rows';

export type HqTableKind = 'consult' | 'evaluation' | 'results' | 'plans' | 'notes';

/** RH-34 — 표 앞 문단 글자로 표의 종류를 정한다 */
export function tableKindOf(text: string): HqTableKind | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/^※ ?자문회의/.test(t)) return 'consult';
  if (/^※ ?평가/.test(t)) return 'evaluation';
  if (/^1\. ?주요 ?업무 ?실적/.test(t)) return 'results';
  if (/^2\. ?주요 ?업무 ?계획/.test(t)) return 'plans';
  if (/^3\. ?기타/.test(t)) return 'notes';
  return null;
}

/** RH-34 — 종류 → `locateTables` 순번. 같은 종류가 둘이면 앞의 것 */
export function locateTitledTables(recs: readonly HwpRecord[]): Partial<Record<HqTableKind, number>> {
  const tables = locateTables(recs);
  const out: Partial<Record<HqTableKind, number>> = {};
  let pending: HqTableKind | null = null;
  for (const b of topParagraphs(recs)) {
    if (ownControls(recs, b).includes('tbl ')) {
      const ord = tables.findIndex((t) => t.tableIdx > b.start && t.tableIdx < b.end);
      if (pending && ord >= 0 && out[pending] === undefined) out[pending] = ord;
      pending = null;
      continue;
    }
    const k = tableKindOf(ownText(recs, b));
    if (k) pending = k;
  }
  return out;
}

// ── 데이터 ─────────────────────────────────────────────

export interface HqItem {
  content: string;
  date: string;
  place: string;
  people: string;
  emphasis?: boolean;
}

export interface HqTask {
  /** 실 약칭(국토실 · 탄중실 …) — 그 실의 첫 과제 줄에만 보인다(RH-32) */
  unit: string;
  type: string;
  title: string;
  owner: string;
  items: HqItem[];
}

export interface HqFormData {
  /** 맨 위 제목(본부명). 없으면 양식 그대로 */
  title?: string;
  /** 자문회의 실적 — 줄 이름(본부명 · 실 이름)마다 네 칸(자문회의 · 전문가 세미나 · 포럼·워크샵 · 기타 회의) */
  consult?: { label: string; values: readonly string[] }[];
  /** 평가 실적 — 양식의 빈 값 칸에 줄 우선 순서로 */
  evaluation?: readonly string[];
  results: HqTask[];
  plans: HqTask[];
  notes: HqItem[];
}

/** 양식의 6칸 표 데이터 줄 배치 — `buildHqTemplate`가 이 순서로 만든다 */
export const PROJECT_PROTO = { taskFirst: 1, taskCont: 2, item: 3, itemLast: 4 } as const;
/** 양식의 특이사항·자문회의 표 데이터 줄 배치 */
export const PLAIN_PROTO = { middle: 1, last: 2 } as const;

/** 짧은 이름 칸 — 꺾이지 않게 줄여 넣는다. 6칸: 구분(실 약칭) · 유형/번호, 5칸: 번호, 자문회의: 줄 이름 */
const PROJECT_FIT = [0, 1] as const;
const NOTE_FIT = [0] as const;
const CONSULT_FIT = [0] as const;

const has = (s: string | undefined) => !!s && s.trim() !== '';
const itemHasText = (i: HqItem) => has(i.content) || has(i.date) || has(i.place) || has(i.people);

/** RH-32 · RH-33 — 과제·항목을 6칸 표의 줄로. `section`은 번호 머리(실적 1 · 계획 2) */
export function projectRows(tasks: readonly HqTask[], section: number, empty = '-'): ProtoRow[] {
  const rows: ProtoRow[] = [];
  let n = 0;
  let prevUnit: string | null = null;
  for (const t of tasks) {
    const items = t.items.filter(itemHasText);
    if (items.length === 0) continue;
    const first = t.unit !== prevUnit;
    prevUnit = t.unit;
    rows.push({
      proto: first ? PROJECT_PROTO.taskFirst : PROJECT_PROTO.taskCont,
      texts: { 0: first ? t.unit : '', 1: t.type, 2: t.title, 5: t.owner },
    });
    for (const it of items) {
      n += 1;
      rows.push({
        proto: PROJECT_PROTO.item,
        texts: { 1: `${section}-${n}`, 2: it.content, 3: it.date, 4: it.place, 5: it.people },
        ...(it.emphasis ? { emphasisCol: 2 } : {}),
      });
    }
  }
  if (rows.length === 0) return [{ proto: PROJECT_PROTO.itemLast, texts: { 1: empty, 2: empty, 3: empty, 4: empty, 5: empty } }];
  rows[rows.length - 1] = { ...rows[rows.length - 1], proto: PROJECT_PROTO.itemLast };
  return rows;
}

/** 3. 기타 특이사항 — 5칸 한 층 */
export function noteRows(notes: readonly HqItem[], empty = '-'): ProtoRow[] {
  const kept = notes.filter(itemHasText);
  if (kept.length === 0) return [{ proto: PLAIN_PROTO.last, texts: { 0: empty, 1: empty, 2: empty, 3: empty, 4: empty } }];
  return kept.map((it, i) => ({
    proto: i === kept.length - 1 ? PLAIN_PROTO.last : PLAIN_PROTO.middle,
    texts: { 0: `3-${i + 1}`, 1: it.content, 2: it.date, 3: it.place, 4: it.people },
    ...(it.emphasis ? { emphasisCol: 1 } : {}),
  }));
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 표의 빈 칸 주소(줄 우선) — 평가 실적의 값 자리 */
function emptyCells(recs: readonly HwpRecord[], t: TableSpan): string[] {
  return [...t.cells]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .filter((c) => cellText(recs, c).trim() === '')
    .map((c) => `${c.row}:${c.col}`);
}

export interface FillHqOptions {
  empty?: string;
  /** 강조 항목의 글자색 — 기본 파랑(HM-37과 같은 규칙). 원래 서식을 복제해 색만 바꾼다 */
  emphasisColor?: number;
}

/** 그 표 (줄, 칸)의 첫 글자 서식 번호 */
function shapeIdAt(recs: readonly HwpRecord[], ord: number, row: number, col: number): number | null {
  const t = locateTables(recs)[ord];
  const cell = t?.cells.find((c) => c.row === row && c.col === col);
  if (!cell) return null;
  for (let k = cell.start; k < cell.end; k++) {
    if (recs[k].tag === TAG.PARA_CHAR_SHAPE && recs[k].data.length >= 8) return recs[k].data.readUInt32LE(4);
  }
  return null;
}

/** 본부 양식에 데이터를 써서 hwp 한 벌을 돌려준다 */
export function fillHqForm(template: Buffer, data: HqFormData, opts: FillHqOptions = {}): Buffer {
  const empty = opts.empty ?? '-';
  const file = openHwp(template);
  const recs = parseRecords(file.sections[0]);
  const at = locateTitledTables(recs);
  for (const k of ['results', 'plans', 'notes'] as const) {
    if (at[k] === undefined) throw new HwpWriteError(`양식에 「${k}」 표가 없습니다`);
  }

  // HM-37 — 강조 항목이 있을 때만 DocInfo에 색 서식을 만든다(바꿀 이유가 없으면 건드리지 않는다). 내용 칸의 원래 서식을 복제한다
  const anyEmph = [...data.results, ...data.plans].some((t) => t.items.some((i) => i.emphasis)) || data.notes.some((i) => i.emphasis);
  let docInfoOut: Buffer | undefined;
  const emph = { project: null as number | null, notes: null as number | null };
  if (anyEmph) {
    const di = parseRecords(file.docInfo);
    const color = opts.emphasisColor ?? BLUE;
    const pBase = shapeIdAt(recs, at.results!, PROJECT_PROTO.item, 2);
    const nBase = shapeIdAt(recs, at.notes!, PLAIN_PROTO.middle, 1);
    emph.project = pBase === null ? null : ensureColorShape(di, pBase, color);
    emph.notes = nBase === null ? null : ensureColorShape(di, nBase, color);
    docInfoOut = serializeRecords(di);
  }

  // 순번이 바뀌지 않으므로(표 수는 그대로) 어느 순서로 고쳐도 된다 — 뒤 표부터
  rebuildRows(recs, at.notes!, noteRows(data.notes, empty), { emphasisShapeId: emph.notes, fitCols: NOTE_FIT });
  rebuildRows(recs, at.plans!, projectRows(data.plans, 2, empty), { emphasisShapeId: emph.project, fitCols: PROJECT_FIT });
  rebuildRows(recs, at.results!, projectRows(data.results, 1, empty), { emphasisShapeId: emph.project, fitCols: PROJECT_FIT });

  if (at.evaluation !== undefined) {
    const t = locateTables(recs)[at.evaluation];
    const slots = emptyCells(recs, t);
    const vals = new Map<string, string>();
    slots.forEach((addr, i) => vals.set(addr, has(data.evaluation?.[i]) ? data.evaluation![i] : empty));
    setCellsAt(recs, at.evaluation, vals);
  }

  if (at.consult !== undefined) {
    const t = locateTables(recs)[at.consult];
    const byLabel = new Map((data.consult ?? []).map((c) => [squash(c.label), c.values]));
    const vals = new Map<string, string>();
    for (let r = 1; r < t.rows; r++) {
      const head = t.cells.find((c) => c.row === r && c.col === 0);
      const v = head ? byLabel.get(squash(cellText(recs, head))) : undefined;
      for (let c = 1; c <= 4; c++) vals.set(`${r}:${c}`, has(v?.[c - 1]) ? v![c - 1] : empty);
    }
    setCellsAt(recs, at.consult, vals);
  }

  if (has(data.title)) setParagraphText(recs, topParagraphs(recs)[0], data.title!);
  return packHwp(template, [serializeRecords(recs)], docInfoOut);
}

// ── RH-36 다시 읽기 ───────────────────────────────────

/** 만든 hwp의 표를 칸 글자 격자로 읽는다 — 줄마다 [열 주소, 글자] */
export function readHqTables(bytes: Buffer): Partial<Record<HqTableKind, [number, string][][]>> {
  const recs = parseRecords(openHwp(bytes).sections[0]);
  const at = locateTitledTables(recs);
  const tables = locateTables(recs);
  const out: Partial<Record<HqTableKind, [number, string][][]>> = {};
  for (const [k, ord] of Object.entries(at) as [HqTableKind, number][]) {
    const t = tables[ord];
    const rows: [number, string][][] = [];
    for (let r = 0; r < t.rows; r++) {
      rows.push(t.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col).map((c) => [c.col, cellText(recs, c)]));
    }
    out[k] = rows;
  }
  return out;
}

// ── RH-70 · RH-76 판정과 되읽기 ───────────────────────

/** RH-70 — 연구 본부 양식인가: `1. 주요 업무실적` 표가 6칸(두 층)이다 */
export function isProjectForm(bytes: Buffer): boolean {
  try {
    const recs = parseRecords(openHwp(bytes).sections[0]);
    const at = locateTitledTables(recs);
    return at.results !== undefined && locateTables(recs)[at.results].cols === 6;
  } catch {
    return false;
  }
}

const isBlank = (v: string) => v.trim() === '' || v.trim() === '-';

/** RH-76 — 만든 hwp(또는 같은 모양의 양식)를 과제·항목으로 되돌린다. 빈 표기(`-`)만 있는 줄은 버린다. 강조는 내용 칸의 글자색으로 안다 */
export function parseHqForm(bytes: Buffer): HqFormData {
  const file = openHwp(bytes);
  const recs = parseRecords(file.sections[0]);
  let colors: number[] = [];
  try {
    colors = charShapeColors(parseRecords(file.docInfo));
  } catch {
    colors = [];
  }
  const at = locateTitledTables(recs);
  const emphasized = (ord: number | undefined, col: number) => {
    const out = new Set<number>();
    if (ord === undefined) return out;
    for (const c of locateTables(recs)[ord].cells) {
      if (c.col !== col || c.row === 0) continue;
      const id = shapeIdAt(recs, ord, c.row, c.col);
      if (id !== null && isEmphasis(colors[id] ?? 0)) out.add(c.row);
    }
    return out;
  };
  const emphRows = { results: emphasized(at.results, 2), plans: emphasized(at.plans, 2), notes: emphasized(at.notes, 1) };
  const back = readHqTables(bytes);
  const text = (row: [number, string][], col: number) => row.find(([c]) => c === col)?.[1] ?? '';
  const project = (rows: [number, string][][] | undefined, emph: Set<number>): HqTask[] => {
    const tasks: HqTask[] = [];
    let unit = '';
    for (const [r, row] of (rows ?? []).entries()) {
      if (r === 0) continue;
      if (row.length === 4) {
        if (text(row, 0).trim()) unit = text(row, 0).trim();
        tasks.push({ unit, type: text(row, 1), title: text(row, 2), owner: text(row, 5), items: [] });
      } else if (row.length >= 6) {
        const it: HqItem = { content: text(row, 2), date: text(row, 3), place: text(row, 4), people: text(row, 5) };
        if ([it.content, it.date, it.place, it.people].every(isBlank)) continue;
        if (emph.has(r)) it.emphasis = true;
        if (tasks.length === 0) tasks.push({ unit, type: '', title: '', owner: '', items: [] });
        tasks[tasks.length - 1].items.push(it);
      }
    }
    return tasks;
  };
  const notes: HqItem[] = [];
  for (const [r, row] of (back.notes ?? []).entries()) {
    if (r === 0) continue;
    const it: HqItem = { content: text(row, 1), date: text(row, 2), place: text(row, 3), people: text(row, 4) };
    if ([it.content, it.date, it.place, it.people].every(isBlank)) continue;
    if (emphRows.notes.has(r)) it.emphasis = true;
    notes.push(it);
  }
  // 자문회의 — 줄 이름(0칸) · 값 넷. 평가 실적 — 값 칸(숫자이거나 「-」)만, 줄 우선 순서 — 이름 칸에는 숫자가 없다(양식 실측)
  const consult = (back.consult ?? []).slice(1).map((row) => ({ label: text(row, 0).trim(), values: [1, 2, 3, 4].map((c) => text(row, c).trim()) }));
  const evaluation = (back.evaluation ?? []).flatMap((row) => row.map(([, v]) => v.trim()).filter((v) => /\d|^-$/.test(v)));
  return {
    results: project(back.results, emphRows.results),
    plans: project(back.plans, emphRows.plans),
    notes,
    ...(consult.length ? { consult } : {}),
    ...(evaluation.length ? { evaluation } : {}),
  };
}

/** 평가 실적 표의 이름 칸(값 칸이 아닌 칸, 줄 우선) — 작성 화면이 값 칸 옆에 붙일 이름 */
export function evaluationLabels(bytes: Buffer): string[] {
  const back = readHqTables(bytes);
  return (back.evaluation ?? []).flatMap((row) => row.map(([, v]) => v.trim()).filter((v) => v !== '' && !/\d|^-$/.test(v)));
}

// ── RH-30 양식 만들기 ─────────────────────────────────

/** 원본 취합본의 섹션 제목 — 본부 구간의 끝을 찾는 데만 쓴다 */
const SECTION_TITLE = /^(임원실|글로벌대외협력단|기획경영본부|경영지원실|기후대기전략연구본부|생활환경연구본부|국토환경연구본부|환경평가본부|국가기후위기적응센터|국가지속가능발전연구센터|AI ?홍보전략실)/;

export interface HqTemplateSpec {
  /** 본부명 — 제목과 자문회의 첫 줄 */
  name: string;
  /** 자문회의 표의 실 줄(본부 줄 다음, 본부 순서) */
  units: readonly string[];
  /** 자문회의 표를 떼어 올 원본 섹션 — 없으면 `name`(그 본부 자신의 표) */
  consultFrom?: string;
  /** 평가 실적 표를 떼어 올 원본 섹션과 자리 */
  evaluation?: { from: string; place: 'beforeConsult' | 'afterConsult' };
}

export interface HqTemplateSources {
  /** 자문회의 · 1 · 2 표의 원형을 떼어 올 섹션 — 가장 깔끔한 본부(RH-30) */
  projectFrom: string;
  /** 3. 기타 특이사항 원형 — 본부·센터 양식의 표준 너비를 가진 섹션 */
  notesFrom: string;
}

export const DEFAULT_SOURCES: HqTemplateSources = { projectFrom: '국토환경연구본부', notesFrom: '기후대기전략연구본부' };

interface Piece {
  start: number;
  end: number;
}

function sectionBlocks(recs: readonly HwpRecord[], name: string): ReturnType<typeof topParagraphs> {
  const blocks = topParagraphs(recs);
  const from = blocks.findIndex((b) => !ownControls(recs, b).includes('tbl ') && ownText(recs, b).trim().startsWith(name));
  if (from < 0) throw new HwpWriteError(`원본에 「${name}」 섹션이 없습니다`);
  let to = from + 1;
  while (to < blocks.length) {
    const t = ownText(recs, blocks[to]).trim();
    if (!ownControls(recs, blocks[to]).includes('tbl ') && SECTION_TITLE.test(t) && tableKindOf(t) === null) break;
    to += 1;
  }
  return blocks.slice(from, to);
}

/** 섹션 안에서 그 종류의 제목 문단부터 다음 제목 문단 앞까지(표와 뒤 빈 줄 포함) */
function pieceOf(recs: readonly HwpRecord[], section: ReturnType<typeof topParagraphs>, kind: HqTableKind): Piece {
  const h = section.findIndex((b) => tableKindOf(ownText(recs, b)) === kind);
  if (h < 0) throw new HwpWriteError(`원본 섹션에 「${kind}」 제목이 없습니다`);
  let e = h + 1;
  while (e < section.length && tableKindOf(ownText(recs, section[e])) === null) e += 1;
  return { start: section[h].start, end: section[e - 1].end };
}

/** 6칸 표의 원형 줄 — 구조로 찾는다(원본마다 줄 번호가 다르다) */
function projectProtos(recs: readonly HwpRecord[], t: TableSpan): number[] {
  const cellsOf = (r: number) => t.cells.filter((c) => c.row === r);
  const col0 = (r: number) => {
    const c = cellsOf(r).find((x) => x.col === 0);
    return c ? cellText(recs, c).trim() : '';
  };
  const last = t.rows - 1;
  const rows = Array.from({ length: t.rows - 1 }, (_, i) => i + 1);
  const taskFirst = rows.find((r) => cellsOf(r).length === 4 && col0(r) !== '');
  const taskCont = rows.find((r) => cellsOf(r).length === 4 && col0(r) === '');
  const item = rows.find((r) => r !== last && cellsOf(r).length === 6);
  if (!taskFirst || !taskCont || !item || cellsOf(last).length !== 6) {
    throw new HwpWriteError('6칸 표에서 원형 줄(과제 첫 줄 · 과제 이은 줄 · 항목 줄 · 마지막 항목 줄)을 찾지 못했습니다');
  }
  return [taskFirst, taskCont, item, last];
}

const blankRow = (proto: number): ProtoRow => ({ proto, texts: {} });

/** 셀의 첫 글자 서식 */
function shapeAt(recs: readonly HwpRecord[], t: TableSpan, row: number, col: number): number | null {
  const cell = t.cells.find((c) => c.row === row && c.col === col);
  if (!cell) return null;
  for (let k = cell.start; k < cell.end; k++) {
    if (recs[k].tag === TAG.PARA_CHAR_SHAPE && recs[k].data.length >= 8) return recs[k].data.readUInt32LE(4);
  }
  return null;
}

/** PARA_HEADER의 문단 모양 번호 자리 */
const PARA_SHAPE = 8;

/** `rows`의 칸마다 문단 모양(정렬 등)을 `fromRow`의 같은 열 칸 것으로 — 원본은 줄마다 가운데·왼쪽 정렬이 섞여 있었다 */
function unifyParaShapes(recs: HwpRecord[], ord: number, rows: readonly number[], fromRow: number): void {
  const t = locateTables(recs)[ord];
  const shapeOfCol = new Map<number, number>();
  for (const c of t.cells.filter((x) => x.row === fromRow)) {
    for (let k = c.start; k < c.end; k++) {
      if (recs[k].tag === TAG.PARA_HEADER && recs[k].data.length >= PARA_SHAPE + 2) {
        shapeOfCol.set(c.col, recs[k].data.readUInt16LE(PARA_SHAPE));
        break;
      }
    }
  }
  for (const c of t.cells) {
    if (!rows.includes(c.row) || !shapeOfCol.has(c.col)) continue;
    for (let k = c.start; k < c.end; k++) {
      if (recs[k].tag !== TAG.PARA_HEADER || recs[k].data.length < PARA_SHAPE + 2) continue;
      const d = Buffer.from(recs[k].data);
      d.writeUInt16LE(shapeOfCol.get(c.col)!, PARA_SHAPE);
      recs[k] = { ...recs[k], data: d };
    }
  }
}

/**
 * 원형 줄들의 글자 서식을 **칸(열)마다** 기준 줄의 것으로 — 원본은 분량을 맞추려고 줄마다 장평·크기를 손으로 줄여 두었다(§1-2).
 * 그대로 복제하면 과제마다 글자가 납작하거나 작아진다. 한 줄의 서식 하나로 몰면 칸마다 다른 원래 모양(구분 칸은 좁게, 과제명은 크게)이
 * 무너져 「순환실」이 두 줄로 꺾이고 항목 글자가 벌어졌다(2026-10-17 한글에서 확인) — 그래서 열마다 맞춘다.
 */
function unifyShapes(recs: HwpRecord[], ord: number, rows: readonly number[], fromRow: number): void {
  const t = locateTables(recs)[ord];
  const ref = new Map<number, number>();
  for (const c of t.cells.filter((x) => x.row === fromRow)) {
    const sh = shapeAt(recs, t, fromRow, c.col);
    if (sh !== null) ref.set(c.col, sh);
  }
  for (const cell of t.cells) {
    if (!rows.includes(cell.row) || !ref.has(cell.col)) continue;
    normalizeCharShape(recs, cell, ref.get(cell.col)!);
  }
}

/**
 * RH-30 — 원본 취합본(바이너리 hwp)에서 본부 양식을 떼어 만든다.
 * `summaryDonor`는 문서 정보(작성자·날짜)를 대신할 깨끗한 hwp — 원본 취합본의 작성자를 양식에 남기지 않는다.
 */
export function buildHqTemplate(source: Buffer, spec: HqTemplateSpec, summaryDonor: Buffer, sources: HqTemplateSources = DEFAULT_SOURCES): Buffer {
  const recs = parseRecords(openHwp(source).sections[0]);
  const base = sectionBlocks(recs, sources.projectFrom);
  const notesSec = sectionBlocks(recs, sources.notesFrom);
  const first = topParagraphs(recs)[0]; // 구역·단 정의를 든 첫 문단 — 제목 자리

  const pieces: Piece[] = [];
  // 자문회의 표는 그 본부 것 — 줄 이름(본부·실) 칸 너비와 글자 모양을 본부마다 맞춰 두었다
  const consult = pieceOf(recs, sectionBlocks(recs, spec.consultFrom ?? spec.name), 'consult');
  const evaluation = spec.evaluation ? pieceOf(recs, sectionBlocks(recs, spec.evaluation.from), 'evaluation') : null;
  if (evaluation && spec.evaluation!.place === 'beforeConsult') pieces.push(evaluation);
  pieces.push(consult);
  if (evaluation && spec.evaluation!.place === 'afterConsult') pieces.push(evaluation);
  const results = pieceOf(recs, base, 'results');
  // 계획 표도 실적 표와 같은 원형 — 원본의 두 표는 칸 너비가 조금 달라 위아래 표 끝이 어긋났다
  pieces.push(results, results, pieceOf(recs, notesSec, 'notes'));

  const copy = (p: Piece) => recs.slice(p.start, p.end).map((r) => ({ ...r, data: Buffer.from(r.data) }));
  const out: HwpRecord[] = [...copy(first)];
  for (const p of pieces) out.push(...copy(p));
  setParagraphText(out, topParagraphs(out)[0], spec.name);
  const resultHeads = topParagraphs(out).filter((b) => tableKindOf(ownText(out, b)) === 'results');
  setParagraphText(out, resultHeads[1], '2. 주요 업무계획');
  renumberTables(out);
  fixLastFlags(out);

  const at = locateTitledTables(out);
  const tables = () => locateTables(out);

  const { taskFirst, taskCont, item, itemLast } = PROJECT_PROTO;
  for (const ord of [at.results!, at.plans!]) {
    rebuildRows(out, ord, projectProtos(out, tables()[ord]).map(blankRow));
    unifyShapes(out, ord, [taskFirst, taskCont], taskFirst);
    unifyShapes(out, ord, [item, itemLast], item);
    unifyParaShapes(out, ord, [taskCont], taskFirst);
    unifyParaShapes(out, ord, [item], itemLast); // 원본 마지막 줄이 일자·장소·참석자 가운데 정렬(제출본의 대다수 모양)
  }
  const nt = tables()[at.notes!];
  rebuildRows(out, at.notes!, [blankRow(1), blankRow(nt.rows - 1)]);
  unifyShapes(out, at.notes!, [PLAIN_PROTO.middle, PLAIN_PROTO.last], PLAIN_PROTO.middle);
  unifyParaShapes(out, at.notes!, [PLAIN_PROTO.middle], PLAIN_PROTO.last);

  // 자문회의 — 본부 줄은 원본의 첫 줄, 실 줄은 원본의 가운데 줄(정렬이 본부 줄과 다르다), 끝 줄은 마지막 줄을 원형으로
  const ct = tables()[at.consult!];
  const middle = ct.rows > 3 ? 2 : 1;
  const labels = [spec.name, ...spec.units];
  rebuildRows(
    out,
    at.consult!,
    labels.map((label, i) => ({ proto: i === 0 ? 1 : i === labels.length - 1 ? ct.rows - 1 : middle, texts: { 0: label } })),
    { fitCols: CONSULT_FIT },
  );
  for (const k of ['consult', 'results', 'plans', 'notes'] as const) fitHeaderRow(out, at[k]!);

  if (at.evaluation !== undefined) {
    const et = tables()[at.evaluation];
    const vals = new Map<string, string>();
    for (const c of et.cells) if (/\d|^-$/.test(cellText(out, c).trim())) vals.set(`${c.row}:${c.col}`, '');
    setCellsAt(out, at.evaluation, vals);
  }

  return scrubContainer(packHwp(source, [serializeRecords(out)]), previewText(out), summaryDonor);
}

/** 미리보기 글자 — 양식 자신의 문단·칸 글자(원본 취합본 첫 쪽이 남지 않게) */
function previewText(recs: readonly HwpRecord[]): string {
  const lines = topParagraphs(recs).map((b) => ownText(recs, b).trim()).filter(Boolean);
  return lines.join('\r\n');
}

/** 원본 컨테이너에서 남의 흔적을 걷는다 — 미리보기 그림 삭제 · 미리보기 글자 교체 · 문서 정보(작성자·날짜) 교체 */
function scrubContainer(bytes: Buffer, prvText: string, summaryDonor: Buffer): Buffer {
  const cf = CFB.read(bytes, { type: 'buffer' });
  const donor = CFB.read(summaryDonor, { type: 'buffer' });
  const summary = CFB.find(donor, '\u0005HwpSummaryInformation');
  if (!summary) throw new HwpWriteError('문서 정보를 빌려 올 양식에 HwpSummaryInformation이 없습니다');
  CFB.utils.cfb_add(cf, '/\u0005HwpSummaryInformation', Buffer.from(summary.content as Uint8Array));
  // 지운 뒤 디렉터리 트리를 다시 짜지 않으면 형제 연결이 어긋나 FileHeader가 엉뚱한 폴더 밑으로 간다(실측)
  if (CFB.find(cf, 'PrvImage')) {
    CFB.utils.cfb_del(cf, '/PrvImage');
    CFB.utils.cfb_gc(cf);
  }
  CFB.utils.cfb_add(cf, '/PrvText', Buffer.from(prvText, 'utf16le'));
  return stripCfbSentinel(Buffer.from(CFB.write(cf, { type: 'buffer' }) as Uint8Array));
}
