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
    select: { id: true, version: true, isLatest: true, uploadedAt: true, byteSize: true, editedById: true, editedAt: true },
  });
  // TACP-22 — 담당자가 고친 판에는 고친 사람 이름을 붙인다
  const editorIds = [...new Set(versions.map((v) => v.editedById).filter((x): x is string => !!x))];
  const editors = new Map(
    (await prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return json({
    versions: versions.map(({ editedById, editedAt, ...v }) => ({
      ...v,
      uploadedAt: toKstIso(v.uploadedAt),
      editedBy: editedById ? (editors.get(editedById) ?? '담당자') : null,
      // TACP-22 — 고친 시각은 따로. `uploadedAt`은 부서원이 낸 시각이다
      editedAt: editedAt ? toKstIso(editedAt) : null,
    })),
  });
});
