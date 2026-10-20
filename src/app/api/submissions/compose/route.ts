// POST /api/submissions/compose — 웹에서 작성한 내용을 hwp로 만들어 제출한다 (WA-04).
//
// 결과물이 업로드된 파일과 **구별되지 않아야 한다**: 부서 양식으로 만들고,
// 기존 uploadSubmission()과 같은 경로로 저장한다 (검증·버전·감사 로그 전부 동일).
// 문서 만들기는 담당자 첨삭(WA-20)과 같은 길이다 — `buildWorklogHwp`.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSubmitter, HttpError, isDocumentManager } from '@/server/authz';
import { submissionName } from '@/lib/docname';
import { handler, json } from '@/server/http';
import { readStoredFile } from '@/server/storage';
import { uploadSubmission, ensureCurrentSlot } from '@/server/worklog';
import { buildWorklogHwp, type DocInput } from '@/server/worklog-doc';
import { buildProjectHwp, hqScopeOf, templateFormOf, type ProjectBody } from '@/server/project-form';
import { unitEachTask } from '@/lib/unit-abbr';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 제출 부서는 신원에서 나온다. 본문이 부서를 정하지 않는다
  const scope = await requireSubmitter(req.headers); // API-45 — 본문을 읽기 전에 판정한다

  const body = (await req.json().catch(() => null)) as (DocInput & { kind?: string }) | null;
  if (!body) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');

  const template = await prisma.template.findFirst({
    where: { divisionId: scope.division.id, isActive: true },
  });
  if (!template) throw new HttpError(409, 'no_template', '등록된 부서 양식이 없습니다. 담당자에게 요청해 주세요.');

  /*
   * RH-70 · RH-75 — 연구실 양식(6칸 두 층)이면 연구실 본문만 받는다. 양식과 본문이 엇갈리면(화면을 연 사이 양식이 바뀐 경우)
   * 채우다 터지기 전에 막는다 — 실형 본문을 연구실 양식에 쓰면 5칸 표를 찾다 실패하고, 그 반대면 과제가 사라진다.
   */
  const form = await templateFormOf(template);
  if ((body.kind === 'project') !== (form === 'project')) {
    throw new HttpError(409, 'form_mismatch', '부서 양식이 바뀌었습니다 — 화면을 새로 고친 뒤 다시 작성해 주세요.');
  }
  const templateBytes = await readStoredFile(template.filePath);
  const built =
    form === 'project'
      ? {
          ...buildProjectHwp(templateBytes, body as unknown as ProjectBody, scope.division.nameKo, {
            counts: isDocumentManager(scope.user),
            hq: isDocumentManager(scope.user) ? await hqScopeOf(scope.division) : null, // RH-96 · RH-97
            unitEachTask: unitEachTask(scope.division.nameKo, scope.division.parentKo), // RH-99
          }),
          rows: undefined,
        }
      : buildWorklogHwp(templateBytes, body, { division: scope.division.nameKo });

  const slot = await ensureCurrentSlot();
  const result = await uploadSubmission({
    user: scope.user,
    division: scope.division,
    fileName: submissionName(slot.year, slot.label, scope.division.nameKo, scope.user.name),
    bytes: built.bytes,
    fromIp: req.headers.get('x-forwarded-for'),
    origin: 'web',
  });

  return json({ ok: true, version: result.submission.version, rows: built.rows });
});
