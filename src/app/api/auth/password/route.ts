// POST /api/auth/password — 비밀번호 변경 (AU-22/24/25)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, HttpError } from '@/server/authz';
import { handler } from '@/server/http';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '@/server/password';
import {
  createSession,
  destroyAllSessions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/server/session';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: string; newPassword?: string }
    | null;
  const current = String(body?.currentPassword ?? '');
  const next = String(body?.newPassword ?? '');

  // 비밀번호가 설정된 계정이면 현재 비밀번호 확인.
  // Cloudflare로 들어와 아직 비밀번호가 없는 경우(Sean)는 최초 설정을 허용한다.
  if (scope.user.passwordHash) {
    if (!(await verifyPassword(current, scope.user.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', '현재 비밀번호가 올바르지 않습니다.');
    }
    if (current === next) {
      throw new HttpError(422, 'invalid_password', '이전과 다른 비밀번호를 사용해 주세요.');
    }
  }

  const err = validatePasswordPolicy(next, { email: scope.user.email, name: scope.user.name });
  if (err) throw new HttpError(422, 'invalid_password', err);

  await prisma.user.update({
    where: { id: scope.user.id },
    data: {
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // AU-25 — 변경 시 기존 세션 전부 무효화 후, 지금 브라우저만 재발급
  await destroyAllSessions(scope.user.id);
  const { token, expiresAt } = await createSession(scope.user.id, {
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for'),
  });

  const secure = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')) === 'https';
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure, expiresAt));
  logger.info({ action: 'password_change', actor: scope.user.email }, 'password changed');
  return res;
});
