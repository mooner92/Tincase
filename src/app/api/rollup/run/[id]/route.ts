// RU-31·32 — 본부본·전사본 내려받기. 읽기 판정은 findReadableRollup 하나 (TACP-21)
import { NextRequest } from 'next/server';
import { requireScope, findReadableRollup, HttpError } from '@/server/authz';
import { handler } from '@/server/http';
import { audit } from '@/server/audit';
import { contentDisposition, readStoredFile } from '@/server/storage';
import { mergedFileName } from '@/server/merge';
import { slotKind } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const run = await findReadableRollup(scope, id);
  if (run.status !== 'succeeded' || !run.outputPath) throw new HttpError(404, 'not_found', '내려받을 결과가 없습니다.');
  const bytes = await readStoredFile(run.outputPath);
  await audit(scope.user.email, 'download', run.divisionId, `rollup:${run.id}`);
  const owner = run.level === 'org' ? '전사' : (run.division?.nameKo ?? '본부');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(mergedFileName(run.weekSlot.year, run.weekSlot.label, owner, slotKind(run.weekSlot))),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});
