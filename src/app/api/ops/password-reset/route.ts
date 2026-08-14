// POST /api/ops/password-reset — 운영자의 비밀번호 초기화 (AU-27).
// 새 임시 비밀번호를 생성해 응답에 **한 번만** 돌려준다. 서버는 해시만 보관하므로
// 이 응답을 놓치면 다시 초기화하는 수밖에 없다 (설계상 의도).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, notFound, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { generateInitialPassword, hashPassword } from '@/server/password';
import { destroyAllSessions } from '@/server/session';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  if (!scope.user.isOperator) throw notFound(); // 존재 은닉
  rateLimit(`pwreset:${scope.user.email}`, 30, 60_000);

  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  if (!body?.userId) throw new HttpError(422, 'invalid_request', 'userId가 필요합니다.');

  const target = await prisma.user.findUnique({ where: { id: body.userId } });
  if (!target) throw notFound();

  const password = generateInitialPassword();
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true, // 첫 로그인 시 변경 강제 (AU-22)
      failedLoginCount: 0,
      lockedUntil: null, // 잠긴 계정 해제 겸용
    },
  });
  await destroyAllSessions(target.id); // AU-25 — 기존 로그인 전부 끊는다

  await audit(scope.user.email, 'password_reset', target.divisionId, `user:${target.id}`);
  logger.info(
    { action: 'password_reset', actor: scope.user.email, target: target.email },
    'password reset by operator',
  );

  // ⚠ 평문은 여기서만 노출된다. 로그에는 절대 남기지 않는다 (OPS-11b)
  return json({ ok: true, name: target.name, email: target.email, password });
});
