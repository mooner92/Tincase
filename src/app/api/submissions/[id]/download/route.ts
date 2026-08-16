// GET /api/submissions/:id/download — ST-13/15, API-15/16
import { NextRequest } from 'next/server';
import { requireScope, findAccessibleSubmission } from '@/server/authz';
import { contentDisposition, readStoredFile } from '@/server/storage';
import { submissionName } from '@/lib/docname';
import { handler } from '@/server/http';
import { audit } from '@/server/audit';
import { logger } from '@/server/logger';
import { HttpError } from '@/server/authz';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const sub = await findAccessibleSubmission(scope, id); // 접근 판정은 전부 여기서 (AU-13)

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(sub.filePath);
  } catch (e) {
    // ST-10 방향의 정합성 이탈 — DB엔 있는데 파일이 없음. 감지 가능한 실패
    logger.error({ submissionId: sub.id, filePath: sub.filePath, err: String(e) }, 'CRITICAL: stored file missing');
    throw new HttpError(500, 'internal', '파일을 찾을 수 없습니다. 운영자에게 문의하세요.');
  }

  await audit(scope.user.email, 'download', sub.divisionId, `submission:${sub.id}`);

  const filename = submissionName(sub.weekSlot.year, sub.weekSlot.label, sub.division.nameKo, sub.user.name);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp', // ST-14
      'Content-Disposition': contentDisposition(filename), // ST-13
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});
