// RU-20·21 — 본부 순서·메모·쪽 나누기·자기 문서 포함 (내 본부의 lead·head만 — TACP-21).
// 저장하면 응답 뒤에 본부본을 다시 맞춘다(RU-72) — 순서가 바뀌면 열쇠가 바뀌어 다시 이어 붙고, 본부장 승인이 있었으면 풀린다(RU-55a)
import { NextRequest } from 'next/server';
import { requireHqManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { later } from '@/server/after';
import { orderInput, setHqOrder } from '@/server/rollup/settings';
import { syncHq, syncOrg } from '@/server/rollup/auto';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqManager(req.headers);
  const parsed = orderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await setHqOrder(scope, node, parsed.data);
  later('syncHq', async () => {
    const slot = await rollupSlot(null);
    const opts = { cause: 'order', causedBy: scope.user.email };
    // 자기 문서를 넣고 빼면 기여 단위가 바뀐다 — 본부 단계가 생기거나 없어질 수 있어 나무를 다시 읽는다(syncHq 안에서)
    await syncHq(node, slot, opts);
    await syncOrg(slot, opts);
  });
  return json({ ok: true });
});
