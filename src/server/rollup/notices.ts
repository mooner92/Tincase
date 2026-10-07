// RU-54~57 — 3단계 알림과 본부장 승인. 시각은 전부 그 주의 기준 시각에서 계산한다(RU-50) —
// 총괄이 연휴로 마감을 옮기면 여기 알림도 같은 간격으로 따라간다.
//
// 부서 알림 스위치(NT-30)가 아니라 **3단계 스위치(RU-52)**를 따른다. 본부 단계만 하는 본부(기획경영본부)는
// 부서원 마감 알림을 끄되 본부 담당자에게는 이 알림이 가야 하기 때문이다. 본인 설정(NT-20)·사번(NT-01)은 그대로.
import type { WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { logger } from '../logger';
import { env } from '../env';
import { HttpError, type Scope } from '../authz';
import { messengerStatus, sendAlert } from '../messenger';
import { readStoredFile, sha256 } from '../storage';
import { ensureCurrentSlot } from '../worklog';
import { weekAnchor } from '../slot-deadline';
import { formatDeadlineKo, slotKind, toKstIso } from '@/lib/week';
import { currentReport } from './report';
import { loadOrgSetting, loadTree, type RollupNode } from './tree';
import { stagesFrom } from './schedule';

const WINDOW_MINUTES = 12; // 스케줄러 주기보다 넉넉하게 — 반드시 한 번 걸린다 (NT-40과 같다)
/** RU-56 — 본부 제출 기한 몇 분 전에 재촉하나 */
export const HQ_DUE_SOON_MINUTES = 15;

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);

interface Person {
  id: string;
  name: string;
  employeeNo: string;
  divisionId: string;
}

async function people(where: { divisionId?: string; divisionRole?: string; isCoordinator?: boolean }): Promise<Person[]> {
  const us = await prisma.user.findMany({
    where: { ...where, isActive: true, notifyEnabled: true, employeeNo: { not: null } },
    select: { id: true, name: true, employeeNo: true, divisionId: true },
  });
  return us.map((u) => ({ ...u, employeeNo: u.employeeNo! }));
}

async function deliver(kind: string, divisionId: string, slot: WeekSlot, to: Person[], msg: (p: Person) => { subject: string; contents: string }, url?: string) {
  if (await prisma.notifyLog.findFirst({ where: { divisionId, weekSlotId: slot.id, kind } })) return null;
  if (to.length === 0) return null;
  const sent: string[] = [];
  const blocked: string[] = [];
  for (const p of to) {
    const r = await sendAlert({ recvIds: [p.employeeNo], ...msg(p), url });
    sent.push(...r.sent);
    blocked.push(...r.blocked);
  }
  if (sent.length) {
    await prisma.notifyLog.create({
      data: { divisionId, weekSlotId: slot.id, kind, recipients: JSON.stringify(sent), detail: JSON.stringify({ blocked, targets: to.length }) },
    });
  }
  return { kind, sent: sent.length, targets: to.length };
}

const link = (path: string) => (env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}${path}` : undefined);

/** RU-54 — 본부 담당자: 산하 제출 현황 */
export function hqCollectMessage(p: { name: string; employeeNo: string }, slot: WeekSlot, node: string, sent: string[], missing: string[]) {
  const label = `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;
  return {
    subject: `[Tincase] ${node} 산하 ${sent.length}/${sent.length + missing.length}곳 제출 — 이어 붙여 주세요`,
    contents: [
      `[${p.employeeNo}]${p.name}님 ${label} 실·팀 제출 기한이 됐어요.`,
      '',
      `제출 ${sent.length}곳${sent.length ? `: ${sent.join('·')}` : ''}`,
      ...(missing.length ? [`아직 ${missing.length}곳: ${missing.join('·')}`] : []),
      '',
      'Tincase 본부 취합에서 이어 붙여 본부장 검토를 받아주세요.',
    ].join('\n'),
  };
}

/** RU-56 — 본부 담당자: 총괄 제출 기한 임박 */
export function hqDueSoonMessage(p: { name: string; employeeNo: string }, slot: WeekSlot, due: Date) {
  return {
    subject: `[Tincase] ${slot.label} 총괄 제출 ${HQ_DUE_SOON_MINUTES}분 전이에요`,
    contents: [
      `[${p.employeeNo}]${p.name}님 ${hhmm(due)}까지 본부본을 총괄에 제출해야 해요.`,
      '',
      '본부장 검토가 끝났으면 Tincase 본부 취합에서 [총괄에 제출]을 눌러주세요.',
    ].join('\n'),
  };
}

/** RU-57 — 총괄: 도착 현황 */
export function orgArrivalMessage(p: { name: string; employeeNo: string }, slot: WeekSlot, arrived: string[], missing: string[]) {
  return {
    subject: `[Tincase] ${slot.label} ${arrived.length}/${arrived.length + missing.length}곳 도착 — 전사 취합`,
    contents: [
      `[${p.employeeNo}]${p.name}님 ${slot.label} 본부 제출 기한이 됐어요.`,
      '',
      `도착 ${arrived.length}곳${arrived.length ? `: ${arrived.join('·')}` : ''}`,
      ...(missing.length ? [`아직 ${missing.length}곳: ${missing.join('·')}`] : []),
      '',
      'Tincase 전사 취합에서 이어 붙여 최종본을 받으세요.',
    ].join('\n'),
  };
}

/** RU-57 — 총괄 도착 알림의 NotifyLog 종류. 총괄 한 사람에 하나 (같은 부서에 총괄이 여럿일 수 있다) */
export const orgArrivalKind = (userId: string) => `ru_org_arrival:${userId}`;

/**
 * RU-57 — 도착 알림에 적는 이름. 본부 단계가 있으면 본부가 낸다. 없으면 그 하나뿐인 단위가 바로 내므로(RU-07)
 * **낸 단위**의 이름이다 — Tincase를 쓰지 않는(꺼진) 본부 아래 한 실만 쓰는 경우 본부 이름을 적으면,
 * 낸 적 없는 곳이 「도착」으로 적히고 정작 낸 실의 이름은 알림 어디에도 없다.
 */
export function arrivalName(n: Pick<RollupNode, 'node' | 'contributors' | 'hasHqStep'>): string {
  return n.hasHqStep ? n.node.nameKo : n.contributors[0].nameKo;
}

function inWindow(now: Date, at: Date) {
  const passed = (now.getTime() - at.getTime()) / 60_000;
  return passed >= 0 && passed <= WINDOW_MINUTES;
}

/** 스케줄러가 부른다. 부서·본부 하나가 실패해도 나머지는 계속 간다 */
export async function runDueRollupNotices(now = new Date()) {
  const setting = await loadOrgSetting();
  if (!setting.enabled || !messengerStatus().enabled) return [];
  const slot = await ensureCurrentSlot(now);
  const t = stagesFrom(await weekAnchor(slot), setting);
  const atUnit = inWindow(now, t.unitDue);
  const atSoon = inWindow(now, new Date(t.hqDue.getTime() - HQ_DUE_SOON_MINUTES * 60_000));
  const atHq = inWindow(now, t.hqDue);
  if (!atUnit && !atSoon && !atHq) return [];

  const tree = await loadTree();
  const out: { kind: string; sent: number; targets: number }[] = [];
  for (const n of tree.nodes.filter((x) => x.hasHqStep)) {
    try {
      const leads = await people({ divisionId: n.node.id, divisionRole: 'lead' });
      if (atUnit) {
        const status = await Promise.all(n.contributors.map(async (c) => ({ c, r: await currentReport(c.id, slot.id, 'unit') })));
        const sent = status.filter((x) => x.r).map((x) => x.c.nameKo);
        const missing = status.filter((x) => !x.r).map((x) => x.c.nameKo);
        const r = await deliver('ru_hq_collect', n.node.id, slot, leads, (p) => hqCollectMessage(p, slot, n.node.nameKo, sent, missing), link('/hq'));
        if (r) out.push(r);
      }
      if (atSoon && !(await currentReport(n.node.id, slot.id, 'hq'))) {
        const r = await deliver('ru_hq_due_soon', n.node.id, slot, leads, (p) => hqDueSoonMessage(p, slot, t.hqDue), link('/hq'));
        if (r) out.push(r);
      }
    } catch (e) {
      logger.error({ node: n.node.nameKo, err: (e as Error).message }, '[알림] 본부 단계 알림 실패');
    }
  }
  if (atHq) {
    try {
      const arrived: string[] = [];
      const missing: string[] = [];
      for (const n of tree.nodes) {
        const ok = n.hasHqStep ? await currentReport(n.node.id, slot.id, 'hq') : await currentReport(n.contributors[0].id, slot.id, 'unit');
        (ok ? arrived : missing).push(arrivalName(n));
      }
      const coords = await people({ isCoordinator: true });
      for (const c of coords) {
        // 총괄이 여럿이면 각자 — NotifyLog는 그 총괄의 부서에 남기고, 종류에 **사람**을 붙인다.
        // (부서·주차·종류)가 유일하므로 종류가 같으면 같은 부서의 둘째 총괄은 「이미 보냄」으로 건너뛰어진다
        const r = await deliver(orgArrivalKind(c.id), c.divisionId, slot, [c], (p) => orgArrivalMessage(p, slot, arrived, missing), link('/org'));
        if (r) out.push(r);
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, '[알림] 총괄 도착 알림 실패');
    }
  }
  return out;
}

// ── RU-55 본부장 승인 ─────────────────────────────────────────

/** 본부장 승인 — 최신 본부본에. 같은 판을 두 번 승인하지 않는다 */
export async function approveHq(scope: Scope, node: RollupNode, slot: WeekSlot) {
  const run = await prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId: node.node.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) throw new HttpError(409, 'no_rollup', '아직 이어 붙인 본부본이 없습니다.');
  const digest = sha256(await readStoredFile(run.outputPath));
  const last = await prisma.mergeReview.findFirst({
    where: { divisionId: node.node.id, weekSlotId: slot.id, kind: 'hq_approve' },
    orderBy: { createdAt: 'desc' },
  });
  if (last && last.mergeRunId === run.id && last.sha256 === digest) return { unchanged: true };

  const review = await prisma.mergeReview.create({
    data: { divisionId: node.node.id, weekSlotId: slot.id, mergeRunId: run.id, reviewerId: scope.user.id, kind: 'hq_approve', sha256: digest },
  });
  await audit(scope.user.email, 'rollup', node.node.id, `rollup:${run.id}`, { action: 'approve' });

  // 승인하는 순간 본부 담당자에게 (HM-47과 같다 — 기다리는 신호다)
  if (messengerStatus().enabled) {
    try {
      const who = `${scope.user.name} ${scope.user.jobTitle?.trim() || '본부장'}`;
      const leads = await people({ divisionId: node.node.id, divisionRole: 'lead' });
      const sent: string[] = [];
      for (const l of leads) {
        const r = await sendAlert({
          recvIds: [l.employeeNo],
          subject: `[Tincase] ${slot.label} 본부본 — ${who}님 승인 완료`,
          contents: [
            `[${l.employeeNo}]${l.name}님 ${who}님이 ${hhmm(review.createdAt)}에 ${node.node.nameKo} 본부본 검토를 마쳤어요 — 승인 완료.`,
            '',
            'Tincase 본부 취합에서 [총괄에 제출]을 눌러주세요.',
          ].join('\n'),
          url: link('/hq'),
        });
        sent.push(...r.sent);
      }
      if (sent.length) {
        await prisma.notifyLog.create({
          data: { divisionId: node.node.id, weekSlotId: slot.id, kind: `hq_approved:${review.id}`, recipients: JSON.stringify(sent) },
        });
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, '[알림] 본부장 승인 알림 실패');
    }
  }
  return { unchanged: false };
}

export interface HqApprovalView {
  by: string;
  atKst: string;
  /** 승인한 뒤 다시 이어 붙였다 */
  changedAfter: boolean;
}

export async function hqApproval(nodeId: string, slot: WeekSlot): Promise<HqApprovalView | null> {
  const review = await prisma.mergeReview.findFirst({
    where: { divisionId: nodeId, weekSlotId: slot.id, kind: 'hq_approve' },
    orderBy: { createdAt: 'desc' },
  });
  if (!review) return null;
  const run = await prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId: nodeId, weekSlotId: slot.id, status: 'succeeded' },
    orderBy: { startedAt: 'desc' },
  });
  const who = await prisma.user.findUnique({ where: { id: review.reviewerId }, select: { name: true, jobTitle: true } });
  return {
    by: who ? `${who.name} ${who.jobTitle?.trim() || '본부장'}` : '본부장',
    atKst: toKstIso(review.createdAt).slice(5, 16).replace('T', ' '),
    changedAfter: !run || run.id !== review.mergeRunId,
  };
}

/** 화면용 — 이번 주 단계 기한 글자 */
export async function stageLabels(slot: WeekSlot) {
  const setting = await loadOrgSetting();
  const t = stagesFrom(await weekAnchor(slot), setting);
  return {
    enabled: setting.enabled,
    unitDueMinutes: setting.unitDueMinutes,
    hqDueMinutes: setting.hqDueMinutes,
    anchorKo: formatDeadlineKo(t.anchor),
    unitDueKo: formatDeadlineKo(t.unitDue),
    hqDueKo: formatDeadlineKo(t.hqDue),
  };
}
