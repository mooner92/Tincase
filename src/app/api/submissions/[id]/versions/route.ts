// GET /api/submissions/:id/versions — 드로어 버전 전환용 (CP-73)
// :id가 속한 (사용자, 주차)의 전체 버전 목록. 권한은 :id 접근 판정과 동일.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, findAccessibleSubmission } from '@/server/authz';
import { handler, json } from '@/server/http';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const sub = await findAccessibleSubmission(scope, id);

  const versions = await prisma.submission.findMany({
    where: { userId: sub.userId, weekSlotId: sub.weekSlotId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, isLatest: true, uploadedAt: true, byteSize: true },
  });

  return json({
    versions: versions.map((v) => ({ ...v, uploadedAt: toKstIso(v.uploadedAt) })),
  });
});
