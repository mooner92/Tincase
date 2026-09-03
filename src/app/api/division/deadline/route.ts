// POST·DELETE /api/division/deadline — 마감 **잠시 열기·닫기** (DM-20 · TACP-18).
//
// 게이트는 `requireOwnManager` — 병합본 수정과 같은 판정이다. 근거도 같다:
// 이건 «부서가 대외로 내보내는 산출물»에 대한 담당자의 책임이고, coordinator는
// 남의 부서 마감을 열 이유가 없다 (전사 취합은 읽기다, TACP-8).
//
// **부서는 신원에서 나온다** (TACP-6). 본문·URL이 부서를 정하지 않는다.
import { NextRequest } from 'next/server';
import { requireOwnManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { ensureCurrentSlot } from '@/server/worklog';
import { closeSlot, openSlot, openingOf, OPEN_MINUTES } from '@/server/deadline';
import { toKstIso } from '@/lib/week';
import { isOpenNow } from '@/lib/deadline';

export const dynamic = 'force-dynamic';

/** 열기 — 이미 열려 있으면 그만큼 연장한다 */
export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOwnManager(req.headers);
  rateLimit(`deadline-open:${scope.user.email}`, 20, 60_000);

  const slot = await ensureCurrentSlot();
  const open = await openSlot(scope.division, slot, {
    email: scope.user.email,
    name: scope.user.name,
  });

  return json({
    open: true,
    openUntilKst: toKstIso(open.openUntil),
    openedBy: open.openedBy,
    minutes: OPEN_MINUTES,
  });
});

/** 닫기 */
export const DELETE = handler(async (req: NextRequest) => {
  const scope = await requireOwnManager(req.headers);
  rateLimit(`deadline-close:${scope.user.email}`, 20, 60_000);

  const slot = await ensureCurrentSlot();
  const before = await openingOf(scope.division.id, slot.id);
  if (!isOpenNow(before)) throw new HttpError(409, 'not_open', '열려 있지 않습니다.');

  await closeSlot(scope.division, slot, { email: scope.user.email });
  return json({ open: false });
});
