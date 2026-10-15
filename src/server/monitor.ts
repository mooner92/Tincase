// 전사 제출 현황 데이터 — 「전사」 화면(/org, PG-51)의 제출 열이 쓴다.
// 예전에는 원형 조직도 그래프(/ops/monitor/graph)도 이것을 함께 썼다 — 두 화면이 각자 세면
// 「현황판은 41명, 그래프는 42명」 같은 어긋남이 생기기 때문이다. 그래프는 2026-10-07에 걷어 냈다(PG-50e).
// 감사 문서(OPS-30)는 따로 읽지만(인쇄용 그림의 부서 순서가 다르다), 세는 식은 화면과 같다 ([PG-T73]).
//
// 주차를 받는다 — 「전사」 화면은 주차 고르기가 있다(PG-51a). 예전 [현황] 탭은 이번 주만 보았다.
import type { WeekSlot } from '@prisma/client';
import { prisma } from './db';
import { toKstIso } from '@/lib/week';
import type { DivisionNode } from '@/lib/orgtree';

export async function progressNodes(slot: Pick<WeekSlot, 'id'>, now = new Date()) {
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
    // DM-15 개정(2026-10-14) — **켜진 부서를 센다.** 예전에는 취합게시판 제출 이력(R-002)으로 셌는데, 「안 낸다」던 연구 실들도
    // 본부 표로 내고 있었다(한 실이 본부 안 다른 실 것까지 모아 낸다). 모든 부서가 쓰게 되므로 이력은 기준이 아니다 —
    // 켜면 그날부터 집계에 든다(RU-96 「켜진 부서만 다룬다」와 같은 기준). 이력으로 두면 연구 실을 켜도 집계에서 빠졌다
    counted: d.isActive,
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
  // `nodes`는 집계 밖 부서까지 전부다 — groupBySection이 상위부서를 따라 섹션을 찾으려면 집계 밖 본부도 보여야 한다
  const skipped = nodes.filter((n) => !n.counted);
  return {
    nodes,
    excludedNote: {
      divisions: skipped.length,
      people: skipped.reduce((n, d) => n + d.people.filter((p) => p.onRoster).length, 0),
    },
    capturedAtKst: toKstIso(now).slice(5, 16).replace('T', ' ') + ' 기준',
  };
}
