// GET /api/my/history — 본인 제출 이력 (최근 26주)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope } from '@/server/authz';
import { handler, json } from '@/server/http';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const slots = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: 26 });
  const subs = await prisma.submission.findMany({
    where: { userId: scope.user.id, weekSlotId: { in: slots.map((s) => s.id) }, isLatest: true },
  });
  const byId = new Map(subs.map((s) => [s.weekSlotId, s]));
  return json({
    weeks: slots.map((s) => {
      const sub = byId.get(s.id) ?? null;
      return {
        isoKey: s.isoKey,
        label: s.label,
        year: s.year,
        submission: sub && {
          id: sub.id,
          version: sub.version,
          uploadedAt: toKstIso(sub.uploadedAt),
          byteSize: sub.byteSize,
        },
      };
    }),
  });
});
