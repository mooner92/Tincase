// HM-19 — 병합 절차. 이 파일이 "목요일 14:10에 다 되어 있다"를 만든다.
//
// 순서: 제출물 수집 → 규칙 적용 → (모델) 중복 묶기 → 조립 → 자체 점검 → 저장
// 어느 단계가 실패해도 **병합본은 나온다** (HM-21 부분 실패 허용, HM-24 폴백).

import path from 'node:path';
import { prisma } from '../db';
import { readStoredFile, writeFileAtomic, sanitizeSegment } from '../storage';
import { readWorklog } from '@/lib/hwp/reader';
import { openHwp } from '@/lib/hwp/ole';
import { parseRecords, serializeRecords } from '@/lib/hwp/record';
import { fillTable, packHwp, plainShapeIdOf } from '@/lib/hwp/writer';
import { BLUE, ensureColorShape } from '@/lib/hwp/charshape';
import { toPlan, orderPeople } from './rules';
import { groupDuplicates, MergeRow, GroupingResult } from './model';
import type { RowGroup } from './dedupe';
import { classifyRows, sortByCategory, OTHER } from './classify';
import { findFlaggedRows, parseFlagWords, type FlaggedRow } from '@/lib/empty-content';
import { parseEmphasisWords, stripEmphasisMarker } from '@/lib/emphasis-marker';
import { mergeRowCells, pickRepresentative } from '@/lib/merge-rows';
export { mergedName as mergedFileName } from '@/lib/docname';
import type { WorklogRow } from '@/lib/hwp/reader';

export interface MergedGroup {
  /** 대표 행 (묶음의 첫 행) */
  row: WorklogRow;
  /** 이 묶음에 들어간 작성자들 — 2명 이상이면 합쳐진 것 */
  authors: string[];
  /** 부서가 정한 분류 (안 쓰면 빈 문자열) */
  category: string;
  /** 원문들 (검토 화면에서 나란히 보여준다) */
  sources: { who: string; content: string }[];
  reason: string;
  /** HM-37 — 이 줄이 「전체 공유·전달이 필요한 주요 사항」인가 */
  emphasis: boolean;
  /** HM-36 — `sources` 중 문서에 들어간 것의 자리 */
  keptIndex: number;
  /** HM-36 — 원문이 글자까지 똑같았는가. 참이면 잃은 것이 없어 확인할 것도 없다 */
  identical: boolean;
}

export interface MergeOutcome {
  outputRelPath: string;
  bytes: number;
  rowCounts: { achievements: number; plans: number; notes: number };
  /** HM-26 — 검토 화면이 "볼 곳"으로 쓰는 정보 */
  mergedGroups: MergedGroup[];
  warnings: string[];
  model: { used: boolean; reason: string | null; elapsedMs: number; name: string };
  /** 분류 정렬 결과 — 안 썼으면 null */
  categories: { used: boolean; reason: string | null; order: string[] } | null;
  sourceIds: string[];
  missing: string[];
  /**
   * TACP-17 — 표별 **행 순서와 나란한** 작성자. `rowAuthors.achievements[0]`은
   * 실적 표 첫 행을 낸 사람들이다 (합쳐진 행은 2명 이상).
   *
   * 작성자만이 아니라 **그때의 내용(`c`)도 같이** 둔다. 나중에 담당자가 행을 지우면
   * 인덱스가 밀리는데, 내용이 없으면 어느 작성자가 어느 행이었는지 되찾을 수 없다.
   *
   * 문서에는 들어가지 않는다 — 화면에서만 쓴다. 담당자·부서장이 잘못된 행을 봤을 때
   * **누구와 이야기해야 하는지**가 필요해서 남긴다.
   */
  rowAuthors: Record<'achievements' | 'plans' | 'notes', { c: string; a: string[] }[]>;
  /**
   * HM-33 — 「내용이 없다」는 뜻으로 보이는 행. **지우지 않고 알린다.**
   * 담당자·부서장 알림과 병합 패널이 **이걸 함께 읽는다** — 따로 계산하면 갈라진다.
   */
  flagged: FlaggedRow[];
}

/** 표 3종 각각을 이 구조로 다룬다 */
type Bucket = 'achievements' | 'plans' | 'notes';
const BUCKETS: Bucket[] = ['achievements', 'plans', 'notes'];

interface Tagged extends MergeRow {
  bucket: Bucket;
  raw: WorklogRow;
}

/**
 * HM-27 — 양식 + 표 내용 → 병합본 hwp. **병합과 수정이 같은 경로를 쓴다.**
 *
 * 담당자가 병합본을 손으로 고칠 수 있게 되면서(API-50) 조립이 두 곳에서 일어난다.
 * 두 곳이 각자 만들면 "병합한 것"과 "고친 것"의 결과가 미묘하게 달라진다 —
 * 표를 지우는 조건, 채번 방식 같은 것들이 갈라진다. 그래서 여기 하나로 모은다.
 */
export function composeMergedHwp(
  templateBytes: Buffer,
  tableRows: Record<Bucket, string[][]>,
  /** HM-37 — 표별 행 강조 여부. 안 주면 전부 보통 */
  emphasis?: Partial<Record<Bucket, boolean[]>>,
): {
  bytes: Buffer;
  tableCount: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const file = openHwp(templateBytes);
  const recs = parseRecords(file.sections[0]);
  const tableCount = countTables(recs);

  /*
   * HM-37 — 강조 서식은 **필요할 때만** 만든다.
   *
   * 강조가 하나도 없는 주에까지 DocInfo를 건드리면, 바꿀 이유가 없는데 바꾸는 것이다 —
   * 그런 변경은 언젠가 조용히 뭔가를 깨뜨린다. 그래서 `docInfoOut`은 기본이 undefined이고,
   * 그 경우 `packHwp`가 원본 DocInfo를 그대로 둔다.
   */
  const wantEmphasis = BUCKETS.some((b) => emphasis?.[b]?.some(Boolean));
  let docInfoOut: Buffer | undefined;
  let blueShapeId: number | null = null;
  if (wantEmphasis) {
    const diRecs = parseRecords(file.docInfo);
    const plain = plainShapeIdOf(recs, 0);
    blueShapeId = plain === null ? null : ensureColorShape(diRecs, plain, BLUE);
    if (blueShapeId === null) {
      warnings.push('강조(파란색) 서식을 만들지 못해 강조 없이 병합했습니다.');
    } else {
      docInfoOut = serializeRecords(diRecs);
    }
  }

  BUCKETS.forEach((bucket, i) => {
    if (i >= tableCount) {
      if (tableRows[bucket].length > 0) {
        warnings.push(`양식에 ${i + 1}번 표가 없어 ${tableRows[bucket].length}행을 넣지 못했습니다.`);
      }
      return;
    }
    /*
     * HM-32 — 빈 표도 **반드시 비운다.** 건너뛰면 안 된다.
     *
     * 여기 있던 「표를 그대로 둔다 (빈 양식 그대로)」는 **양식의 표가 비어 있다는 전제**였고,
     * 그 전제가 틀렸다 — AI홍보전략실 양식의 실적 표에는 예시 4줄이 들어 있다
     * («제10차 인사위원회» 등). 건너뛰면 그 예시가 부서 실적으로 병합본에 남고,
     * 그대로 취합게시판에 올라간다. 아무도 쓰지 않은 일이 부서 실적이 되는 것이다.
     *
     * `fillTable(recs, i, [])`는 머리행만 남기고 본문을 지운다 (2026-08-26 실측).
     */
    fillTable(recs, i, tableRows[bucket], {
      emphasis: emphasis?.[bucket],
      emphasisShapeId: blueShapeId,
    });
  });

  return {
    bytes: packHwp(templateBytes, [serializeRecords(recs)], docInfoOut),
    tableCount,
    warnings,
  };
}

export function mergedRelPath(divisionSlug: string, year: number, weekLabel: string): string {
  return path.join(
    'divisions',
    sanitizeSegment(divisionSlug),
    'merged',
    String(year),
    `${sanitizeSegment(weekLabel.replace(/ /g, '_'))}.hwp`,
  );
}


/**
 * 병합 실행. 예외를 던지는 경우는 **양식이 없거나 제출이 0건일 때뿐**이다 —
 * 그 외에는 무슨 일이 있어도 결과물을 만들어 낸다.
 */
export async function runMerge(divisionId: string, weekSlotId: string): Promise<MergeOutcome> {
  const [division, slot] = await Promise.all([
    prisma.division.findUniqueOrThrow({ where: { id: divisionId } }),
    prisma.weekSlot.findUniqueOrThrow({ where: { id: weekSlotId } }),
  ]);

  const plan = toPlan(division);
  const warnings: string[] = [];

  const template = await prisma.template.findFirst({ where: { divisionId, isActive: true } });
  if (!template) throw new MergeUnavailable('등록된 부서 양식이 없습니다. 부서 설정에서 양식을 먼저 등록하세요.');

  const submissions = await prisma.submission.findMany({
    where: { divisionId, weekSlotId, isLatest: true },
    include: { user: true },
  });
  if (submissions.length === 0) throw new MergeUnavailable('제출된 파일이 없습니다.');

  // 제출자 순서 — 명단은 운영자 소관이므로 sortOrder를 그대로 따른다 (TACP-3)
  const ordered = orderPeople(submissions.map((s) => ({ ...s, name: s.user.name, sortOrder: s.user.sortOrder })));

  // HM-38 — 부서가 정한 강조 표시 낱말. 비우면 아무것도 떼지 않는다
  const emphasisWords = parseEmphasisWords(division.emphasisWords);

  // ── 1. 수집 — 한 명이 깨져도 나머지로 계속한다 (HM-21) ──
  const rows: Tagged[] = [];
  const usedIds: string[] = [];
  let nextId = 1;
  for (const sub of ordered) {
    let parsed;
    try {
      parsed = readWorklog(await readStoredFile(sub.filePath));
    } catch (e) {
      warnings.push(`${sub.user.name}: 파일을 읽지 못해 제외했습니다 (${(e as Error).message})`);
      continue;
    }
    usedIds.push(sub.id);
    for (const bucket of BUCKETS) {
      for (const raw of parsed.worklog[bucket]) {
        /*
         * HM-38 — 글로 적은 강조 표시를 여기서 뗀다.
         *
         * **수집 단계에서** 떼는 이유: 중복 묶기가 글자로 비교하는데(HM-36),
         * 한 사람은 「…개최 (하이라이트)」, 다른 사람은 「…개최」로 적으면 표시 때문에
         * 서로 다른 업무가 된다. 떼고 나서 비교해야 같은 일이 같은 일로 묶인다.
         *
         * 원본 파일은 그대로다 (ABS-3) — 병합본에 들어갈 글자만 바뀐다.
         */
        const stripped = stripEmphasisMarker(raw.content, emphasisWords);
        const row = stripped.marked
          ? { ...raw, content: stripped.content, emphasis: true }
          : raw;
        rows.push({
          id: nextId++,
          who: sub.user.name,
          content: row.content,
          date: row.date,
          place: row.place,
          attendee: row.attendee,
          bucket,
          raw: row,
        });
      }
    }
  }
  if (rows.length === 0) throw new MergeUnavailable('제출물에서 업무 행을 찾지 못했습니다.');

  // ── 2. 판단 — 표별로 따로 묶는다 (실적과 계획을 섞지 않는다) ──
  const grouped: Record<Bucket, MergedGroup[]> = { achievements: [], plans: [], notes: [] };
  let model: GroupingResult = { groups: [], usedModel: false, fallbackReason: '중복묶기 꺼짐', elapsedMs: 0, rejected: [] };

  for (const bucket of BUCKETS) {
    const mine = rows.filter((r) => r.bucket === bucket);
    if (mine.length === 0) continue;

    const result = plan.dedupe
      ? await groupDuplicates(mine, division.mergeRuleText)
      : {
          groups: mine.map((r) => ({ ids: [r.id], reason: '' }) as RowGroup),
          usedModel: false,
          fallbackReason: '중복묶기 꺼짐',
          elapsedMs: 0,
          rejected: [],
        };

    // 가장 정보가 많은 실행 결과를 대표로 남긴다 (실적 표가 보통 제일 크다)
    if (result.elapsedMs >= model.elapsedMs) model = result;

    const byId = new Map(mine.map((r) => [r.id, r]));
    for (const g of result.groups) {
      const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
      if (members.length === 0) continue;
      // 대표 행은 **가장 정보가 많은 것**을 고른다 — 원문 중 하나를 고르는 것이지
      // 새로 쓰는 게 아니다. "보도자료 배포"와 "보도자료 배포(2건) 8/13"이 묶이면
      // 후자를 남겨야 읽는 사람이 잃는 게 없다.
      const best = pickRepresentative(members);
      /*
       * HM-37 — **한 사람이라도 강조했으면 강조로 남는다.**
       *
       * 두 사람이 같은 일을 적었는데 한 명만 파랗게 표시했다면, 그 표시는 «이건 공유돼야
       * 한다»는 판단이다. 대표로 안 뽑힌 쪽의 표시라고 버리면 그 판단이 사라진다 —
       * HM-36에서 「잃는 쪽이 늘 더 나쁘다」고 정한 것과 같은 이유다.
       */
      const emphasized = members.some((m) => m.raw.emphasis === true);
      /*
       * HM-40 — 내용은 대표 줄의 것, **곁칸은 묶음 전체에서 모은다.**
       * 대표가 일자를 안 적었는데 다른 사람이 적었으면 그 일자가 들어간다 —
       * 일자를 지키자고 내용을 버리는 일이 없어진다.
       */
      const cells = mergeRowCells(members, best);
      grouped[bucket].push({
        emphasis: emphasized,
        row: { ...best.raw, ...cells },
        authors: [...new Set(members.map((m) => m.who))],
        category: '',
        sources: members.map((m) => ({ who: m.who, content: m.content })),
        reason: members.length > 1 ? g.reason : '',
        // HM-36 — 화면이 «어느 줄이 문서에 들어갔나»를 글자 비교로 짐작하지 않게 한다.
        // 두 사람이 똑같이 적으면 글자 비교로는 둘 다 «남김»이 되어 «합쳤다»와 모순된다
        keptIndex: members.indexOf(best),
        identical: g.identical ?? new Set(members.map((m) => m.content.trim())).size === 1,
      });
    }
  }

  // ── 2b. 분류 정렬 — 부서가 "AI-홍보-시스템-도서관"을 정했으면 그 순서로 (HM-27) ──
  let categoryInfo: MergeOutcome['categories'] = null;
  if (plan.categories.length > 0) {
    const probes: MergeRow[] = [];
    for (const bucket of BUCKETS) {
      grouped[bucket].forEach((g, i) => {
        probes.push({ id: i * 10 + BUCKETS.indexOf(bucket), who: g.authors[0] ?? '', content: g.row.content, date: '', place: '', attendee: '' });
      });
    }
    const cls = await classifyRows(probes, plan.categories, plan.guidance);
    categoryInfo = { used: cls.usedModel, reason: cls.fallbackReason, order: [...plan.categories] };
    if (cls.usedModel) {
      for (const bucket of BUCKETS) {
        grouped[bucket].forEach((g, i) => {
          g.category = cls.assigned.get(i * 10 + BUCKETS.indexOf(bucket)) ?? OTHER;
        });
        // 같은 분류 안에서는 원래 순서를 유지한다 (ABS-6)
        grouped[bucket] = sortByCategory(grouped[bucket], (g) => g.category, plan.categories);
      }
    } else {
      warnings.push(`분류 정렬을 건너뛰었습니다 — ${cls.fallbackReason}. 제출자 순서로 넣었습니다.`);
    }
  }

  if (model.fallbackReason && plan.dedupe) {
    warnings.push(`중복 묶기를 건너뛰었습니다 — ${model.fallbackReason}. 모든 행이 그대로 들어갔습니다.`);
  }

  // ── 3. 조립 — 글자는 전부 원문 그대로 ──
  const src = await readStoredFile(template.filePath);

  const tableRows: Record<Bucket, string[][]> = { achievements: [], plans: [], notes: [] };
  const rowEmphasis: Record<Bucket, boolean[]> = { achievements: [], plans: [], notes: [] };
  BUCKETS.forEach((bucket, tableIdx) => {
    const prefix = tableIdx + 1;
    const body = grouped[bucket].map((g, i) => [
      `${prefix}-${i + 1}`, // ABS-5 — 채번은 항상 재생성
      g.row.content,
      g.row.date,
      g.row.place,
      g.row.attendee,
    ]);
    tableRows[bucket] = body;
    rowEmphasis[bucket] = grouped[bucket].map((g) => g.emphasis);
  });

  // 특이사항이 비면 3번 표를 지운다 — 실제 제출물의 관례 (sample-filled-w1에 3번 표가 없다)
  if (plan.dropEmptyNotes && grouped.notes.length === 0) {
    tableRows.notes = [];
    rowEmphasis.notes = [];
  }

  const composed = composeMergedHwp(src, tableRows, rowEmphasis);
  warnings.push(...composed.warnings);
  const out = composed.bytes;
  const tableCount = composed.tableCount;

  // ── 4. 자체 점검 (HM-22) — 누락은 조용히 일어난다 ──
  const check = verifyMerged(out, grouped, tableCount);
  if (check) throw new MergeFailed(`결과 검증 실패 — ${check}`);

  const rel = mergedRelPath(division.slug, slot.year, slot.label);
  await writeFileAtomic(rel, out);

  const roster = await prisma.user.findMany({
    where: { divisionId, isActive: true, onRoster: true },
    select: { id: true, name: true },
  });
  const submitted = new Set(submissions.map((s) => s.userId));

  return {
    outputRelPath: rel,
    bytes: out.length,
    rowCounts: {
      achievements: grouped.achievements.length,
      plans: grouped.plans.length,
      notes: grouped.notes.length,
    },
    mergedGroups: BUCKETS.flatMap((b) => grouped[b]).filter((g) => g.sources.length > 1),
    // TACP-17 — `tableRows`와 **같은 순서로** 만든다. 위에서 `grouped[bucket]`을 그대로
    // 훑어 표를 만들었으므로 인덱스가 곧 행 번호다. 특이사항 표를 지운 경우는 비운다
    // HM-33 — 표에 들어간 최종 순서 그대로 본다. 구분 번호가 화면과 같아야 바로 찾는다
    flagged: findFlaggedRows(grouped, parseFlagWords(division.emptyWords)),
    rowAuthors: {
      achievements: grouped.achievements.map((g) => ({ c: g.row.content, a: g.authors })),
      plans: grouped.plans.map((g) => ({ c: g.row.content, a: g.authors })),
      notes: tableRows.notes.length === 0 ? [] : grouped.notes.map((g) => ({ c: g.row.content, a: g.authors })),
    },
    warnings,
    model: {
      used: model.usedModel,
      reason: model.fallbackReason,
      elapsedMs: model.elapsedMs,
      name: model.usedModel ? (process.env.MERGE_MODEL ?? '') : '',
    },
    categories: categoryInfo,
    sourceIds: usedIds,
    missing: roster.filter((u) => !submitted.has(u.id)).map((u) => u.name),
  };
}

export class MergeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeUnavailable';
  }
}
export class MergeFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeFailed';
  }
}


function countTables(recs: ReturnType<typeof parseRecords>): number {
  // locateTables를 쓰지 않고 세는 이유: 여기서는 개수만 필요하고, 편집 전후로 불린다
  return recs.filter((r) => r.tag === 77).length;
}

/**
 * HM-41 — 어긋난 곳을 사람이 읽을 수 있게. 「누가·무엇이·어떻게」 셋 다 넣는다.
 *
 * 제어 문자는 보이지 않아서 **이름으로 적는다** — 오늘 사고가 정확히 눈에 안 보이는
 * 글자(줄바꿈) 때문이었고, 원문을 그대로 찍었어도 화면에서는 똑같아 보였을 것이다.
 */
function describeMismatch(g: MergedGroup, got: string | undefined): string {
  const who = g.authors.join('·') || '작성자 미상';
  if (got === undefined) return `${who} 님의 줄이 아예 빠졌습니다`;

  const show = (t: string) =>
    t
      .replace(/\n/g, '⏎')
      .replace(/\t/g, '⇥')
      .replace(/[\u0000-\u001f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .slice(0, 60);

  // 처음으로 갈라지는 자리 — 긴 줄에서 어디가 문제인지 바로 보이게
  let i = 0;
  while (i < g.row.content.length && i < got.length && g.row.content[i] === got[i]) i++;
  const 자리 = `${i + 1}번째 글자부터`;
  return `${who} 님, ${자리} 「${show(g.row.content.slice(i))}」가 「${show(got.slice(i))}」로 바뀌었습니다`;
}

/**
 * HM-22 — 저장 전 자체 점검. **4번(내용 무손실)이 핵심이다.**
 * 실패하면 저장하지 않는다. 잘못된 병합본이 나가는 것보다 안 나가는 편이 낫다.
 */
function verifyMerged(out: Buffer, grouped: Record<Bucket, MergedGroup[]>, tableCount: number): string | null {
  let back;
  try {
    back = readWorklog(out);
  } catch (e) {
    return `결과를 다시 읽을 수 없습니다 (${(e as Error).message})`;
  }
  if (back.tables.length !== tableCount) {
    return `표 개수가 달라졌습니다 (${tableCount} → ${back.tables.length})`;
  }
  for (const [i, bucket] of BUCKETS.entries()) {
    if (i >= tableCount) continue;
    const want = grouped[bucket];
    const got = back.worklog[bucket];
    for (const [k, g] of want.entries()) {
      if (got[k]?.content !== g.row.content) {
        /*
         * HM-41 — **누구의 어느 글자가 어긋났는지까지 말한다.**
         *
         * 예전 문구는 「1번 표 24행의 내용이 다릅니다」였다. 2026-09-03에 이 문구만 보고는
         * 아무도 원인을 알 수 없었고(줄바꿈이 든 칸이었다), 그동안 자동 병합이 1분마다
         * 재시도하며 그 주 병합이 통째로 멈춰 있었다.
         *
         * 담당자가 화면에서 이 문장 하나로 **그 사람에게 연락할 수 있어야** 한다.
         * 진단이 안 되는 오류 메시지는 오류를 두 번 나게 한다.
         */
        return `${i + 1}번 표 ${k + 1}행이 그대로 들어가지 않았습니다 — ${describeMismatch(g, got[k]?.content)}`;
      }
    }
    if (got.length < want.length) return `${i + 1}번 표에서 행이 사라졌습니다 (${want.length} → ${got.length})`;
  }
  return null;
}
