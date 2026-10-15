// GET /api/ops/divisions · PUT — 테넌시 관리 (operator 전용, API-32/33 · 부서 알림 스위치 API-66)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { templateProblem, templateState, templateStates } from '@/server/template-state';
import { HttpError, notFound, requireOperator } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { validateDeadlinePolicy } from '@/lib/week';
import { laterSyncCurrentWeek } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  void scope;
  // PG-95 (2026-10-14) — **등록 순서 = ERP 인원 현황 순서 = 조직도 순서**로 준다. 화면이 상위부서로 묶는다(lib/division-groups).
  // 예전에는 취합게시판 제출 이력(DM-15)으로 위아래를 갈랐다 — 연구 실도 본부 표로 내고 있어 모든 부서가 쓰게 됐다(운영자: 「이력 없음은 없애도 되겠네」)
  const divisions = await prisma.division.findMany({
    orderBy: [{ createdAt: 'asc' }, { nameKo: 'asc' }],
    include: { _count: { select: { users: { where: { isActive: true } } } } },
  });
  // OPS-41 — **행이 아니라 파일까지** 본다. 행만 보면 「✓」가 거짓이 된다
  const tplState = await templateStates(divisions.map((d) => d.id));
  return json({
    divisions: divisions.map((d) => ({
      id: d.id,
      slug: d.slug,
      shortSlug: d.shortSlug,
      nameKo: d.nameKo,
      /** PG-95 — ERP 「상위부서」. 화면이 본부별로 묶는다 */
      parentKo: d.parentKo,
      isActive: d.isActive,
      /** API-66 · PG-91 — 부서 알림 스위치. 켜짐과 따로 보인다 — 꺼진 부서에 켜 둔 것도 운영자가 알아야 한다 */
      notifyEnabled: d.notifyEnabled,
      deadlineDow: d.deadlineDow,
      deadlineTime: d.deadlineTime,
      memberCount: d._count.users,
      hasTemplate: tplState.get(d.id) === 'ok',
      /** OPS-41 — 「없음」과 「파일이 사라짐」은 해야 할 일이 다르다 */
      templateState: tplState.get(d.id) ?? 'none',
    })),
  });
});

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    isActive?: boolean;
    /** API-66 — 타입을 믿지 않는다. 아래에서 불리언인지 본다 */
    notifyEnabled?: unknown;
    deadlineDow?: number;
    deadlineTime?: string;
    shortSlug?: string | null;
    boardStatus?: string;
  } | null;
  if (!body?.id) throw new HttpError(422, 'invalid_request', 'id가 필요합니다.');

  const div = await prisma.division.findUnique({ where: { id: body.id } });
  if (!div) throw notFound();

  const data: Record<string, unknown> = {};
  if (typeof body.isActive === 'boolean') {
    // 온보딩 활성화는 양식이 있어야 의미가 있다 — 없으면 부서원 업로드가 막힌 채 열림
    if (body.isActive) {
      // OPS-41 — 목록과 **같은 판정**을 쓴다. 여기만 DB를 보면 「✓인데 못 켠다」가 된다
      const problem = templateProblem(await templateState(div.id), div.nameKo);
      if (problem) throw new HttpError(409, 'no_template', problem);
    }
    data.isActive = body.isActive;
  }
  /*
   * API-66 · NT-61 — 부서 알림 스위치. 켜짐과 **따로** 저장한다: 꺼진 부서에 미리 켜 둬도 켜기 전까지는 아무것도 나가지 않는다
   * (부서 알림은 켜짐 그리고 스위치 — NT-30). 위의 isActive처럼 불리언이 아니면 조용히 건너뛰지 않고 422다 — 「끄기」가 문자열
   * "false"로 와서 무시되면 운영자는 껐다고 믿는데 쪽지는 계속 나간다.
   */
  if (body.notifyEnabled !== undefined) {
    if (typeof body.notifyEnabled !== 'boolean') {
      throw new HttpError(422, 'invalid_request', 'notifyEnabled 값이 올바르지 않습니다.');
    }
    data.notifyEnabled = body.notifyEnabled;
  }
  if (body.deadlineDow !== undefined || body.deadlineTime !== undefined) {
    const policy = {
      deadlineDow: body.deadlineDow ?? div.deadlineDow,
      deadlineTime: body.deadlineTime ?? div.deadlineTime,
    };
    const err = validateDeadlinePolicy(policy); // DM-10
    if (err) throw new HttpError(422, 'invalid_request', err);
    data.deadlineDow = policy.deadlineDow;
    data.deadlineTime = policy.deadlineTime;
  }
  if (body.shortSlug !== undefined) data.shortSlug = body.shortSlug || null;
  if (body.boardStatus !== undefined) {
    // `unclear`는 폐기됐다 (v1.23.0, DM-15) — 새로 들어오는 값으로는 받지 않는다
    if (!['confirmed', 'none'].includes(body.boardStatus)) {
      throw new HttpError(422, 'invalid_request', 'boardStatus 값이 올바르지 않습니다.');
    }
    data.boardStatus = body.boardStatus;
  }
  if (Object.keys(data).length === 0) throw new HttpError(422, 'invalid_request', '변경할 내용이 없습니다.');

  const updated = await prisma.division.update({ where: { id: div.id }, data });
  await audit(scope.user.email, 'rule_update', div.id, `ops:division:${div.slug}`, {
    changed: Object.keys(data),
    // NT-61 — 스위치는 「바꿨다」만으로는 어느 쪽으로 바꿨는지 모른다. SQL로 바꾸던 때 그날 명령 출력이 하던 일을 이 기록이 한다
    ...(typeof data.notifyEnabled === 'boolean' && { notifyEnabled: data.notifyEnabled }),
  });
  // RU-72 — 나무(상위부서·켜짐)가 바뀌면 받는 곳·기여 단위가 바뀐다 — 이번 주를 위에서 아래로 맞춘다
  laterSyncCurrentWeek({ cause: 'tree', causedBy: scope.user.email });
  return json({ ok: true, division: { id: updated.id, isActive: updated.isActive, notifyEnabled: updated.notifyEnabled } });
});
