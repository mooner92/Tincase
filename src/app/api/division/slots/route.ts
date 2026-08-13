// GET /api/division/slots — 부서 관점 주차 목록 (lead용 셀렉터)
import { NextRequest } from 'next/server';
import { requireLead } from '@/server/authz';
import { divisionSlots, ensureCurrentSlot, effectiveDeadline } from '@/server/worklog';
import { handler, json } from '@/server/http';
import { isLocked, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireLead(req.headers);
  await ensureCurrentSlot(); // 현재 슬롯이 목록에 반드시 포함되게
  const { slots, roster, submittedOf } = await divisionSlots(scope.division.id);

  return json({
    roster,
    slots: slots.map((s) => ({
      isoKey: s.isoKey,
      label: s.label,
      year: s.year,
      deadlineAt: toKstIso(effectiveDeadline(s, scope.division)),
      locked: isLocked({ opensAt: s.opensAt }, scope.division),
      submitted: submittedOf(s.id),
    })),
  });
});
