// RU-53~57b — 3단계 알림. **막고 있는 사람에게만 간다** (2026-10-08 개정 · ADR-0015 · messenger.md §4-3).
//
// 승인이 곧 제출이 되면서 넘기는 사람에게 가던 알림(「이어 붙이세요」·「[총괄에 제출]을 눌러 주세요」)이 없어졌다 — 넘길 일이 없다.
// 남는 알림은 둘 중 하나다:
//   사건  「당신의 결정을 기다리는 것이 준비됐다」 — 그 사건을 맞춘 조립 직후(auto.ts), 스케줄러를 기다리지 않는다
//   시각  「기한이 15분 남았는데 당신이 막고 있다」 — 스케줄러(`runDueRollupNotices`)가 본다
// 시각은 전부 그 주의 기준 시각에서 계산한다(RU-50) — 총괄이 연휴로 마감을 옮기면 같은 간격으로 따라간다.
//
// 본부·총괄 사람에게 가는 것은 **3단계 스위치(RU-52)**를, 실·팀 사람에게 가는 것(RU-56a)은 부서 알림 스위치(NT-30)도 따른다.
// 본인 설정(NT-20)·사번(NT-01)은 그대로. 종류마다 `NotifyLog`로 한 번 — 테스트 서버는 메신저가 꺼져 있어 아무것도 안 나간다(RU-41).
import type { RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { messengerStatus, sendAlert } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { weekAnchor } from '../slot-deadline';
import { HQ_REVIEW, NEWEST_FIRST, UNIT_REVIEW } from '../merge/review-scope';
import { formatDeadlineKo, slotKind, toKstIso } from '@/lib/week';
import { STAGE_HQ, STAGE_UNIT } from '@/lib/rollup-stages';
import { currentReport, fileSha } from './report';
import { loadOrgSetting, loadTree, submitTarget, type OrgTree, type RollupNode } from './tree';
import { stagesFrom } from './schedule';

const WINDOW_MINUTES = 12; // 스케줄러 주기보다 넉넉하게 — 반드시 한 번 걸린다 (NT-40과 같다)
/** RU-56·56a — 기한 몇 분 전에 막고 있는 사람에게 알리나. 같은 시각부터 비상구가 열린다(RU-77 — handoff.ts `ESCAPE_MINUTES`) */
export const DUE_SOON_MINUTES = 15;
/** @deprecated 이름만 남긴다 — `DUE_SOON_MINUTES` */
export const HQ_DUE_SOON_MINUTES = DUE_SOON_MINUTES;

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);
const weekLabel = (slot: Pick<WeekSlot, 'label' | 'opensAt'>) => `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;

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

export interface RollupNoticeOutcome {
  kind: string;
  sent: number;
  targets: number;
}

async function sentBefore(divisionId: string, weekSlotId: string, kind: string) {
  return prisma.notifyLog.findFirst({ where: { divisionId, weekSlotId, kind } });
}

/** 한 종류를 한 번 (NT-42). 실제로 나간 사람이 있을 때만 기록한다 — 그래야 메신저가 꺼진 동안의 「보냄」이 남지 않는다 */
async function deliver(
  kind: string,
  divisionId: string,
  slot: WeekSlot,
  to: Person[],
  msg: (p: Person) => { subject: string; contents: string },
  url?: string,
  detail: Record<string, unknown> = {},
): Promise<RollupNoticeOutcome | null> {
  if (await sentBefore(divisionId, slot.id, kind)) return null;
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
      data: { divisionId, weekSlotId: slot.id, kind, recipients: JSON.stringify(sent), detail: JSON.stringify({ ...detail, blocked, targets: to.length }) },
    });
  }
  return { kind, sent: sent.length, targets: to.length };
}

const link = (path: string) => (env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}${path}` : undefined);

/** 3단계 알림을 보낼 수 있나 — 스위치(RU-52)와 메신저(RU-41) 둘 다 */
async function canNotify(): Promise<boolean> {
  return messengerStatus().enabled && (await loadOrgSetting()).enabled;
}

// ── 문구 (순수 — 시험할 수 있게) ─────────────────────────────

type Who = { name: string; employeeNo: string };
const head = (p: Who) => `[${p.employeeNo}]${p.name}님`;

/** RU-54 — 본부장: 본부본 준비. `again`이면 기한에 일부로 보낸 뒤 다 모인 것 */
export function hqReadyMessage(p: Who, slot: WeekSlot, node: string, arrived: string[], missing: string[], again = false) {
  const n = arrived.length + missing.length;
  return {
    subject: again
      ? `[Tincase] ${node} 산하 ${n}곳이 다 모였어요 — 본부본 검토`
      : `[Tincase] ${node} 본부본이 준비됐어요 — 산하 ${arrived.length}/${n}곳`,
    contents: [
      again
        ? `${head(p)} ${weekLabel(slot)} 산하 ${n}곳이 다 올라와 본부본을 다시 이어 붙였어요.`
        : `${head(p)} ${weekLabel(slot)} 산하 ${arrived.length}/${n}곳이 올라와 본부본이 준비됐어요.`,
      ...(missing.length ? [`아직 ${missing.length}곳: ${missing.join('·')}`] : []),
      '',
      'Tincase 본부 취합에서 검토하고 [검토 완료 · 승인]을 누르면 바로 총괄로 갑니다.',
    ].join('\n'),
  };
}

/** RU-55a — 본부장: 승인한 뒤 본부본이 바뀌었다 */
export function hqReapproveMessage(p: Who, slot: WeekSlot, node: string, why: string, approvedAt: Date) {
  return {
    subject: `[Tincase] ${node} 본부본이 바뀌었어요 — 다시 승인해 주세요`,
    contents: [
      `${head(p)} ${weekLabel(slot)} ${why ? `${why} ` : ''}승인한 뒤 본부본이 다시 이어 붙었어요.`,
      `총괄에는 ${hhmm(approvedAt)}에 승인한 판이 있어요.`,
      '',
      'Tincase 본부 취합에서 확인하고 다시 [검토 완료 · 승인]을 눌러 주세요.',
    ].join('\n'),
  };
}

/** RU-56 — 본부장: 「본부 → 총괄」 기한 15분 전 (승인 전·승인 뒤 바뀜·승인 없이 감) */
export function hqHeadDueSoonMessage(p: Who, slot: WeekSlot, due: Date) {
  return {
    subject: `[Tincase] ${slot.label} 「${STAGE_HQ}」 기한 ${DUE_SOON_MINUTES}분 전이에요`,
    contents: [
      `${head(p)} ${hhmm(due)}까지 본부본 승인이 필요해요 — ${DUE_SOON_MINUTES}분 남았어요.`,
      '',
      'Tincase 본부 취합에서 검토하고 승인하면 바로 총괄로 갑니다.',
    ].join('\n'),
  };
}

/** RU-56a — 실·팀장: 그 단위 기한 15분 전 (승인 전·승인 뒤 바뀜) */
export function unitDueSoonMessage(p: Who, slot: WeekSlot, target: string, due: Date, toHq: boolean) {
  return {
    subject: `[Tincase] ${slot.label} 「${toHq ? STAGE_UNIT : STAGE_HQ}」 기한 ${DUE_SOON_MINUTES}분 전이에요`,
    contents: [
      `${head(p)} ${hhmm(due)}까지 병합본 승인이 필요해요 — ${DUE_SOON_MINUTES}분 남았어요.`,
      '',
      `Tincase 수합 관리에서 병합본을 승인하면 바로 ${target}에 올라갑니다.`,
    ].join('\n'),
  };
}

/** RU-57 — 총괄: 전사본 준비. `again`이면 기한에 일부로 보낸 뒤 다 들어온 것 */
export function orgReadyMessage(p: Who, slot: WeekSlot, arrived: string[], missing: string[], again = false) {
  const n = arrived.length + missing.length;
  return {
    subject: again ? `[Tincase] ${slot.label} ${n}곳이 다 들어왔어요 — 전사본` : `[Tincase] ${slot.label} ${arrived.length}/${n}곳 도착 — 전사본이 준비돼 있어요`,
    contents: [
      again ? `${head(p)} ${slot.label} ${n}곳이 다 들어와 전사본을 다시 만들었어요.` : `${head(p)} ${slot.label} 전사본이 준비돼 있어요.`,
      '',
      `도착 ${arrived.length}곳${arrived.length ? `: ${arrived.join('·')}` : ''}`,
      ...(missing.length ? [`아직 ${missing.length}곳: ${missing.join('·')}`] : []),
      '',
      'Tincase 「전사」에서 전사본을 받으세요.',
    ].join('\n'),
  };
}

/** RU-57a — 받은 총괄: 받은 뒤 전사본이 바뀌었다 */
export function orgChangedMessage(p: Who, slot: WeekSlot, downloadedAt: Date, why: string) {
  return {
    subject: `[Tincase] ${slot.label} 받은 전사본이 바뀌었어요`,
    contents: [
      `${head(p)} ${hhmm(downloadedAt)}에 받은 전사본이 바뀌었어요${why ? `(${why})` : ''}.`,
      '',
      '이미 올렸다면 Tincase 「전사」에서 다시 받아 바꿔 주세요.',
    ].join('\n'),
  };
}

/** RU-57b — 만들기 실패. 고칠 수 있는 사람에게 (본부본: 본부 담당자 · 전사본: 총괄) */
export function rollupFailedMessage(p: Who, slot: WeekSlot, what: string, error: string) {
  return {
    subject: `[Tincase] ${slot.label} ${what}을 만들지 못했어요`,
    contents: [`${head(p)} ${slot.label} ${what}을 자동으로 만들지 못했어요.`, '', `이유: ${error}`, '', '고친 뒤 Tincase에서 [다시 시도]를 눌러 주세요.'].join('\n'),
  };
}

/** RU-57 — 총괄 알림의 NotifyLog 종류. 총괄 한 사람에 하나 (같은 부서에 총괄이 여럿일 수 있다) */
export const orgReadyKind = (userId: string) => `ru_org_ready:${userId}`;
export const orgCompleteKind = (userId: string) => `ru_org_complete:${userId}`;

/**
 * RU-57 — 도착 알림에 적는 이름. 본부 단계가 있으면 본부가 낸다. 없으면 그 하나뿐인 단위가 바로 내므로(RU-07)
 * **낸 단위**의 이름이다 — Tincase를 쓰지 않는(꺼진) 본부 아래 한 실만 쓰는 경우 본부 이름을 적으면,
 * 낸 적 없는 곳이 「도착」으로 적히고 정작 낸 실의 이름은 알림 어디에도 없다.
 */
export function arrivalName(n: Pick<RollupNode, 'node' | 'contributors' | 'hasHqStep'>): string {
  return n.hasHqStep ? n.node.nameKo : n.contributors[0].nameKo;
}

// ── 사건 알림 (조립 직후 — auto.ts가 부른다) ─────────────────────

/** 지금 본부본 sha와 가장 최근 본부장 승인 */
async function hqApprovalFor(nodeId: string, weekSlotId: string) {
  return prisma.mergeReview.findFirst({ where: { divisionId: nodeId, weekSlotId, ...HQ_REVIEW }, orderBy: NEWEST_FIRST });
}

async function hqArrivals(node: RollupNode, slot: WeekSlot) {
  const status = await Promise.all(node.contributors.map(async (c) => ({ c, r: await currentReport(c.id, slot.id, 'unit') })));
  return { arrived: status.filter((x) => x.r).map((x) => x.c.nameKo), missing: status.filter((x) => !x.r).map((x) => x.c.nameKo) };
}

/**
 * RU-54 · RU-55a — 본부본이 새로 만들어진 직후.
 *   승인한 적이 있고 그 판(sha)이 지금과 다르다 → RU-55a 「다시 승인」 (풀린 승인마다 한 번)
 *   승인한 적이 없고 산하가 다 모였다 → RU-54 「본부본 준비」(처음) 또는 「다 모였어요」(기한에 일부로 보낸 뒤)
 * 본부 담당자에게는 보내지 않는다 — 할 일이 없다.
 */
export async function noticeHqBuilt(node: RollupNode, slot: WeekSlot, run: RollupRun, why: string): Promise<RollupNoticeOutcome[]> {
  if (!(await canNotify())) return [];
  const out: RollupNoticeOutcome[] = [];
  const heads = await people({ divisionId: node.node.id, divisionRole: 'head' });
  const sha = await fileSha(run.outputPath);
  const approval = await hqApprovalFor(node.node.id, slot.id);
  if (approval) {
    if (sha && approval.sha256 !== sha) {
      const r = await deliver(`ru_hq_reapprove:${approval.id}`, node.node.id, slot, heads, (p) => hqReapproveMessage(p, slot, node.node.nameKo, why, approval.createdAt), link('/hq'));
      if (r) out.push(r);
    }
    return out;
  }
  const { arrived, missing } = await hqArrivals(node, slot);
  if (missing.length > 0) return out; // 일부는 기한(스케줄러)에
  const ready = await sentBefore(node.node.id, slot.id, 'ru_hq_ready');
  if (!ready) {
    const r = await deliver('ru_hq_ready', node.node.id, slot, heads, (p) => hqReadyMessage(p, slot, node.node.nameKo, arrived, missing), link('/hq'), { complete: true });
    if (r) out.push(r);
  } else if (!JSON.parse(ready.detail ?? '{}').complete) {
    const r = await deliver('ru_hq_complete', node.node.id, slot, heads, (p) => hqReadyMessage(p, slot, node.node.nameKo, arrived, missing, true), link('/hq'));
    if (r) out.push(r);
  }
  return out;
}

/** 이 섹션 출처들에서 도착·미도착 이름 — 켜진 섹션 기준 (RU-57) */
export function orgArrivals(sources: readonly { section: { title: string }; kind: string }[]) {
  const ok = (k: string) => k === 'tincase' || k === 'upload';
  return { arrived: sources.filter((s) => ok(s.kind)).map((s) => s.section.title), missing: sources.filter((s) => !ok(s.kind)).map((s) => s.section.title) };
}

/**
 * RU-57 · RU-57a — 전사본이 새로 만들어진 직후.
 *   켜진 섹션이 모두 들어왔다 → 총괄 각자에게 「전사본 준비」(처음) 또는 「다 들어왔어요」(기한에 일부로 보낸 뒤)
 *   이 주의 전사본을 **받은** 총괄 → 받은 판과 바이트가 다르면 「받은 뒤 바뀜」 (받은 판마다 한 번, 받은 사람에게만)
 */
export async function noticeOrgBuilt(
  slot: WeekSlot,
  run: RollupRun,
  sources: readonly { section: { title: string }; kind: string }[],
  why: string,
): Promise<RollupNoticeOutcome[]> {
  if (!(await canNotify())) return [];
  const out: RollupNoticeOutcome[] = [];
  const coords = await people({ isCoordinator: true });
  const { arrived, missing } = orgArrivals(sources);
  if (missing.length === 0) {
    for (const c of coords) {
      const ready = await sentBefore(c.divisionId, slot.id, orgReadyKind(c.id));
      const r = !ready
        ? await deliver(orgReadyKind(c.id), c.divisionId, slot, [c], (p) => orgReadyMessage(p, slot, arrived, missing), link('/org'), { complete: true })
        : !JSON.parse(ready.detail ?? '{}').complete
          ? await deliver(orgCompleteKind(c.id), c.divisionId, slot, [c], (p) => orgReadyMessage(p, slot, arrived, missing, true), link('/org'))
          : null;
      if (r) out.push(r);
    }
  }
  // RU-57a — 받은 사람만. NAMS에 이미 올렸을 수 있다 — 화면만으로는 늦게 안다
  const sha = await fileSha(run.outputPath);
  const runs = await prisma.rollupRun.findMany({ where: { level: 'org', weekSlotId: slot.id, status: 'succeeded', id: { not: run.id } }, select: { id: true, outputPath: true } });
  if (!sha || runs.length === 0) return out;
  const downloads = await prisma.auditLog.findMany({
    where: { action: 'download', target: { in: runs.map((r) => `rollup:${r.id}`) } },
    orderBy: { at: 'desc' },
  });
  const byActor = new Map<string, (typeof downloads)[number]>();
  for (const d of downloads) if (!byActor.has(d.actor)) byActor.set(d.actor, d); // 사람마다 가장 최근에 받은 것
  const users = await prisma.user.findMany({ where: { email: { in: [...byActor.keys()] } }, select: { id: true, email: true } });
  const idOf = new Map(users.map((u) => [u.email, u.id]));
  for (const [email, d] of byActor) {
    const person = coords.find((x) => x.id === idOf.get(email));
    if (!person) continue; // 받은 사람이 총괄이 아니거나 알림을 끈 사람
    const runId = d.target!.slice('rollup:'.length);
    const got = runs.find((r) => r.id === runId);
    if (!got || (await fileSha(got.outputPath)) === sha) continue;
    const r = await deliver(`ru_org_changed:${runId}:${person.id}`, person.divisionId, slot, [person], (p) => orgChangedMessage(p, slot, d.at, why), link('/org'));
    if (r) out.push(r);
  }
  return out;
}

/**
 * RU-57b — 만들기 실패. 실패한 입력(열쇠)마다 한 번. 고칠 수 있는 사람에게 — 본부본은 본부 담당자, 전사본은 총괄.
 * 본부장에게 보내지 않는 것은 HM의 실패 알림과 같은 이유다(고칠 수 없는 사람에게 가는 실패 통지는 소음이다, TACP-16)
 */
export async function noticeRollupFailed(level: 'hq' | 'org', node: RollupNode | null, slot: WeekSlot, run: RollupRun): Promise<RollupNoticeOutcome[]> {
  if (!(await canNotify())) return [];
  const key = (run.inputKey ?? run.id).slice(0, 12);
  const error = run.errorText ?? '알 수 없는 오류';
  if (level === 'hq' && node) {
    const leads = await people({ divisionId: node.node.id, divisionRole: 'lead' });
    const r = await deliver(`ru_hq_failed:${key}`, node.node.id, slot, leads, (p) => rollupFailedMessage(p, slot, `${node.node.nameKo} 본부본`, error), link('/hq'));
    return r ? [r] : [];
  }
  const coords = await people({ isCoordinator: true });
  const byDivision = new Map<string, Person[]>();
  for (const c of coords) byDivision.set(c.divisionId, [...(byDivision.get(c.divisionId) ?? []), c]);
  const out: RollupNoticeOutcome[] = [];
  for (const [divisionId, to] of byDivision) {
    const r = await deliver(`ru_org_failed:${key}`, divisionId, slot, to, (p) => rollupFailedMessage(p, slot, '전사본', error), link('/org'));
    if (r) out.push(r);
  }
  return out;
}

// ── 시각 알림 (스케줄러) ─────────────────────────────────────

function inWindow(now: Date, at: Date) {
  const passed = (now.getTime() - at.getTime()) / 60_000;
  return passed >= 0 && passed <= WINDOW_MINUTES;
}

const soon = (d: Date) => new Date(d.getTime() - DUE_SOON_MINUTES * 60_000);

/** 본부본이 지금 판에 승인을 기다리나 — 있고, 승인한 판(sha)과 다르다 (Q1·Q3·Q4) */
async function hqAwaitingApproval(nodeId: string, slot: WeekSlot): Promise<boolean> {
  const run = await prisma.rollupRun.findFirst({
    where: { level: 'hq', divisionId: nodeId, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const sha = await fileSha(run?.outputPath);
  if (!sha) return false;
  const approval = await hqApprovalFor(nodeId, slot.id);
  return !approval || approval.sha256 !== sha;
}

/** 실·팀 병합본이 승인을 기다리나 — 마감 뒤 최종본이 있고 그 판에 승인이 없다 (U1·U3) */
async function unitAwaitingApproval(divisionId: string, slot: WeekSlot): Promise<boolean> {
  const division = await prisma.division.findUnique({ where: { id: divisionId } });
  if (!division) return false;
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null }, startedAt: { gte: effectiveDeadline(slot, division) } },
    orderBy: { startedAt: 'desc' },
  });
  const sha = await fileSha(run?.outputPath);
  if (!sha) return false;
  const review = await prisma.mergeReview.findFirst({ where: { divisionId, weekSlotId: slot.id, ...UNIT_REVIEW }, orderBy: NEWEST_FIRST });
  return !review || review.sha256 !== sha;
}

/** RU-56a — 막고 있는 실·팀장에게. 부서 알림 스위치(NT-30)도 따른다 */
async function unitDueSoon(tree: OrgTree, slot: WeekSlot, due: Date, toHq: boolean): Promise<RollupNoticeOutcome[]> {
  const out: RollupNoticeOutcome[] = [];
  for (const n of tree.nodes) {
    if (n.hasHqStep !== toHq) continue;
    for (const c of n.contributors) {
      try {
        const division = await prisma.division.findUnique({ where: { id: c.id }, select: { notifyEnabled: true } });
        if (!division?.notifyEnabled) continue;
        if (!(await unitAwaitingApproval(c.id, slot))) continue;
        const heads = await people({ divisionId: c.id, divisionRole: 'head' });
        const target = submitTarget(tree, c.id);
        const label = target?.kind === 'hq' ? target.node.node.nameKo : '총괄';
        const r = await deliver('ru_unit_due_soon', c.id, slot, heads, (p) => unitDueSoonMessage(p, slot, label, due, toHq), link(`/${c.slug}/manage`));
        if (r) out.push(r);
      } catch (e) {
        logger.error({ division: c.nameKo, err: (e as Error).message }, '[알림] 실·팀 기한 알림 실패');
      }
    }
  }
  return out;
}

/** 스케줄러가 부른다. 부서·본부 하나가 실패해도 나머지는 계속 간다 */
export async function runDueRollupNotices(now = new Date()): Promise<RollupNoticeOutcome[]> {
  const setting = await loadOrgSetting();
  if (!setting.enabled || !messengerStatus().enabled) return [];
  const slot = await ensureCurrentSlot(now);
  const t = stagesFrom(await weekAnchor(slot), setting);
  const atUnit = inWindow(now, t.unitDue);
  const atUnitSoon = inWindow(now, soon(t.unitDue));
  const atHqSoon = inWindow(now, soon(t.hqDue));
  const atHq = inWindow(now, t.hqDue);
  if (!atUnit && !atUnitSoon && !atHqSoon && !atHq) return [];

  const tree = await loadTree();
  const out: RollupNoticeOutcome[] = [];
  // RU-56a — 본부로 가는 단위는 「실·팀 → 본부」 기한, 바로 총괄로 가는 단위는 「본부 → 총괄」 기한 15분 전
  if (atUnitSoon) out.push(...(await unitDueSoon(tree, slot, t.unitDue, true)));
  if (atHqSoon) out.push(...(await unitDueSoon(tree, slot, t.hqDue, false)));

  for (const n of tree.nodes.filter((x) => x.hasHqStep)) {
    try {
      const heads = await people({ divisionId: n.node.id, divisionRole: 'head' });
      // RU-54 — 「실·팀 → 본부」 기한에 하나라도 와 있고 본부본이 승인을 기다리면 그때 (다 모인 순간에 이미 갔으면 안 간다)
      if (atUnit && (await hqAwaitingApproval(n.node.id, slot))) {
        const { arrived, missing } = await hqArrivals(n, slot);
        if (arrived.length > 0) {
          const r = await deliver('ru_hq_ready', n.node.id, slot, heads, (p) => hqReadyMessage(p, slot, n.node.nameKo, arrived, missing), link('/hq'), {
            complete: missing.length === 0,
          });
          if (r) out.push(r);
        }
      }
      // RU-56 — 본부장이 막고 있을 때만 (승인 전·승인 뒤 바뀜·승인 없이 감)
      if (atHqSoon && (await hqAwaitingApproval(n.node.id, slot))) {
        const r = await deliver('ru_hq_due_soon', n.node.id, slot, heads, (p) => hqHeadDueSoonMessage(p, slot, t.hqDue), link('/hq'));
        if (r) out.push(r);
      }
    } catch (e) {
      logger.error({ node: n.node.nameKo, err: (e as Error).message }, '[알림] 본부 단계 알림 실패');
    }
  }
  if (atHq) {
    try {
      // RU-57 — 「본부 → 총괄」 기한에 일부라도 — 다 들어온 순간에 이미 갔으면 안 간다. 이름은 낸 곳(arrivalName)
      const arrived: string[] = [];
      const missing: string[] = [];
      for (const n of tree.nodes) {
        const ok = n.hasHqStep ? await currentReport(n.node.id, slot.id, 'hq') : await currentReport(n.contributors[0].id, slot.id, 'unit');
        (ok ? arrived : missing).push(arrivalName(n));
      }
      for (const c of await people({ isCoordinator: true })) {
        // 총괄이 여럿이면 각자 — NotifyLog는 그 총괄의 부서에 남기고, 종류에 **사람**을 붙인다.
        // (부서·주차·종류)가 유일하므로 종류가 같으면 같은 부서의 둘째 총괄은 「이미 보냄」으로 건너뛰어진다
        const r = await deliver(orgReadyKind(c.id), c.divisionId, slot, [c], (p) => orgReadyMessage(p, slot, arrived, missing), link('/org'), {
          complete: missing.length === 0,
        });
        if (r) out.push(r);
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, '[알림] 총괄 도착 알림 실패');
    }
  }
  return out;
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

