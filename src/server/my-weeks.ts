// PG-66 — 부서원 홈 데이터. 이번 주 카드와 지난 주차를 **병렬 질의 한 묶음**으로 만든다.
//
// 예전 홈은 부서 전원·제출·알림 기록을 읽어 남의 이름을 그렸다(divisionStatus — 이 화면에서 가장 무거웠다).
// 2026-10-08 사용자 결정으로 명단이 홈에서 빠지고(TACP-11 v1.8), 「보관함」·「내 이력」이 이 화면으로 합쳐졌다.
// 그래서 여기서는 **나와 내 부서의 주**만 읽는다. 남의 id·이름은 어디에도 싣지 않는다(PG-66e — PG-T97이 잰다).
import { prisma } from './db';
import { ensureCurrentSlot, effectiveDeadline } from './worklog';
import { openingOf } from './deadline';
import type { DivisionView } from './page-scope';
import { isSubmissionLocked, mergeGate, homeRefreshAt } from '@/lib/deadline';
import { formatDeadlineNearKo, isLocked, mondayOf, slotKind, toKstIso } from '@/lib/week';
import { groupPast, pickPastWeeks, type PastGroups } from '@/lib/week-groups';
import type { ThisWeekCardProps } from '@/components/ThisWeekCard';

/**
 * 질의 넷 — 모두 인덱스를 탄다. N+1은 없다.
 *
 *   슬롯          @@index([opensAt]) — 서버 전체 슬롯, 한 해 53행
 *   내 최신 판    @@unique([userId, weekSlotId, version])의 앞머리 — 어느 부서에서 냈든(AU-13)
 *   부서 제출 주  @@index([divisionId, weekSlotId, isLatest]) — 주마다 한 행
 *   병합본 주     @@index([divisionId, weekSlotId, startedAt]) — 주마다 한 행. 재병합이 쌓여도 옛 주가 빠지지 않는다
 */
export async function myWeeks(p: { userId: string; divisionId: string; upTo: Date }) {
  const [slots, mine, dept, merged] = await Promise.all([
    prisma.weekSlot.findMany({
      where: { opensAt: { lte: p.upTo } },
      orderBy: { opensAt: 'desc' },
      select: { id: true, isoKey: true, label: true, year: true, month: true, weekOfMonth: true, opensAt: true },
    }),
    prisma.submission.findMany({
      where: { userId: p.userId, isLatest: true },
      select: { id: true, weekSlotId: true, divisionId: true, version: true, uploadedAt: true, editedById: true },
    }),
    prisma.submission.groupBy({
      by: ['weekSlotId'],
      where: { divisionId: p.divisionId, isLatest: true },
    }),
    prisma.mergeRun.groupBy({
      by: ['weekSlotId'],
      where: { divisionId: p.divisionId, status: 'succeeded', outputPath: { not: null } },
      _max: { startedAt: true },
    }),
  ]);
  return {
    slots,
    mine,
    deptWeekIds: new Set(dept.map((d) => d.weekSlotId)),
    mergedAt: new Map(merged.map((m) => [m.weekSlotId, m._max.startedAt ?? new Date(0)])),
  };
}

export interface MemberHome {
  card: Omit<ThisWeekCardProps, 'layout'>;
  groups: PastGroups;
  showMissing: boolean;
}

/** 카드·목록 props를 한 번에. 판정은 전부 서버가 한다(마감은 취소 게이트와 같은 식 — isSubmissionLocked) */
export async function loadMemberHome(view: DivisionView, now: Date): Promise<MemberHome> {
  const { scope, division } = view; // TACP-7 — 부서는 단일 해석기에서만
  const me = scope.user; // TACP-1 — 사람은 신원에서만
  const slot = await ensureCurrentSlot(now); // WS-11
  const deadline = effectiveDeadline(slot, division); // WS-18 포함
  const [opening, templates, w] = await Promise.all([
    openingOf(division.id, slot.id),
    prisma.template.count({ where: { divisionId: division.id, isActive: true } }),
    myWeeks({ userId: me.id, divisionId: division.id, upTo: slot.opensAt }),
  ]);

  const locked = isSubmissionLocked(slot, division, opening, now);
  // opened = 마감은 지났지만 담당자가 잠시 열어 둔 동안(TACP-18)
  const phase: ThisWeekCardProps['phase'] = locked ? 'locked' : isLocked(slot, division, now) ? 'opened' : 'open';
  const mineNow = w.mine.find((s) => s.weekSlotId === slot.id) ?? null;
  // PG-67c — 이번 주 [병합본]은 잠긴 뒤, 마감 이벤트(열었다 닫았으면 그 시각) 뒤에 만든 성공본만. 마감 전 미리보기는 아니다
  const doc = locked && (w.mergedAt.get(slot.id)?.getTime() ?? 0) >= mergeGate(deadline, opening).getTime();
  const hasTemplate = templates > 0;

  const past = pickPastWeeks({
    slots: w.slots,
    currentId: slot.id,
    mine: w.mine,
    deptWeekIds: w.deptWeekIds,
    mergedWeekIds: new Set(w.mergedAt.keys()),
    divisionId: division.id,
    joinedMonday: mondayOf(me.createdAt),
    onRoster: me.onRoster, // 68e — 명단 밖이면 빈 줄을 두지 않는다
  });

  const nextMonday = new Date(slot.opensAt.getTime() + 7 * 86_400_000);
  const refreshAt = homeRefreshAt({ now, phase, deadline, openUntil: opening?.openUntil ?? null, nextMonday });

  return {
    card: {
      week: {
        isoKey: slot.isoKey,
        label: slot.label,
        month: slot.month,
        monthly: slotKind(slot) === 'monthly',
        weekStartMs: slot.opensAt.getTime(),
      },
      deadline: { text: formatDeadlineNearKo(deadline, now), changedNote: slot.deadlineNote ?? null },
      phase,
      openUntilText: phase === 'opened' && opening ? toKstIso(opening.openUntil).slice(11, 16) : null,
      refresh: { atMs: refreshAt.getTime(), serverNowMs: now.getTime() },
      // 고친 사람의 id·이름은 싣지 않는다 — 「고침」 여부만(PG-66e). 이름은 열었을 때 preview가 준다(TACP-22)
      mine: mineNow && {
        id: mineNow.id,
        at: toKstIso(mineNow.uploadedAt).slice(5, 16).replace('T', ' '),
        version: mineNow.version,
        edited: mineNow.editedById !== null,
      },
      showMissing: me.onRoster,
      canCompose: phase !== 'locked' && hasTemplate,
      canCancel: !!mineNow && phase !== 'locked', // TACP-14 — 게이트(requireDeletableSubmission)와 같은 식
      noTemplate: phase !== 'locked' && !hasTemplate,
      doc,
      divisionSlug: division.slug,
      me: { id: me.id, name: me.name },
      emptyWordsRaw: division.emptyWords,
    },
    groups: groupPast(past, { year: slot.year, month: slot.month }),
    showMissing: me.onRoster,
  };
}
