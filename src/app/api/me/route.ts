// GET /api/me — 신원·부서·현재 슬롯·본인 제출 (API-07/08)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope } from '@/server/authz';
import { ensureCurrentSlot, effectiveDeadline } from '@/server/worklog';
import { handler, json } from '@/server/http';
import { isLocked, msUntilDeadline, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const now = new Date();
  const slot = await ensureCurrentSlot(now);
  const deadline = effectiveDeadline(slot, scope.division);
  const nextOpens = new Date(slot.opensAt.getTime() + 7 * 86400_000);

  const mySubmission = await prisma.submission.findFirst({
    where: { userId: scope.user.id, weekSlotId: slot.id, isLatest: true },
  });

  return json({
    user: {
      id: scope.user.id,
      name: scope.user.name,
      divisionRole: scope.user.divisionRole,
      isOperator: scope.user.isOperator,
      isCoordinator: scope.user.isCoordinator,
    },
    division: {
      slug: scope.division.slug,
      shortSlug: scope.division.shortSlug,
      nameKo: scope.division.nameKo,
      deadlineDow: scope.division.deadlineDow,
      deadlineTime: scope.division.deadlineTime,
    },
    slot: {
      isoKey: slot.isoKey,
      label: slot.label,
      year: slot.year,
      opensAt: toKstIso(slot.opensAt),
      deadlineAt: toKstIso(deadline),
      locked: isLocked({ opensAt: slot.opensAt }, scope.division, now),
      msUntilDeadline: msUntilDeadline(deadline, now),
      nextOpensAt: toKstIso(nextOpens),
    },
    mySubmission: mySubmission && {
      id: mySubmission.id,
      version: mySubmission.version,
      uploadedAt: toKstIso(mySubmission.uploadedAt),
      originalName: mySubmission.originalName,
      byteSize: mySubmission.byteSize,
    },
  });
});
