// GET /api/division/download-zip — lead 전용, isLatest 전체 zip (ST-16, API-25~29 상당)
import { NextRequest } from 'next/server';
import { ZipArchive } from 'archiver'; // archiver v8+ 클래스 API
import { PassThrough, Readable } from 'node:stream';
import { prisma } from '@/server/db';
import { requireLead, HttpError } from '@/server/authz';
import { ensureCurrentSlot } from '@/server/worklog';
import { resolveInRoot, contentDisposition } from '@/server/storage';
import { handler, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireLead(req.headers); // member는 404 (AU-06)
  rateLimit(`zip:${scope.user.email}`, 3, 60_000);

  const isoKey = req.nextUrl.searchParams.get('slot');
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await ensureCurrentSlot();
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차가 없습니다.');

  const subs = await prisma.submission.findMany({
    where: { divisionId: scope.division.id, weekSlotId: slot.id, isLatest: true }, // 격리 축 (ST-T16)
    include: { user: true },
    orderBy: { uploadedAt: 'asc' },
  });
  if (subs.length === 0) {
    throw new HttpError(409, 'no_submissions', '제출된 파일이 없습니다.');
  }

  const zipName = `${scope.division.nameKo}_${slot.year}_${slot.label.replace(/ /g, '_')}_주간업무.zip`;

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const pass = new PassThrough();
  archive.pipe(pass);
  for (const s of subs) {
    archive.file(resolveInRoot(s.filePath), { name: `${s.user.name}.hwp` }); // 평면 구조
  }
  void archive.finalize();

  await audit(scope.user.email, 'download_zip', scope.division.id, `slot:${slot.isoKey}`, {
    count: subs.length,
  });

  return new Response(Readable.toWeb(pass) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(zipName),
      'Cache-Control': 'no-store',
    },
  });
});
