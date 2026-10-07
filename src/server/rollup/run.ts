// RU-04·10·31·32 — 본부·전사 **이어 붙이기 실행**과 현황판.
//
// 입력은 언제나 **보낸 사본**이다(ADR-0012). 하위의 병합본 원본을 직접 읽지 않는다 —
// 그러면 아직 검토 중인 문서가 위로 새고, 하위가 다시 병합하는 순간 위의 결과가 몰래 바뀐다.
import path from 'node:path';
import type { ReportSubmission, RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, type Scope } from '../authz';
import { readStoredFile, sanitizeSegment, writeFileAtomic } from '../storage';
import { logger } from '../logger';
import { composeRollupHwp, readUnits, BUCKETS, type UnitBlock } from '@/lib/hwp/rollup';
import { currentReport, outputDiffers } from './report';
import { loadOrgSetting, loadTree, type RollupNode, type TreeDivision } from './tree';

/** 결과 화면이 쓰는 단위별 요약 (RollupRun.unitsJson) */
export interface RolledUnit {
  name: string;
  divisionId: string;
  submissionId: string;
  rows: { achievements: number; plans: number; notes: number };
  emphasis: number;
}

interface Input {
  division: Pick<TreeDivision, 'id' | 'nameKo' | 'slug'>;
  report: ReportSubmission;
}

function summarize(u: UnitBlock, input: Input): RolledUnit {
  return {
    name: u.name,
    divisionId: input.division.id,
    submissionId: input.report.id,
    rows: { achievements: u.tables.achievements.length, plans: u.tables.plans.length, notes: u.tables.notes.length },
    emphasis: BUCKETS.reduce((n, b) => n + u.tables[b].filter((r) => r.emphasis).length, 0),
  };
}

/** 양식 — 본부 단계는 본부의 양식, 전사는 총괄 부서의 양식. 없으면 첫 단위의 것, 그다음 전사 표준 */
async function templateFor(ownerDivisionId: string | null, fallbackDivisionIds: string[]): Promise<Buffer> {
  for (const id of [ownerDivisionId, ...fallbackDivisionIds]) {
    if (!id) continue;
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
 * 공통 — 사본들을 순서대로 읽어 이어 붙이고 기록한다.
 * 실패해도 RollupRun은 남는다(`failed` + 이유) — 「눌렀는데 아무 일도 없었다」가 없게.
 */
async function execute(opts: {
  scope: Scope;
  level: 'hq' | 'org';
  divisionId: string | null;
  slot: WeekSlot;
  inputs: Input[];
  template: Buffer;
  pageBreak: boolean;
  outRel: (runId: string) => string;
}): Promise<RollupRun> {
  const { scope, level, divisionId, slot, inputs } = opts;
  const run = await prisma.rollupRun.create({
    data: {
      level,
      divisionId,
      weekSlotId: slot.id,
      status: 'running',
      inputIds: JSON.stringify(inputs.map((i) => i.report.id)),
      createdBy: scope.user.id,
    },
  });
  try {
    const units: UnitBlock[] = [];
    const summary: RolledUnit[] = [];
    const warnings: string[] = [];
    for (const input of inputs) {
      const read = readUnits(await readStoredFile(input.report.filePath), input.division.nameKo);
      warnings.push(...read.warnings);
      // 실·팀 사본은 단위가 하나다 — 이름은 **부서 기록의 이름**을 쓴다. 지난 자료에는 옛 이름
      // (「생물환경부」)이나 문서 제목이 맨 위에 있을 수 있다. 본부본은 문서 안의 단위 이름을 따른다
      const blocks =
        input.report.level === 'unit' && read.units.length === 1 ? [{ ...read.units[0], name: input.division.nameKo }] : read.units;
      for (const u of blocks) {
        units.push(u);
        summary.push(summarize(u, input));
      }
    }
    const out = composeRollupHwp(opts.template, units, { pageBreak: opts.pageBreak });
    warnings.push(...out.warnings);
    const rel = opts.outRel(run.id);
    await writeFileAtomic(rel, out.bytes);
    const done = await prisma.rollupRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        outputPath: rel,
        unitsJson: JSON.stringify(summary),
        warnings: JSON.stringify(warnings),
        finishedAt: new Date(),
      },
    });
    await audit(scope.user.email, 'rollup', divisionId, `rollup:${run.id}`, {
      level,
      isoKey: slot.isoKey,
      inputs: inputs.map((i) => ({ division: i.division.nameKo, report: i.report.id })),
    });
    return done;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: message, runId: run.id, level }, '[취합] 이어 붙이기 실패');
    return prisma.rollupRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorText: message, finishedAt: new Date() },
    });
  }
}

const rollupRel = (dir: string[], slot: WeekSlot, runId: string) =>
  path.join(...dir.map(sanitizeSegment), String(slot.year), `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${sanitizeSegment(runId)}.hwp`);

/** RU-31 — 본부 이어 붙이기. 기여 단위 중 **제출한 것만**, 정한 순서대로 (RU-04·20) */
export async function runHqRollup(scope: Scope, node: RollupNode, slot: WeekSlot): Promise<RollupRun> {
  const inputs: Input[] = [];
  for (const c of node.contributors) {
    const report = await currentReport(c.id, slot.id, 'unit');
    if (report) inputs.push({ division: c, report });
  }
  if (inputs.length === 0) throw new HttpError(409, 'nothing_submitted', '아직 제출한 실·팀이 없습니다.');
  return execute({
    scope,
    level: 'hq',
    divisionId: node.node.id,
    slot,
    inputs,
    template: await templateFor(node.node.id, node.contributors.map((c) => c.id)),
    pageBreak: node.node.rollupPageBreak,
    outRel: (id) => rollupRel(['divisions', node.node.slug, 'rollup'], slot, id),
  });
}

/** 전사 입력 한 칸 — 본부 단계가 있으면 본부의 [총괄에 제출], 없으면 그 단위의 [제출] (RU-07) */
async function orgInputOf(n: RollupNode, slot: WeekSlot): Promise<Input | null> {
  if (n.hasHqStep) {
    const report = await currentReport(n.node.id, slot.id, 'hq');
    return report ? { division: n.node, report } : null;
  }
  const only = n.contributors[0];
  const report = await currentReport(only.id, slot.id, 'unit');
  return report ? { division: only, report } : null;
}

/** RU-32 — 전사 이어 붙이기 (총괄 「딸깍」) */
export async function runOrgRollup(scope: Scope, slot: WeekSlot): Promise<RollupRun> {
  const [tree, setting] = await Promise.all([loadTree(), loadOrgSetting()]);
  const inputs: Input[] = [];
  for (const n of tree.nodes) {
    const i = await orgInputOf(n, slot);
    if (i) inputs.push(i);
  }
  if (inputs.length === 0) throw new HttpError(409, 'nothing_submitted', '아직 총괄에 제출된 본부·단위가 없습니다.');
  return execute({
    scope,
    level: 'org',
    divisionId: null,
    slot,
    inputs,
    // 전사본의 양식은 총괄 자신의 부서 양식이다 — 신원의 부서 (TACP-6과 같은 원리)
    template: await templateFor(scope.division.id, inputs.map((i) => i.division.id)),
    pageBreak: setting.pageBreak,
    outRel: (id) => rollupRel(['org', 'rollup'], slot, id),
  });
}

// ── 현황판 ────────────────────────────────────────────────

export interface ReportCell {
  id: string;
  submittedAt: Date;
  submittedBy: string;
  origin: string;
}

export interface UnitStatus {
  division: { id: string; slug: string; nameKo: string };
  report: ReportCell | null;
  /** 실·팀 병합본이 있나 (제출 전 단계 표시) */
  merged: boolean;
}

export interface RunCell {
  id: string;
  status: string;
  finishedAt: Date | null;
  units: RolledUnit[];
  warnings: string[];
  errorText: string | null;
  /** RU-03 — 이 결과를 만든 뒤 하위 제출이 바뀌었다(새로 냄·취소·순서 변경) */
  stale: boolean;
}

async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function cell(r: ReportSubmission | null, names: Map<string, string>): ReportCell | null {
  return r ? { id: r.id, submittedAt: r.submittedAt, submittedBy: names.get(r.submittedBy) ?? '알 수 없음', origin: r.origin } : null;
}

function runCell(run: RollupRun | null, currentInputIds: string[]): RunCell | null {
  if (!run) return null;
  const parse = <T,>(s: string | null, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  const used = parse<string[]>(run.inputIds, []);
  return {
    id: run.id,
    status: run.status,
    finishedAt: run.finishedAt,
    units: parse<RolledUnit[]>(run.unitsJson, []),
    warnings: parse<string[]>(run.warnings, []),
    errorText: run.errorText,
    stale: run.status === 'succeeded' && JSON.stringify(used) !== JSON.stringify(currentInputIds),
  };
}

async function unitStatuses(divs: TreeDivision[], slot: WeekSlot) {
  const reports = await Promise.all(divs.map((d) => currentReport(d.id, slot.id, 'unit')));
  const merged = await prisma.mergeRun.findMany({
    where: { divisionId: { in: divs.map((d) => d.id) }, weekSlotId: slot.id, status: 'succeeded' },
    select: { divisionId: true },
  });
  const mergedSet = new Set(merged.map((m) => m.divisionId));
  const names = await namesOf(reports.filter(Boolean).map((r) => r!.submittedBy));
  return divs.map((d, i) => ({
    division: { id: d.id, slug: d.slug, nameKo: d.nameKo },
    report: cell(reports[i], names),
    merged: mergedSet.has(d.id),
  }));
}

export interface HqBoard {
  node: { id: string; slug: string; nameKo: string; note: string; pageBreak: boolean; self: boolean };
  units: UnitStatus[];
  lastRun: RunCell | null;
  hqReport: ReportCell | null;
  /** 본부본이 이 제출 뒤 다시 만들어졌다 — 다시 [총괄에 제출]해야 간다 (RU-02) */
  hqReportOutdated: boolean;
}

/** RU-31 — 본부 화면 */
export async function hqBoard(node: RollupNode, slot: WeekSlot): Promise<HqBoard> {
  const [units, lastRun, hq, settings] = await Promise.all([
    unitStatuses(node.contributors, slot),
    prisma.rollupRun.findFirst({ where: { level: 'hq', divisionId: node.node.id, weekSlotId: slot.id }, orderBy: { startedAt: 'desc' } }),
    currentReport(node.node.id, slot.id, 'hq'),
    prisma.division.findUnique({ where: { id: node.node.id }, select: { rollupNote: true } }),
  ]);
  const current = units.filter((u) => u.report).map((u) => u.report!.id);
  const names = await namesOf(hq ? [hq.submittedBy] : []);
  const lastOk = await prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId: node.node.id, weekSlotId: slot.id, status: 'succeeded' },
    orderBy: { startedAt: 'desc' },
  });
  return {
    node: {
      id: node.node.id,
      slug: node.node.slug,
      nameKo: node.node.nameKo,
      note: settings?.rollupNote ?? '',
      pageBreak: node.node.rollupPageBreak,
      self: node.node.rollupSelf,
    },
    units,
    lastRun: runCell(lastRun, current),
    hqReport: cell(hq, names),
    // RU-02 — 실행 id가 아니라 내용으로. 다시 이어 붙여 같은 파일이 나오면 「바뀜」이 아니다 (outputDiffers)
    hqReportOutdated: !!hq && !!lastOk?.outputPath && (await outputDiffers(lastOk.outputPath, hq.sha256)),
  };
}

export interface OrgNodeStatus {
  node: { id: string; slug: string; nameKo: string };
  hasHqStep: boolean;
  units: UnitStatus[];
  /** 본부 단계가 있으면 본부의 [총괄에 제출] */
  hqReport: ReportCell | null;
  /** 전사가 실제로 쓰는 것이 있나 (본부 제출 또는 단독 단위의 제출) */
  ready: boolean;
}

export interface OrgBoard {
  nodes: OrgNodeStatus[];
  offline: { id: string; nameKo: string }[];
  lastRun: RunCell | null;
  note: string;
  pageBreak: boolean;
}

/** RU-32·33 — 전사 화면·큰 화면 */
export async function orgBoard(slot: WeekSlot): Promise<OrgBoard> {
  const [tree, setting] = await Promise.all([loadTree(), loadOrgSetting()]);
  const nodes: OrgNodeStatus[] = [];
  const current: string[] = [];
  for (const n of tree.nodes) {
    const units = await unitStatuses(n.contributors, slot);
    const hq = n.hasHqStep ? await currentReport(n.node.id, slot.id, 'hq') : null;
    const names = await namesOf(hq ? [hq.submittedBy] : []);
    const used = n.hasHqStep ? hq?.id : units[0]?.report?.id;
    if (used) current.push(used);
    nodes.push({
      node: { id: n.node.id, slug: n.node.slug, nameKo: n.node.nameKo },
      hasHqStep: n.hasHqStep,
      units,
      hqReport: cell(hq, names),
      ready: !!used,
    });
  }
  const lastRun = await prisma.rollupRun.findFirst({
    where: { level: 'org', weekSlotId: slot.id },
    orderBy: { startedAt: 'desc' },
  });
  return {
    nodes,
    offline: tree.offline.map((d) => ({ id: d.id, nameKo: d.nameKo })),
    lastRun: runCell(lastRun, current),
    note: setting.note,
    pageBreak: setting.pageBreak,
  };
}

/** 주차 고르기 — 이어 붙일 것이 있는 최근 주차들 (지난 자료 재현에 쓴다) */
export async function rollupWeeks(limit = 8) {
  const recent = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: 40 });
  const withReports = await prisma.reportSubmission.groupBy({ by: ['weekSlotId'], _count: { _all: true } });
  const has = new Set(withReports.map((w) => w.weekSlotId));
  return recent.filter((s) => has.has(s.id)).slice(0, limit);
}
