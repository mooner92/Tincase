// RU-20·21 — 전사 순서·메모 (총괄·운영자 — TACP-21)
import { NextRequest } from 'next/server';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { orderInput, setOrgOrder } from '@/server/rollup/settings';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = orderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await setOrgOrder(scope, parsed.data);
  return json({ ok: true });
});
