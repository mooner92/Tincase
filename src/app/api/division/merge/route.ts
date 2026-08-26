// POST /api/division/merge — 자동 병합 실행 (API-30). lead 전용.
// 마감이 지나면 스케줄러가 알아서 돌리므로(HM-25) 이 경로는 **재실행**이 주 용도다:
// 설정을 고쳤거나, 자동 실행이 실패했거나, 늦게 낸 사람을 반영할 때.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { runMergeRecorded } from '@/server/merge/run';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 병합 대상은 언제나 신원의 부서다. 슬러그로 남의 부서를 병합할 수 없다
  // TACP §3.2 — 병합 **실행**은 lead·head·coordinator·operator (자기 부서).
  // 「병합본 수정」과 다른 칸이다 — 그쪽은 coordinator가 빠진다 (requireOwnManager)
  const scope = await requireManager(req.headers);

  const isoKey = String((await req.json().catch(() => ({})))?.isoKey ?? '');
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  const result = await runMergeRecorded(scope.division.id, slot.id, 'manual');
  await audit(scope.user.email, 'merge', scope.division.id, `slot:${slot.isoKey}`, {
    status: result.status,
  });

  if (result.status === 'failed') {
    throw new HttpError(422, 'merge_failed', result.errorText ?? '병합에 실패했습니다.');
  }
  return json(result);
});
