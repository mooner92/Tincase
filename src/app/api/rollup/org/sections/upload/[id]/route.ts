// RU-60 — 총괄이 올린 섹션 파일 내려받기 (총괄·운영자). 판정·기록은 findReadableSectionUpload 하나 (TACP-21)
import { NextRequest } from 'next/server';
import { requireScope, findReadableSectionUpload } from '@/server/authz';
import { handler } from '@/server/http';
import { contentDisposition, readStoredFile } from '@/server/storage';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const u = await findReadableSectionUpload(scope, id);
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
