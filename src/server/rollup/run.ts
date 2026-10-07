// RU-04·10·31 — 본부 **이어 붙이기 실행**과 본부 현황판. (전사 취합본은 orgrun.ts)
//
// 입력은 언제나 **보낸 사본**이다(ADR-0012). 하위의 병합본 원본을 직접 읽지 않는다 —
// 그러면 아직 검토 중인 문서가 위로 새고, 하위가 다시 병합하는 순간 위의 결과가 몰래 바뀐다.
//
// 조립은 전사 취합과 **같은 엔진**(orgdoc.ts — RU-62)이다. 사본 하나가 섹션 하나가 되어 원래 꼴 그대로 들어간다.
// 예전에는 본부 단계만 실형 5열 표로 다시 그렸다(composeRollupHwp) — 엔진이 둘이면 본부장이 검토한 꼴과
// 최종본의 꼴이 갈라진다. 2026-10-07 중복 제거로 뺐다.
import path from 'node:path';
import type { ReportSubmission, RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, type Scope } from '../authz';
import { readStoredFile, sanitizeSegment, writeFileAtomic } from '../storage';
import { logger } from '../logger';
import { composeOrgDocument, type OrgSectionOutcome } from '@/lib/hwp/orgdoc';
import { readUnits, BUCKETS } from '@/lib/hwp/rollup';
import { currentReport, outputDiffers } from './report';
import { sectionTitles } from './sections';
import { type RollupNode, type TreeDivision } from './tree';

/** 결과 화면이 쓰는 단위별 요약 (RollupRun.unitsJson) — 단위 하나 = 사본 하나 = 섹션 하나 */
export interface RolledUnit {
  /** 섹션 제목 — 전사와 같은 제목(RU-61), 섹션이 없는 부서는 부서 이름 */
  name: string;
  divisionId: string;
  submissionId: string;
  rows: { achievements: number; plans: number; notes: number };
  emphasis: number;
}

interface Input {
  division: Pick<TreeDivision, 'id' | 'nameKo'>;
  report: ReportSubmission;
  title: string;
  bytes: Buffer;
}

/**
 * RU-19 — 화면용 행 수·「공유」 수. **보낸 사본**에서 센다(RU-16 단위로 읽기). 결과 문서에서 세지 않는 이유:
 * RU-63 정규화가 빈 3번 표에 「특이사항 없음」을 넣는다 — 실·팀이 적은 줄이 아니다.
 * 사본 하나에 단위가 여럿이면(지난 자료 적재본 등) 더한다.
 * 읽기 경고(「표 밖의 글은 옮기지 않았습니다」)는 옮기지 않는다 — 이제 표 밖의 글도 원래 꼴 그대로 들어가서 사실이 아니다.
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
    // 못 읽는 사본은 조립 결과(status 'failed')가 이미 경고로 말한다 — 여기서는 0으로 둔다
  }
  return { name: input.title, divisionId: input.division.id, submissionId: input.report.id, rows, emphasis };
}

/**
 * RU-19 — 섹션 결과 → 「확인해 주세요」 줄들, 섹션 제목을 앞에 붙여서.
 * 사본 맨 위의 부서명 줄을 뺀 것은 알리지 않는다 — 제목을 생성해 단 것이라(RU-61) 매번 뜨면 소음이다.
 * 그 밖에 뺀 것(빨간 안내문, 지난 자료의 문서 제목 등)은 알린다 — 조용히 버리지 않는다(RU-16과 같은 원칙).
 */
function outcomeLines(o: OrgSectionOutcome, input: Input): string[] {
  if (o.status === 'failed') return [`${o.title}: 옮기지 못했습니다 — ${o.error ?? '알 수 없는 오류'}`];
  const ownTitle = new Set([input.division.nameKo, o.title].map((t) => `제목 「${t.slice(0, 30)}」`));
  const dropped = o.dropped.filter((d) => !ownTitle.has(d));
  return [
    ...(o.fixed?.length ? [`${o.title}: 자동 수정 — ${o.fixed.join(' · ')}`] : []),
    ...(o.warnings ?? []).map((w) => `${o.title}: ${w}`),
    ...(dropped.length ? [`${o.title}: 뺀 것 — ${dropped.join(', ')}`] : []),
  ];
}

/** 양식 — 본부의 양식. 없으면 기여 단위의 것, 그다음 전사 표준 */
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

const rollupRel = (dir: string[], slot: WeekSlot, runId: string) =>
  path.join(...dir.map(sanitizeSegment), String(slot.year), `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${sanitizeSegment(runId)}.hwp`);

/**
 * RU-31 — 본부 이어 붙이기. 기여 단위 중 **제출한 것만**, 정한 순서대로 (RU-04·20).
 * 실패해도 RollupRun은 남는다(`failed` + 이유) — 「눌렀는데 아무 일도 없었다」가 없게.
 * 사본 하나를 못 읽으면 그 섹션 자리에 실패를 적고 나머지는 만든다(HM-21 — 전사와 같다). 경고 맨 앞 줄이 그것을 말한다(RU-19).
 */
export async function runHqRollup(scope: Scope, node: RollupNode, slot: WeekSlot): Promise<RollupRun> {
  const submitted: { division: TreeDivision; report: ReportSubmission }[] = [];
  for (const c of node.contributors) {
    const report = await currentReport(c.id, slot.id, 'unit');
    if (report) submitted.push({ division: c, report });
  }
  if (submitted.length === 0) throw new HttpError(409, 'nothing_submitted', '아직 제출한 실·팀이 없습니다.');
  const template = await templateFor(node.node.id, node.contributors.map((c) => c.id));
  const titles = await sectionTitles(submitted.map((s) => s.division));

  const run = await prisma.rollupRun.create({
    data: {
      level: 'hq',
      divisionId: node.node.id,
      weekSlotId: slot.id,
      status: 'running',
      inputIds: JSON.stringify(submitted.map((s) => s.report.id)),
      createdBy: scope.user.id,
    },
  });
  try {
    const inputs: Input[] = [];
    for (const s of submitted) {
      inputs.push({ ...s, title: titles.get(s.division.id) ?? s.division.nameKo, bytes: await readStoredFile(s.report.filePath) });
    }
    // RU-10 — 사본 하나 = 섹션 하나. 원래 꼴 그대로(RU-62), 정규화(RU-63)도 전사와 같다 — 본부장이 본 것이 최종본에 들어간다
    const out = composeOrgDocument(
      template,
      inputs.map((i) => ({ title: i.title, source: i.bytes })),
      { pageBreak: node.node.rollupPageBreak },
    );
    // 못 옮긴 섹션을 맨 앞에 — 결과 카드는 「준비됨」이라도 이 줄을 먼저 읽어야 한다
    const failedFirst = out.outcomes.map((o, k) => ({ o, k })).sort((a, b) => Number(b.o.status === 'failed') - Number(a.o.status === 'failed'));
    const warnings = [...failedFirst.flatMap(({ o, k }) => outcomeLines(o, inputs[k])), ...out.warnings];
    const rel = rollupRel(['divisions', node.node.slug, 'rollup'], slot, run.id);
    await writeFileAtomic(rel, out.bytes);
    const done = await prisma.rollupRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        outputPath: rel,
        unitsJson: JSON.stringify(inputs.map(summarize)),
        warnings: JSON.stringify(warnings),
        finishedAt: new Date(),
      },
    });
    await audit(scope.user.email, 'rollup', node.node.id, `rollup:${run.id}`, {
      level: 'hq',
      isoKey: slot.isoKey,
      inputs: inputs.map((i) => ({ division: i.division.nameKo, report: i.report.id })),
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

/** 주차 고르기 — 이어 붙일 것이 있는 최근 주차들 (지난 자료 재현에 쓴다) */
export async function rollupWeeks(limit = 8) {
  const recent = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: 40 });
  const withReports = await prisma.reportSubmission.groupBy({ by: ['weekSlotId'], _count: { _all: true } });
  const has = new Set(withReports.map((w) => w.weekSlotId));
  return recent.filter((s) => has.has(s.id)).slice(0, limit);
}
