// POST /api/division/template — 부서 양식 교체 (API-40/41, ST-19). lead 전용.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { sha256, templateRelPath, writeFileAtomic } from '@/server/storage';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP §3.1 — 내 부서 양식은 lead·head·coordinator·operator가 등록한다 (TACP-6: 대상은 신원의 부서)
  const scope = await requireManager(req.headers);
  rateLimit(`template:${scope.user.email}`, 5, 60_000);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError(422, 'invalid_file', '파일이 없습니다.');
  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.length > env.MAX_UPLOAD_BYTES) throw new HttpError(422, 'invalid_file', '파일이 너무 큽니다 (최대 20MB).');
  if (!/\.hwp$/i.test(file.name)) throw new HttpError(422, 'invalid_file', '한글(.hwp) 파일만 등록할 수 있습니다.');

  // ST-19 — 제출물과 동일 검증 + 표 구조 필수. 양식이 깨지면 부서 전체가 막히므로 여기서 잡는다
  let parsed;
  try {
    parsed = validateHwpUpload(bytes);
  } catch (e) {
    if (e instanceof UploadValidationError) {
      throw new HttpError(422, 'invalid_file', `양식 검증 실패: ${e.message} (기존 양식은 그대로 유지됩니다)`);
    }
    throw e;
  }

  const hash = sha256(bytes);
  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.template.findFirst({
      where: { divisionId: scope.division.id },
      orderBy: { version: 'desc' },
    });
    if (last?.sha256 === hash && last.isActive) {
      throw new HttpError(409, 'conflict', '현재 양식과 동일한 파일입니다.');
    }
    const version = (last?.version ?? 0) + 1;
    await tx.template.updateMany({
      where: { divisionId: scope.division.id, isActive: true },
      data: { isActive: false },
    });
    const rel = templateRelPath(scope.division.slug, version, true); // active.hwp
    const created = await tx.template.create({
      data: {
        divisionId: scope.division.id,
        filePath: rel,
        sha256: hash,
        version,
        isActive: true,
        uploadedBy: scope.user.id,
      },
    });
    return { created, version };
  });

  // 이력 보관본 + active 갱신 (DM-14 / ST-19)
  await writeFileAtomic(templateRelPath(scope.division.slug, result.version, false), bytes);
  await writeFileAtomic(templateRelPath(scope.division.slug, result.version, true), bytes);

  await audit(scope.user.email, 'template_update', scope.division.id, `template:v${result.version}`, {
    bytes: bytes.length,
  });

  return json(
    {
      template: { version: result.version, byteSize: bytes.length },
      // API-41 — 담당자가 "안 깨졌는지" 즉시 확인할 파싱 요약
      parsedSummary: parsed.tables.map((t) => ({ rows: t.rows, cols: t.cols })),
      warnings: parsed.warnings,
    },
    { status: 201 },
  );
});
