// RU-20·21 — 본부 순서·메모 (내 본부의 lead·head만 — TACP-21)
import { NextRequest } from 'next/server';
import { requireHqManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { orderInput, setHqOrder } from '@/server/rollup/settings';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqManager(req.headers);
  const parsed = orderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await setHqOrder(scope, node, parsed.data);
  return json({ ok: true });
});
