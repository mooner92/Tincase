// POST /api/division/template — 부서 양식 교체 (API-40/41, ST-19). lead 전용.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit, rejectOversizedBody } from '@/server/http';
import { audit } from '@/server/audit';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { sha256, templateRelPath, writeFileAtomic } from '@/server/storage';
import { env } from '@/server/env';
import { laterSyncCurrentWeek } from '@/server/rollup/auto';
import { assertUsableTemplate } from '@/server/template-check';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP §3.1 — 내 부서 양식은 lead·head·coordinator·operator가 등록한다 (TACP-6: 대상은 신원의 부서)
  const scope = await requireManager(req.headers);
  rateLimit(`template:${scope.user.email}`, 5, 60_000);
  rejectOversizedBody(req, env.MAX_UPLOAD_BYTES); // ST-04

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
  /*
   * ST-19a·b (2026-10-10) — 「표가 파싱된다」로는 모자랐다. 표가 둘인 양식(3번 특이사항을 지운 꼴)도 경고와 함께 받았고, 그날부터
   * 이 부서 전원의 웹 작성이 500, 병합은 3번 줄을 버렸다. 모양(5칸 표 셋)을 보고, 시험 작성·시험 병합을 해 다시 읽어 본 뒤에만 받는다.
   * 대상은 신원의 부서다(TACP-6) — 부서명은 병합본 맨 위(HM-46)와 같은 길을 지나게 넣는다
   */
  try {
    assertUsableTemplate(bytes, scope.division.nameKo);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'invalid_template') {
      throw new HttpError(422, 'invalid_template', `양식 검증 실패: ${e.message} (기존 양식은 그대로 유지됩니다)`);
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
  // RU-72 — 양식이 본부본·전사본의 열쇠에 들어 있다(RU-74). 이번 주를 맞추면 그 양식을 쓰는 것만 다시 만들어진다 —
  // 양식이 없어 실패하던 조립도 이 요청 뒤에 성공한다(RU-T106)
  laterSyncCurrentWeek({ cause: 'template', causedBy: scope.user.email });

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
