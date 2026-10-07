// PUT /api/submissions/[id]/content — 담당자 첨삭 (WA-20 · TACP-22).
//
// 부서원 제출물을 고쳐 **그 사람의 새 판**으로 저장한다. 원래 판은 그대로 남고, 누가 고쳤는지가 붙는다.
// 문서는 웹 작성과 같은 길(`buildWorklogHwp`)로 만든다 — 부서 양식 + 같은 자체 검증.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, requireRevisableSubmission, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { readStoredFile } from '@/server/storage';
import { reviseSubmission } from '@/server/worklog';
import { buildWorklogHwp, type DocInput } from '@/server/worklog-doc';
import { submissionName } from '@/lib/docname';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  const { id } = await ctx.params;
  const target = await requireRevisableSubmission(scope, id); // 내 부서 lead·head, 최신 판만 — 그 외 404/409
  rateLimit(`revise:${scope.user.email}`, 30, 60_000);

  const body = (await req.json().catch(() => null)) as DocInput | null;
  if (!body) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');

  const template = await prisma.template.findFirst({ where: { divisionId: target.divisionId, isActive: true } });
  if (!template) throw new HttpError(409, 'no_template', '등록된 부서 양식이 없습니다. 부서 설정에서 양식을 먼저 등록하세요.');

  const built = buildWorklogHwp(await readStoredFile(template.filePath), body, {
    division: target.division.nameKo,
    revise: target.id,
  });
  const created = await reviseSubmission({
    editor: scope.user,
    target,
    bytes: built.bytes,
    fileName: submissionName(target.weekSlot.year, target.weekSlot.label, target.division.nameKo, target.user.name),
  });
  return json({ ok: true, id: created.id, version: created.version, rows: built.rows });
});
