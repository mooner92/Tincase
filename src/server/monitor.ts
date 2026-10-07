// 전사 현황 데이터 — 현황판(/ops/monitor, PG-50)이 쓴다.
// 예전에는 원형 조직도 그래프(/ops/monitor/graph)도 이것을 함께 썼다 — 두 화면이 각자 세면
// 「현황판은 41명, 그래프는 42명」 같은 어긋남이 생기기 때문이다. 그래프는 2026-10-07에 걷어 냈다(PG-50e).
// 감사 문서(OPS-30)는 지난 주차도 받아야 해서 따로 읽지만, 세는 식은 본판과 같다 ([PG-T73]).
import { prisma } from './db';
import { ensureCurrentSlot } from './worklog';
import { earliestDeadline } from './slot-deadline';
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
  // 집계 대상만 추린 `counted` 목록은 원형 그래프(layoutOrg(data.counted))만 받았다 — 그래프와 함께 뺐다(PG-50e).
  // 본판은 `nodes` 전부를 받아 groupByHq 안에서 거른다(최상위 본부를 찾으려면 집계 밖 부서도 보여야 한다)
  const skipped = nodes.filter((n) => !n.counted);
  return {
    slot,
    nodes,
    excludedNote: {
      divisions: skipped.length,
      people: skipped.reduce((n, d) => n + d.people.filter((p) => p.onRoster).length, 0),
    },
    // WS-19 — 켜진 부서 중 **가장 이른** 마감 (주차 마감 예외 화면과 같은 식). 첫 부서를 대표로 쓰지 않는다
    deadlineText: formatDeadlineKo(earliestDeadline(slot, divisions.filter((d) => d.isActive))),
    capturedAtKst: toKstIso(now).slice(5, 16).replace('T', ' ') + ' 기준',
  };
}
