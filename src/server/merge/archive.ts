// PG-45 — 보관함: 주차마다 **마지막 성공 병합본** 하나씩.
//
// 예전에는 성공 실행 최근 60건을 읽은 뒤 주차로 접었다. 마감 전 미리보기·재병합이 모두 성공 행으로 쌓이므로
// 재병합이 잦은 부서는 60건이 금방 차고, 그보다 오래된 주차는 **목록에서 소리 없이 사라진다** — 링크가 깨진 것이
// 아니라 아예 나오지 않아서 아무도 이상한 줄 모른다. 그래서 주차를 먼저 고르고, 고른 실행만 읽는다.
import { prisma } from '../db';

export async function latestRunPerWeek(divisionId: string) {
  // 1) 가벼운 열만 — 주차마다 가장 늦게 시작한 성공 실행 id를 고른다 (reviewJson처럼 큰 열은 읽지 않는다)
  const heads = await prisma.mergeRun.findMany({
    where: { divisionId, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, weekSlotId: true },
  });
  const seen = new Set<string>();
  const ids = heads.filter((r) => !seen.has(r.weekSlotId) && seen.add(r.weekSlotId)).map((r) => r.id);
  if (ids.length === 0) return [];

  // 2) 고른 실행만 화면에 필요한 열로. 순서는 예전과 같다 — 최근에 만든 것이 위
  return prisma.mergeRun.findMany({
    where: { id: { in: ids } },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      weekSlotId: true,
      startedAt: true,
      finishedAt: true,
      rowCounts: true,
      sourceIds: true,
      weekSlot: true,
    },
  });
}
