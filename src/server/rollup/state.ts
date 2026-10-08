// RU-80 — 실·팀 수합 관리의 **「위로」 상태 카드**가 그리는 것. 쓰지 않는다.
//
// 버튼이 아니라 **상태**다 (2026-10-08 · ADR-0015). 실장의 승인이 곧 위로 가는 제출이므로 담당자가 누를 것은 없고,
// 담당자·실장이 알아야 할 것은 「지금 어디까지 갔나」다 — 상태 하나 · 받는 곳 · 기한 · 올라간 시각과 승인한 사람 · 그 뒤의 행방.
import type { Division, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { effectiveDeadline } from '../worklog';
import { NEWEST_FIRST, UNIT_REVIEW, HQ_REVIEW } from '../merge/review-scope';
import { toKstIso } from '@/lib/week';
import { currentReport, fileSha } from './report';
import { escapeClosesAt, escapeOpensAt, hasHead, targetLabel, unitDue, unitTarget } from './handoff';
import { decidesForUnit, lastEditor } from '../merge/edits';
import { rollupEnabled, stageCells, stageTimes } from './schedule';
import { parseOrder } from './tree';

/**
 * 12 §2a 실·팀 상태 기계.
 *   부서장 있음  U0 받는 중 · U1 승인 기다림 · U2 올라감 · U3 승인 뒤 바뀜 · U4 승인 없이 올라감 · Uf 병합본 없음
 *   부서장 없음  H0 받는 중(마감 뒤 저절로) · H1 올라감 · H2 운영자가 고친 판(안 올라감 — 2026-10-08 결정 b) · Hf 병합본 없음
 */
export type UnitHandoffState = 'U0' | 'U1' | 'U2' | 'U3' | 'U4' | 'Uf' | 'H0' | 'H1' | 'H2' | 'Hf';

export interface HandoffTrail {
  /** 본부 도착 (본부 단계가 있을 때) */
  hqArrivedKst: string | null;
  /** 내 사본이 든 본부본을 본부장이 승인한 시각 */
  hqApprovedKst: string | null;
  /** 총괄 도착 — 본부를 거치면 본부본이 총괄에 간 시각, 아니면 내 사본이 간 시각 */
  orgArrivedKst: string | null;
}

export interface HandoffView {
  /** 받는 곳 — 「기획경영본부」 또는 「총괄」 (RU-07) */
  target: string;
  toHq: boolean;
  /** RU-30 — 이 단위의 기한 (본부로 가면 「실·팀 → 본부」, 바로 총괄로 가면 「본부 → 총괄」) */
  dueKo: string;
  hasHead: boolean;
  state: UnitHandoffState;
  /** 지금 위에 가 있는 사본 */
  sent: { id: string; atKst: string; basis: string; by: string } | null;
  /** RU-80 · TACP-21 v1.7 — 내 사본의 행방, **시각만**. 볼 수 없는 사람에게는 null */
  trail: HandoffTrail | null;
  /**
   * RU-77 — 비상구. 이 사람이 쓸 수 있고 지금 상태가 맞을 때만(U1·U3), 그리고 창이 닫히기 전(「본부 → 총괄」 + 24시간 — 결정 a)까지만.
   * `open`이 거짓이면 아직 창 전이다 — 화면은 그리지 않는다. 닫힌 뒤(지난 주차 포함)에는 null
   */
  escape: { open: boolean; opensAtKst: string } | null;
}

const kst = (d: Date) => toKstIso(d).slice(5, 16).replace('T', ' ');

async function nameOf(userId: string): Promise<string> {
  if (userId === 'system') return '자동';
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, jobTitle: true, divisionRole: true } });
  if (!u) return '알 수 없음';
  return u.divisionRole === 'head' ? `${u.name} ${u.jobTitle?.trim() || '부서장'}` : u.name;
}

/** RU-80 — 내 사본이 위에서 어떻게 되었나 (시각만 — 본부본의 내용·다른 단위는 아니다, TACP-21 v1.7) */
async function trailOf(sent: { id: string; submittedAt: Date }, toHq: boolean, nodeId: string | null, slot: WeekSlot): Promise<HandoffTrail> {
  if (!toHq || !nodeId) return { hqArrivedKst: null, hqApprovedKst: null, orgArrivedKst: kst(sent.submittedAt) };
  const runs = await prisma.rollupRun.findMany({
    where: { level: 'hq', divisionId: nodeId, weekSlotId: slot.id, status: 'succeeded' },
    select: { id: true, inputIds: true },
  });
  const mine = runs.filter((r) => parseOrder(r.inputIds).includes(sent.id)).map((r) => r.id);
  const [approval, hqSent] = mine.length
    ? await Promise.all([
        prisma.mergeReview.findFirst({ where: { divisionId: nodeId, weekSlotId: slot.id, mergeRunId: { in: mine }, ...HQ_REVIEW }, orderBy: NEWEST_FIRST }),
        prisma.reportSubmission.findFirst({
          where: { divisionId: nodeId, weekSlotId: slot.id, level: 'hq', withdrawnAt: null, sourceRunId: { in: mine } },
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        }),
      ])
    : [null, null];
  return {
    hqArrivedKst: kst(sent.submittedAt),
    hqApprovedKst: approval ? kst(approval.createdAt) : null,
    orgArrivedKst: hqSent ? kst(hqSent.submittedAt) : null,
  };
}

/**
 * RU-80 — 「위로」 카드. 3단계가 꺼져 있거나 기여 단위가 아니면 부르는 쪽이 그리지 않는다(여기서는 null).
 * `trail` — 행방을 볼 수 있는 사람인가(`canSeeHandoff`). `canEscape` — 비상구를 쓸 수 있는 사람인가(`canUseHandoffEscape`).
 */
export async function unitHandoffView(
  division: Division,
  slot: WeekSlot,
  opts: { trail: boolean; canEscape: boolean; now?: Date },
): Promise<HandoffView | null> {
  const now = opts.now ?? new Date();
  const target = await unitTarget(division.id);
  if (!target) return null;
  const toHq = target.kind === 'hq';
  const deadline = effectiveDeadline(slot, division);
  const [t, head, sentRow, run, review] = await Promise.all([
    stageTimes(slot),
    hasHead(division.id),
    currentReport(division.id, slot.id, 'unit'),
    prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.mergeReview.findFirst({ where: { divisionId: division.id, weekSlotId: slot.id, ...UNIT_REVIEW }, orderBy: NEWEST_FIRST }),
  ]);
  const cells = stageCells(t.anchor, t);
  const due = unitDue(t, target);
  const sha = await fileSha(run?.outputPath);
  const final = !!run && run.startedAt >= deadline;
  const past = now >= deadline;

  let state: UnitHandoffState;
  if (!head) {
    if (sentRow && sha && sentRow.sha256 === sha) state = 'H1';
    else if (past && !final) state = 'Hf';
    // 결정 b — 마감 뒤 최종본을 운영자가 마지막으로 고쳤다. 그 판은 그 단위의 결론이 아니라 올라가지 않는다(syncUnit과 같은 판정)
    else if (run && final && !decidesForUnit(lastEditor(run.reviewJson))) state = 'H2';
    else state = sentRow ? 'H1' : 'H0';
  } else if (sentRow && sha && sentRow.sha256 === sha) {
    state = sentRow.basis === 'unapproved' ? 'U4' : 'U2';
  } else if (sentRow) {
    state = 'U3';
  } else if (!run) {
    state = past ? 'Uf' : 'U0';
  } else {
    state = final || (review && review.sha256 === sha) ? 'U1' : 'U0';
  }

  let by = '';
  if (sentRow) {
    if (sentRow.reviewId) {
      const r = await prisma.mergeReview.findUnique({ where: { id: sentRow.reviewId }, select: { reviewerId: true } });
      by = r ? `${await nameOf(r.reviewerId)} 승인` : '승인';
    } else {
      by = sentRow.basis === 'no_head' ? '자동 (부서장 없음)' : await nameOf(sentRow.submittedBy);
    }
  }
  // 결정 a — 닫힌 뒤에는 그리지 않는다(API는 409 too_late). 열리기 전은 `open: false`로 내려 화면이 숨긴다
  const escapable = opts.canEscape && head && final && (state === 'U1' || state === 'U3') && now <= escapeClosesAt(t);
  const opens = escapeOpensAt(due);
  return {
    target: targetLabel(target),
    toHq,
    dueKo: toHq ? cells.unitDueKo : cells.hqDueKo,
    hasHead: head,
    state,
    sent: sentRow ? { id: sentRow.id, atKst: kst(sentRow.submittedAt), basis: sentRow.basis, by } : null,
    trail: opts.trail && sentRow ? await trailOf(sentRow, toHq, target.kind === 'hq' ? target.node.node.id : null, slot) : null,
    escape: escapable ? { open: now >= opens, opensAtKst: toKstIso(opens).slice(11, 16) } : null,
  };
}

/**
 * RU-80 — 3단계에서 이 부서의 승인이 곧 위로 가는 제출이면 받는 곳(「기획경영본부」·「총괄」), 아니면 null.
 * 부서장 화면의 [고칠 것 없음 · 승인] 옆 「승인하면 바로 ○○에 올라갑니다」와, 승인 뒤 담당자가 고칠 때의 한 줄이 이것을 쓴다.
 */
export async function handoffHint(divisionId: string): Promise<string | null> {
  if (!(await rollupEnabled())) return null;
  const target = await unitTarget(divisionId);
  return target ? targetLabel(target) : null;
}
