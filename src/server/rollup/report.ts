// RU-01~03 — 위로 **보내기**. 보내는 것은 그 순간 병합본의 사본이다 (ADR-0012).
import path from 'node:path';
import type { ReportSubmission, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, notFound, type Scope } from '../authz';
import { readStoredFile, sanitizeSegment, sha256, writeFileAtomic } from '../storage';
import { loadTree, submitTarget, type RollupNode } from './tree';

export type ReportLevel = 'unit' | 'hq';

/** 「지금 제출된 것」 — 가장 최근의 취소되지 않은 행 (RU-01) */
export async function currentReport(divisionId: string, weekSlotId: string, level: ReportLevel) {
  return prisma.reportSubmission.findFirst({
    where: { divisionId, weekSlotId, level, withdrawnAt: null },
    orderBy: { submittedAt: 'desc' },
  });
}

/** 사본 자리. 원본 병합본 경로와 다른 곳이다 — 원본은 다시 병합하면 덮인다 (RU-02) */
export function reportRelPath(divisionSlug: string, slot: Pick<WeekSlot, 'year' | 'label'>, level: ReportLevel, stamp: string): string {
  return path.join(
    'divisions',
    sanitizeSegment(divisionSlug),
    'reports',
    String(slot.year),
    `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${level}_${sanitizeSegment(stamp)}.hwp`,
  );
}

/** 지금 내 부서의 「보낼 것」 — 실·팀이면 최신 병합본, 본부면 최신 본부 이어 붙이기 결과 */
async function latestOutput(level: ReportLevel, divisionId: string, weekSlotId: string) {
  if (level === 'unit') {
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    return run?.outputPath ? { runId: run.id, outputPath: run.outputPath, at: run.finishedAt ?? run.startedAt } : null;
  }
  const run = await prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  return run?.outputPath ? { runId: run.id, outputPath: run.outputPath, at: run.finishedAt ?? run.startedAt } : null;
}

export interface ReportState {
  level: ReportLevel;
  /** 보낼 곳 — 「기획경영본부」 또는 「총괄」 (RU-07) */
  targetLabel: string;
  current: { id: string; submittedAt: Date; submittedBy: string; origin: string } | null;
  /** 보낼 것이 있나 (병합본·본부본) */
  hasOutput: boolean;
  /** RU-02 — 제출한 뒤 병합본이 바뀌었다. 다시 내야 위에 간다 */
  changedSinceSubmit: boolean;
}

/** 수합 관리·본부 화면의 「제출」 카드 상태. 쓰지 않는다 */
export async function reportState(
  divisionId: string,
  slot: WeekSlot,
  level: ReportLevel,
): Promise<ReportState | null> {
  let targetLabel = '총괄';
  if (level === 'unit') {
    const target = submitTarget(await loadTree(), divisionId);
    if (!target) return null; // 꺼진 부서 — 보낼 곳이 없다
    if (target.kind === 'hq') targetLabel = target.node.node.nameKo;
  }
  const [current, out] = await Promise.all([currentReport(divisionId, slot.id, level), latestOutput(level, divisionId, slot.id)]);
  let changed = false;
  if (current && out && out.runId !== current.sourceRunId) changed = true;
  else if (current && out) {
    // 같은 실행이라도 담당자가 고치면(API-50) 파일이 바뀐다 — 내용으로 본다
    changed = sha256(await readStoredFile(out.outputPath)) !== current.sha256;
  }
  const who = current ? await prisma.user.findUnique({ where: { id: current.submittedBy }, select: { name: true } }) : null;
  return {
    level,
    targetLabel,
    current: current
      ? { id: current.id, submittedAt: current.submittedAt, submittedBy: who?.name ?? '알 수 없음', origin: current.origin }
      : null,
    hasOutput: !!out,
    changedSinceSubmit: changed,
  };
}

/**
 * RU-01 — 내 부서의 지금 결과를 위로 보낸다. **쓰기 대상은 신원의 부서다** (TACP-6).
 * 같은 판을 또 보내면 새 행을 만들지 않는다 — 눌러 놓고 또 누르는 일이 기록을 어지럽히지 않게.
 */
export async function submitReport(
  scope: Scope,
  level: ReportLevel,
  slot: WeekSlot,
  /** 본부 단계면 그 본부 — 게이트가 이미 확인했다 */
  hqNode?: RollupNode,
): Promise<{ report: ReportSubmission; unchanged: boolean }> {
  const division = scope.division; // TACP-6 — 신원의 부서
  if (level === 'hq' && hqNode?.node.id !== division.id) throw notFound();
  if (level === 'unit' && !submitTarget(await loadTree(), division.id)) throw notFound();

  const out = await latestOutput(level, division.id, slot.id);
  if (!out) {
    throw new HttpError(
      409,
      'no_output',
      level === 'unit' ? '아직 병합본이 없습니다. 병합을 먼저 실행하세요.' : '아직 이어 붙인 본부본이 없습니다. [이어 붙이기]를 먼저 누르세요.',
    );
  }
  const bytes = await readStoredFile(out.outputPath);
  const digest = sha256(bytes);

  const current = await currentReport(division.id, slot.id, level);
  if (current && current.sha256 === digest) return { report: current, unchanged: true };

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rel = reportRelPath(division.slug, slot, level, `${stamp}_${digest.slice(0, 8)}`);
  await writeFileAtomic(rel, bytes);
  const report = await prisma.reportSubmission.create({
    data: {
      level,
      divisionId: division.id,
      weekSlotId: slot.id,
      filePath: rel,
      sha256: digest,
      byteSize: bytes.length,
      sourceRunId: out.runId,
      submittedBy: scope.user.id,
    },
  });
  await audit(scope.user.email, 'report_submit', division.id, `report:${report.id}`, {
    level,
    isoKey: slot.isoKey,
    sha256: digest,
    replaced: current?.id ?? null,
  });
  return { report, unchanged: false };
}

/** RU-03 — 제출 취소. 내 부서가 보낸 것만 (TACP-6) */
export async function withdrawReport(scope: Scope, reportId: string): Promise<ReportSubmission> {
  const r = await prisma.reportSubmission.findUnique({ where: { id: reportId } });
  if (!r || r.divisionId !== scope.division.id) throw notFound();
  if (r.withdrawnAt) return r;
  const done = await prisma.reportSubmission.update({
    where: { id: r.id },
    data: { withdrawnAt: new Date(), withdrawnBy: scope.user.id },
  });
  await audit(scope.user.email, 'report_withdraw', r.divisionId, `report:${r.id}`, { level: r.level });
  return done;
}
