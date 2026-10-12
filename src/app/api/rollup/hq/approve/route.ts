// RU-55 · RU-70 — 본부장의 [검토 완료 · 승인] = **총괄로 제출**. 본부 단계의 head만 (`requireHqReviewer` — HM-47과 같은 규칙:
// 담당자는 자기가 만든 것을 승인하지 않는다). 승인은 **본 판에만** — 화면이 그린 본부본의 runId·sha를 함께 받는다(다르면 409).
// 본부 사본은 이 요청 안에서(승인과 한 트랜잭션), 전사본은 응답 뒤(`after()`)에 맞춘다.
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireHqReviewer, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { later } from '@/server/after';
import { rollupSlot } from '@/server/rollup/slot';
import { approveHq } from '@/server/rollup/handoff';
import { syncOrg } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqReviewer(req.headers);
  rateLimit(`hq-approve:${scope.user.email}`, 10, 60_000);
  const parsed = z
    .object({ isoKey: z.string().optional(), runId: z.string().optional(), sha256: z.string().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const slot = await rollupSlot(parsed.data.isoKey);
  const r = await approveHq(scope, node, slot, parsed.data);
  // RU-78 — 일으킨 사건은 그 본부 사본(`hq_handoff:<id>`) — 전사본 상태 줄이 「기획경영본부 승인으로」라고 말한다.
  // 예전 `hq_approval`은 이름표가 없어 본부장 승인으로 다시 만든 전사본의 「무엇 때문에」가 비었다(2026-10-08 머지 뒤 화면에서 발견)
  const h = r.handedOff;
  if (h) later('syncOrg', () => syncOrg(slot, { cause: `hq_handoff:${h.submissionId}`, causedBy: scope.user.email }));
  return json({ ok: true, unchanged: r.unchanged, handedOff: h ? { target: h.target, at: h.at } : null });
});
