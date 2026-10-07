// RU-32 — 전사 취합 (총괄·운영자 — TACP-21).
//   GET  ?isoKey=   섹션별 출처 + 최근 전사 취합본
//   POST { isoKey } 전사 취합본 만들기 (총괄 「딸깍」) — 섹션을 원래 꼴 그대로 (RU-60~64)
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { resolveSections } from '@/server/rollup/sections';
import { lastOrgRun, runOrgDocument } from '@/server/rollup/orgrun';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireOrgRollup(req.headers);
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  const sources = await resolveSections(slot);
  return json({
    slot: { isoKey: slot.isoKey, label: slot.label },
    sections: sources.map((x) => ({ id: x.section.id, title: x.section.title, source: x.kind, label: x.label, offline: x.offline })),
    lastRun: await lastOrgRun(slot, sources),
  });
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = z.object({ isoKey: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const run = await runOrgDocument(scope, await rollupSlot(parsed.data.isoKey));
  if (run.status !== 'succeeded') throw new HttpError(500, 'rollup_failed', `만들지 못했습니다 — ${run.errorText ?? '알 수 없는 오류'}`);
  return json({ runId: run.id });
});
