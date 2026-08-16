// DELETE /api/submissions/:id — 제출 취소 (API-40, ST-30~33, TACP-14)
//
// 넘기는 id는 "그 사람의 그 주차 제출"을 가리키는 손잡이일 뿐이다.
// 실제로는 그 주차의 **모든 버전**이 함께 사라진다 (ADR-0007).
import { NextRequest } from 'next/server';
import { requireScope, requireDeletableSubmission } from '@/server/authz';
import { deleteSubmission } from '@/server/worklog';
import { handler, json, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  rateLimit(`delete:${scope.user.email}`, 20, 5 * 60_000); // 업로드(10)보다 넉넉 — 정리 작업은 연속으로 일어난다

  const { id } = await ctx.params;
  // 권한·마감 판정은 전부 게이트에서 (TACP-12). 여기서 역할 플래그를 보지 않는다
  const sub = await requireDeletableSubmission(scope, id);

  const result = await deleteSubmission(sub, scope.user.email);
  return json(result);
});
