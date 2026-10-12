// RU-31·82 — 본부 취합 (TACP-21 · TACP-23).
//   GET  ?isoKey=&node=   현황 — 내 본부, 또는 readAll의 다른 본부(읽기만). 그리기 **전에** 본부본을 맞춘다(읽기 수리, RU-72)
//   POST { isoKey }       [다시 시도] — 만들기가 **실패했을 때만** 뜻이 있다. 내 본부의 lead·head (RU-76)
//
// 2026-10-08(ADR-0015) 전에는 POST가 [이어 붙이기]였다. 이제 본부본은 산하 사본이 바뀔 때마다 저절로 이어 붙는다(auto.ts).
// [다시 시도]도 입력을 고르지 못한다 — 본문의 isoKey 말고는 아무것도 읽지 않는다(TACP-23 · RU-T121).
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireHqManager, requireScope, resolveHqView, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { hqBoard } from '@/server/rollup/run';
import { readRepairHq, syncHq } from '@/server/rollup/auto';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const { node, canWrite } = await resolveHqView(scope, req.nextUrl.searchParams.get('node'));
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  await readRepairHq(node, slot); // 보는 사람과 상관없이 같은 결과 — 조립은 system의 것이다
  return json({ board: await hqBoard(node, slot), canWrite, slot: { isoKey: slot.isoKey, label: slot.label } });
});

export const POST = handler(async (req: NextRequest) => {
  const { scope, node } = await requireHqManager(req.headers);
  // 입력 목록·본부·부서는 받지 않는다 — 실어 보내도 무시한다(입력은 나무와 받은 사본이 정한다)
  const parsed = z.object({ isoKey: z.string().optional() }).passthrough().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const slot = await rollupSlot(parsed.data.isoKey);
  await syncHq(node, slot, { cause: 'retry', causedBy: scope.user.email, force: true });
  const board = await hqBoard(node, slot);
  if (board.lastRun?.status === 'failed') {
    throw new HttpError(500, 'rollup_failed', `이어 붙이지 못했습니다 — ${board.lastRun.errorText ?? '알 수 없는 오류'}`);
  }
  return json({ runId: board.current?.id ?? null, state: board.state });
});
