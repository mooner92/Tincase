// RU-60·65 — 전사 섹션 (총괄·운영자 — TACP-21).
//   GET ?isoKey=   섹션 목록 + 이번 주 출처(Tincase 제출·총괄 업로드·미제출)
//   PUT { sections: [{id,title,divisionId,isActive}] }   순서·제목·부서 저장 (목록 순서 = 문서 순서)
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { rollupSlot } from '@/server/rollup/slot';
import { resolveSections, saveSections } from '@/server/rollup/sections';
import { later } from '@/server/after';
import { syncOrg } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireOrgRollup(req.headers);
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  const [sources, divisions] = await Promise.all([
    resolveSections(slot),
    prisma.division.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nameKo: true, isActive: true } }),
  ]);
  return json({
    slot: { isoKey: slot.isoKey, label: slot.label },
    sections: sources.map((s) => ({
      flag: s.flag ?? null,
      id: s.section.id,
      title: s.section.title,
      divisionId: s.section.divisionId,
      kind: s.section.kind,
      source: s.kind,
      label: s.label,
      refId: s.refId ?? null,
      offline: s.offline,
    })),
    divisions,
  });
});

const body = z.object({
  sections: z.array(z.object({ id: z.string(), title: z.string().max(60), divisionId: z.string().nullable(), isActive: z.boolean() })).max(40),
});

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await saveSections(scope, parsed.data.sections);
  // RU-72 — 섹션 구성(순서·제목·부서)이 바뀌면 전사본을 다시 만든다(전사본은 늘 준비돼 있다, RU-83)
  later('syncOrg', async () => syncOrg(await rollupSlot(null), { cause: 'sections', causedBy: scope.user.email }));
  return json({ ok: true });
});
