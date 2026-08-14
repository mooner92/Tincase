// GET /api/submissions/:id/preview — 드로어 데이터 (API-22~25).
// hwp를 서버에서 파싱해 구조화된 표로 반환. 원문 그대로, 요약·가공 없음 (API-25).
import { NextRequest } from 'next/server';
import { requireScope, findAccessibleSubmission, HttpError } from '@/server/authz';
import { readStoredFile } from '@/server/storage';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { logger } from '@/server/logger';
import { readWorklog, TABLE_TITLES, TABLE_COLUMNS } from '@/lib/hwp/reader';
import { tableGrid } from '@/lib/hwp/model';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  rateLimit(`preview:${scope.user.email}`, 30, 60_000); // API-34
  const { id } = await ctx.params;
  const sub = await findAccessibleSubmission(scope, id); // 본인·lead(자기 부서)·readAll — 그 외 404

  let parsed;
  try {
    const bytes = await readStoredFile(sub.filePath);
    parsed = readWorklog(bytes); // 업로드 시 이미 검증됨 — 실패는 정합성 이탈 (API-22)
  } catch (e) {
    logger.error({ submissionId: sub.id, err: String(e) }, 'CRITICAL: preview parse failed for validated file');
    throw new HttpError(500, 'internal', '파일을 읽을 수 없습니다. 원본 다운로드로 확인해 주세요.');
  }

  await audit(scope.user.email, 'preview', sub.divisionId, `submission:${sub.id}`); // API-24

  return json({
    submission: {
      id: sub.id,
      version: sub.version,
      uploadedAt: toKstIso(sub.uploadedAt),
      userName: sub.user.name,
      userId: sub.userId,
    },
    tables: parsed.tables.slice(0, 3).map((t, i) => ({
      title: TABLE_TITLES[i] ?? `표 ${i + 1}`,
      columns: [...TABLE_COLUMNS],
      rows: tableGrid(t), // 헤더 행 포함 원문 격자
    })),
    warnings: parsed.warnings,
  });
});
