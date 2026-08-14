// POST /api/auth/login — 사내망 비밀번호 로그인 (AU-20~23)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { handler, jsonError } from '@/server/http';
import { verifyPassword } from '@/server/password';
import { createSession, pruneExpiredSessions, SESSION_COOKIE, sessionCookieOptions } from '@/server/session';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

const LOCK_THRESHOLD = 8; //  연속 실패 8회
const LOCK_MS = 10 * 60 * 1000; // 10분 잠금

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? null;

  // AU-23 — 존재 여부를 응답으로 구별할 수 없게 (사용자 열거 방지). 문구·상태코드 동일
  const generic = () =>
    jsonError(401, 'invalid_credentials', '이메일 또는 비밀번호가 올바르지 않습니다.');

  if (!email || !password) return generic();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !user.passwordHash) {
    logger.info({ action: 'login_fail', email, reason: 'no_user_or_password', ip }, 'login failed');
    return generic();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return jsonError(429, 'locked', `로그인 시도가 너무 많습니다. ${mins}분 후 다시 시도해 주세요.`);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const count = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: count,
        lockedUntil: count >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    logger.info({ action: 'login_fail', email, count, ip }, 'login failed');
    return generic();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  void pruneExpiredSessions();

  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get('user-agent'),
    ip,
  });

  const secure = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')) === 'https';
  const res = NextResponse.json(
    { ok: true, mustChangePassword: user.mustChangePassword },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure, expiresAt));
  logger.info({ action: 'login_ok', email, ip, secure }, 'login ok');
  return res;
});
