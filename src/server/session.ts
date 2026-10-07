// AU-21 — 사내망 로그인 세션. 쿠키에 원문 토큰, DB에는 SHA-256 해시만.
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './db';

/*
 * RU-42 — 쿠키 이름은 환경으로 바꿀 수 있다. **같은 서버의 다른 포트는 쿠키를 공유한다**
 * (쿠키는 호스트만 보고 포트를 보지 않는다). 테스트 서버(11112)가 같은 이름을 쓰면
 * 거기 로그인하는 순간 운영(11111)의 로그인이 덮여 풀린다. 운영은 기본값 그대로다.
 */
export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'repman_session';
/** 재로그인 피로도를 줄이기 위한 넉넉한 유효기간 (사용자 결정: 약 한 달) */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 마지막 사용 후 이 시간이 지나면 만료 연장 (슬라이딩) */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      tokenHash: hash(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 200) ?? null,
      ip: meta.ip ?? null,
    },
  });
  return { token, expiresAt };
}

/** 유효한 세션이면 userId 반환. 만료·없음이면 null. 오래된 세션은 자동 연장 */
export async function resolveSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: hash(token) } });
  if (!s) return null;
  const now = new Date();
  if (s.expiresAt <= now) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  if (now.getTime() - s.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await prisma.session
      .update({
        where: { id: s.id },
        data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      })
      .catch(() => {});
  }
  return s.userId;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hash(token) } });
}

/** 비밀번호 변경·계정 잠금 시 전 세션 무효화 (AU-25) */
export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/** 만료 세션 청소 — 로그인 시 곁다리로 호출 (별도 크론 불필요) */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }).catch(() => {});
}

export function sessionCookieOptions(secure: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // 사내망 접속은 평문 HTTP라 secure를 켤 수 없다 (AU-26 참조).
    // Cloudflare(HTTPS) 경유일 때만 secure를 켠다.
    secure,
    path: '/',
    expires: expiresAt,
  };
}
