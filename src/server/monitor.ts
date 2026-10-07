// 전사 현황 데이터 — 현황판(/ops/monitor)과 조직도 그래프(/ops/monitor/graph)가 같은 것을 쓴다.
// 두 화면이 각자 세면 「현황판은 41명, 그래프는 42명」 같은 어긋남이 생긴다.
import { prisma } from './db';
import { ensureCurrentSlot, effectiveDeadline } from './worklog';
import { missingStreaks } from './streak';
import { formatDeadlineKo, toKstIso } from '@/lib/week';
import type { DivisionNode } from '@/lib/orgtree';

export async function monitorData(now = new Date()) {
  const slot = await ensureCurrentSlot(now);
  const divisions = await prisma.division.findMany({
    // ERP 등록 순서 = 조직도 순서 (임원실 → 감사실 → … → 기획경영본부 → 기획조정실 …)
    orderBy: { createdAt: 'asc' },
    include: {
      users: {
        where: { isActive: true },
        orderBy: [{ divisionRole: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, divisionRole: true, onRoster: true },
      },
    },
  });
  const subs = await prisma.submission.findMany({
    where: { weekSlotId: slot.id, isLatest: true },
    select: { userId: true, uploadedAt: true },
  });
  const byUser = new Map(subs.map((s) => [s.userId, s.uploadedAt]));

  const nodes: DivisionNode[] = divisions.map((d) => ({
    id: d.id,
    name: d.nameKo,
    slug: d.slug,
    parent: d.parentKo,
    isActive: d.isActive,
    // R-002 실측 — 취합게시판 제출 이력이 있는 부서만 집계한다.
    // 연구부서 17개(232명)는 애초에 주간 업무일지를 내지 않는다.
    counted: d.boardStatus === 'confirmed',
    people: d.users.map((u) => {
      const at = byUser.get(u.id);
      return {
        id: u.id,
        name: u.name,
        submitted: !!at,
        isLead: u.divisionRole === 'lead',
        onRoster: u.onRoster,
        submittedAtKst: at ? toKstIso(at).slice(5, 16).replace('T', ' ') : null,
      };
    }),
  }));
  const counted = nodes.filter((n) => n.counted);
  const skipped = nodes.filter((n) => !n.counted);
  const active = divisions.find((d) => d.isActive) ?? divisions[0];
  return {
    slot,
    nodes,
    counted,
    excludedNote: {
      divisions: skipped.length,
      people: skipped.reduce((n, d) => n + d.people.filter((p) => p.onRoster).length, 0),
    },
    // 스냅샷이 못 보여주는 것 — "이번 주 안 냄"과 "3주 연속 안 냄"은 다른 얘기다
    streaks: await missingStreaks(now),
    deadlineText: active ? formatDeadlineKo(effectiveDeadline(slot, active)) : '',
    capturedAtKst: toKstIso(now).slice(5, 16).replace('T', ' ') + ' 기준',
  };
}
