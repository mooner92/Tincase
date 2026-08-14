// S-03 — 인증. 신원 제공자 2개를 같은 seam 뒤에 둔다 (ADR-0006).
//   ① 사내망 직접 접속(192.x)  → 세션 쿠키 (비밀번호 로그인)
//   ② 외부 접속(worklog.excusa.uk) → Cloudflare Access JWT
// 어느 쪽이든 결과는 동일한 AccessIdentity. 인가(authz.ts)는 출처를 모른다.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env';
import { SESSION_COOKIE, resolveSession } from './session';

export type IdentitySource = 'session' | 'cloudflare' | 'dev';

export interface AccessIdentity {
  /** 소문자 정규화된 이메일 (DM-01) — cloudflare 경로 */
  email?: string;
  /** 세션 경로에서는 userId로 바로 해석된다 */
  userId?: string;
  source: IdentitySource;
}

export class AuthError extends Error {
  constructor(
    public readonly code: 'missing_assertion' | 'invalid_token' | 'no_email_claim',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const ISSUER = `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com`;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${ISSUER}/cdn-cgi/access/certs`));
  return jwks;
}

function cookieFrom(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** AU-02 — Cloudflare Access JWT 검증 (외부 경로) */
async function verifyCloudflare(headers: Headers): Promise<AccessIdentity | null> {
  const token = headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: ISSUER,
      audience: env.CF_ACCESS_AUD,
    });
    const email = String(payload.email ?? '').toLowerCase();
    if (!email) throw new AuthError('no_email_claim', 'JWT에 email 클레임이 없습니다');
    return { email, source: 'cloudflare' };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('invalid_token', 'Access JWT 검증에 실패했습니다');
  }
}

/**
 * 요청 → 검증된 신원.
 * 우선순위: 세션 쿠키 → Cloudflare JWT → (비-production) 개발 우회.
 * 세션을 먼저 보는 이유: 외부에서 접속한 사람도 로그인했다면 그 신원이 더 구체적이다.
 */
export async function verifyAccess(headers: Headers): Promise<AccessIdentity> {
  if (env.NODE_ENV === 'test') {
    const t = headers.get('x-test-identity');
    if (t) return { email: t.toLowerCase(), source: 'dev' };
    const sid = await resolveSession(cookieFrom(headers, SESSION_COOKIE));
    if (sid) return { userId: sid, source: 'session' };
    throw new AuthError('missing_assertion', '인증 정보가 없습니다');
  }

  const sessionUserId = await resolveSession(cookieFrom(headers, SESSION_COOKIE));
  if (sessionUserId) return { userId: sessionUserId, source: 'session' };

  const cf = await verifyCloudflare(headers);
  if (cf) return cf;

  if (env.NODE_ENV === 'development' && env.DEV_IDENTITY) {
    return { email: env.DEV_IDENTITY.toLowerCase(), source: 'dev' };
  }

  throw new AuthError('missing_assertion', '로그인이 필요합니다');
}
