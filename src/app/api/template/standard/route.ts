// 전사 표준 양식 (ST-20).
//   GET  — lead 이상이면 다운로드. 각 부서가 이걸 받아 자기 부서 부분만 남겨 부서 양식으로 등록한다.
//   POST — operator만 등록/교체 (기획조정실이 배포한 원본을 운영자가 올린다)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, requireLead, requireOperator } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { contentDisposition, readStoredFile, sha256, writeFileAtomic } from '@/server/storage';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { env } from '@/server/env';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const relPath = (version: number, active = false) =>
  path.join('templates', active ? 'standard.hwp' : `standard-v${version}.hwp`);

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireLead(req.headers); // 양식을 만드는 사람만 필요 (부서원은 부서 양식을 받는다)
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true } });
  if (!std) {
    throw new HttpError(
      404,
      'not_found',
      '등록된 전사 표준 양식이 없습니다. 운영자에게 등록을 요청하세요.',
    );
  }
  const bytes = await readStoredFile(std.filePath);
  await audit(scope.user.email, 'download', scope.division.id, `standard-template:v${std.version}`);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(`전사표준양식_v${std.version}.hwp`),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers); // TACP-12 — 판정은 게이트에만

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const note = String(form?.get('note') ?? '').slice(0, 200);
  if (!file || typeof file === 'string') throw new HttpError(422, 'invalid_file', '파일이 없습니다.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > env.MAX_UPLOAD_BYTES) throw new HttpError(422, 'invalid_file', '파일이 너무 큽니다.');
  if (!/\.hwp$/i.test(file.name)) throw new HttpError(422, 'invalid_file', '한글(.hwp) 파일만 등록할 수 있습니다.');

  let parsed;
  try {
    parsed = validateHwpUpload(bytes);
  } catch (e) {
    if (e instanceof UploadValidationError) {
      throw new HttpError(422, 'invalid_file', `표준 양식 검증 실패: ${e.message} (기존 표준 양식은 유지됩니다)`);
    }
    throw e;
  }

  const hash = sha256(bytes);
  const last = await prisma.standardTemplate.findFirst({ orderBy: { version: 'desc' } });
  if (last?.sha256 === hash && last.isActive) {
    throw new HttpError(409, 'conflict', '현재 표준 양식과 동일한 파일입니다.');
  }
  const version = (last?.version ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.standardTemplate.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await tx.standardTemplate.create({
      data: { filePath: relPath(version, true), sha256: hash, version, isActive: true, note, uploadedBy: scope.user.id },
    });
  });
  await writeFileAtomic(relPath(version, false), bytes); // 이력
  await writeFileAtomic(relPath(version, true), bytes); // active
  await audit(scope.user.email, 'template_update', null, `standard-template:v${version}`, { bytes: bytes.length });

  return json(
    { standard: { version, byteSize: bytes.length }, parsedSummary: parsed.tables.map((t) => ({ rows: t.rows, cols: t.cols })) },
    { status: 201 },
  );
});
