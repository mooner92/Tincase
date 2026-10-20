// GET /api/ops/roster?division=… · PUT — 인원 배치 (operator 전용, DM-04, API-26/27)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, requireOperator } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { offboardUser } from '@/server/offboard';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireOperator(req.headers);
  const divisionId = req.nextUrl.searchParams.get('division');
  if (!divisionId) throw new HttpError(422, 'invalid_request', 'division이 필요합니다.');
  const users = await prisma.user.findMany({
    where: { divisionId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      divisionRole: true,
      isOperator: true,
      isCoordinator: true,
      isActive: true,
      onRoster: true,
      rosterNote: true,
      employeeNo: true,
      notifyEnabled: true,
      sortOrder: true,
      passwordHash: true, // 발급 여부만 쓴다 (해시 자체는 응답에 넣지 않는다)
      mustChangePassword: true,
      lastLoginAt: true,
      lockedUntil: true,
      divisionPinned: true, // ADR-0022 D1
      hqDesks: { select: { divisionId: true } }, // ADR-0022 D2 — 이 사람이 소속과 따로 맡은 본부
    },
  });
  // ADR-0022 D2 — 이 부서(본부)를 소속과 따로 맡은 사람. 본부 줄을 열면 드로어 머리에 보인다
  const desks = await prisma.hqDesk.findMany({
    where: { divisionId },
    select: { user: { select: { id: true, name: true, isActive: true, division: { select: { nameKo: true } } } } },
  });
  const now = new Date();
  return json({
    users: users.map(({ passwordHash, lockedUntil, hqDesks, ...u }) => ({
      ...u,
      hasPassword: !!passwordHash,
      locked: !!lockedUntil && lockedUntil > now,
      hqDeskIds: hqDesks.map((d) => d.divisionId),
    })),
    desks: desks.filter((d) => d.user.isActive).map((d) => ({ userId: d.user.id, name: d.user.name, divisionName: d.user.division.nameKo })),
  });
});

interface RosterUpdate {
  userId: string;
  onRoster?: boolean;
  /** DM-16 — 집계에서 뺀 이유("휴직" 등). 뺀 것과 이유를 같이 적어야 나중에 되돌릴 수 있다 */
  rosterNote?: string | null;
  /** NT-22 — 사내 메신저 사번. 없으면 알림이 가지 않는다 */
  employeeNo?: string | null;
  /** NT-22 — 알림을 끄는 유일한 자리다. 본인 스위치(NT-21)는 2026-10-08에 걷었다 — 끈 사람이 0명이었다 */
  notifyEnabled?: boolean;
  sortOrder?: number;
  divisionRole?: 'member' | 'lead' | 'head';
  isActive?: boolean;
  /** ADR-0022 D1 — Tincase 소속 옮기기. 옮기면 고정된다(인원 최신화가 ERP 부서로 되돌리지 않는다) */
  divisionId?: string;
  /** ADR-0022 D1 — `false`면 고정을 푼다 — 다음 인원 최신화가 ERP 부서로 옮긴다 */
  divisionPinned?: false;
  /** ADR-0022 D2 — 소속과 따로 맡을 본부. `null`이면 모두 푼다 (한 사람에 하나 — 화면이 그렇게 고른다) */
  hqDesk?: string | null;
}

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  const body = (await req.json().catch(() => null)) as { updates?: RosterUpdate[] } | null;
  if (!body?.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
    throw new HttpError(422, 'invalid_request', 'updates 배열이 필요합니다.');
  }

  // API-27 — 부분 적용 없음: 전건 검증 후 단일 트랜잭션
  const ids = body.updates.map((u) => u.userId);
  const found = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) {
    throw new HttpError(409, 'conflict', '존재하지 않는 사용자가 포함되어 있습니다. 전체 변경을 취소했습니다.');
  }
  for (const u of body.updates) {
    // TACP-16 — `head`(부서장) 추가. `isOperator`·`isCoordinator`는 여전히 이 API로 못 바꾼다 (TACP-2)
    if (u.divisionRole && !['member', 'lead', 'head'].includes(u.divisionRole)) {
      throw new HttpError(422, 'invalid_request', `divisionRole 값이 올바르지 않습니다: ${u.divisionRole}`);
    }
    if (u.sortOrder !== undefined && (!Number.isInteger(u.sortOrder) || u.sortOrder < 0)) {
      throw new HttpError(422, 'invalid_request', 'sortOrder는 0 이상 정수여야 합니다.');
    }
    if (u.divisionPinned !== undefined && u.divisionPinned !== false) {
      throw new HttpError(422, 'invalid_request', 'divisionPinned는 false(고정 풀기)만 받습니다 — 고정은 소속을 옮기면 생깁니다.');
    }
  }
  // ADR-0022 — 옮길 부서·맡을 본부가 있는가. 본부는 「산하가 있는 부서」(ERP 상위부서로 누군가 그 이름을 가리킨다)여야 한다
  const divisions = await prisma.division.findMany({ select: { id: true, nameKo: true, parentKo: true } });
  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const parentNames = new Set(divisions.map((d) => d.parentKo));
  for (const u of body.updates) {
    if (u.divisionId !== undefined && !divisionById.has(u.divisionId)) {
      throw new HttpError(422, 'invalid_request', '옮길 부서를 찾지 못했습니다.');
    }
    if (u.hqDesk) {
      const hq = divisionById.get(u.hqDesk);
      if (!hq || !parentNames.has(hq.nameKo)) throw new HttpError(422, 'invalid_request', '본부(산하가 있는 부서)만 맡길 수 있습니다.');
    }
  }

  const updates = body.updates;
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      /*
       * AU-31 — **계정을 닫는 것은 다른 일이다.** 다른 필드처럼 `isActive: false`만
       * 쓰면 비밀번호·세션·미사용 설정 링크가 그대로 남는다. 그 절차는
       * `offboardUser` 한 곳에만 있고 엑셀 최신화도 같은 것을 부른다 —
       * 두 곳에 적으면 반드시 갈라진다 (TACP-12).
       */
      if (u.isActive === false) {
        await offboardUser(tx, u.userId);
      }

      const data = {
        ...(u.onRoster !== undefined && { onRoster: u.onRoster }),
        ...(u.rosterNote !== undefined && { rosterNote: u.rosterNote?.trim() || null }),
        // 사번은 숫자·영문만 남긴다 — 공백이 섞이면 메신저가 사람을 못 찾는다 (문서 06 §3)
        ...(u.employeeNo !== undefined && { employeeNo: u.employeeNo?.replace(/[^A-Za-z0-9]/g, '') || null }),
        ...(u.notifyEnabled !== undefined && { notifyEnabled: u.notifyEnabled }),
        ...(u.sortOrder !== undefined && { sortOrder: u.sortOrder }),
        ...(u.divisionRole !== undefined && { divisionRole: u.divisionRole }),
        // 켜는 것은 여기서. 끄는 것은 위 offboardUser가 이미 했다
        ...(u.isActive === true && { isActive: true }),
        // DM-26 — 손으로 옮기면 고정. ERP와 다르게 둔 것을 인원 최신화가 되돌리면 그 사람이 맡은 부서가 빈다
        ...(u.divisionId !== undefined && { divisionId: u.divisionId, divisionPinned: true }),
        ...(u.divisionPinned === false && u.divisionId === undefined && { divisionPinned: false }),
      };
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: u.userId }, data });
      }
      if (u.hqDesk !== undefined) {
        await tx.hqDesk.deleteMany({ where: { userId: u.userId } });
        if (u.hqDesk) await tx.hqDesk.create({ data: { userId: u.userId, divisionId: u.hqDesk, createdBy: scope.user.email } });
      }
    }
  });

  await audit(scope.user.email, 'rule_update', null, 'ops:roster', { count: body.updates.length });
  // ADR-0022 — 소속을 옮기거나 본부를 맡기는 것은 권한이 바뀌는 일이다 — 따로 남긴다(누가 · 누구를 · 어디로)
  for (const u of body.updates) {
    if (u.divisionId !== undefined) await audit(scope.user.email, 'roster_move', u.divisionId, `user:${u.userId}`, { pinned: true });
    if (u.divisionPinned === false && u.divisionId === undefined) await audit(scope.user.email, 'roster_unpin', null, `user:${u.userId}`, {});
    if (u.hqDesk !== undefined) await audit(scope.user.email, 'hq_desk', u.hqDesk, `user:${u.userId}`, { hq: u.hqDesk ? divisionById.get(u.hqDesk)?.nameKo : null });
  }
  return json({ ok: true, updated: body.updates.length });
});
