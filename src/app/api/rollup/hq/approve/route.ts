// RU-55 — 본부장의 [검토 완료 · 승인]. 본부 단계의 head만 (HM-47과 같은 규칙 — 담당자는 자기가 만든 것을 승인하지 않는다)
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireHqManager, isReviewer, notFound, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { rollupSlot } from '@/server/rollup/slot';
import { approveHq } from '@/server/rollup/notices';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqManager(req.headers);
  if (!isReviewer(scope)) throw notFound();
  rateLimit(`hq-approve:${scope.user.email}`, 10, 60_000);
  const parsed = z.object({ isoKey: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const r = await approveHq(scope, node, await rollupSlot(parsed.data.isoKey));
  return json({ ok: true, unchanged: r.unchanged });
});
