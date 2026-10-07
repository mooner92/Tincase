// RU-60~63 · RU-10 — **섹션 조립 엔진.** 전사 취합본(13섹션)과 본부 이어 붙이기가 같이 쓰는 **하나뿐인** 조립기다.
// 섹션을 정해진 순서로, 섹션마다 원래 꼴 그대로(RU-62).
//
// 처음의 이어 붙이기(옛 rollup.ts의 composeRollupHwp)는 실형 5열 표만 다시 그렸다. 실제 최종본에는 본부·센터형
// (6열 「실·과제·항목」), 환경평가형(평가 실적 표), 임원실 꼴이 섞여 있어(분석 §3·4) 다시 그리면 망가진다. 그래서
// 섹션 블록을 **레코드째 복제**하고 서식 번호만 대상 문서에 맞게 옮겨 적는다(docmerge.ts).
// 본부 단계도 2026-10-07부터 이 엔진을 쓴다(중복 제거) — 엔진이 둘이면 본부장이 본 꼴과 최종본의 꼴이 갈라진다.
//
// 섹션 하나 = [제목 문단(생성, 새 쪽)] + [원본의 본문 — 원본 제목·빨간 안내문은 뺀다]
// 제목은 제출자가 쓰지 않는다(RU-61) — AI홍보전략실 제목이 매주 빠지던 것(분석 §6.2)이 구조적으로 없어진다.
import { openHwp } from './ole';
import { parseRecords, serializeRecords, leadingControlUnits, TAG, type HwpRecord } from './record';
import { charShapeColors } from './charshape';
import { packHwp, ownControls, ownText, setParagraphText, topParagraphs, type Block } from './writer';
import { DocInfoMerger, remapBody, checkReferences, DocMergeError } from './docmerge';
import { titleBucket } from './rollup';
import { normalizeSectionBody } from './normalize';

export interface OrgSectionInput {
  /** 생성할 제목 — `기획경영본부(기획조정실)` 등 (RU-61) */
  title: string;
  /** 그 섹션의 원본 hwp. 없으면 「미제출」 자리만 둔다 (분석 Q3 기본값) */
  source: Buffer | null;
}

export interface OrgSectionOutcome {
  title: string;
  status: 'copied' | 'missing' | 'failed';
  /** 원본에서 뺀 것 — 「빨간 안내문 2줄」 같은 기록 */
  dropped: string[];
  /** RU-63 — 자동으로 고친 것 */
  fixed?: string[];
  /** RU-64 — 사람이 확인할 것 */
  warnings?: string[];
  error?: string;
}

const NCHARS_LAST = 0x80000000;
const BREAK_TYPE = 11;
const PAGE_BREAK = 0x04;
/** 빨강 (COLORREF 0x00BBGGRR) — 작성 안내문 색 (분석 §3.5) */
const RED = 0x0000ff;
const TBL_INSTANCE_ID = 36;

const clone = (rs: readonly HwpRecord[]): HwpRecord[] => rs.map((r) => ({ ...r, data: Buffer.from(r.data) }));
const ctrlName = (d: Buffer) => (d.length < 4 ? '' : Buffer.from([d[3], d[2], d[1], d[0]]).toString('latin1'));

/**
 * 문단에서 **앞쪽 컨트롤**(구역·단 정의 등)과 그 서브트리를 걷어낸다. 원본 문서의 첫 문단은 구역 정의를 들고 있는데,
 * 그것이 대상 문서 중간에 들어가면 구역이 하나 더 생긴다 — 용지·여백이 섹션마다 바뀐다.
 */
export function stripLeadingControls(block: HwpRecord[]): HwpRecord[] {
  const head = block[0];
  const lv = head.level;
  const out: HwpRecord[] = [{ ...head, data: Buffer.from(head.data) }];
  if (out[0].data.length > BREAK_TYPE) out[0].data[BREAK_TYPE] = 0;
  // 컨트롤 서브트리를 뺀다 — 자기 레벨+1의 CTRL_HEADER와 그 아래 전부
  for (let k = 1; k < block.length; k++) {
    const r = block[k];
    if (r.level === lv + 1 && r.tag === TAG.CTRL_HEADER) {
      const id = ctrlName(r.data);
      // 표는 본문이다 — 첫 문단에 표가 붙은 원본은 여기서 걷지 않는다
      if (id === 'tbl ') {
        out.push(...block.slice(k).map((x) => ({ ...x, data: Buffer.from(x.data) })));
        return out;
      }
      let e = k + 1;
      while (e < block.length && block[e].level > r.level) e++;
      k = e - 1;
      continue;
    }
    out.push({ ...r, data: Buffer.from(r.data) });
  }
  const textIdx = out.findIndex((r) => r.tag === TAG.PARA_TEXT && r.level === lv + 1);
  if (textIdx < 0) return out;
  const units = leadingControlUnits(out[textIdx].data);
  if (units === 0) return out;
  const d = out[textIdx].data.subarray(units * 2);
  out[textIdx] = { ...out[textIdx], data: Buffer.from(d) };
  const nChars = d.length / 2;
  const h = out[0].data;
  h.writeUInt32LE(((h.readUInt32LE(0) & NCHARS_LAST) | nChars) >>> 0, 0);
  h.writeUInt32LE(0, 4); // 컨트롤 마스크 — 남은 컨트롤이 없다
  // 첫 문단은 「구역 나누기·단 나누기」 표시(11번째 바이트)를 들고 있다 — 컨트롤을 걷으면 그 표시도 걷는다.
  // 남겨 두면 구역 정의 없는 구역 나누기가 생겨, 제목만 한 쪽에 남고 본문이 다음 쪽으로 밀린다 (2026-10-07 렌더링 확인)
  h[BREAK_TYPE] = 0;
  // 글자 모양 구간 위치를 앞당긴다 (0 아래는 0으로, 겹치면 뒤엣것)
  const csIdx = out.findIndex((r) => r.tag === TAG.PARA_CHAR_SHAPE && r.level === lv + 1);
  if (csIdx >= 0) {
    const src = out[csIdx].data;
    const runs: [number, number][] = [];
    for (let o = 0; o + 8 <= src.length; o += 8) {
      const pos = Math.max(0, src.readUInt32LE(o) - units);
      const id = src.readUInt32LE(o + 4);
      if (runs.length && runs[runs.length - 1][0] === pos) runs[runs.length - 1] = [pos, id];
      else runs.push([pos, id]);
    }
    const kept = runs.filter(([p], i) => i === 0 || p < nChars);
    const b = Buffer.alloc(kept.length * 8);
    kept.forEach(([p, id], i) => (b.writeUInt32LE(i === 0 ? 0 : p, i * 8), b.writeUInt32LE(id, i * 8 + 4)));
    out[csIdx] = { ...out[csIdx], data: b };
    h.writeUInt16LE(kept.length, 12);
  }
  // 줄 배치 캐시는 버린다 (HM-28)
  const segIdx = out.findIndex((r) => r.tag === TAG.PARA_LINE_SEG && r.level === lv + 1);
  if (segIdx >= 0) {
    out.splice(segIdx, 1);
    h.writeUInt16LE(0, 16);
  }
  return out;
}

/** 문단 글자가 전부 빨강인가 — 작성 안내문(`※ 1페이지 이내로 작성 必`) 판정 */
function allRed(recs: readonly HwpRecord[], b: Block, colors: readonly number[]): boolean {
  const lv = recs[b.start].level + 1;
  let any = false;
  for (let k = b.start + 1; k < b.end; k++) {
    if (recs[k].tag !== TAG.PARA_CHAR_SHAPE || recs[k].level !== lv) continue;
    const d = recs[k].data;
    for (let o = 0; o + 8 <= d.length; o += 8) {
      any = true;
      if ((colors[d.readUInt32LE(o + 4)] ?? 0) !== RED) return false;
    }
  }
  return any;
}

/**
 * 원본에서 **본문**만 골라낸다:
 *   · 앞쪽의 제목 문단(섹션 이름)은 뺀다 — 제목은 우리가 생성한다
 *   · 빨간 안내문 문단은 뺀다 (분석 Q9 기본값: 최종본에서 모두 제거)
 *   · 첫 문단이 본문이면(예: 「1. 주요 업무실적」으로 시작하는 옛 양식) 구역 정의만 걷고 남긴다
 */
export function extractSectionBody(bytes: Buffer): { body: HwpRecord[]; docInfo: HwpRecord[]; dropped: string[] } {
  const file = openHwp(bytes);
  const docInfo = parseRecords(file.docInfo);
  let colors: number[] = [];
  try {
    colors = charShapeColors(docInfo);
  } catch {
    colors = [];
  }
  const recs = parseRecords(file.sections[0]);
  const blocks = topParagraphs(recs);
  const dropped: string[] = [];
  // 본문 시작 = 표가 붙은 문단, 표 제목(「업무실적」 등), 또는 「※ 자문회의」 같은 표 머리 — 그 전은 제목·머리글이다
  const isBodyStart = (b: Block) => {
    const t = ownText(recs, b).trim();
    return ownControls(recs, b).includes('tbl ') || titleBucket(t) !== null || /^※\s*(자문|평가)/.test(t);
  };
  const first = blocks.findIndex(isBodyStart);
  if (first < 0) throw new DocMergeError('본문(표)을 찾지 못했습니다');
  for (const b of blocks.slice(0, first)) {
    const t = ownText(recs, b).trim();
    if (t) dropped.push(`제목 「${t.slice(0, 30)}」`);
  }
  const body: HwpRecord[] = [];
  for (const [i, b] of blocks.slice(first).entries()) {
    const t = ownText(recs, b).trim();
    if (t.startsWith('※') && allRed(recs, b, colors) && !ownControls(recs, b).includes('tbl ')) {
      dropped.push(`안내문 「${t.slice(0, 30)}」`);
      continue;
    }
    let part = recs.slice(b.start, b.end);
    // 구역 정의를 들고 있는 첫 문단 — 본문이면 컨트롤만 걷는다
    if (i === 0 && first === 0 && ownControls(recs, b).some((c) => c === 'secd' || c === 'cold')) part = stripLeadingControls(part);
    body.push(...part);
  }
  return { body, docInfo, dropped };
}

/** 표 인스턴스 ID를 문서 안에서 겹치지 않게 — 같은 양식에서 나온 원본들은 같은 값을 들고 온다 */
function renumberTables(recs: HwpRecord[]) {
  const idx = recs.map((r, i) => (r.tag === TAG.CTRL_HEADER && ctrlName(r.data) === 'tbl ' && r.data.length >= TBL_INSTANCE_ID + 4 ? i : -1)).filter((i) => i >= 0);
  const seen = new Set<number>();
  let next = Math.max(1, ...idx.map((i) => recs[i].data.readUInt32LE(TBL_INSTANCE_ID))) + 1;
  for (const i of idx) {
    const v = recs[i].data.readUInt32LE(TBL_INSTANCE_ID);
    if (v === 0 || !seen.has(v)) {
      seen.add(v);
      continue;
    }
    const d = Buffer.from(recs[i].data);
    d.writeUInt32LE(next++ >>> 0, TBL_INSTANCE_ID);
    recs[i] = { ...recs[i], data: d };
  }
}

/** 「목록의 마지막 문단」 표시는 최상위 마지막 문단에만 (리뷰 #25와 같은 규칙) */
function fixLastFlags(recs: HwpRecord[]) {
  const tops = recs.map((r, i) => (r.tag === TAG.PARA_HEADER && r.level === 0 ? i : -1)).filter((i) => i >= 0);
  tops.forEach((i, n) => {
    const d = Buffer.from(recs[i].data);
    const v = d.readUInt32LE(0) & 0x7fffffff;
    d.writeUInt32LE((n === tops.length - 1 ? (v | NCHARS_LAST) : v) >>> 0, 0);
    recs[i] = { ...recs[i], data: d };
  });
}

export interface ComposeOrgOptions {
  /**
   * RU-18 — 둘째 섹션부터 새 쪽에서 시작한다(제목 문단 머리의 쪽 나누기). 기본 켬.
   * 전사 최종본은 언제나 켠다(분석 §3.1). 본부 단계는 본부 설정(`rollupPageBreak`)을 따른다.
   */
  pageBreak?: boolean;
}

/**
 * RU-60~62 · RU-10 — 양식(최종본 꼴) + 섹션들 → 취합본 (전사 취합본·본부본 모두).
 *
 * 양식의 첫 문단(구역 정의를 든 제목 문단)을 첫 섹션 제목으로 쓰고, 둘째부터는 그 문단을 **컨트롤을 걷어** 복제한다 —
 * 섹션 제목 모양(분석 §3.2 「(상단) 본부,센터,실명」)이 모든 섹션에 같다.
 */
export function composeOrgDocument(
  templateBytes: Buffer,
  sections: readonly OrgSectionInput[],
  opts: ComposeOrgOptions = {},
): { bytes: Buffer; outcomes: OrgSectionOutcome[]; warnings: string[] } {
  const pageBreak = opts.pageBreak ?? true;
  if (sections.length === 0) throw new DocMergeError('섹션이 없습니다');
  const t = openHwp(templateBytes);
  const tRecs = parseRecords(t.sections[0]);
  const blocks = topParagraphs(tRecs);
  if (!blocks.length || ownControls(tRecs, blocks[0]).includes('tbl ')) throw new DocMergeError('양식 첫 문단이 제목 문단이 아닙니다');
  const merger = new DocInfoMerger(parseRecords(t.docInfo));

  const titleFirst = clone(tRecs.slice(blocks[0].start, blocks[0].end));
  const titleProto = stripLeadingControls(clone(titleFirst));
  // 「미제출」 자리 — 양식의 표 제목 문단 꼴을 빌린다
  const noteProtoBlock = blocks.find((b) => titleBucket(ownText(tRecs, b)) !== null && ownControls(tRecs, b).length === 0);
  const noteProto = noteProtoBlock ? clone(tRecs.slice(noteProtoBlock.start, noteProtoBlock.end)) : clone(titleProto);

  const out: HwpRecord[] = [];
  const outcomes: OrgSectionOutcome[] = [];
  sections.forEach((s, i) => {
    const head = i === 0 ? clone(titleFirst) : clone(titleProto);
    setParagraphText(head, { start: 0, end: head.length }, s.title);
    if (i > 0 && pageBreak) head[0].data[BREAK_TYPE] = head[0].data[BREAK_TYPE] | PAGE_BREAK; // 섹션마다 새 쪽 (분석 §3.1 · RU-18)
    const before = out.length;
    out.push(...head);
    if (!s.source) {
      const note = clone(noteProto);
      setParagraphText(note, { start: 0, end: note.length }, '미제출 — 이번 주 제출이 없습니다');
      out.push(...note);
      outcomes.push({ title: s.title, status: 'missing', dropped: [] });
      return;
    }
    try {
      const { body, docInfo, dropped } = extractSectionBody(s.source);
      const norm = normalizeSectionBody(body); // RU-63·64 — 칸 글자와 빈 줄만, 서식은 그대로
      out.push(...remapBody(body, merger.from(docInfo)));
      outcomes.push({ title: s.title, status: 'copied', dropped, fixed: norm.fixed, warnings: norm.warnings });
    } catch (e) {
      // 한 섹션이 못 들어와도 나머지는 만든다 (HM-21) — 그 자리엔 실패를 적는다
      out.length = before;
      out.push(...head);
      const note = clone(noteProto);
      setParagraphText(note, { start: 0, end: note.length }, `옮기지 못했습니다 — ${(e as Error).message}`);
      out.push(...note);
      outcomes.push({ title: s.title, status: 'failed', dropped: [], error: (e as Error).message });
    }
  });
  renumberTables(out);
  fixLastFlags(out);
  const docInfo = merger.build();
  const bad = checkReferences(docInfo, out);
  if (bad.length) throw new DocMergeError(`서식 번호 검증 실패 — ${bad.slice(0, 3).join(' · ')}`);
  return { bytes: packHwp(templateBytes, [serializeRecords(out)], serializeRecords(docInfo)), outcomes, warnings: [...merger.notes] };
}
