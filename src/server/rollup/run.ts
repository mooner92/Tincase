// RU-04·10·31·82 — 본부본 **조립**과 본부 현황판. (전사본은 orgrun.ts, 언제 조립하나는 auto.ts)
//
// 입력은 언제나 **보낸 사본**이다(ADR-0012). 하위의 병합본 원본을 직접 읽지 않는다 —
// 그러면 아직 검토 중인 문서가 위로 새고, 하위가 다시 병합하는 순간 위의 결과가 몰래 바뀐다.
//
// 조립은 전사 취합과 **같은 엔진**(orgdoc.ts — RU-62)이다. 사본 하나가 섹션 하나가 되어 원래 꼴 그대로 들어간다.
// 2026-10-08(ADR-0015)부터 조립은 사람이 누르지 않는다 — 산하 사본이 바뀌면 `system`이 다시 이어 붙인다(auto.ts).
import path from 'node:path';
import type { ReportSubmission, RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError } from '../authz';
import { readStoredFile, sanitizeSegment, sha256, writeFileAtomic } from '../storage';
import { logger } from '../logger';
import { effectiveDeadline } from '../worklog';
import { HQ_REVIEW, NEWEST_FIRST } from '../merge/review-scope';
import { composeOrgDocument, type OrgSectionOutcome } from '@/lib/hwp/orgdoc';
import { readUnits, BUCKETS } from '@/lib/hwp/rollup';
import { toKstIso } from '@/lib/week';
import { currentReport, fileSha } from './report';
import { sectionTitles } from './sections';
import { type RollupNode, type TreeDivision } from './tree';

/** RU-78 — 자동(`system`)이 한 일의 기록 — 일으킨 사건과 사람 (handoff.ts와 같은 모양, 고리를 피해 여기 다시 적는다) */
export interface BuildCause {
  cause: string;
  causedBy: string | null;
}

/** 결과 화면이 쓰는 단위별 요약 (RollupRun.unitsJson) — 단위 하나 = 사본 하나 = 섹션 하나 */
export interface RolledUnit {
  /** 섹션 제목 — 전사와 같은 제목(RU-61), 섹션이 없는 부서는 부서 이름 */
  name: string;
  divisionId: string;
  submissionId: string;
  rows: { achievements: number; plans: number; notes: number };
  emphasis: number;
  /**
   * RU-19 · RU-63 — 엔진이 **이미 고친 것**(번호 다시 매김·「특이사항 없음」 등). 「확인해 주세요」(warnings)와 나눠 둔다 —
   * 할 일이 없는 줄이 주황 상자에 들어가면 본부장이 [승인] 앞에서 멈춘다. 2026-10-08 전의 기록에는 없다
   */
  fixed?: string[];
}

interface Input {
  division: Pick<TreeDivision, 'id' | 'nameKo'>;
  report: ReportSubmission;
  title: string;
  bytes: Buffer;
}

/** 본부본의 입력 — 기여 단위(정한 순서대로)와 그 지금 사본. 안 낸 단위는 `report: null` (RU-04) */
export interface HqInput {
  division: TreeDivision;
  report: ReportSubmission | null;
}

export async function hqInputs(node: RollupNode, slot: WeekSlot): Promise<HqInput[]> {
  return Promise.all(node.contributors.map(async (division) => ({ division, report: await currentReport(division.id, slot.id, 'unit') })));
}

/**
 * RU-19 — 화면용 행 수·「공유」 수. **보낸 사본**에서 센다(RU-16 단위로 읽기). 결과 문서에서 세지 않는 이유:
 * RU-63 정규화가 빈 3번 표에 「특이사항 없음」을 넣는다 — 실·팀이 적은 줄이 아니다.
 */
function summarize(input: Input): RolledUnit {
  const rows = { achievements: 0, plans: 0, notes: 0 };
  let emphasis = 0;
  try {
    for (const u of readUnits(input.bytes, input.division.nameKo).units) {
      for (const b of BUCKETS) {
        rows[b] += u.tables[b].length;
        emphasis += u.tables[b].filter((r) => r.emphasis).length;
      }
    }
  } catch {
    // 못 읽는 사본은 조립 결과(섹션 실패)가 이미 경고로 말한다 — 여기서는 0으로 둔다
  }
  return { name: input.title, divisionId: input.division.id, submissionId: input.report.id, rows, emphasis };
}

/**
 * RU-19 — 섹션 결과 → 「확인해 주세요」 줄들, 섹션 제목을 앞에 붙여서. **사람이 볼 것만** — 자동 수정은 단위의 `fixed`로 따로.
 * 사본 맨 위의 부서명 줄을 뺀 것은 알리지 않는다 — 제목을 생성해 단 것이라(RU-61) 매번 뜨면 소음이다.
 */
function outcomeLines(o: OrgSectionOutcome, input: Input): string[] {
  if (o.status === 'failed') return [`${o.title}: 옮기지 못했습니다 — ${o.error ?? '알 수 없는 오류'}`];
  const ownTitle = new Set([input.division.nameKo, o.title].map((t) => `제목 「${t.slice(0, 30)}」`));
  const dropped = o.dropped.filter((d) => !ownTitle.has(d));
  return [
    ...(o.warnings ?? []).map((w) => `${o.title}: ${w}`),
    ...(dropped.length ? [`${o.title}: 뺀 것 — ${dropped.join(', ')}`] : []),
  ];
}

/** 양식 후보 순서 — 본부의 양식, 없으면 기여 단위의 것, 그다음 전사 표준 */
const templateOrder = (node: RollupNode) => [node.node.id, ...node.contributors.map((c) => c.id)];

/**
 * RU-74 — 본부본이 쓸 양식의 **표지**(파일을 읽지 않는다). 입력 열쇠에 들어간다 — 양식을 등록·교체하면 열쇠가 바뀌어 다시 만들어진다.
 * 부서 양식은 교체할 때마다 새 행이라(id·판) 표지가 바뀐다.
 */
export async function hqTemplateRef(node: RollupNode): Promise<string> {
  const ids = templateOrder(node);
  const rows = await prisma.template.findMany({ where: { divisionId: { in: ids }, isActive: true }, select: { id: true, divisionId: true, version: true, sha256: true } });
  for (const id of ids) {
    const t = rows.find((r) => r.divisionId === id);
    if (t) return `div:${t.id}:${t.version}:${t.sha256}`;
  }
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' }, select: { id: true, version: true } });
  return std ? `std:${std.id}:${std.version}` : 'none';
}

/** 양식 — 본부의 양식. 없으면 기여 단위의 것, 그다음 전사 표준 */
async function templateFor(node: RollupNode): Promise<Buffer> {
  for (const id of templateOrder(node)) {
    const t = await prisma.template.findFirst({ where: { divisionId: id, isActive: true } });
    if (t) {
      try {
        return await readStoredFile(t.filePath);
      } catch {
        continue; // 양식 파일이 없는 부서 (OPS-41) — 다음 후보로
      }
    }
  }
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
  if (std) return readStoredFile(std.filePath);
  throw new HttpError(409, 'no_template', '이어 붙일 양식을 찾지 못했습니다. 부서 설정에서 양식을 등록하세요.');
}

/**
 * RU-74 — 본부본의 **입력 열쇠**. 같은 열쇠면 다시 만들지 않는다. 기여 단위의 순서와 지금 사본, 쪽 나누기, 양식이 들어간다.
 * **섹션 제목은 넣지 않는다** — 넣으면 총괄이 섹션 제목을 고칠 때마다 모든 본부본이 다시 만들어지고 본부장 승인이 풀린다(내용은 그대로인데).
 * 같은 이유로 본부 메모(RU-21)도 넣지 않는다. 최종본은 언제나 지금 제목으로 만들어진다(전사는 본부본을 다시 읽지 않는다).
 */
export async function hqInputKey(node: RollupNode, inputs: readonly HqInput[]): Promise<string> {
  return sha256(
    Buffer.from(
      JSON.stringify({
        v: 1,
        hq: node.node.id,
        units: inputs.map((i) => [i.division.id, i.report?.id ?? null]),
        pageBreak: node.node.rollupPageBreak,
        template: await hqTemplateRef(node),
      }),
    ),
  );
}

const rollupRel = (dir: string[], slot: WeekSlot, runId: string) =>
  path.join(...dir.map(sanitizeSegment), String(slot.year), `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${sanitizeSegment(runId)}.hwp`);

/**
 * RU-10·31 — 본부본 이어 붙이기 한 번. 기여 단위 중 **올라온 것만**, 정한 순서대로 (RU-04·20). 기록의 주체는 `system`이고
 * 일으킨 사건·사람을 붙인다(TACP-23) — 다른 부서 실장의 이름으로 본부 문서를 「만들었다」고 적지 않는다.
 * 실패해도 RollupRun은 남는다(`failed` + 이유). 사본 하나를 못 읽으면 그 섹션 자리에 실패를 적고 나머지는 만든다(HM-21).
 * 부르는 쪽(auto.ts)이 열쇠를 이미 계산했고 `hq:` 잠금을 쥐고 있다.
 */
export async function composeHq(node: RollupNode, slot: WeekSlot, inputs: readonly HqInput[], inputKey: string, ctx: BuildCause): Promise<RollupRun> {
  const submitted = inputs.filter((i): i is HqInput & { report: ReportSubmission } => !!i.report);
  const run = await prisma.rollupRun.create({
    data: {
      level: 'hq',
      divisionId: node.node.id,
      weekSlotId: slot.id,
      status: 'running',
      inputIds: JSON.stringify(submitted.map((s) => s.report.id)),
      createdBy: 'system',
      inputKey,
      cause: ctx.cause,
      startedAt: new Date(),
    },
  });
  try {
    if (submitted.length === 0) throw new HttpError(409, 'nothing_submitted', '아직 올라온 실·팀이 없습니다.');
    const template = await templateFor(node);
    const titles = await sectionTitles(submitted.map((s) => s.division));
    const parts: Input[] = [];
    for (const s of submitted) {
      parts.push({ division: s.division, report: s.report, title: titles.get(s.division.id) ?? s.division.nameKo, bytes: await readStoredFile(s.report.filePath) });
    }
    // RU-10 — 사본 하나 = 섹션 하나. 원래 꼴 그대로(RU-62), 정규화(RU-63)도 전사와 같다 — 본부장이 본 것이 최종본에 들어간다
    const out = composeOrgDocument(
      template,
      parts.map((i) => ({ title: i.title, source: i.bytes })),
      { pageBreak: node.node.rollupPageBreak },
    );
    // 못 옮긴 섹션을 맨 앞에 — 결과 카드는 「준비됨」이라도 이 줄을 먼저 읽어야 한다
    const failedFirst = out.outcomes.map((o, k) => ({ o, k })).sort((a, b) => Number(b.o.status === 'failed') - Number(a.o.status === 'failed'));
    const warnings = [...failedFirst.flatMap(({ o, k }) => outcomeLines(o, parts[k])), ...out.warnings];
    const rel = rollupRel(['divisions', node.node.slug, 'rollup'], slot, run.id);
    await writeFileAtomic(rel, out.bytes);
    const done = await prisma.rollupRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        outputPath: rel,
        unitsJson: JSON.stringify(parts.map((input, k) => ({ ...summarize(input), fixed: out.outcomes[k].fixed ?? [] }))),
        warnings: JSON.stringify(warnings),
        finishedAt: new Date(),
      },
    });
    await audit('system', 'rollup', node.node.id, `rollup:${run.id}`, {
      level: 'hq',
      isoKey: slot.isoKey,
      cause: ctx.cause,
      causedBy: ctx.causedBy,
      inputs: parts.map((i) => ({ division: i.division.nameKo, report: i.report.id })),
    });
    return done;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: message, runId: run.id, level: 'hq' }, '[취합] 이어 붙이기 실패');
    return prisma.rollupRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorText: message, finishedAt: new Date() },
    });
  }
}

// ── 현황판 ────────────────────────────────────────────────

export interface ReportCell {
  id: string;
  submittedAt: Date;
  /** 올린 사람 — 사람 이름, 자동이면 「자동」 (RU-78) */
  submittedBy: string;
  origin: string;
  /** DM-18b — approved · no_head · unapproved · manual */
  basis: string;
  /** 승인으로 올라온 것이면 승인한 사람 (「홍길동 실장」) */
  approvedBy: string | null;
  sha256: string;
}

export interface UnitStatus {
  division: { id: string; slug: string; nameKo: string };
  report: ReportCell | null;
  /** 실·팀 병합본이 있나 (올라오기 전 단계 표시) */
  merged: boolean;
  /** 마감 뒤 최종본이 있나 (HM-34) — 「부서장 승인 전」은 이때만 */
  final: boolean;
  /** 부서장 계정이 있나 — 없으면 「부서장 없음」 (RU-82) */
  hasHead: boolean;
}

export interface RunCell {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  units: RolledUnit[];
  warnings: string[];
  errorText: string | null;
  /** RU-74 — 이 결과의 입력 열쇠가 지금 열쇠와 다르다(아직 맞추지 못함 — 실패 뒤 기다리는 중 등). 정상이면 거짓 */
  stale: boolean;
  /** 결과 파일의 sha — 본부장 승인이 「본 판」으로 싣는다 (RU-55) */
  sha256: string | null;
  /** RU-78 — 무엇 때문에 만들어졌나 (「기획조정실 승인으로」) */
  causeLabel: string;
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, jobTitle: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** 「홍길동 실장」 — 승인한 사람의 이름 (HM-47 `titled`와 같은 꼴) */
async function approversOf(reviewIds: string[]): Promise<Map<string, string>> {
  if (reviewIds.length === 0) return new Map();
  const reviews = await prisma.mergeReview.findMany({ where: { id: { in: reviewIds } }, select: { id: true, reviewerId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: reviews.map((r) => r.reviewerId) } }, select: { id: true, name: true, jobTitle: true } });
  const byUser = new Map(users.map((u) => [u.id, `${u.name} ${u.jobTitle?.trim() || '부서장'}`]));
  return new Map(reviews.map((r) => [r.id, byUser.get(r.reviewerId) ?? '부서장']));
}

/** RU-78 — 사람 id → 이름. `system`은 「자동」 — 예전처럼 「알 수 없음」이 되지 않게 */
export function whoLabel(id: string, names: Map<string, string>): string {
  return id === 'system' ? '자동' : (names.get(id) ?? '알 수 없음');
}

export async function reportCells(rows: (ReportSubmission | null)[]): Promise<(ReportCell | null)[]> {
  const present = rows.filter((r): r is ReportSubmission => !!r);
  const [names, approvers] = await Promise.all([namesOf(present.map((r) => r.submittedBy)), approversOf(present.flatMap((r) => (r.reviewId ? [r.reviewId] : [])))]);
  return rows.map((r) =>
    r
      ? {
          id: r.id,
          submittedAt: r.submittedAt,
          submittedBy: whoLabel(r.submittedBy, names),
          origin: r.origin,
          basis: r.basis,
          approvedBy: r.reviewId ? (approvers.get(r.reviewId) ?? null) : null,
          sha256: r.sha256,
        }
      : null,
  );
}

const parse = <T,>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

/**
 * RU-78 · RU-82 — 「무엇 때문에」를 사람 말로. 사건 이름은 auto.ts가 붙인다.
 * 사본 id로 남은 것은 그 사본의 부서 이름으로 바꾼다 — 「기획조정실 승인으로」.
 */
export async function causeLabel(cause: string | null): Promise<string> {
  if (!cause) return '';
  const [kind, ref] = cause.split(':');
  if ((kind === 'unit_handoff' || kind === 'hq_handoff') && ref) {
    const s = await prisma.reportSubmission.findUnique({ where: { id: ref }, include: { division: { select: { nameKo: true } } } });
    if (!s) return '';
    const how = s.basis === 'unapproved' ? '승인 없이 올려서' : s.basis === 'no_head' ? '병합본이 올라와서' : '승인으로';
    return `${s.division.nameKo} ${how}`;
  }
  return (
    {
      order: '순서를 바꿔서',
      template: '양식이 바뀌어서',
      tree: '조직이 바뀌어서',
      sections: '섹션 구성이 바뀌어서',
      upload: '섹션 파일이 바뀌어서',
      retry: '다시 시도',
      rollup_enabled: '3단계를 켜서',
    } as Record<string, string>
  )[kind] ?? '';
}

async function runCell(run: RollupRun | null, currentKey: string | null): Promise<RunCell | null> {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    units: parse<RolledUnit[]>(run.unitsJson, []),
    warnings: parse<string[]>(run.warnings, []),
    errorText: run.errorText,
    stale: currentKey !== null && run.inputKey !== currentKey,
    sha256: run.status === 'succeeded' ? await fileSha(run.outputPath) : null,
    causeLabel: await causeLabel(run.cause),
  };
}

async function unitStatuses(divs: TreeDivision[], slot: WeekSlot, reports: (ReportSubmission | null)[]): Promise<UnitStatus[]> {
  const [cells, merged, heads, divisions] = await Promise.all([
    reportCells(reports),
    prisma.mergeRun.findMany({
      where: { divisionId: { in: divs.map((d) => d.id) }, weekSlotId: slot.id, status: 'succeeded' },
      select: { divisionId: true, startedAt: true },
    }),
    prisma.user.groupBy({ by: ['divisionId'], where: { divisionId: { in: divs.map((d) => d.id) }, isActive: true, divisionRole: 'head' }, _count: { _all: true } }),
    prisma.division.findMany({ where: { id: { in: divs.map((d) => d.id) } } }),
  ]);
  const headSet = new Set(heads.map((h) => h.divisionId));
  const divById = new Map(divisions.map((d) => [d.id, d]));
  return divs.map((d, i) => {
    const full = divById.get(d.id);
    const runs = merged.filter((m) => m.divisionId === d.id);
    return {
      division: { id: d.id, slug: d.slug, nameKo: d.nameKo },
      report: cells[i],
      merged: runs.length > 0,
      final: !!full && runs.some((m) => m.startedAt >= effectiveDeadline(slot, full)),
      hasHead: headSet.has(d.id),
    };
  });
}

export interface HqApprovalView {
  id: string;
  by: string;
  atKst: string;
  /** 승인한 판(sha)이 지금 본부본과 다르다 — 다시 이어 붙어 바뀌었다 (같은 바이트로 다시 만들어진 것은 바뀐 것이 아니다) */
  changedAfter: boolean;
}

/**
 * RU-82 — 본부 상태 (12 §2a 본부 상태 기계).
 *   Q0 비어 있음 · Q1 준비됨·승인 전 · Q2 승인·총괄로 감 · Q3 보낸 뒤 바뀜 · Q4 승인 없이 감 · Qf 만들기 실패
 */
export type HqState = 'Q0' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Qf';

export interface HqBoard {
  node: { id: string; slug: string; nameKo: string; note: string; pageBreak: boolean; self: boolean };
  units: UnitStatus[];
  /** 가장 최근 **시도** (실패일 수 있다) */
  lastRun: RunCell | null;
  /** 가장 최근 **성공한** 본부본 — 본부장이 보고 승인하는 판 */
  current: RunCell | null;
  approval: HqApprovalView | null;
  /** 총괄에 지금 가 있는 본부본 */
  hqReport: ReportCell | null;
  hasHead: boolean;
  state: HqState;
}

/** RU-55 — 가장 최근 본부장 승인. 「승인 뒤 바뀜」은 **내용(sha)**으로 본다 */
export async function hqApproval(nodeId: string, slot: WeekSlot, currentSha?: string | null): Promise<HqApprovalView | null> {
  const review = await prisma.mergeReview.findFirst({ where: { divisionId: nodeId, weekSlotId: slot.id, ...HQ_REVIEW }, orderBy: NEWEST_FIRST });
  if (!review) return null;
  let sha = currentSha;
  if (sha === undefined) {
    const run = await prisma.rollupRun.findFirst({
      where: { level: 'hq', divisionId: nodeId, weekSlotId: slot.id, status: 'succeeded' },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });
    sha = await fileSha(run?.outputPath);
  }
  const who = await prisma.user.findUnique({ where: { id: review.reviewerId }, select: { name: true, jobTitle: true } });
  return {
    id: review.id,
    by: who ? `${who.name} ${who.jobTitle?.trim() || '본부장'}` : '본부장',
    atKst: toKstIso(review.createdAt).slice(5, 16).replace('T', ' '),
    changedAfter: !sha || sha !== review.sha256,
  };
}

export function hqStateOf(b: Pick<HqBoard, 'units' | 'lastRun' | 'current' | 'approval' | 'hqReport'>): HqState {
  if (!b.units.some((u) => u.report)) return 'Q0';
  if (b.lastRun?.status === 'failed') return 'Qf';
  const R = b.current;
  if (!R?.sha256) return b.lastRun?.status === 'failed' ? 'Qf' : 'Q0';
  const S = b.hqReport;
  if (S && S.sha256 === R.sha256) return S.basis === 'unapproved' ? 'Q4' : 'Q2';
  if (S) return 'Q3';
  return 'Q1';
}

/** RU-31·82 — 본부 화면. 읽기만 한다(맞추기는 부르는 쪽이 먼저 — 읽기 수리, auto.ts) */
export async function hqBoard(node: RollupNode, slot: WeekSlot): Promise<HqBoard> {
  const inputs = await hqInputs(node, slot);
  const [units, lastRun, currentRun, hq, settings, key, head] = await Promise.all([
    unitStatuses(node.contributors, slot, inputs.map((i) => i.report)),
    prisma.rollupRun.findFirst({ where: { level: 'hq', divisionId: node.node.id, weekSlotId: slot.id }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    prisma.rollupRun.findFirst({
      where: { level: 'hq', divisionId: node.node.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    currentReport(node.node.id, slot.id, 'hq'),
    prisma.division.findUnique({ where: { id: node.node.id }, select: { rollupNote: true } }),
    hqInputKey(node, inputs),
    prisma.user.count({ where: { divisionId: node.node.id, isActive: true, divisionRole: 'head' } }),
  ]);
  const [last, current] = await Promise.all([runCell(lastRun, key), runCell(currentRun, key)]);
  const [hqReport] = await reportCells([hq]);
  const approval = await hqApproval(node.node.id, slot, current?.sha256 ?? null);
  const board = {
    node: {
      id: node.node.id,
      slug: node.node.slug,
      nameKo: node.node.nameKo,
      note: settings?.rollupNote ?? '',
      pageBreak: node.node.rollupPageBreak,
      self: node.node.rollupSelf,
    },
    units,
    lastRun: last,
    current,
    approval,
    hqReport,
    hasHead: head > 0,
  };
  return { ...board, state: hqStateOf(board) };
}

/** 주차 고르기 — 이어 붙일 것이 있는 최근 주차들 (지난 자료 재현에 쓴다) */
export async function rollupWeeks(limit = 8) {
  const recent = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: 40 });
  const withReports = await prisma.reportSubmission.groupBy({ by: ['weekSlotId'], _count: { _all: true } });
  const has = new Set(withReports.map((w) => w.weekSlotId));
  return recent.filter((s) => has.has(s.id)).slice(0, limit);
}
