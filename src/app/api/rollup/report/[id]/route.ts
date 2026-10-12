// RU-31 — 보낸 사본 내려받기. 읽기 판정은 findReadableReport 하나 (TACP-21)
import { NextRequest } from 'next/server';
import { requireScope, findReadableReport } from '@/server/authz';
import { handler } from '@/server/http';
import { audit } from '@/server/audit';
import { contentDisposition, readStoredFile } from '@/server/storage';
import { mergedFileName } from '@/server/merge';
import { slotKind } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const r = await findReadableReport(scope, id);
  const bytes = await readStoredFile(r.filePath);
  await audit(scope.user.email, 'download', r.divisionId, `report:${r.id}`);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(mergedFileName(r.weekSlot.year, r.weekSlot.label, r.division.nameKo, slotKind(r.weekSlot))),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});
