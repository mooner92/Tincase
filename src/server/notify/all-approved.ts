// NT-62 (2026-10-12 운영자) — 「켜진 부서 모두 승인 완료」 한 통 → 총괄.
//
// 3단계가 꺼진 동안은 부서장 승인이 곧 그 부서의 최종이다 — 담당자는 승인 쪽지(NT-46)를 받는 즉시 [받기]로 받아 취합게시판(NAMS)에
// 올린다. 총괄은 그 게시판에서 모아 NAMS 최종본을 낸다. 부서마다 승인될 때 총괄에게도 쪽지가 가면 많다(운영자: 「팀마다 가면 너무
// 많이 갈 것 같으니」) — 그래서 **켜진 부서가 모두 끝났을 때 한 번**만 보낸다. 총괄이 「이제 다 모였다」를 Tincase를 열어 보지 않고 안다.
//
// 「끝」의 뜻 (부서마다):
//   approved  부서장이 승인했고 그 뒤 병합본이 안 바뀌었다(`approvalOf` — 화면의 「승인 뒤 바뀜」과 같은 판정)
//   final     부서장이 없는 부서 — 마감 뒤 최종본이 곧 최종이다(승인할 사람이 없다)
//   nothing   이번 주 낸 사람이 없다 — 기다릴 병합본이 없다
// 하나라도 아직(waiting)이면 보내지 않는다. 모두 nothing이면(아무도 안 냈다) 알릴 것이 없어 보내지 않는다.
//
// 3단계가 켜져 있으면 보내지 않는다 — 그때는 승인이 곧 위로 가는 사본이고 총괄에게는 3단계 쪽지(RU-53~57)가 같은 일을 한다.
// 받는 사람: 총괄(`isCoordinator`) — 사번이 있고 본인 알림을 켠 사람. 사람마다 주마다 한 번(NotifyLog 유일 키).
// 스케줄러가 1분마다 병합 안내와 같은 묶음에서 부른다(`runMergeNotices`) — 마지막 승인 뒤 1분 안에 간다.
import type { Division, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { messengerStatus } from '../messenger';
// ADR-0022 D4 — 알림은 보낼 함을 지난다(같은 사람에게 짧은 사이 여럿이면 한 통). 창이 0이면 바로 보낸다
import { sendOrQueue } from './outbox';
import { claimNotice, settleNotice } from './claim';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { approvalOf } from '../merge/review';
import { loadOrgSetting } from '../rollup/tree';
import { slotKind, toKstIso } from '@/lib/week';

/** 마감에서 이만큼 지나면 더 보지 않는다 — 그 주의 일은 끝났다(병합 점검 「완료」와 같은 한도) */
export const ALL_APPROVED_HORIZON_MINUTES = 24 * 60;

export type UnitDoneState = 'approved' | 'final' | 'nothing' | 'waiting';

export interface UnitDone {
  id: string;
  name: string;
  state: UnitDoneState;
  /** 승인 시각(approved) · 최종본이 끝난 시각(final) */
  at: Date | null;
}

/** 부서 하나가 이번 주에 끝났나 — 최종본은 마감 뒤에 시작한 성공한 실행만(HM-34: 마감 전 미리보기는 최종본이 아니다) */
export async function unitDone(division: Division, slot: WeekSlot, now: Date): Promise<UnitDone> {
  const base = { id: division.id, name: division.nameKo };
  const deadline = effectiveDeadline(slot, division);
  if (now < deadline) return { ...base, state: 'waiting', at: null };
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null }, startedAt: { gte: deadline } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run) {
    const submitted = await prisma.submission.count({ where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true } });
    return { ...base, state: submitted === 0 ? 'nothing' : 'waiting', at: null };
  }
  const hasHead = (await prisma.user.count({ where: { divisionId: division.id, isActive: true, divisionRole: 'head' } })) > 0;
  if (!hasHead) return { ...base, state: 'final', at: run.finishedAt ?? run.startedAt };
  const approval = await approvalOf(run);
  return approval && !approval.changedAfter ? { ...base, state: 'approved', at: approval.at } : { ...base, state: 'waiting', at: null };
}

/** 다 끝났나 — 하나라도 아직이면 아니다. 모두 「제출 없음」이면 알릴 것이 없다 */
export function allDone(units: readonly UnitDone[]): boolean {
  return units.length > 0 && units.every((u) => u.state !== 'waiting') && units.some((u) => u.state !== 'nothing');
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);

/** 문구 — 부서 이름 · 시각 · 상태만. 승인한 사람 이름 · 문서 내용은 넣지 않는다(병합 점검과 같은 원칙 — TACP-30) */
export function allApprovedMessage(p: { name: string; employeeNo: string }, slot: WeekSlot, units: readonly UnitDone[]) {
  const label = `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;
  const lines = units.map((u) =>
    u.state === 'approved'
      ? `· ${u.name} — ${hhmm(u.at!)} 부서장 승인`
      : u.state === 'final'
        ? `· ${u.name} — ${hhmm(u.at!)} 병합본 확정(부서장 없음)`
        : `· ${u.name} — 이번 주 제출 없음`,
  );
  return {
    subject: `[Tincase] ${label} — 부서 ${units.length}곳 모두 승인 완료`,
    contents: [
      `[${p.employeeNo}]${p.name}님 Tincase로 내는 부서 ${units.length}곳의 ${label} 병합본이 모두 승인됐어요.`,
      '',
      ...lines,
      '',
      '각 부서 담당자가 승인본을 취합게시판에 올려요.',
    ].join('\n'),
  };
}

/** 기록 종류 — 사람마다 · 주마다 한 번 (`(부서, 주차, 종류)` 유일 키 — 받는 사람의 부서로 남긴다) */
export const allApprovedKind = (userId: string) => `all_approved:${userId}`;

export interface AllApprovedOutcome {
  isoKey: string;
  sent: number;
  targets: number;
}

export async function runAllApprovedNotice(now: Date = new Date()): Promise<AllApprovedOutcome | null> {
  if (!messengerStatus().enabled) return null;
  if ((await loadOrgSetting()).enabled) return null;
  const slot = await ensureCurrentSlot(now);
  const divisions = await prisma.division.findMany({ where: { isActive: true }, orderBy: { nameKo: 'asc' } });
  if (divisions.length === 0) return null;
  // 창 — 가장 이른 마감부터 가장 늦은 마감 + 24시간. 밖이면 아무것도 조회하지 않는다(1분마다 도는 길이다)
  const deadlines = divisions.map((d) => effectiveDeadline(slot, d).getTime());
  if (now.getTime() < Math.min(...deadlines)) return null;
  if (now.getTime() > Math.max(...deadlines) + ALL_APPROVED_HORIZON_MINUTES * 60_000) return null;

  const people = await prisma.user.findMany({
    where: { isActive: true, isCoordinator: true, notifyEnabled: true, employeeNo: { not: null } },
    select: { id: true, name: true, employeeNo: true, divisionId: true },
    orderBy: { id: 'asc' },
  });
  const seen = new Set<string>();
  const audience = people.filter((p) => p.employeeNo && !seen.has(p.employeeNo) && seen.add(p.employeeNo));
  if (audience.length === 0) return null;
  // 이미 보낸 사람은 다시 판정하지 않는다 — 보낸 뒤에는 매분 병합본 파일을 읽을 까닭이 없다
  const logged = new Set(
    (await prisma.notifyLog.findMany({ where: { weekSlotId: slot.id, kind: { in: audience.map((p) => allApprovedKind(p.id)) } }, select: { kind: true } })).map(
      (l) => l.kind,
    ),
  );
  const need = audience.filter((p) => !logged.has(allApprovedKind(p.id)));
  if (need.length === 0) return null;

  const units: UnitDone[] = [];
  for (const d of divisions) units.push(await unitDone(d, slot, now));
  if (!allDone(units)) return null;

  const detail = { units: units.map((u) => ({ name: u.name, state: u.state, at: u.at?.toISOString() ?? null })) };
  const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/org` : undefined;
  let sent = 0;
  let targets = 0;
  for (const p of need) {
    const kind = allApprovedKind(p.id);
    // 기록을 먼저 잡는다 — 스케줄러와 일꾼이 같은 순간에 판정해도 한 번
    const claim = await claimNotice(p.divisionId, slot.id, kind, detail);
    if (!claim) continue;
    targets++;
    const out: string[] = [];
    try {
      const r = await sendOrQueue({ recvIds: [p.employeeNo!], ...allApprovedMessage({ name: p.name, employeeNo: p.employeeNo! }, slot, units), url, kind });
      out.push(...r.sent);
    } finally {
      await settleNotice(claim, out, detail);
    }
    sent += out.length;
  }
  return targets ? { isoKey: slot.isoKey, sent, targets } : null;
}
