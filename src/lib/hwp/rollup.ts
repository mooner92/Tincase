// RU-12·16 — 병합본을 **단위 블록으로 읽기** (표 제목 낱말 · 단위 이름 · 1·2·3 표의 행).
//
// 이 파일에는 원래 본부·전사 이어 붙이기 엔진(composeRollupHwp — 양식의 「제목 + 1·2·3 표」를 단위 수만큼 복제해
// 5열 표를 **다시 그리는** 방식)이 있었다. 본부·센터형 6열 표·환경평가형이 섞인 최종본을 다시 그리면 망가져서
// 전사 취합이 섹션을 원래 꼴 그대로 옮기는 엔진(orgdoc.ts — RU-62)으로 갔고, 2026-10-07 본부 단계도 그쪽으로
// 합쳤다(중복 제거). 조립기는 이제 orgdoc.ts 하나다.
//
// 남은 것은 **읽기**다 — 조립하지 않고 내용을 셀 때 쓴다:
//   · readUnits   본부 결과 화면의 행·「공유」 수(run.ts), 지난 자료 적재(scripts/import-reports.ts), 테스트의 「넣은 것 = 다시 읽은 것」
//   · titleBucket 표 제목 알아보기 — 섹션 본문 고르기(orgdoc.ts)·정규화(normalize.ts)가 같은 판정을 쓴다
import { openHwp } from './ole';
import { parseRecords } from './record';
import { extractTables, tableGrid, type HwpTable } from './model';
import { cellValue, rowEmphasis } from './reader';
import { charShapeColors } from './charshape';
import { ownControls, ownText, topParagraphs } from './writer';

export type Bucket = 'achievements' | 'plans' | 'notes';
export const BUCKETS: readonly Bucket[] = ['achievements', 'plans', 'notes'];

export interface UnitRow {
  /** 구분 열 그대로 («1-3») — 읽을 때 다시 매기지 않는다 */
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
