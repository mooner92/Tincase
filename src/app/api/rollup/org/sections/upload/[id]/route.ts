// RU-60 — 총괄이 올린 섹션 파일 내려받기 (총괄·운영자)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler } from '@/server/http';
import { contentDisposition, readStoredFile } from '@/server/storage';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireOrgRollup(req.headers);
  const { id } = await ctx.params;
  const u = await prisma.orgSectionUpload.findUnique({ where: { id } });
  if (!u) throw new HttpError(404, 'not_found', '파일을 찾을 수 없습니다.');
  const bytes = await readStoredFile(u.filePath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(u.originalName),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});
