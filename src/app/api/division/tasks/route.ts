// GET /api/division/tasks — RH-71 · RH-72 · RH-74: 연구실 작성 화면이 고를 「우리 실 최근 과제」 · 장소·참석자 제안 · 내 지난주 계획.
// 부서는 신원에서만 나온다(TACP-6) — 요청이 부서를 정하지 않는다. 제출할 수 있는 사람이면 볼 수 있다(같은 실의 과제 이름뿐이다).
import { NextRequest } from 'next/server';
import { isDocumentManager, requireSubmitter } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { ensureCurrentSlot } from '@/server/worklog';
import { projectDesk, recentForDivision } from '@/server/project-form';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireSubmitter(req.headers);
  rateLimit(`tasks:${scope.user.email}`, 30, 60_000);
  const slot = await ensureCurrentSlot();
  const [recent, desk] = await Promise.all([
    recentForDivision(scope.division.id, scope.user.id, slot),
    projectDesk(scope.division, isDocumentManager(scope.user)), // RH-82 — 담당·부서장에게만 자문회의·평가 칸
  ]);
  return json({ ...recent, desk });
});
