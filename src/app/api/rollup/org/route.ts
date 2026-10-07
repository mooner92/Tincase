// RU-32 — 전사 취합 (총괄·운영자 — TACP-21).
//   GET  ?isoKey=   현황
//   POST { isoKey } 이어 붙이기 (총괄 「딸깍」)
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { orgBoard, runOrgRollup } from '@/server/rollup/run';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireOrgRollup(req.headers);
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  return json({ board: await orgBoard(slot), slot: { isoKey: slot.isoKey, label: slot.label } });
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = z.object({ isoKey: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const run = await runOrgRollup(scope, await rollupSlot(parsed.data.isoKey));
  if (run.status !== 'succeeded') throw new HttpError(500, 'rollup_failed', `이어 붙이지 못했습니다 — ${run.errorText ?? '알 수 없는 오류'}`);
  return json({ runId: run.id });
});
