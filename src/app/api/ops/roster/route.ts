// GET /api/ops/roster?division=… · PUT — 인원 배치 (operator 전용, DM-04, API-26/27)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, requireOperator } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';

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
      sortOrder: true,
      passwordHash: true, // 발급 여부만 쓴다 (해시 자체는 응답에 넣지 않는다)
      mustChangePassword: true,
      lastLoginAt: true,
      lockedUntil: true,
    },
  });
  const now = new Date();
  return json({
    users: users.map(({ passwordHash, lockedUntil, ...u }) => ({
      ...u,
      hasPassword: !!passwordHash,
      locked: !!lockedUntil && lockedUntil > now,
    })),
  });
});

interface RosterUpdate {
  userId: string;
  onRoster?: boolean;
  /** DM-16 — 집계에서 뺀 이유("휴직" 등). 뺀 것과 이유를 같이 적어야 나중에 되돌릴 수 있다 */
  rosterNote?: string | null;
  sortOrder?: number;
  divisionRole?: 'member' | 'lead';
  isActive?: boolean;
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
    if (u.divisionRole && u.divisionRole !== 'member' && u.divisionRole !== 'lead') {
      throw new HttpError(422, 'invalid_request', `divisionRole 값이 올바르지 않습니다: ${u.divisionRole}`);
    }
    if (u.sortOrder !== undefined && (!Number.isInteger(u.sortOrder) || u.sortOrder < 0)) {
      throw new HttpError(422, 'invalid_request', 'sortOrder는 0 이상 정수여야 합니다.');
    }
  }

  await prisma.$transaction(
    body.updates.map((u) =>
      prisma.user.update({
        where: { id: u.userId },
        data: {
          ...(u.onRoster !== undefined && { onRoster: u.onRoster }),
          ...(u.rosterNote !== undefined && { rosterNote: u.rosterNote?.trim() || null }),
          ...(u.sortOrder !== undefined && { sortOrder: u.sortOrder }),
          ...(u.divisionRole !== undefined && { divisionRole: u.divisionRole }),
          ...(u.isActive !== undefined && { isActive: u.isActive }),
        },
      }),
    ),
  );

  await audit(scope.user.email, 'rule_update', null, 'ops:roster', { count: body.updates.length });
  return json({ ok: true, updated: body.updates.length });
});
