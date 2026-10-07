// POST /api/submissions — 업로드 (API-09~14). 스위치가 꺼진 서버에서는 410 (API-54 · ADR-0014)
import { NextRequest } from 'next/server';
import { requireSubmitter, HttpError } from '@/server/authz';
import { assertHwpUploadOpen } from '@/server/submit-mode';
import { uploadSubmission } from '@/server/worklog';
import { handler, json, rateLimit } from '@/server/http';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireSubmitter(req.headers); // API-45 — 명단 밖은 여기서 걸린다
  // API-54 · WA-31 — 업로드가 닫힌 서버면 파일을 읽기 전에 돌려보낸다. 아무것도 남지 않는다
  assertHwpUploadOpen();
  rateLimit(`upload:${scope.user.email}`, 10, 5 * 60_000); // API-34

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    throw new HttpError(422, 'invalid_file', '파일이 없습니다.');
  }
  // API-09 — 본문의 userId/divisionId류는 읽지도 않는다. 신원에서 도출 (AU-05, DM-12)
  const bytes = Buffer.from(await file.arrayBuffer());

  const result = await uploadSubmission({
    user: scope.user,
    division: scope.division,
    fileName: file.name || 'upload.hwp',
    bytes,
    fromIp: req.headers.get('cf-connecting-ip') ?? undefined,
  });

  return json(
    {
      submission: {
        id: result.submission.id,
        version: result.submission.version,
        uploadedAt: toKstIso(result.submission.uploadedAt),
        byteSize: result.submission.byteSize,
      },
      replacedVersion: result.replacedVersion,
      sameAsPrevious: result.sameAsPrevious, // DM-07
    },
    { status: 201 },
  );
});
