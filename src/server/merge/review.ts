// HM-47 · NT-46 — 부서장의 **검토 완료(승인)**를 기록하고, 그 순간 담당자에게 알린다.
//
// 담당자가 기다리는 신호는 「실장이 봤다」 하나다. 그 신호가 사람 입으로만 오가면 언제·무엇을 고쳤는지가
// 사라지고, 제출이 늦어진다(2026-10-07 운영자 요청). 그래서 저장이 곧 승인이고, 승인이 곧 알림이다.
//
// 2026-10-08(ADR-0015) — 3단계에서는 **승인이 곧 위로 가는 제출**이다. 승인 기록과 사본은 rollup/handoff.ts가 한 트랜잭션에서
// 만든다(사본을 만드는 곳은 거기 하나 — TACP-23). 이 파일은 승인의 앞뒤(본 판 확인·알림)를 맡는다.
import type { Division, MergeRun, MergeReview, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { logger } from '../logger';
import { env } from '../env';
import { messengerStatus, sendAlert } from '../messenger';
import { claimNotice, settleNotice } from '../notify/claim';
import { readStoredFile, sha256 } from '../storage';
import { HttpError, type Scope } from '../authz';
import { readWorklog } from '@/lib/hwp/reader';
import { BUCKETS, type BucketKey } from '@/lib/merge-rows';
import { describeChange, summarizeChanges, type DiffRow, type RowChange } from '@/lib/merge-diff';
import { slotKind, toKstIso } from '@/lib/week';
import { NEWEST_FIRST, UNIT_REVIEW } from './review-scope';
import type { Frozen } from '../rollup/handoff';

export { UNIT_REVIEW };

/** 병합본 hwp → 표별 행 (비교용) */
export function worklogRows(buf: Buffer): Record<BucketKey, DiffRow[]> {
  const w = readWorklog(buf).worklog;
  const out = {} as Record<BucketKey, DiffRow[]>;
  for (const b of BUCKETS) {
    out[b] = w[b].map((r) => ({ content: r.content, date: r.date, place: r.place, attendee: r.attendee, emphasis: r.emphasis === true }));
  }
  return out;
}

/** 「홍길동 실장」 — 직책은 ERP에서 온다(DM-19). 없으면 「부서장」. 고친 기록(HM-49)도 같은 이름을 쓴다 */
export function titled(u: { name: string; jobTitle: string | null }): string {
  return `${u.name} ${u.jobTitle?.trim() || '부서장'}`;
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);

/** 알림에 적을 바뀐 곳 줄 수. 팝업이라 길면 안 읽힌다 — 나머지는 화면에서 본다 */
const NOTICE_LINES = 4;

/**
 * NT-46 · NT-46′ — 승인 알림. 3단계에서 승인이 곧 제출이면(`handedOffTo`) 끝 줄이 「○○에 자동으로 올라갔어요」다 —
 * 담당자가 할 일(취합게시판에 올리기)이 없어졌다. 꺼져 있으면 지금 문구 그대로.
 */
export function approvalMessage(
  lead: { name: string; employeeNo: string },
  reviewer: string,
  slot: WeekSlot,
  at: Date,
  changes: RowChange[],
  handedOffTo: string | null = null,
) {
  const label = `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;
  const lines = changes.slice(0, NOTICE_LINES).map((c) => `· ${describeChange(c)}`);
  if (changes.length > NOTICE_LINES) lines.push(`· 외 ${changes.length - NOTICE_LINES}곳`);
  return {
    subject: `[Tincase] ${label} 병합본 — ${reviewer}님 승인 완료`,
    contents: [
      `[${lead.employeeNo}]${lead.name}님 ${reviewer}님이 ${hhmm(at)}에 ${label} 병합본 검토를 마쳤어요 — 승인 완료.`,
      '',
      changes.length ? `바뀐 곳: ${summarizeChanges(changes)}` : '고친 곳 없이 승인했어요.',
      ...lines,
      '',
      handedOffTo ? `${handedOffTo}에 자동으로 올라갔어요.` : 'Tincase에서 받아 취합게시판에 올려주세요.',
    ].join('\n'),
  };
}

/** 승인 알림을 몇 명에게 보냈나 — 화면이 「알렸습니다」를 사실대로 말하게 한다 */
export interface NotifyResult {
  /** 실제로 나간 사람 수 */
  sent: number;
  /** 보낼 대상(알림을 켠 담당자) 수 */
  targets: number;
}

/**
 * NT-46 — 승인하는 순간 담당자에게. 부서 알림(NT-30)·본인 설정(NT-20)·사번(NT-01)을 그대로 따른다.
 * **몇 명에게 나갔는지 돌려준다** — 알림이 꺼진 부서에서도 화면이 「담당자에게 알렸습니다」라고
 * 말하던 결함이 있었다(2026-10-07 리뷰). 보내지 않았으면 0이다.
 */
async function notifyLeads(review: MergeReview, reviewer: string, slot: WeekSlot, changes: RowChange[], handedOffTo: string | null): Promise<NotifyResult> {
  if (!messengerStatus().enabled) return { sent: 0, targets: 0 };
  const division = await prisma.division.findUnique({ where: { id: review.divisionId } });
  if (!division?.notifyEnabled) return { sent: 0, targets: 0 };
  const leads = await prisma.user.findMany({
    where: { divisionId: division.id, isActive: true, divisionRole: 'lead', notifyEnabled: true, employeeNo: { not: null } },
    select: { name: true, employeeNo: true },
  });
  const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}/manage` : undefined;
  const sent: string[] = [];
  const blocked: string[] = [];
  for (const l of leads) {
    const r = await sendAlert({
      recvIds: [l.employeeNo!],
      ...approvalMessage({ name: l.name, employeeNo: l.employeeNo! }, reviewer, slot, review.createdAt, changes, handedOffTo),
      url,
    });
    sent.push(...r.sent);
    blocked.push(...r.blocked);
  }
  if (sent.length) {
    // 한 주에 여러 번 승인할 수 있다 — 종류에 승인 id를 붙여 (부서·주차·종류) 유니크를 피한다
    await prisma.notifyLog.create({
      data: {
        divisionId: division.id,
        weekSlotId: slot.id,
        kind: `merge_approved:${review.id}`,
        recipients: JSON.stringify(sent),
        detail: JSON.stringify({ blocked, targets: leads.length }),
      },
    });
  }
  return { sent: sent.length, targets: leads.length };
}

/**
 * HM-47 — 승인·저장은 **화면에서 본 판**에 대해서만 한다. 연 뒤에 다시 병합했거나 누가 고쳐 저장했으면 409.
 *
 * 판은 (실행 id, 파일 sha256)로 짚는다. 실행 id만 보면 담당자가 같은 실행의 파일을 고친 것(API-50)을
 * 못 잡고, sha만 보면 다시 병합해 우연히 같은 파일이 된 경우를 구별하지 못한다.
 * 부서장이 보지 않은 판에 「승인」이 붙거나, 옛 화면이 방금 저장된 것을 덮어쓰는 일을 막는다.
 */
export function requireViewedVersion(
  run: Pick<MergeRun, 'id'>,
  currentSha: string,
  viewed: { runId?: unknown; sha256?: unknown } | null | undefined,
): void {
  if (!viewed || viewed.runId !== run.id || viewed.sha256 !== currentSha) {
    throw new HttpError(409, 'merged_changed', '병합본이 바뀌었어요 — 다시 열어 확인해 주세요');
  }
}

/**
 * HM-47 — **이 판**을 이미 승인했나. 같은 판을 두 번 승인하면 담당자에게 알림이 두 번 간다 —
 * [승인]을 두 번 누른 것도, 부서장이 아무것도 안 바꾸고 [수정 저장]을 한 번 더 누른 것도 같은 일이다.
 * HM-56a (2026-10-08) — 판은 **내용**(sha)이다. 가장 최근 승인의 sha가 같으면 실행 번호가 달라도 같은 판이다 — 같은 입력으로
 * 다시 병합해 바이트가 같은 병합본에 [승인]을 또 누르면 「이미 승인한 판」이다.
 */
export async function alreadyApproved(run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId'>, sha: string): Promise<boolean> {
  const last = await prisma.mergeReview.findFirst({
    where: { divisionId: run.divisionId, weekSlotId: run.weekSlotId, ...UNIT_REVIEW },
    orderBy: NEWEST_FIRST,
  });
  return !!last && last.sha256 === sha;
}

/**
 * HM-47 — 승인을 남기고 알린다. 알림이 실패해도 승인은 남는다 — 알림은 승인의 결과이지 조건이 아니다.
 * `frozen`은 승인한 판 그대로의 **불변 사본**이다 — 부르는 쪽이 본 판을 확인한 그 바이트로 **맨 먼저** 썼다(RU-73).
 * 3단계면 같은 트랜잭션에서 위로 가는 사본이 생긴다(`handedOff` — handoff.ts). 부르는 쪽이 `unit:` 잠금을 쥐고 있다.
 */
export async function recordReview(opts: {
  scope: Scope;
  run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId'>;
  slot: WeekSlot;
  kind: 'edit' | 'approve';
  changes: RowChange[];
  frozen: Frozen;
}): Promise<{ review: MergeReview; notified: NotifyResult; handedOff: { target: string; at: Date; submissionId: string } | null }> {
  const { scope, run, slot, kind, changes, frozen } = opts;
  // 정적으로 이으면 merge-notices → review → handoff → schedule → slot-deadline → merge-notices 고리가 된다
  const { commitUnitApproval } = await import('../rollup/handoff');
  const { review, handoff } = await commitUnitApproval({ scope, run, slot, kind, changes, frozen });
  await audit(scope.user.email, 'merge', run.divisionId, `merged:${slot.isoKey}`, {
    action: 'approve',
    kind,
    summary: summarizeChanges(changes),
    review: review.id,
    sha256: frozen.sha256,
  });
  let notified: NotifyResult = { sent: 0, targets: 0 };
  try {
    notified = await notifyLeads(review, titled(scope.user), slot, changes, handoff?.target ?? null);
  } catch (e) {
    logger.error({ err: (e as Error).message, review: review.id }, '[알림] 승인 알림 실패');
  }
  return {
    review,
    notified,
    handedOff: handoff ? { target: handoff.target, at: handoff.submission.submittedAt, submissionId: handoff.submission.id } : null,
  };
}

/**
 * NT-52 — 부서장 「다시 승인해 주세요」의 NotifyLog 종류. **승인마다 하나** (2026-10-08 결정 e — 예전에는 새 판(sha)마다).
 * 다시 승인하기 전에 담당자가 또 고치거나 늦게 낸 사람으로 다시 병합해도 부서장이 할 일은 하나(다시 승인)다 — 판마다 보내면 같은 할 일이
 * 여러 번 가고, 같은 할 일을 여러 번 알리는 알림은 곧 무시된다. 본부장의 RU-55a(`ru_hq_reapprove:<승인 id>`)와 같은 단위다.
 * 마감 뒤 검토 요청(NT-40)도 가장 최근 승인의 이 기록을 보고 겹치지 않는다(NT-T66).
 */
export const reapproveKind = (reviewId: string) => `merge_reapprove:${reviewId}`;

/** NT-52 — 무엇이 판을 바꿨나 */
export type ReapproveReason = { kind: 'edit'; places: number } | { kind: 'merge'; late: number };

/** NT-52 — 부서장: 승인 뒤 병합본이 바뀌었다. 다시 승인하면 올라간다 */
export function reapproveMessage(p: { name: string; employeeNo: string }, slot: WeekSlot, target: string, reason: ReapproveReason) {
  const label = `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;
  const what =
    reason.kind === 'edit'
      ? `담당자가 승인 뒤 병합본을 ${reason.places}곳 고쳤어요.`
      : `승인 뒤 병합본이 다시 병합됐어요${reason.late > 0 ? `(늦게 낸 ${reason.late}명 포함)` : ''}.`;
  return {
    subject: `[Tincase] ${label} 병합본 — 다시 승인해 주세요`,
    contents: [
      `[${p.employeeNo}]${p.name}님 ${what}`,
      `${target}에는 승인한 판이 그대로 있어요.`,
      '',
      `Tincase 수합 관리에서 확인하고 다시 승인하면 바로 ${target}에 올라갑니다.`,
    ].join('\n'),
  };
}

/**
 * NT-52 · HM-47 (2026-10-08) — 3단계에서 **승인 뒤 병합본이 바뀌면**(담당자 수정 저장·다시 병합) 부서장에게 한 번.
 * **승인마다 한 번**이다(`merge_reapprove:<승인 id>` — 결정 e). 담당자의 저장은 위로 가지 않으므로(승인이 아니다), 바뀐 판이
 * 올라가려면 부서장이 다시 승인해야 한다 — 부서장이 그 사실을 화면을 열기 전에 알아야 한다. 다시 승인한 뒤 또 바뀌면 그 새 승인에 대해 한 번.
 * 기록은 보내기 전에 잡는다(결정 f — 병합 뒤 맞추기와 저장 뒤 맞추기가 겹쳐도 한 번).
 * 부서 알림 스위치(NT-30)·3단계 스위치(RU-52)·메신저(RU-41)를 따른다. 보냈으면 나간 사람 수, 아니면 0.
 */
export async function notifyReapprove(division: Division, slot: WeekSlot, target: string, reason: ReapproveReason): Promise<number> {
  if (!messengerStatus().enabled || !division.notifyEnabled) return 0;
  const review = await prisma.mergeReview.findFirst({ where: { divisionId: division.id, weekSlotId: slot.id, ...UNIT_REVIEW }, orderBy: NEWEST_FIRST });
  if (!review) return 0; // 승인한 적이 없으면 「다시」가 아니다 — 마감 뒤 검토 요청(NT-40)이 맡는다
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) return 0;
  let sha: string;
  try {
    sha = sha256(await readStoredFile(run.outputPath));
  } catch {
    return 0;
  }
  if (sha === review.sha256) return 0; // 같은 판 — 승인이 그대로 유효하다
  const kind = reapproveKind(review.id);
  if (await prisma.notifyLog.findFirst({ where: { divisionId: division.id, weekSlotId: slot.id, kind } })) return 0;
  const heads = await prisma.user.findMany({
    where: { divisionId: division.id, isActive: true, divisionRole: 'head', notifyEnabled: true, employeeNo: { not: null } },
    select: { name: true, employeeNo: true },
  });
  if (heads.length === 0) return 0;
  const claim = await claimNotice(division.id, slot.id, kind, { reason, sha: sha.slice(0, 12) });
  if (!claim) return 0; // 다른 맞추기가 이 승인에 대해 이미 보냈거나 보내는 중
  const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}/manage` : undefined;
  const sent: string[] = [];
  const blocked: string[] = [];
  try {
    for (const h of heads) {
      const r = await sendAlert({ recvIds: [h.employeeNo!], ...reapproveMessage({ name: h.name, employeeNo: h.employeeNo! }, slot, target, reason), url });
      sent.push(...r.sent);
      blocked.push(...r.blocked);
    }
  } finally {
    await settleNotice(claim, sent, { reason, sha: sha.slice(0, 12), blocked, targets: heads.length });
  }
  return sent.length;
}

export interface ReviewView {
  by: string;
  atKst: string;
  kind: 'edit' | 'approve';
  summary: string;
  lines: string[];
  /** 승인한 뒤 병합본이 바뀌었다 — 다시 병합했거나 담당자가 고쳤다 */
  changedAfter: boolean;
}

/** 지금 병합본에 대한 가장 최근 승인. 병합본이 없거나 승인 전이면 null */
export async function latestReview(divisionId: string, weekSlotId: string): Promise<ReviewView | null> {
  const review = await prisma.mergeReview.findFirst({ where: { divisionId, weekSlotId, ...UNIT_REVIEW }, orderBy: NEWEST_FIRST });
  if (!review) return null;
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  // HM-56a — 승인은 실행 번호가 아니라 **내용**에 묶인다. 같은 입력으로 다시 병합해 바이트가 같으면 승인은 그대로다(예전에는 실행 번호가
  // 다르다는 것만으로 「승인 뒤 바뀜」이었다 — 시뮬레이션 p06). 내용이 다르면 실행이 같아도(담당자 수정 저장) 「승인 뒤 바뀜」이다
  let changedAfter = true;
  if (run?.outputPath) {
    try {
      changedAfter = sha256(await readStoredFile(run.outputPath)) !== review.sha256;
    } catch {
      changedAfter = true;
    }
  }
  const who = await prisma.user.findUnique({ where: { id: review.reviewerId }, select: { name: true, jobTitle: true } });
  let changes: RowChange[] = [];
  try {
    changes = JSON.parse(review.changes) as RowChange[];
  } catch {
    changes = [];
  }
  return {
    by: who ? titled(who) : '부서장',
    atKst: toKstIso(review.createdAt).slice(5, 16).replace('T', ' '),
    kind: review.kind === 'approve' ? 'approve' : 'edit',
    summary: summarizeChanges(changes),
    lines: changes.map(describeChange),
    changedAfter,
  };
}

/**
 * NT-47 — 이 실행(최종본)의 병합본에 대한 승인이 있나. 마감 뒤 알림이 문구를 고르는 데 쓴다.
 * HM-56a (2026-10-08) — 그 부서·주차의 **가장 최근 승인**을 보고, 그 승인의 sha가 이 병합본과 같으면 유효하다. 실행 번호는 보지 않는다 —
 * 승인 뒤 같은 입력으로 다시 병합해 바이트가 같으면 +10분 검토 요청을 다시 보내지 않고 +30분 안내는 「승인 완료」라고 한다.
 * 다른 판을 승인했었으면 `changedAfter` — 「승인한 뒤 병합본이 바뀌었어요」(마감 전 미리보기를 승인했는데 최종본이 다를 때도).
 */
export async function approvalOf(run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId' | 'outputPath'>) {
  const review = await prisma.mergeReview.findFirst({
    where: { divisionId: run.divisionId, weekSlotId: run.weekSlotId, ...UNIT_REVIEW },
    orderBy: NEWEST_FIRST,
  });
  if (!review) return null;
  /*
   * 승인한 **판**인가 — 담당자가 같은 실행의 파일을 고치면(API-50) 실행 id는 그대로다.
   * 화면(`latestReview`)은 sha로 「승인 뒤 바뀜」을 보이는데 알림만 「승인 완료」라고 하면 둘이 갈라진다.
   * 파일을 못 읽으면 같은 실행에 대한 승인만 믿는다 — 판을 확인할 수 없으니 실행 번호가 마지막 근거다.
   */
  let changedAfter = review.mergeRunId !== run.id;
  if (run.outputPath) {
    try {
      changedAfter = sha256(await readStoredFile(run.outputPath)) !== review.sha256;
    } catch {
      changedAfter = true;
    }
  }
  const who = await prisma.user.findUnique({ where: { id: review.reviewerId }, select: { name: true, jobTitle: true } });
  let changes: RowChange[] = [];
  try {
    changes = JSON.parse(review.changes) as RowChange[];
  } catch {
    changes = [];
  }
  return { by: who ? titled(who) : '부서장', at: review.createdAt, summary: summarizeChanges(changes), changedAfter };
}
