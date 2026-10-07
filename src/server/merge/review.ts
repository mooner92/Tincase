// HM-47 · NT-46 — 부서장의 **검토 완료(승인)**를 기록하고, 그 순간 담당자에게 알린다.
//
// 담당자가 기다리는 신호는 「실장이 봤다」 하나다. 그 신호가 사람 입으로만 오가면 언제·무엇을 고쳤는지가
// 사라지고, 제출이 늦어진다(2026-10-07 운영자 요청). 그래서 저장이 곧 승인이고, 승인이 곧 알림이다.
import type { MergeRun, MergeReview, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { logger } from '../logger';
import { env } from '../env';
import { messengerStatus, sendAlert } from '../messenger';
import { readStoredFile, sha256 } from '../storage';
import type { Scope } from '../authz';
import { readWorklog } from '@/lib/hwp/reader';
import { BUCKETS, type BucketKey } from '@/lib/merge-rows';
import { describeChange, summarizeChanges, type DiffRow, type RowChange } from '@/lib/merge-diff';
import { slotKind, toKstIso } from '@/lib/week';

/** 병합본 hwp → 표별 행 (비교용) */
export function worklogRows(buf: Buffer): Record<BucketKey, DiffRow[]> {
  const w = readWorklog(buf).worklog;
  const out = {} as Record<BucketKey, DiffRow[]>;
  for (const b of BUCKETS) {
    out[b] = w[b].map((r) => ({ content: r.content, date: r.date, place: r.place, attendee: r.attendee, emphasis: r.emphasis === true }));
  }
  return out;
}

/** 「홍길동 실장」 — 직책은 ERP에서 온다(DM-19). 없으면 「부서장」 */
function titled(u: { name: string; jobTitle: string | null }): string {
  return `${u.name} ${u.jobTitle?.trim() || '부서장'}`;
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);

/** 알림에 적을 바뀐 곳 줄 수. 팝업이라 길면 안 읽힌다 — 나머지는 화면에서 본다 */
const NOTICE_LINES = 4;

export function approvalMessage(lead: { name: string; employeeNo: string }, reviewer: string, slot: WeekSlot, at: Date, changes: RowChange[]) {
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
      'Tincase에서 받아 취합게시판에 올려주세요.',
    ].join('\n'),
  };
}

/** NT-46 — 승인하는 순간 담당자에게. 부서 알림(NT-30)·본인 설정(NT-20)·사번(NT-01)을 그대로 따른다 */
async function notifyLeads(review: MergeReview, reviewer: string, slot: WeekSlot, changes: RowChange[]) {
  if (!messengerStatus().enabled) return;
  const division = await prisma.division.findUnique({ where: { id: review.divisionId } });
  if (!division?.notifyEnabled) return;
  const leads = await prisma.user.findMany({
    where: { divisionId: division.id, isActive: true, divisionRole: 'lead', notifyEnabled: true, employeeNo: { not: null } },
    select: { name: true, employeeNo: true },
  });
  const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}/manage` : undefined;
  const sent: string[] = [];
  const blocked: string[] = [];
  for (const l of leads) {
    const r = await sendAlert({ recvIds: [l.employeeNo!], ...approvalMessage({ name: l.name, employeeNo: l.employeeNo! }, reviewer, slot, review.createdAt, changes), url });
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
}

/**
 * HM-47 — 승인을 남기고 알린다. 알림이 실패해도 승인은 남는다 — 알림은 승인의 결과이지 조건이 아니다.
 * `bytes`는 승인한 판 그대로의 파일이다(저장 직후의 것).
 */
export async function recordReview(opts: {
  scope: Scope;
  run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId'>;
  slot: WeekSlot;
  kind: 'edit' | 'approve';
  changes: RowChange[];
  bytes: Buffer;
}): Promise<MergeReview> {
  const { scope, run, slot, kind, changes, bytes } = opts;
  const review = await prisma.mergeReview.create({
    data: {
      divisionId: run.divisionId,
      weekSlotId: run.weekSlotId,
      mergeRunId: run.id,
      reviewerId: scope.user.id,
      kind,
      changes: JSON.stringify(changes),
      sha256: sha256(bytes),
    },
  });
  await audit(scope.user.email, 'merge', run.divisionId, `merged:${slot.isoKey}`, {
    action: 'approve',
    kind,
    summary: summarizeChanges(changes),
  });
  try {
    await notifyLeads(review, titled(scope.user), slot, changes);
  } catch (e) {
    logger.error({ err: (e as Error).message, review: review.id }, '[알림] 승인 알림 실패');
  }
  return review;
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
  const review = await prisma.mergeReview.findFirst({ where: { divisionId, weekSlotId }, orderBy: { createdAt: 'desc' } });
  if (!review) return null;
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  let changedAfter = !run || run.id !== review.mergeRunId;
  if (!changedAfter && run?.outputPath) {
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

/** NT-47 — 이 실행(최종본)에 대한 승인이 있나. 마감 뒤 알림이 문구를 고르는 데 쓴다 */
export async function approvalOf(run: Pick<MergeRun, 'id' | 'divisionId' | 'weekSlotId'>) {
  const review = await prisma.mergeReview.findFirst({
    where: { divisionId: run.divisionId, weekSlotId: run.weekSlotId, mergeRunId: run.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!review) return null;
  const who = await prisma.user.findUnique({ where: { id: review.reviewerId }, select: { name: true, jobTitle: true } });
  let changes: RowChange[] = [];
  try {
    changes = JSON.parse(review.changes) as RowChange[];
  } catch {
    changes = [];
  }
  return { by: who ? titled(who) : '부서장', at: review.createdAt, summary: summarizeChanges(changes) };
}
