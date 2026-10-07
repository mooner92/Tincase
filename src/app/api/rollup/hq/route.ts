// RU-31 — 본부 취합 (TACP-21).
//   GET  ?isoKey=&node=   현황 — 내 본부, 또는 readAll의 다른 본부(읽기만)
//   POST { isoKey }       이어 붙이기 — 내 본부의 lead·head만
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireHqManager, requireScope, resolveHqView, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { hqBoard, runHqRollup } from '@/server/rollup/run';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const { node, canWrite } = await resolveHqView(scope, req.nextUrl.searchParams.get('node'));
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  return json({ board: await hqBoard(node, slot), canWrite, slot: { isoKey: slot.isoKey, label: slot.label } });
});

export const POST = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqManager(req.headers);
  const parsed = z.object({ isoKey: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const run = await runHqRollup(scope, node, await rollupSlot(parsed.data.isoKey));
  if (run.status !== 'succeeded') throw new HttpError(500, 'rollup_failed', `이어 붙이지 못했습니다 — ${run.errorText ?? '알 수 없는 오류'}`);
  return json({ runId: run.id });
});
