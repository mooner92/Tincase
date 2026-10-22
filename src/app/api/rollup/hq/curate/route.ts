// RH-120~125 — 본부 다듬기 (TACP-21 v1.19 — 내 본부의 lead·head · 지정된 본부 담당).
//   GET ?isoKey=&node=   항목(규칙 답 · 사람이 정한 것) · 자문회의 줄 · 어림 쪽 수
//   PUT { isoKey, node?, decisions, consult }   저장 → 본부본을 그 자리에서 다시 맞춘다(입력 열쇠에 다듬기가 들어간다 — RH-124)
// 사본을 고르거나 글을 고치는 길은 없다 — 항목을 빼고(다시 넣고) 자문회의 값을 고치는 것뿐(ADR-0024).
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireHqManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { rollupSlot } from '@/server/rollup/slot';
import { syncHq } from '@/server/rollup/auto';
import { curateBoard, saveCuration } from '@/server/rollup/curation';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const { node } = await requireHqManager(req.headers, req.nextUrl.searchParams.get('node'));
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  return json(await curateBoard(node, slot));
});

const KEY = /^[0-9a-f]{16}(\.\d{1,3})?$/;
const body = z.object({
  isoKey: z.string().optional(),
  node: z.string().max(80).optional(),
  decisions: z.record(z.string().regex(KEY), z.boolean()).refine((r) => Object.keys(r).length <= 2000),
  consult: z.record(z.string().max(60), z.array(z.string().max(20)).length(4)).refine((r) => Object.keys(r).length <= 30),
});

export const PUT = handler(async (req: NextRequest) => {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const { scope, node } = await requireHqManager(req.headers, parsed.data.node); // ADR-0022 D2 — 맡은 본부 중 고르기
  rateLimit(`hq-curate:${scope.user.email}`, 30, 60_000);
  const slot = await rollupSlot(parsed.data.isoKey);
  await saveCuration(scope.user.email, node, slot, parsed.data);
  // 화면이 저장 뒤 본부본 카드를 다시 그리면 새 판이 있어야 한다 — 응답 전에 맞춘다(크기가 작다 · [다시 시도]와 같은 길)
  await syncHq(node, slot, { cause: 'curate', causedBy: scope.user.email });
  return json(await curateBoard(node, slot));
});
