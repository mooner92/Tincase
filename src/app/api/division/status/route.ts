// GET /api/division/status — 부서 현황 (API-20/21).
// v2.1: member도 접근 가능하되 축소판 (이름·제출여부·시각만) — AU-06.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, HttpError } from '@/server/authz';
import { divisionStatus, effectiveDeadline, ensureCurrentSlot } from '@/server/worklog';
import { handler, json } from '@/server/http';
import { isLocked, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const isoKey = req.nextUrl.searchParams.get('slot');

  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await ensureCurrentSlot();
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차가 없습니다.');

  const { members, offRoster, summary } = await divisionStatus(scope.division.id, slot.id);
  const deadline = effectiveDeadline(slot, scope.division);
  const locked = isLocked({ opensAt: slot.opensAt }, scope.division);

  const full = scope.isManager || scope.readAll; // TACP-16 — 부서장도 부서 담당자와 같이 본다

  return json({
    slot: { isoKey: slot.isoKey, label: slot.label, year: slot.year, deadlineAt: toKstIso(deadline), locked },
    summary,
    members: members.map((m) => ({
      user: full ? m.user : { name: m.user.name }, // member 축소판: 링크·id·버전 없음
      status: m.status,
      uploadedAt: m.latest ? toKstIso(m.latest.uploadedAt) : null,
      ...(full && {
        latest: m.latest && {
          id: m.latest.id,
          version: m.latest.version,
          byteSize: m.latest.byteSize,
        },
        versionCount: m.versionCount,
      }),
    })),
    ...(full && { offRoster }),
  });
});
