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
import { fillTable, packHwp } from '@/lib/hwp/writer';
import { toPlan, orderPeople } from './rules';
import { groupDuplicates, MergeRow, GroupingResult } from './model';
import { classifyRows, sortByCategory, OTHER } from './classify';
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
}

/** 표 3종 각각을 이 구조로 다룬다 */
type Bucket = 'achievements' | 'plans' | 'notes';
const BUCKETS: Bucket[] = ['achievements', 'plans', 'notes'];

interface Tagged extends MergeRow {
  bucket: Bucket;
  raw: WorklogRow;
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

/** 병합본 파일명 — 담당자가 받아서 그대로 올릴 수 있게 (HM-19) */
export function mergedFileName(divisionName: string, year: number, weekLabel: string): string {
  return `${year}_${weekLabel.replace(/ /g, '_')}_${divisionName}_주간업무.hwp`;
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
        rows.push({
          id: nextId++,
          who: sub.user.name,
          content: raw.content,
          date: raw.date,
          place: raw.place,
          attendee: raw.attendee,
          bucket,
          raw,
        });
      }
    }
  }
  if (rows.length === 0) throw new MergeUnavailable('제출물에서 업무 행을 찾지 못했습니다.');

  // ── 2. 판단 — 표별로 따로 묶는다 (실적과 계획을 섞지 않는다) ──
  const grouped: Record<Bucket, MergedGroup[]> = { achievements: [], plans: [], notes: [] };
  let model: GroupingResult = { groups: [], usedModel: false, fallbackReason: '중복묶기 꺼짐', elapsedMs: 0 };

  for (const bucket of BUCKETS) {
    const mine = rows.filter((r) => r.bucket === bucket);
    if (mine.length === 0) continue;

    const result = plan.dedupe
      ? await groupDuplicates(mine, division.mergeRuleText)
      : { groups: mine.map((r) => ({ ids: [r.id], reason: '' })), usedModel: false, fallbackReason: '중복묶기 꺼짐', elapsedMs: 0 };

    // 가장 정보가 많은 실행 결과를 대표로 남긴다 (실적 표가 보통 제일 크다)
    if (result.elapsedMs >= model.elapsedMs) model = result;

    const byId = new Map(mine.map((r) => [r.id, r]));
    for (const g of result.groups) {
      const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
      if (members.length === 0) continue;
      // 대표 행은 **가장 정보가 많은 것**을 고른다 — 원문 중 하나를 고르는 것이지
      // 새로 쓰는 게 아니다. "보도자료 배포"와 "보도자료 배포(2건) 8/13"이 묶이면
      // 후자를 남겨야 읽는 사람이 잃는 게 없다.
      const best = members.reduce((a, b) => (fillCount(b) > fillCount(a) ? b : a));
      grouped[bucket].push({
        row: best.raw,
        authors: [...new Set(members.map((m) => m.who))],
        category: '',
        sources: members.map((m) => ({ who: m.who, content: m.content })),
        reason: members.length > 1 ? g.reason : '',
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
  const section = openHwp(src).sections[0];
  const recs = parseRecords(section);

  const tableRows: Record<Bucket, string[][]> = { achievements: [], plans: [], notes: [] };
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
  });

  // 특이사항이 비면 3번 표를 지운다 — 실제 제출물의 관례 (sample-filled-w1에 3번 표가 없다)
  if (plan.dropEmptyNotes && grouped.notes.length === 0) tableRows.notes = [];

  const tableCount = countTables(recs);
  BUCKETS.forEach((bucket, i) => {
    if (i >= tableCount) {
      if (grouped[bucket].length > 0) {
        warnings.push(`양식에 ${i + 1}번 표가 없어 ${grouped[bucket].length}행을 넣지 못했습니다.`);
      }
      return;
    }
    if (tableRows[bucket].length === 0) return; // 표를 그대로 둔다 (빈 양식 그대로)
    fillTable(recs, i, tableRows[bucket]);
  });

  const out = packHwp(src, [serializeRecords(recs)]);

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

/** 채워진 칸 수 — 대표 행 선택 기준 */
function fillCount(m: { content: string; date: string; place: string; attendee: string }): number {
  return [m.content, m.date, m.place, m.attendee].filter((x) => x.trim()).length;
}

function countTables(recs: ReturnType<typeof parseRecords>): number {
  // locateTables를 쓰지 않고 세는 이유: 여기서는 개수만 필요하고, 편집 전후로 불린다
  return recs.filter((r) => r.tag === 77).length;
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
        return `${i + 1}번 표 ${k + 1}행의 내용이 다릅니다`;
      }
    }
    if (got.length < want.length) return `${i + 1}번 표에서 행이 사라졌습니다 (${want.length} → ${got.length})`;
  }
  return null;
}
