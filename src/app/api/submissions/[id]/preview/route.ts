// GET /api/submissions/:id/preview — 드로어 데이터 (API-22~25).
// hwp를 서버에서 파싱해 구조화된 표로 반환. 원문 그대로, 요약·가공 없음 (API-25).
import { NextRequest } from 'next/server';
import { requireScope, findAccessibleSubmission, canReviseSubmission, HttpError } from '@/server/authz';
import { prisma } from '@/server/db';
import { readStoredFile } from '@/server/storage';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { logger } from '@/server/logger';
import { readWorklog, TABLE_TITLES, TABLE_COLUMNS } from '@/lib/hwp/reader';
import { isProjectForm, parseHqForm, type HqFormData } from '@/lib/hwp/hq-form';
import { projectTables, type ViewTable } from '@/lib/hwp/hq-view';
import { tableGrid } from '@/lib/hwp/model';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const scope = await requireScope(req.headers);
  rateLimit(`preview:${scope.user.email}`, 30, 60_000); // API-34
  const { id } = await ctx.params;
  const sub = await findAccessibleSubmission(scope, id); // 본인·lead·head(자기 부서)·readAll — 그 외 404

  let parsed;
  // RH-76 — 연구실 양식으로 낸 판이면 과제·항목으로도 돌려준다(작성 화면이 [열기]로 이어 쓴다)
  let project: HqFormData | null = null;
  let projectView: ViewTable[] | null = null;
  try {
    const bytes = await readStoredFile(sub.filePath);
    parsed = readWorklog(bytes); // 업로드 시 이미 검증됨 — 실패는 정합성 이탈 (API-22)
    if (isProjectForm(bytes)) {
      // RH-76 · RH-82 — 이 실의 자문회의 줄만 작성 화면에 되돌린다(표의 다른 줄은 이 사람이 적은 것이 아니다)
      const d = parseHqForm(bytes);
      const own = await prisma.division.findUnique({ where: { id: sub.divisionId }, select: { nameKo: true } });
      const mine = d.consult?.find((c) => c.label.replace(/\s+/g, '') === (own?.nameKo ?? '').replace(/\s+/g, ''))?.values;
      project = { ...d, consult: mine ? [{ label: own!.nameKo, values: mine }] : [] };
      // RH-88 — 열람 드로어도 두 층 표 그대로(실형 5칸으로 읽으면 칸이 엇갈린다). 자문회의는 이 실의 줄만
      projectView = projectTables(bytes, { onlyConsultOf: own?.nameKo ?? '' });
    }
  } catch (e) {
    logger.error({ submissionId: sub.id, err: String(e) }, 'CRITICAL: preview parse failed for validated file');
    throw new HttpError(500, 'internal', '파일을 읽을 수 없습니다. 원본 다운로드로 확인해 주세요.');
  }

  await audit(scope.user.email, 'preview', sub.divisionId, `submission:${sub.id}`); // API-24

  // TACP-22 — 누가 고친 판인가 (주인과 다를 때만)
  const editor = sub.editedById
    ? await prisma.user.findUnique({ where: { id: sub.editedById }, select: { name: true } })
    : null;

  return json({
    submission: {
      id: sub.id,
      version: sub.version,
      uploadedAt: toKstIso(sub.uploadedAt),
      userName: sub.user.name,
      userId: sub.userId,
      editedBy: editor?.name ?? null,
      // TACP-22 — 고친 시각. `uploadedAt`은 부서원이 낸 시각 그대로다 (현황이 고친 시각을 제출 시각으로 보이지 않게)
      editedAt: sub.editedAt ? toKstIso(sub.editedAt) : null,
      // LE-44 — 담당자가 대신 입력한 판이면 머리가 「고침」 대신 「입력」이라 말한다
      proxied: sub.origin === 'lead_entry',
    },
    // WA-20 — [고치기]는 내 부서 lead·head에게, 남의 것·최신 판일 때만 (TACP-22). 게이트와 같은 식이다
    // RH-86 — 연구실 판은 담당·부서장 고치기(실형 편집기)를 아직 쓰지 않는다 — 낸 사람이 고쳐 다시 내거나 병합 뒤 본다
    canRevise: sub.isLatest && !projectView && canReviseSubmission(scope, sub),
    // HM-37 — 행별 「공유」 표시. 고칠 때 잃지 않게 같이 보낸다 (빈 행을 뺀 순서 = 격자의 빈 행 뺀 순서)
    emphasis: {
      achievements: parsed.worklog.achievements.map((r) => r.emphasis === true),
      plans: parsed.worklog.plans.map((r) => r.emphasis === true),
      notes: parsed.worklog.notes.map((r) => r.emphasis === true),
    },
    rowsByTable: {
      achievements: parsed.worklog.achievements,
      plans: parsed.worklog.plans,
      notes: parsed.worklog.notes,
    },
    tables: projectView ?? parsed.tables.slice(0, 3).map((t, i) => {
      /*
       * API-57 — 본문 칸이 모두 빈 행(양식의 빈 번호 줄 3-1~3-4)은 뺀다. 병합본 보기(UX-03)와 같은 조건이다.
       * 거르지 않으면 부서원이 「빈 번호가 생겼네, 잘못 냈나?」 하고 묻는다. 글자는 건드리지 않는다(API-25).
       * [고치기]는 이 격자가 아니라 `rowsByTable`을 쓰므로 거른다고 자리가 어긋나지 않는다.
       */
      const full = tableGrid(t); // 헤더 행 포함 원문 격자
      return {
        title: TABLE_TITLES[i] ?? `표 ${i + 1}`,
        columns: [...TABLE_COLUMNS],
        rows: [full[0] ?? [], ...full.slice(1).filter((r) => r.slice(1).some((c) => c.trim()))],
      };
    }),
    // RH-88 — 표 수·열 경고는 실형 양식 기준이라 연구실 판에는 맞지 않는다(「표가 4개입니다」)
    warnings: projectView ? [] : parsed.warnings,
    project,
  });
});
