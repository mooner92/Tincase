// GET /api/division/merged?division=&isoKey= — 병합본 내려받기 (API-32).
// 파일명은 취합게시판에 **그대로 올릴 수 있게** 만든다 — 받아서 이름을 고치게 하면
// 자동화한 의미가 절반 사라진다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, resolveTargetDivision, requireMergedAccess, HttpError } from '@/server/authz';
import { handler } from '@/server/http';
import { audit } from '@/server/audit';
import { readStoredFile, contentDisposition } from '@/server/storage';
import { mergedFileName } from '@/server/merge';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  // TACP-7 — 대상 부서는 단일 해석기를 통과한다
  const { division } = await resolveTargetDivision(scope, req.nextUrl.searchParams.get('division'));
  await requireMergedAccess(scope, division.id);

  const isoKey = req.nextUrl.searchParams.get('isoKey');
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) {
    throw new HttpError(404, 'not_found', '아직 병합본이 없습니다.');
  }

  const bytes = await readStoredFile(run.outputPath);
  await audit(scope.user.email, 'download', division.id, `merged:${slot.isoKey}`);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(mergedFileName(slot.year, slot.label, division.nameKo)),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});
