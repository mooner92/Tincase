// RU-70~79 · TACP-23 — 위로 가는 사본(`ReportSubmission`)을 만드는 **유일한** 곳 (RU-T123).
//
// 2026-10-08(ADR-0015) 전에는 사람이 [본부에 제출]·[총괄에 제출]을 눌러 사본을 만들었다. 그 앞에는 언제나 이미 끝난 결정이 있었다 —
// 실장이 승인했다, 본부장이 승인했다. 그래서 이제 **결정이 곧 넘김**이다. 사본이 생기는 경우는 TACP-23의 표 그대로 다섯뿐이고
// (승인 · 부서장 없는 단위의 최종본 · 켤 때 따라잡기 · 본부장 없는 본부 · 비상구), 그 밖의 어떤 것도 위로 보내지 않는다.
//
// 정확성(RU-73): 자동 사본은 언제나 **승인한 바이트**다. 실·팀은 승인 요청이 본 판을 확인한 바로 그 메모리의 바이트를 불변 파일로
// 쓰고(`freeze`) 사본은 그 파일을 가리킨다 — 병합본 파일은 다시 병합·수정 저장에 덮이기 때문이다(HM-49). 본부본은 실행마다 따로 쓴
// 파일이라 덮이지 않는다 — 그 파일을 sha로 다시 확인해 가리킨다.
//
// 동시성(RU-75): 같은 (부서, 주차)의 일은 `unit:` 잠금으로, 본부는 `hq:` 잠금으로 줄을 선다. 그 위에 DB가 한 번 더 막는다 —
// 사본을 만드는 트랜잭션 안에서 「이 승인이 가장 최근 승인인가」·「지금 사본보다 나중인가」·「지금 사본과 sha·근거가 같은가」를 다시 본다.
import type { MergeReview, MergeRun, Prisma, ReportSubmission, RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { logger } from '../logger';
import { HttpError, notFound, type Scope } from '../authz';
import { readStoredFile, sha256, writeFileAtomic } from '../storage';
import { effectiveDeadline } from '../worklog';
import { HQ_REVIEW, NEWEST_FIRST, UNIT_REVIEW } from '../merge/review-scope';
import type { RowChange } from '@/lib/merge-diff';
import { toKstIso } from '@/lib/week';
import { currentReport, reportRelPath, type ReportLevel } from './report';
import { loadTree, submitTarget, type OrgTree, type RollupNode } from './tree';
import { rollupEnabled, stageTimes, type StageTimes } from './schedule';
import { withLock } from './lock';

/** RU-78 · TACP-23 — 사람이 아닌 기록의 주체. 이메일이 아니어서(`@` 없음) 로그인 신원과 섞이지 않는다. 화면은 「자동」 */
export const SYSTEM = 'system';

/** RU-77 — 비상구(승인 없이 올리기)는 그 단계 기한 이만큼 전부터 열린다. 기한 15분 전 알림(RU-56·56a)과 같은 시각 */
export const ESCAPE_MINUTES = 15;

/** RU-78 — 일으킨 사건과 사람. 조립·따라잡기의 기록에 붙는다 (`causedBy`는 사람의 이메일, 없으면 null) */
export interface AutoCause {
  cause: string;
  causedBy: string | null;
}

/** 불변 사본 — 지우지도 덮지도 않는다 */
export interface Frozen {
  filePath: string;
  sha256: string;
  byteSize: number;
}

export type UnitTarget = { kind: 'hq'; node: RollupNode } | { kind: 'org' };

/** 받는 곳의 이름 — 「기획경영본부」 또는 「총괄」 (RU-07) */
export const targetLabel = (t: UnitTarget): string => (t.kind === 'hq' ? t.node.node.nameKo : '총괄');

/** 넘김의 결과 — 응답의 `handedOff`(HM-47)와 알림(NT-46′)이 이것을 말한다 */
export interface Handoff {
  submission: ReportSubmission;
  target: string;
}

export const unitLockKey = (divisionId: string, slotId: string) => `unit:${divisionId}:${slotId}`;
export const hqLockKey = (nodeId: string, slotId: string) => `hq:${nodeId}:${slotId}`;

/** RU-75 — 같은 (부서, 주차)의 승인·수정 저장·비상구·따라잡기는 줄을 선다 */
export function withUnitLock<T>(divisionId: string, slotId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(unitLockKey(divisionId, slotId), fn);
}

/** RU-71 — 「부서장(본부장)이 있다」 = 그 부서에 켜진 head 계정이 있다. 사건마다 다시 본다(계정이 생기거나 꺼질 수 있다) */
export async function hasHead(divisionId: string): Promise<boolean> {
  return (await prisma.user.count({ where: { divisionId, isActive: true, divisionRole: 'head' } })) > 0;
}

/** RU-07 — 이 단위의 사본이 가는 곳. 저장하지 않고 그때그때 나무로 정한다. 기여 단위가 아니면 null */
export async function unitTarget(divisionId: string, tree?: OrgTree): Promise<UnitTarget | null> {
  return submitTarget(tree ?? (await loadTree()), divisionId);
}

/** RU-77 — 이 단위가 지킬 기한: 본부로 가면 「실·팀 → 본부」, 바로 총괄로 가면 「본부 → 총괄」 (RU-51) */
export function unitDue(t: Pick<StageTimes, 'unitDue' | 'hqDue'>, target: UnitTarget): Date {
  return target.kind === 'hq' ? t.unitDue : t.hqDue;
}

/** RU-77 — 비상구가 열리는 시각 */
export function escapeOpensAt(due: Date): Date {
  return new Date(due.getTime() - ESCAPE_MINUTES * 60_000);
}

/**
 * RU-73 — 승인한(또는 비상구로 올린) 바이트를 불변 파일로. 시각과 sha 앞자리를 이름에 넣는다 — 같은 이름이면 같은 바이트다.
 * 병합본 파일과 다른 자리다(그쪽은 다시 병합하면 덮인다).
 */
export async function freeze(divisionSlug: string, slot: WeekSlot, level: ReportLevel, bytes: Buffer): Promise<Frozen> {
  const digest = sha256(bytes);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const filePath = reportRelPath(divisionSlug, slot, level, `${stamp}_${digest.slice(0, 8)}`);
  await writeFileAtomic(filePath, bytes);
  return { filePath, sha256: digest, byteSize: bytes.length };
}

type Tx = Prisma.TransactionClient;

/** 지금 올라가 있는 사본 — 트랜잭션 안에서 다시 읽는다 */
function currentIn(tx: Tx, divisionId: string, weekSlotId: string, level: ReportLevel) {
  return tx.reportSubmission.findFirst({
    where: { divisionId, weekSlotId, level, withdrawnAt: null },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * RU-75 (2026-10-08 검증) — 같은 판(sha)을 이미 승인했는데, 그 승인 **뒤에** 그 승인과 다른 사본이 위에 올라가 있다(비상구 — RU-77).
 * 이때 같은 판을 다시 [승인]하는 것은 「같은 일을 두 번」이 아니라 **새 결정**이다 — 승인한 판으로 되돌린다.
 * 「이미 승인한 판」 판정(`alreadyApproved`·같은 sha)만 보면 응답은 「이미 승인했어요」이고, 따라잡기는 「뒤의 비상구 사본을 앞선
 * 승인으로 되돌리지 않는다」에 걸린다 — 담당자가 비상구로 Y를 올린 뒤 실장 판 X로 되돌리면, X를 다시 승인해도 위에는 승인 없이 간 Y가
 * 남고 아무도 바꿀 수 없었다(비상구도 「이미 올라가 있다」 409 — RU-T131·T134).
 * 위의 사본이 이 판의 승인으로 간 것이면(따라잡기 사본은 승인보다 늦게 생긴다) 새 결정이 아니다.
 */
export async function supersededSince(divisionId: string, weekSlotId: string, level: ReportLevel, sha: string): Promise<boolean> {
  if (!(await rollupEnabled())) return false;
  const [review, cur] = await Promise.all([
    prisma.mergeReview.findFirst({ where: { divisionId, weekSlotId, ...(level === 'unit' ? UNIT_REVIEW : HQ_REVIEW) }, orderBy: NEWEST_FIRST }),
    currentReport(divisionId, weekSlotId, level),
  ]);
  if (!review || !cur || review.sha256 !== sha) return false;
  if (cur.submittedAt <= review.createdAt) return false; // 승인 뒤에 바뀐 것이 없다 — 안 넘어갔으면 따라잡기가 맡는다
  return !(cur.sha256 === sha && cur.basis === 'approved');
}

/**
 * 비상구의 「이미 올라가 있다」 — 지금 판이 위에 있거나, 지금 판의 승인이 위의 사본보다 나중이다(넘어갔거나 따라잡기가 넘긴다).
 * 승인한 판이라도 그 뒤 다른 사본이 올라가 있으면 「이미 올라가 있다」가 거짓이다(RU-T131).
 */
function alreadyUp(cur: ReportSubmission | null, approved: MergeReview | null, digest: string): boolean {
  if (cur?.sha256 === digest) return true;
  return approved?.sha256 === digest && !(cur && cur.submittedAt > approved.createdAt);
}

/** 같은 승인을 둘이 넘기려 하면 DB가 하나만 받는다(`reviewId` 유일) — 진 쪽은 조용히 물러난다 */
function isUniqueClash(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * RU-75 — 승인 하나를 사본으로 넘길지 **트랜잭션 안에서** 다시 본다. 넘기면 그 행, 아니면 null.
 *   · 이 승인이 그 부서·주차의 **가장 최근** 승인이 아니다 → 늦게 도착한 옛 승인. 새 승인을 덮지 않는다
 *   · 지금 사본이 이 승인보다 **나중**이다 → 그 뒤의 비상구 사본을 앞선 승인으로 되돌리지 않는다
 *   · 지금 사본과 sha·근거가 같다 → 같은 판 (RU-02). 새 행을 만들지 않는다
 */
async function handOffReviewTx(
  tx: Tx,
  review: MergeReview & { filePath: string },
  level: ReportLevel,
  opts: { submittedBy: string; cause: string; sourceRunId: string; byteSize: number },
): Promise<ReportSubmission | null> {
  const latest = await tx.mergeReview.findFirst({
    where: { divisionId: review.divisionId, weekSlotId: review.weekSlotId, ...(level === 'unit' ? UNIT_REVIEW : HQ_REVIEW) },
    orderBy: NEWEST_FIRST,
    select: { id: true },
  });
  if (latest?.id !== review.id) return null;
  const cur = await currentIn(tx, review.divisionId, review.weekSlotId, level);
  if (cur && cur.submittedAt > review.createdAt) return null;
  if (cur && (cur.reviewId === review.id || (cur.sha256 === review.sha256 && cur.basis === 'approved'))) return null;
  return tx.reportSubmission.create({
    data: {
      level,
      divisionId: review.divisionId,
      weekSlotId: review.weekSlotId,
      filePath: review.filePath,
      sha256: review.sha256,
      byteSize: opts.byteSize,
      sourceRunId: opts.sourceRunId,
      submittedBy: opts.submittedBy,
      submittedAt: new Date(),
      reviewId: review.id,
      basis: 'approved',
      cause: opts.cause,
    },
  });
}

async function auditSubmit(actor: string, s: ReportSubmission, detail: Record<string, unknown>) {
  await audit(actor, 'report_submit', s.divisionId, `report:${s.id}`, {
    level: s.level,
    sha256: s.sha256,
    basis: s.basis,
    cause: s.cause,
    ...detail,
  });
}

// ── 실·팀 ────────────────────────────────────────────────

/**
 * HM-47 · RU-70 — **부서장 승인 = 위로 제출.** 승인 기록과 사본을 **한 트랜잭션**에서 만든다 — 반쪽 승인이 없다(RU-76).
 * 불변 사본(`frozen`)은 부르는 쪽이 이미 썼다(맨 먼저 — 고쳐 저장이면 병합본을 덮기 전에). 3단계가 꺼져 있거나 기여 단위가
 * 아니면 승인만 남는다(불변 사본은 남긴다 — 켜는 순간 그 승인이 올라가야 한다, RU-79).
 * 기록의 주체는 **승인한 부서장**이다 — 승인이 곧 제출이므로 「누구 것인가」와 「누가 올렸나」가 갈리지 않는다(TACP-23).
 * 부르는 쪽이 `unit:` 잠금을 쥐고 있어야 한다.
 */
export async function commitUnitApproval(opts: {
  scope: Scope;
  run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId'>;
  slot: WeekSlot;
  kind: 'edit' | 'approve';
  changes: RowChange[];
  frozen: Frozen;
}): Promise<{ review: MergeReview; handoff: Handoff | null }> {
  const { scope, run, slot, kind, changes, frozen } = opts;
  const target = (await rollupEnabled()) ? await unitTarget(run.divisionId) : null;
  const { review, submission } = await prisma.$transaction(async (tx) => {
    const review = await tx.mergeReview.create({
      data: {
        divisionId: run.divisionId,
        weekSlotId: run.weekSlotId,
        mergeRunId: run.id,
        reviewerId: scope.user.id,
        kind,
        changes: JSON.stringify(changes),
        sha256: frozen.sha256,
        filePath: frozen.filePath,
        createdAt: new Date(),
      },
    });
    const submission = target
      ? await handOffReviewTx(tx, { ...review, filePath: frozen.filePath }, 'unit', {
          submittedBy: scope.user.id,
          cause: 'approval',
          sourceRunId: run.id,
          byteSize: frozen.byteSize,
        })
      : null;
    return { review, submission };
  });
  if (!target) return { review, handoff: null };
  if (!submission) {
    // RU-02 — 위에 이미 **같은 바이트**가 승인으로 가 있다(다시 병합해 같은 파일이 나온 새 실행을 승인). 새 사본은 없지만 「올라가 있다」는
    // 사실은 같다 — 넘김 없음으로 돌려주면 담당자 알림(NT-46′)이 3단계인데도 「취합게시판에 올려주세요」라고 말한다(RU-T132)
    const cur = await currentReport(run.divisionId, run.weekSlotId, 'unit');
    return { review, handoff: cur && cur.sha256 === frozen.sha256 ? { submission: cur, target: targetLabel(target) } : null };
  }
  await auditSubmit(scope.user.email, submission, { isoKey: slot.isoKey, auto: true, reviewId: review.id, target: targetLabel(target) });
  return { review, handoff: { submission, target: targetLabel(target) } };
}

/** 가장 최근 부서 병합본 승인 */
function latestUnitReview(divisionId: string, weekSlotId: string) {
  return prisma.mergeReview.findFirst({ where: { divisionId, weekSlotId, ...UNIT_REVIEW }, orderBy: NEWEST_FIRST });
}

/**
 * v1.7 전의 승인에는 불변 사본이 없다(`filePath` null). 지금 그 실행의 파일이 승인한 sha와 **같을 때만** 사본을 떠 둔다 —
 * 다르면 승인한 바이트는 이미 사라졌다. 그때는 넘기지 않는다(승인 안 된 것을 승인한 것으로 보내지 않는다).
 */
async function ensureFrozen(review: MergeReview, divisionSlug: string, slot: WeekSlot): Promise<(MergeReview & { filePath: string }) | null> {
  if (review.filePath) return review as MergeReview & { filePath: string };
  const run = await prisma.mergeRun.findUnique({ where: { id: review.mergeRunId }, select: { outputPath: true } });
  if (!run?.outputPath) return null;
  try {
    const bytes = await readStoredFile(run.outputPath);
    if (sha256(bytes) !== review.sha256) return null;
    const f = await freeze(divisionSlug, slot, 'unit', bytes);
    return (await prisma.mergeReview.update({ where: { id: review.id }, data: { filePath: f.filePath } })) as MergeReview & { filePath: string };
  } catch {
    return null;
  }
}

/** RU-73 — 사본 파일을 넘기기 전에 다시 확인한다. 승인 기록과 sha가 다르면 넘기지 않고 오류로 남긴다 */
async function verifiedSize(filePath: string, expected: string): Promise<number | null> {
  try {
    const bytes = await readStoredFile(filePath);
    if (sha256(bytes) === expected) return bytes.length;
    logger.error({ filePath, expected }, '[자동] 사본 파일의 sha가 승인 기록과 다르다 — 넘기지 않는다');
  } catch (e) {
    logger.error({ filePath, err: (e as Error).message }, '[자동] 사본 파일을 읽지 못했다 — 넘기지 않는다');
  }
  return null;
}

/**
 * RU-71 — 실·팀 단위 **맞추기**. 같은 상태에서 몇 번을 돌려도 결과가 같다(RU-74) — 그래서 시키는 곳이 여럿이어도 된다.
 *   부서장 있음  가장 최근 승인이 아직 안 넘어갔으면 넘긴다(3단계를 켤 때 · 요청 안의 넘김이 어긋났을 때). 기록은 `system` + 일으킨 것
 *   부서장 없음  마감 뒤 최종본(HM-34)의 **지금 파일**을 넘긴다 — 담당자의 저장이 그 단위의 마지막 판단이다(§12 Q8). `basis=no_head`
 * 3단계가 꺼져 있거나 기여 단위가 아니면 아무것도 하지 않는다(RU-79). 넘겼으면 그 사본.
 */
export async function syncUnit(divisionId: string, slot: WeekSlot, ctx: AutoCause): Promise<ReportSubmission | null> {
  if (!(await rollupEnabled())) return null;
  const target = await unitTarget(divisionId);
  if (!target) return null;
  return withUnitLock(divisionId, slot.id, async () => {
    const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId } });
    if (await hasHead(divisionId)) {
      const latest = await latestUnitReview(divisionId, slot.id);
      if (!latest) return null;
      const review = await ensureFrozen(latest, division.slug, slot);
      if (!review) return null;
      const size = await verifiedSize(review.filePath, review.sha256);
      if (size === null) return null;
      let sub: ReportSubmission | null = null;
      try {
        sub = await prisma.$transaction((tx) =>
          handOffReviewTx(tx, review, 'unit', { submittedBy: SYSTEM, cause: ctx.cause, sourceRunId: review.mergeRunId, byteSize: size }),
        );
      } catch (e) {
        if (!isUniqueClash(e)) throw e;
      }
      if (sub) await auditSubmit(SYSTEM, sub, { isoKey: slot.isoKey, auto: true, reviewId: review.id, approvedBy: review.reviewerId, causedBy: ctx.causedBy, target: targetLabel(target) });
      return sub;
    }

    // 부서장 없음 — 마감 뒤 최종본만. 마감 전 미리보기는 올리지 않는다(아직 낼 사람이 남아 있다)
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null }, startedAt: { gte: effectiveDeadline(slot, division) } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run?.outputPath) return null;
    let bytes: Buffer;
    try {
      bytes = await readStoredFile(run.outputPath);
    } catch {
      return null;
    }
    const digest = sha256(bytes);
    const cur = await currentReport(divisionId, slot.id, 'unit');
    if (cur && cur.sha256 === digest && cur.basis === 'no_head') return null; // 같은 바이트 — RU-02
    const frozen = await freeze(division.slug, slot, 'unit', bytes);
    const sub = await prisma.reportSubmission.create({
      data: {
        level: 'unit',
        divisionId,
        weekSlotId: slot.id,
        filePath: frozen.filePath,
        sha256: frozen.sha256,
        byteSize: frozen.byteSize,
        sourceRunId: run.id,
        submittedBy: SYSTEM,
        submittedAt: new Date(),
        basis: 'no_head',
        cause: ctx.cause,
      },
    });
    await auditSubmit(SYSTEM, sub, { isoKey: slot.isoKey, auto: true, causedBy: ctx.causedBy, replaced: cur?.id ?? null, target: targetLabel(target) });
    return sub;
  });
}

/**
 * RU-77 — **비상구: 승인 없이 올리기** (실·팀 lead). 승인할 사람이 자리에 없는 날의 길이다. 게이트(`requireHandoffEscape`)는 사람을,
 * 여기는 업무 규칙(409)을 본다: 기한 15분 전부터 · 마감 뒤 최종본만 · 지금 판이 이미 올라가 있지 않을 때만.
 * 위에서는 주황 「부서장 승인 없이」로 보인다(`basis=unapproved`). 나중에 부서장이 승인하면 승인한 판이 대신한다.
 */
export async function escapeUnit(scope: Scope, slot: WeekSlot, now = new Date()): Promise<Handoff> {
  const division = scope.division; // TACP-6 — 신원의 부서
  const target = await unitTarget(division.id);
  if (!target) throw notFound();
  return withUnitLock(division.id, slot.id, async () => {
    if (!(await hasHead(division.id))) {
      throw new HttpError(409, 'no_head', '부서장 승인 단계가 없는 부서입니다 — 마감 뒤 병합본이 저절로 올라갑니다.');
    }
    const t = await stageTimes(slot);
    const due = unitDue(t, target);
    const opens = escapeOpensAt(due);
    if (now < opens) {
      throw new HttpError(409, 'too_early', `승인 없이 올리기는 기한(${toKstIso(due).slice(11, 16)}) ${ESCAPE_MINUTES}분 전부터 열립니다.`);
    }
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run?.outputPath) throw new HttpError(409, 'no_merge', '아직 병합본이 없습니다.');
    if (run.startedAt < effectiveDeadline(slot, division)) {
      throw new HttpError(409, 'not_final', '마감 전 미리보기는 올릴 수 없습니다 — 마감 뒤 병합본을 기다려 주세요.');
    }
    const bytes = await readStoredFile(run.outputPath);
    const digest = sha256(bytes);
    const cur = await currentReport(division.id, slot.id, 'unit');
    const approved = await latestUnitReview(division.id, slot.id);
    if (alreadyUp(cur, approved, digest)) {
      throw new HttpError(409, 'already_sent', '지금 판은 이미 올라가 있습니다.');
    }
    const frozen = await freeze(division.slug, slot, 'unit', bytes);
    const submission = await prisma.reportSubmission.create({
      data: {
        level: 'unit',
        divisionId: division.id,
        weekSlotId: slot.id,
        filePath: frozen.filePath,
        sha256: frozen.sha256,
        byteSize: frozen.byteSize,
        sourceRunId: run.id,
        submittedBy: scope.user.id,
        submittedAt: new Date(),
        basis: 'unapproved',
        cause: 'escape',
      },
    });
    await auditSubmit(scope.user.email, submission, { isoKey: slot.isoKey, replaced: cur?.id ?? null, target: targetLabel(target) });
    return { submission, target: targetLabel(target) };
  });
}

// ── 본부 ────────────────────────────────────────────────

/** 가장 최근 성공한 본부본 — 본부장이 보는 「지금 판」 */
export function latestHqRun(nodeId: string, weekSlotId: string) {
  return prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId: nodeId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
}

function latestHqReview(nodeId: string, weekSlotId: string) {
  return prisma.mergeReview.findFirst({ where: { divisionId: nodeId, weekSlotId, ...HQ_REVIEW }, orderBy: NEWEST_FIRST });
}

async function runSha(run: Pick<RollupRun, 'outputPath'>): Promise<{ sha: string; size: number } | null> {
  if (!run.outputPath) return null;
  try {
    const bytes = await readStoredFile(run.outputPath);
    return { sha: sha256(bytes), size: bytes.length };
  } catch {
    return null;
  }
}

/**
 * RU-55 · RU-70 — **본부장 승인 = 총괄로 제출.** 승인은 **본 판에만** 붙는다: 화면이 그린 본부본의 runId·sha를 함께 받고, 그 사이
 * 자동으로 다시 이어 붙었으면 409 — 예전에는 「최신 본부본」에 붙어 화면을 연 뒤 다시 만든 판이 보지도 않고 승인될 수 있었다.
 * 승인 기록과 본부 사본을 한 트랜잭션에서 만든다(actor = 본부장). `hq:` 잠금 안에서 — 조립과 엇갈리지 않는다.
 * 본부 담당자에게 알리지 않는다 — 받을 사람이 할 일이 없다(RU-55 개정).
 */
export async function approveHq(
  scope: Scope,
  node: RollupNode,
  slot: WeekSlot,
  viewed: { runId?: unknown; sha256?: unknown } | null | undefined,
): Promise<{ unchanged: boolean; handedOff: { target: string; at: Date } | null }> {
  return withLock(hqLockKey(node.node.id, slot.id), async () => {
    const run = await latestHqRun(node.node.id, slot.id);
    const file = run ? await runSha(run) : null;
    if (!run || !file) throw new HttpError(409, 'no_rollup', '아직 이어 붙인 본부본이 없습니다.');
    if (!viewed || viewed.runId !== run.id || viewed.sha256 !== file.sha) {
      throw new HttpError(409, 'rollup_changed', '본부본이 바뀌었어요 — 다시 열어 확인해 주세요');
    }
    const last = await latestHqReview(node.node.id, slot.id);
    // 같은 판 두 번은 하나로 — 단, 그 승인 뒤 비상구로 다른 판이 총괄에 가 있으면 지금 승인은 새 결정이다 (RU-T134)
    if (last && last.sha256 === file.sha && !(await supersededSince(node.node.id, slot.id, 'hq', file.sha))) {
      // 같은 판 두 번 — 승인을 또 만들지 않는다. 넘김이 어긋나 있었으면(드문 일) 그 승인으로 맞춘다
      const sub = await catchUpHqApproval(node, slot, { cause: 'catch_up', causedBy: scope.user.email });
      return { unchanged: true, handedOff: sub ? { target: '총괄', at: sub.submittedAt } : null };
    }
    const { review, submission } = await prisma.$transaction(async (tx) => {
      const review = await tx.mergeReview.create({
        data: {
          divisionId: node.node.id,
          weekSlotId: slot.id,
          mergeRunId: run.id,
          reviewerId: scope.user.id,
          kind: 'hq_approve',
          sha256: file.sha,
          filePath: run.outputPath,
          createdAt: new Date(),
        },
      });
      const submission = await handOffReviewTx(tx, { ...review, filePath: run.outputPath! }, 'hq', {
        submittedBy: scope.user.id,
        cause: 'approval',
        sourceRunId: run.id,
        byteSize: file.size,
      });
      return { review, submission };
    });
    await audit(scope.user.email, 'rollup', node.node.id, `rollup:${run.id}`, { action: 'approve', review: review.id, sha256: file.sha });
    if (submission) await auditSubmit(scope.user.email, submission, { isoKey: slot.isoKey, auto: true, reviewId: review.id, target: '총괄' });
    return { unchanged: false, handedOff: submission ? { target: '총괄', at: submission.submittedAt } : null };
  });
}

/** 가장 최근 본부장 승인이 아직 안 넘어갔으면 넘긴다 (`system`). `hq:` 잠금 안에서 부른다 */
async function catchUpHqApproval(node: RollupNode, slot: WeekSlot, ctx: AutoCause): Promise<ReportSubmission | null> {
  const review = await latestHqReview(node.node.id, slot.id);
  if (!review) return null;
  const run = await prisma.rollupRun.findUnique({ where: { id: review.mergeRunId } });
  const filePath = review.filePath ?? run?.outputPath ?? null;
  if (!filePath) return null;
  const size = await verifiedSize(filePath, review.sha256);
  if (size === null) return null;
  let sub: ReportSubmission | null = null;
  try {
    sub = await prisma.$transaction((tx) =>
      handOffReviewTx(tx, { ...review, filePath }, 'hq', { submittedBy: SYSTEM, cause: ctx.cause, sourceRunId: review.mergeRunId, byteSize: size }),
    );
  } catch (e) {
    if (!isUniqueClash(e)) throw e;
  }
  if (sub) await auditSubmit(SYSTEM, sub, { isoKey: slot.isoKey, auto: true, reviewId: review.id, approvedBy: review.reviewerId, causedBy: ctx.causedBy, target: '총괄' });
  return sub;
}

/**
 * RU-71 — 본부 사본 **맞추기**. `hq:` 잠금을 쥔 채로 부른다(조립 직후 — auto.ts).
 *   본부장 있음  가장 최근 승인이 안 넘어갔으면 넘긴다(따라잡기)
 *   본부장 없음  지금 본부본이 곧 넘김이다 — 다시 만들어질 때마다 `basis=no_head` (`system`)
 * 넘겼으면 그 사본.
 */
export async function syncHqHandoffLocked(node: RollupNode, slot: WeekSlot, ctx: AutoCause): Promise<ReportSubmission | null> {
  if (await hasHead(node.node.id)) return catchUpHqApproval(node, slot, ctx);
  const run = await latestHqRun(node.node.id, slot.id);
  const file = run ? await runSha(run) : null;
  if (!run || !file) return null;
  const cur = await currentReport(node.node.id, slot.id, 'hq');
  if (cur && cur.sha256 === file.sha && cur.basis === 'no_head') return null;
  const sub = await prisma.reportSubmission.create({
    data: {
      level: 'hq',
      divisionId: node.node.id,
      weekSlotId: slot.id,
      filePath: run.outputPath!,
      sha256: file.sha,
      byteSize: file.size,
      sourceRunId: run.id,
      submittedBy: SYSTEM,
      submittedAt: new Date(),
      basis: 'no_head',
      cause: ctx.cause,
    },
  });
  await auditSubmit(SYSTEM, sub, { isoKey: slot.isoKey, auto: true, causedBy: ctx.causedBy, replaced: cur?.id ?? null, target: '총괄' });
  return sub;
}

/**
 * RU-77 — 본부 비상구 「본부장 승인 없이 총괄로」(본부 lead). 「본부 → 총괄」 기한 15분 전부터, 지금 본부본이 승인되지 않았고
 * 아직 올라가 있지 않을 때만. 총괄 화면에 주황 「본부장 승인 없이」. 나중에 본부장이 승인하면 승인한 판이 대신한다.
 */
export async function escapeHq(scope: Scope, node: RollupNode, slot: WeekSlot, now = new Date()): Promise<Handoff> {
  return withLock(hqLockKey(node.node.id, slot.id), async () => {
    if (!(await hasHead(node.node.id))) {
      throw new HttpError(409, 'no_head', '본부장 승인 단계가 없는 본부입니다 — 본부본이 저절로 총괄에 올라갑니다.');
    }
    const t = await stageTimes(slot);
    if (now < escapeOpensAt(t.hqDue)) {
      throw new HttpError(409, 'too_early', `승인 없이 올리기는 기한(${toKstIso(t.hqDue).slice(11, 16)}) ${ESCAPE_MINUTES}분 전부터 열립니다.`);
    }
    const run = await latestHqRun(node.node.id, slot.id);
    const file = run ? await runSha(run) : null;
    if (!run || !file) throw new HttpError(409, 'no_rollup', '아직 이어 붙인 본부본이 없습니다.');
    const cur = await currentReport(node.node.id, slot.id, 'hq');
    const approved = await latestHqReview(node.node.id, slot.id);
    if (alreadyUp(cur, approved, file.sha)) {
      throw new HttpError(409, 'already_sent', '지금 본부본은 이미 총괄에 올라가 있습니다.');
    }
    const submission = await prisma.reportSubmission.create({
      data: {
        level: 'hq',
        divisionId: node.node.id,
        weekSlotId: slot.id,
        filePath: run.outputPath!,
        sha256: file.sha,
        byteSize: file.size,
        sourceRunId: run.id,
        submittedBy: scope.user.id,
        submittedAt: new Date(),
        basis: 'unapproved',
        cause: 'escape',
      },
    });
    await auditSubmit(scope.user.email, submission, { isoKey: slot.isoKey, replaced: cur?.id ?? null, target: '총괄' });
    return { submission, target: '총괄' };
  });
}
