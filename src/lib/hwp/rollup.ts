// RU-10~15 — 본부·전사 단계의 **이어 붙이기** (병합 엔진 L5).
//
// 실·팀 병합본 여러 개를 한 문서로 잇는다. 단위 **안의** 내용(행 순서·구분 번호·파란 「공유」)은
// 손대지 않고, 단위의 **순서**만 정한다 (RU-11).
//
// 파일을 바이트째 잇지 않는다(RU-12). 문서마다 서식 표(DocInfo)가 달라서, 남의 문서 본문을
// 그대로 붙이면 서식 번호가 엉뚱한 서식을 가리킨다. 대신 각 문서를 **단위 블록으로 읽고**,
// 양식 한 벌의 「제목 + 1·2·3 표」를 단위 수만큼 **복제해서** 채운다 — HM-03 「합성하지 말고
// 복제하라」를 문서 단위로 넓힌 것이다. 서식·글꼴·테두리는 전부 양식이 들고 있다.
import { openHwp } from './ole';
import { parseRecords, serializeRecords, TAG, type HwpRecord } from './record';
import { extractTables, tableGrid, type HwpTable } from './model';
import { cellValue, rowEmphasis } from './reader';
import { BLUE, charShapeColors, ensureColorShape } from './charshape';
import {
  fillTable,
  HwpWriteError,
  ownControls,
  ownText,
  packHwp,
  plainShapeIdOf,
  prependTitleParagraph,
  setParagraphText,
  topParagraphs,
  type Block,
} from './writer';

export type Bucket = 'achievements' | 'plans' | 'notes';
export const BUCKETS: readonly Bucket[] = ['achievements', 'plans', 'notes'];

export interface UnitRow {
  /** 구분 열 그대로 («1-3»). RU-11 — 다시 매기지 않는다 */
  no: string;
  content: string;
  date: string;
  place: string;
  attendee: string;
  /** HM-37 — 파란 「공유」 */
  emphasis: boolean;
}

export interface UnitBlock {
  /** 블록 머리의 단위명 («AI홍보전략실») */
  name: string;
  tables: Record<Bucket, UnitRow[]>;
}

export interface UnitsRead {
  units: UnitBlock[];
  warnings: string[];
}

const emptyTables = (): Record<Bucket, UnitRow[]> => ({ achievements: [], plans: [], notes: [] });

/**
 * 표 제목 문단인가 — 「1. 주요 업무실적」·「2. 주요 업무계획」·「3. 기타 특이사항」.
 *
 * 번호보다 **낱말**을 먼저 본다. 부서 양식마다 번호 꼴(「1.」·「Ⅰ.」·「□」)은 달라도
 * 이 세 낱말은 기획조정실 양식에서 온 것이라 같다. 긴 문장(작성 요령 등)은 제목이 아니다.
 */
export function titleBucket(text: string): Bucket | null {
  const s = text.replace(/\s+/g, '');
  if (!s || s.length > 30) return null;
  if (/업무실적/.test(s)) return 'achievements';
  if (/업무계획/.test(s)) return 'plans';
  if (/특이사항/.test(s)) return 'notes';
  return null;
}

function tableRows(t: HwpTable, colors: readonly number[]): UnitRow[] {
  const grid = tableGrid(t);
  const emph = rowEmphasis(t, colors);
  const out: UnitRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    // HM-15c — 첫 행은 머리글
    const [no = '', content = '', date = '', place = '', attendee = ''] = grid[r].map(cellValue);
    // HM-15e — 구분만 있고 나머지가 비면 양식의 빈 줄이다
    if (!content && !date && !place && !attendee) continue;
    out.push({ no, content, date, place, attendee, emphasis: emph.get(r) ?? false });
  }
  return out;
}

type Token = { kind: 'text'; text: string } | { kind: 'table'; table: HwpTable };

/**
 * RU-12 — 문서를 **단위 블록들**로 읽는다. 실·팀 병합본이면 한 블록, 본부본이면 여러 블록이다.
 *
 * 규칙 (단순하고 예측 가능하게):
 *   1. 「업무실적」 제목이 나오면 새 단위가 시작된다
 *   2. 단위명 = 그 제목 앞, 직전 표 이후에 나온 **마지막** 글 문단
 *      (본부 제목 → 실 이름 순으로 적혀 있으면 실 이름이 단위명이 된다)
 *   3. 표는 직전 제목의 자리(1·2·3)로 들어간다. 제목이 없으면 비어 있는 다음 자리로
 *   4. 단위가 시작된 뒤 표 밖에 적힌 글은 **옮기지 않고 경고로 알린다** — 조용히 버리지 않는다
 *
 * 이름을 못 찾은 첫 단위는 `fallbackName`(부서명)을 쓴다.
 */
export function readUnits(buf: Buffer, fallbackName: string): UnitsRead {
  const file = openHwp(buf);
  const warnings: string[] = [];
  let colors: number[] = [];
  try {
    colors = charShapeColors(parseRecords(file.docInfo));
  } catch {
    warnings.push(`${fallbackName}: 글자 서식을 읽지 못해 파란 「공유」 표시 없이 읽었습니다.`);
  }

  const tokens: Token[] = [];
  for (const section of file.sections) {
    const recs = parseRecords(section);
    for (const b of topParagraphs(recs)) {
      if (ownControls(recs, b).includes('tbl ')) {
        for (const t of extractTables(recs.slice(b.start, b.end))) tokens.push({ kind: 'table', table: t });
      } else {
        const text = ownText(recs, b).trim();
        if (text) tokens.push({ kind: 'text', text });
      }
    }
  }

  const units: (UnitBlock & { filled: Set<Bucket> })[] = [];
  // 지금 채우는 단위 = 마지막 단위. 변수로 들고 다니면 클로저 안 대입을 타입 검사가 못 따라간다
  const current = () => units[units.length - 1] ?? null;
  let pending: string[] = []; // 직전 표 이후의 글 문단
  let slot: Bucket | null = null;

  const dropPending = () => {
    const u = current();
    if (u && pending.length) {
      warnings.push(`${u.name}: 표 밖의 글 ${pending.length}줄은 옮기지 않았습니다 — 「${pending[0].slice(0, 30)}」`);
    }
    pending = [];
  };
  const start = () => {
    const name = pending.pop() ?? (units.length === 0 ? fallbackName : '');
    // 단위가 이미 있었다면 남은 글은 그 단위의 표 밖 글이다. 첫 단위 앞은 문서 머리(제목 등)라 넘어간다
    dropPending();
    if (!name) warnings.push(`${units.length + 1}번째 단위의 이름을 찾지 못했습니다.`);
    units.push({ name: name || `(이름 없음 ${units.length + 1})`, tables: emptyTables(), filled: new Set() });
    return units[units.length - 1];
  };

  for (const tok of tokens) {
    if (tok.kind === 'text') {
      const bucket = titleBucket(tok.text);
      if (bucket === null) {
        pending.push(tok.text);
        continue;
      }
      if (bucket === 'achievements' || current() === null) start();
      else dropPending();
      slot = bucket;
      continue;
    }
    const u = current() ?? start();
    const at = slot && !u.filled.has(slot) ? slot : BUCKETS.find((b) => !u.filled.has(b));
    slot = null;
    if (!at) {
      warnings.push(`${u.name}: 표가 셋보다 많아 ${tok.table.rows}행짜리 표를 옮기지 않았습니다.`);
      continue;
    }
    if (tok.table.cols !== 5) {
      warnings.push(`${u.name}: ${BUCKETS.indexOf(at) + 1}번 표가 ${tok.table.cols}칸입니다 — 양식(5칸)의 순서대로 옮겼습니다.`);
    }
    u.tables[at] = tableRows(tok.table, colors);
    u.filled.add(at);
  }
  dropPending();

  return { units: units.map(({ name, tables }) => ({ name, tables })), warnings };
}

export interface ComposeRollupOptions {
  /** 둘째 단위부터 새 쪽에서 시작한다 (문단 머리의 쪽 나누기) */
  pageBreak?: boolean;
}

export class RollupUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollupUnsupported';
  }
}

/** PARA_HEADER 11바이트째 — 나누기 종류. 0x04 = 쪽 나누기 (HWP 5.0 표 60) */
const BREAK_TYPE = 11;
const PAGE_BREAK = 0x04;
/** 표 CTRL_HEADER의 개체 공통 속성 안 인스턴스 ID 자리 (ctrlId 4 + 속성·좌표·크기·z 24 + 여백 8) */
const TBL_INSTANCE_ID = 36;

const clone = (rs: readonly HwpRecord[]): HwpRecord[] => rs.map((r) => ({ ...r, data: Buffer.from(r.data) }));

function ctrlName(data: Buffer): string {
  return data.length < 4 ? '' : Buffer.from([data[3], data[2], data[1], data[0]]).toString('latin1');
}

/**
 * RU-10 — 양식 + 단위 블록들 → 이어 붙인 hwp.
 *
 * 양식의 꼴(전 부서 양식이 같다, 2026-10-07 실측):
 *
 *   P0  [secd][cold]「기획조정실」     ← 첫 문단. 구역 정의 컨트롤이 붙어 있다
 *   P1  「1. 주요 업무실적」
 *   P2  [표]   P3 (빈 줄)   P4 「2. 주요 업무계획」   P5 [표]   P6 (빈 줄)   P7 「3. 기타 특이사항」   P8 [표]
 *
 * 만드는 꼴:
 *
 *   P0           「단위1」 (컨트롤 그대로·글자만)
 *   P1..끝 복제  단위1의 표 셋
 *   머리 복제    「단위2」 (P1을 복제해 글자만 — P0과 같은 문단·글자 모양이다)
 *   P1..끝 복제  단위2의 표 셋
 *   …
 *
 * 첫 문단이 「1. 주요 업무실적」인 양식(부서명이 없는 옛 꼴)은 먼저 HM-46으로 부서명 자리를 만든다.
 */
export function composeRollupHwp(
  templateBytes: Buffer,
  units: readonly UnitBlock[],
  opts: ComposeRollupOptions = {},
): { bytes: Buffer; warnings: string[] } {
  if (units.length === 0) throw new RollupUnsupported('이어 붙일 단위가 없습니다.');
  const warnings: string[] = [];
  const file = openHwp(templateBytes);
  let recs = parseRecords(file.sections[0]);

  let blocks = topParagraphs(recs);
  if (blocks.length < 2) throw new RollupUnsupported('양식에 문단이 너무 적습니다.');
  if (ownControls(recs, blocks[0]).includes('tbl ')) {
    throw new RollupUnsupported('양식의 첫 문단에 표가 붙어 있어 단위 이름을 둘 자리가 없습니다.');
  }
  if (titleBucket(ownText(recs, blocks[0]))) {
    // 부서명 줄이 없는 양식 — 첫 문단을 이름 자리로 비워 내고 제목을 아래로 내린다
    if (prependTitleParagraph(recs, units[0].name) === 'unsupported') {
      throw new RollupUnsupported('양식 첫 부분의 구조가 달라 단위 이름을 둘 자리를 만들지 못했습니다.');
    }
    blocks = topParagraphs(recs);
  }

  const first = blocks[0];
  const head = recs.slice(first.start, first.end);
  const body = recs.slice(blocks[1].start);
  const tablesPerUnit = locateTableCount(body);
  if (tablesPerUnit === 0) throw new RollupUnsupported('양식에 표가 없습니다.');

  // 단위 머리 문단의 원형 — 첫 문단과 문단 모양이 같은 「컨트롤 없는 글 문단」 (HM-46과 같은 선택)
  const shape = recs[first.start].data.readUInt16LE(8);
  const plain = blocks.slice(1).filter((b) => ownControls(recs, b).length === 0 && ownText(recs, b).trim() !== '');
  const protoBlock: Block | undefined = plain.find((b) => recs[b.start].data.readUInt16LE(8) === shape) ?? plain[0];
  if (!protoBlock && units.length > 1) throw new RollupUnsupported('단위 이름 줄로 복제할 문단을 양식에서 찾지 못했습니다.');
  const proto = protoBlock ? recs.slice(protoBlock.start, protoBlock.end) : [];

  // ── 조립 — 전부 복제다. 새 레코드를 지어내지 않는다 ──
  const out: HwpRecord[] = clone(head);
  setParagraphText(out, { start: 0, end: out.length }, units[0].name);
  out.push(...clone(body));
  for (let k = 1; k < units.length; k++) {
    const h = clone(proto);
    setParagraphText(h, { start: 0, end: h.length }, units[k].name);
    if (opts.pageBreak) {
      const d = Buffer.from(h[0].data);
      d[BREAK_TYPE] = d[BREAK_TYPE] | PAGE_BREAK;
      h[0] = { ...h[0], data: d };
    }
    out.push(...h, ...clone(body));
  }
  recs = out;
  renumberTableInstances(recs, tablesPerUnit);

  // ── 강조 서식 — 필요할 때만 DocInfo를 건드린다 (HM-37) ──
  const wantEmphasis = units.some((u) => BUCKETS.some((b) => u.tables[b].some((r) => r.emphasis)));
  let docInfoOut: Buffer | undefined;
  let blue: number | null = null;
  if (wantEmphasis) {
    const di = parseRecords(file.docInfo);
    const p = plainShapeIdOf(recs, 0);
    blue = p === null ? null : ensureColorShape(di, p, BLUE);
    if (blue === null) warnings.push('파란 「공유」 서식을 만들지 못해 강조 없이 이어 붙였습니다.');
    else docInfoOut = serializeRecords(di);
  }

  // ── 채우기 — 단위 k의 b번 표 = 전체에서 k×(표 수)+b번째 표 ──
  units.forEach((u, k) => {
    BUCKETS.forEach((bucket, b) => {
      const rows = u.tables[bucket];
      if (b >= tablesPerUnit) {
        if (rows.length) warnings.push(`${u.name}: 양식에 ${b + 1}번 표가 없어 ${rows.length}행을 넣지 못했습니다.`);
        return;
      }
      fillTable(
        recs,
        k * tablesPerUnit + b,
        rows.map((r, i) => [r.no || `${b + 1}-${i + 1}`, r.content, r.date, r.place, r.attendee]),
        { emphasis: rows.map((r) => r.emphasis), emphasisShapeId: blue },
      );
    });
  });

  const bytes = packHwp(templateBytes, [serializeRecords(recs)], docInfoOut);

  // ── RU-14 자체 점검 — 다시 읽어 단위·행·강조가 넣은 그대로인지 ──
  const problem = verifyRollup(bytes, units, tablesPerUnit);
  if (problem) throw new HwpWriteError(`이어 붙인 결과 검증 실패 — ${problem}`);
  return { bytes, warnings };
}

function locateTableCount(recs: readonly HwpRecord[]): number {
  return recs.filter((r) => r.tag === TAG.CTRL_HEADER && ctrlName(r.data) === 'tbl ').length;
}

/**
 * 복제한 표에 새 인스턴스 ID를 준다. 한글은 표마다 이 값을 따로 들고 있고, 같은 문서에서
 * 한글이 표를 복사해 붙일 때도 새 값을 준다 — 같은 값이 여럿이면 무엇이 깨질지 우리가 모른다.
 * 첫 단위의 표는 양식 그대로 둔다. 값은 결정적이다(같은 입력 → 같은 파일).
 */
function renumberTableInstances(recs: HwpRecord[], perUnit: number): void {
  const idx = recs
    .map((r, i) => (r.tag === TAG.CTRL_HEADER && ctrlName(r.data) === 'tbl ' && r.data.length >= TBL_INSTANCE_ID + 4 ? i : -1))
    .filter((i) => i >= 0);
  const base = Math.max(0, ...idx.slice(0, perUnit).map((i) => recs[i].data.readUInt32LE(TBL_INSTANCE_ID)));
  if (base === 0) return; // 양식이 값을 쓰지 않는다 — 우리도 만들지 않는다
  idx.slice(perUnit).forEach((i, n) => {
    const d = Buffer.from(recs[i].data);
    d.writeUInt32LE((base + n + 1) >>> 0, TBL_INSTANCE_ID);
    recs[i] = { ...recs[i], data: d };
  });
}

/** RU-14 — 넣은 것과 다시 읽은 것이 같은가. 다르면 사람이 읽을 수 있는 한 문장 */
export function verifyRollup(bytes: Buffer, units: readonly UnitBlock[], tablesPerUnit = 3): string | null {
  let back: UnitsRead;
  try {
    back = readUnits(bytes, units[0]?.name ?? '');
  } catch (e) {
    return `결과를 다시 읽을 수 없습니다 (${(e as Error).message})`;
  }
  if (back.units.length !== units.length) return `단위 수가 다릅니다 (${units.length} → ${back.units.length})`;
  for (const [k, u] of units.entries()) {
    const got = back.units[k];
    if (got.name !== u.name.replace(/\s+/g, ' ').trim()) return `${k + 1}번째 단위 이름이 「${u.name}」 → 「${got.name}」로 바뀌었습니다`;
    for (const [b, bucket] of BUCKETS.entries()) {
      if (b >= tablesPerUnit) continue;
      const want = u.tables[bucket];
      const have = got.tables[bucket];
      if (have.length !== want.length) return `${u.name} ${b + 1}번 표 행 수가 다릅니다 (${want.length} → ${have.length})`;
      for (const [i, r] of want.entries()) {
        const h = have[i];
        if (h.content !== r.content) return `${u.name} ${b + 1}번 표 ${i + 1}행 내용이 그대로 들어가지 않았습니다`;
        if (h.emphasis !== r.emphasis) return `${u.name} ${b + 1}번 표 ${i + 1}행의 「공유」 표시가 달라졌습니다`;
        if (r.no && h.no !== r.no) return `${u.name} ${b + 1}번 표 ${i + 1}행 구분 번호가 달라졌습니다`;
      }
    }
  }
  return null;
}
