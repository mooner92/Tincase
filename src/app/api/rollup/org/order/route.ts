// RU-20·21 — 전사 순서·메모 (총괄·운영자 — TACP-21)
import { NextRequest } from 'next/server';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { orderInput, setOrgOrder } from '@/server/rollup/settings';
import { laterSyncCurrentWeek } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = orderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await setOrgOrder(scope, parsed.data);
  // RU-72 — 본부 순서는 섹션 구성과 별개지만 도착 순서·나무가 바뀐 것과 같게 맞춘다(같은 열쇠면 아무것도 하지 않는다)
  laterSyncCurrentWeek({ cause: 'order', causedBy: scope.user.email });
  return json({ ok: true });
});
