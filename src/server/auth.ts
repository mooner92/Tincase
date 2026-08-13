// S-03 — 인증. Cloudflare Access JWT 검증 (AU-02) + 개발/테스트 우회 (AU-03).
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env';

export interface AccessIdentity {
  email: string; // 소문자 정규화 (DM-01)
  sub: string;
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
// JWKS는 jose가 캐시·자동 갱신. 모듈 스코프에 1회 생성.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${ISSUER}/cdn-cgi/access/certs`));
  return jwks;
}

/**
 * 요청 → 검증된 신원.
 * - production: Cf-Access-Jwt-Assertion 필수. 서명·iss·aud·exp 전부 검증 (AU-02)
 * - development: DEV_IDENTITY 환경변수로 우회 (AU-03; production에선 env.ts가 기동 자체를 거부)
 * - test: x-test-identity 헤더 허용 (통합 테스트 전용)
 */
export async function verifyAccess(headers: Headers): Promise<AccessIdentity> {
  if (env.NODE_ENV === 'test') {
    // 테스트에서는 x-test-identity만 인정. DEV_IDENTITY 폴백 없음 — 401 경로를 테스트 가능하게
    const t = headers.get('x-test-identity');
    if (t) return { email: t.toLowerCase(), sub: 'test' };
    throw new AuthError('missing_assertion', 'Access JWT가 없습니다');
  }
  if (env.NODE_ENV === 'development' && env.DEV_IDENTITY) {
    return { email: env.DEV_IDENTITY.toLowerCase(), sub: 'dev' };
  }

  const token = headers.get('cf-access-jwt-assertion');
  if (!token) throw new AuthError('missing_assertion', 'Access JWT가 없습니다');

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: ISSUER,
      audience: env.CF_ACCESS_AUD,
    });
    const email = String(payload.email ?? '').toLowerCase();
    if (!email) throw new AuthError('no_email_claim', 'JWT에 email 클레임이 없습니다');
    return { email, sub: String(payload.sub ?? '') };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('invalid_token', 'Access JWT 검증에 실패했습니다');
  }
}
