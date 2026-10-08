// RU-32·83 — 전사 취합 (총괄·운영자 — TACP-21 · TACP-23).
//   GET  ?isoKey=   섹션별 출처 + 전사본. 그리기 **전에** 전사본을 맞춘다(읽기 수리, RU-72)
//   POST { isoKey } [다시 시도] — 만들기가 **실패했을 때만** 뜻이 있다(RU-76). 마지막이 성공이고 열쇠가 같으면 아무것도 하지 않는다
//
// 2026-10-08(ADR-0015) 전에는 POST가 [전사 취합본 만들기]였다. 이제 전사본은 섹션 출처가 바뀔 때마다 저절로 다시 만들어진다 —
// 총괄은 보고 받기만 한다. [다시 시도]도 입력을 고르지 못한다(TACP-23).
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { resolveSections } from '@/server/rollup/sections';
import { lastOrgRun, orgRunState } from '@/server/rollup/orgrun';
import { readRepairOrg, syncOrg } from '@/server/rollup/auto';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireOrgRollup(req.headers);
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  await readRepairOrg(slot);
  const sources = await resolveSections(slot);
  const state = await orgRunState(slot, sources);
  return json({
    slot: { isoKey: slot.isoKey, label: slot.label },
    sections: sources.map((x) => ({ id: x.section.id, title: x.section.title, source: x.kind, label: x.label, offline: x.offline, flag: x.flag ?? null })),
    lastRun: await lastOrgRun(slot, sources),
    current: state.current,
    failed: state.failed,
  });
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = z.object({ isoKey: z.string().optional() }).passthrough().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const slot = await rollupSlot(parsed.data.isoKey);
  await syncOrg(slot, { cause: 'retry', causedBy: scope.user.email, force: true });
  const last = await lastOrgRun(slot);
  if (last?.status === 'failed') throw new HttpError(500, 'rollup_failed', `만들지 못했습니다 — ${last.errorText ?? '알 수 없는 오류'}`);
  return json({ runId: last?.id ?? null });
});
