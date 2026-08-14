// AU-20~26 — 사내망 비밀번호 인증 (ADR-0006)
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-auth.db';
process.env.STORAGE_ROOT = mkdtempSync(path.join(tmpdir(), 'repman-auth-'));
process.env.CF_ACCESS_TEAM = 'aidt-kei';
delete process.env.DEV_IDENTITY;

const EMAIL = 'pw@t.kei.re.kr';
const OTHER = 'pw2@t.kei.re.kr';
let INITIAL = '';

function nx(url: string, init?: RequestInit & { cookie?: string }) {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.cookie) headers.cookie = init.cookie;
  const r = new Request(`http://t.local${url}`, { ...init, headers }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://t.local${url}`);
  // NextRequest.cookies 흉내 (logout 라우트가 사용)
  (r as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies = {
    get: (n: string) => {
      const m = new RegExp(`(?:^|; )${n}=([^;]*)`).exec(headers.cookie ?? '');
      return m ? { value: decodeURIComponent(m[1]) } : undefined;
    },
  };
  return r as never;
}

const jsonReq = (url: string, body: unknown, cookie?: string) =>
  nx(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cookie });

/** Set-Cookie에서 세션 쿠키만 추출 */
function sessionCookie(res: Response): string {
  const sc = res.headers.get('set-cookie') ?? '';
  const m = /repman_session=([^;]*)/.exec(sc);
  return m ? `repman_session=${m[1]}` : '';
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-auth.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });

  const { prisma } = await import('@/server/db');
  const { generateInitialPassword, hashPassword } = await import('@/server/password');
  const d = await prisma.division.create({
    data: { slug: 'PW_Div', shortSlug: 'pwd', nameKo: '비번부서', nameEn: 'PW', isActive: true },
  });
  INITIAL = generateInitialPassword();
  await prisma.user.create({
    data: {
      email: EMAIL,
      name: '가나다',
      divisionId: d.id,
      passwordHash: await hashPassword(INITIAL),
      mustChangePassword: true,
    },
  });
  await prisma.user.create({ data: { email: OTHER, name: '라마바', divisionId: d.id } }); // 비번 미발급
}, 60_000);

describe('[AU-20] 비밀번호 해시', () => {
  it('같은 비밀번호도 매번 다른 해시 (salt) · 검증은 통과', async () => {
    const { hashPassword, verifyPassword } = await import('@/server/password');
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
  it('[AU-24] 정책 — 길이·아이디 포함·흔한 값 거부', async () => {
    const { validatePasswordPolicy } = await import('@/server/password');
    expect(validatePasswordPolicy('short')).not.toBeNull();
    expect(validatePasswordPolicy('password123456')).not.toBeNull();
    expect(validatePasswordPolicy('honghong12', { email: 'honghong@kei.re.kr' })).not.toBeNull();
    expect(validatePasswordPolicy('aaaaaaaaaaaa')).not.toBeNull();
    expect(validatePasswordPolicy('  spaced123  ')).not.toBeNull();
    expect(validatePasswordPolicy('푸른하늘은하수1234')).toBeNull(); // 한글 허용
  });
  it('초기 비밀번호는 헷갈리는 글자를 쓰지 않는다', async () => {
    const { generateInitialPassword } = await import('@/server/password');
    for (let i = 0; i < 30; i++) {
      const pw = generateInitialPassword();
      expect(pw.length).toBe(12);
      expect(/[0O1lI]/.test(pw)).toBe(false);
    }
  });
});

describe('[AU-21/23] 로그인', () => {
  it('잘못된 비밀번호 → 401, 없는 계정도 동일 문구 (사용자 열거 방지)', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const bad = await POST(jsonReq('/api/auth/login', { email: EMAIL, password: 'nope-nope-1' }));
    const ghost = await POST(jsonReq('/api/auth/login', { email: 'ghost@t.kei.re.kr', password: 'x' }));
    expect(bad.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect((await bad.json()).message).toBe((await ghost.json()).message);
  });
  it('비밀번호 미발급 계정 → 401 (동일 문구)', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(jsonReq('/api/auth/login', { email: OTHER, password: 'anything123' }));
    expect(res.status).toBe(401);
  });
  it('올바른 비밀번호 → 200 + 세션 쿠키 + mustChangePassword', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mustChangePassword).toBe(true);
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('repman_session=');
    expect(sc.toLowerCase()).toContain('httponly');
    expect(sc.toLowerCase()).not.toContain('secure'); // 사내망 HTTP (AU-26)
  });
  it('[AU-23] 연속 실패 8회 → 계정 잠금 429', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const { prisma } = await import('@/server/db');
    await prisma.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lockedUntil: null } });
    let last: Response | undefined;
    for (let i = 0; i < 8; i++) {
      last = await POST(jsonReq('/api/auth/login', { email: EMAIL, password: 'wrong-one-123' }));
    }
    expect(last!.status).toBe(401);
    const locked = await POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL }));
    expect(locked.status).toBe(429); // 올바른 비밀번호여도 잠금 중엔 거부
    await prisma.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lockedUntil: null } });
  });
});

describe('[AU-21] 세션으로 신원 해석', () => {
  it('세션 쿠키만으로 /api/me 200 · 쿠키 없으면 401', async () => {
    const login = await import('@/app/api/auth/login/route');
    const me = await import('@/app/api/me/route');
    const res = await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL }));
    const cookie = sessionCookie(res);
    expect(cookie).toContain('repman_session=');

    const ok = await me.GET(nx('/api/me', { cookie }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.name).toBe('가나다');

    const anon = await me.GET(nx('/api/me'));
    expect(anon.status).toBe(401);
  });
  it('위조 토큰 → 401', async () => {
    const me = await import('@/app/api/me/route');
    const res = await me.GET(nx('/api/me', { cookie: 'repman_session=forged-token-value' }));
    expect(res.status).toBe(401);
  });
  it('세션 TTL은 약 한 달 (재로그인 피로도 완화)', async () => {
    const { SESSION_TTL_MS } = await import('@/server/session');
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('[AU-22/25] 비밀번호 변경', () => {
  it('현재 비밀번호 틀리면 401', async () => {
    const login = await import('@/app/api/auth/login/route');
    const pw = await import('@/app/api/auth/password/route');
    const cookie = sessionCookie(await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL })));
    const res = await pw.POST(
      jsonReq('/api/auth/password', { currentPassword: 'wrong', newPassword: '새비밀번호1234' }, cookie),
    );
    expect(res.status).toBe(401);
  });
  it('정책 위반 → 422', async () => {
    const login = await import('@/app/api/auth/login/route');
    const pw = await import('@/app/api/auth/password/route');
    const cookie = sessionCookie(await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL })));
    const res = await pw.POST(
      jsonReq('/api/auth/password', { currentPassword: INITIAL, newPassword: 'short' }, cookie),
    );
    expect(res.status).toBe(422);
  });
  it('변경 성공 → mustChangePassword 해제 · 기존 세션 무효화 · 새 쿠키 발급', async () => {
    const login = await import('@/app/api/auth/login/route');
    const pw = await import('@/app/api/auth/password/route');
    const me = await import('@/app/api/me/route');
    const { prisma } = await import('@/server/db');

    // 세션 2개 (다른 기기 흉내)
    const c1 = sessionCookie(await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL })));
    const c2 = sessionCookie(await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL })));

    const NEW = '나의새로운비밀번호99';
    const res = await pw.POST(
      jsonReq('/api/auth/password', { currentPassword: INITIAL, newPassword: NEW }, c1),
    );
    expect(res.status).toBe(200);
    const c1b = sessionCookie(res); // 지금 브라우저만 재발급

    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(u.mustChangePassword).toBe(false);

    // 다른 기기 세션은 죽어야 한다 (AU-25)
    expect((await me.GET(nx('/api/me', { cookie: c2 }))).status).toBe(401);
    expect((await me.GET(nx('/api/me', { cookie: c1b }))).status).toBe(200);

    // 새 비밀번호로 로그인되고 옛 비밀번호는 거부
    expect((await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: NEW }))).status).toBe(200);
    expect((await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL }))).status).toBe(401);
    INITIAL = NEW;
  });
});

describe('로그아웃', () => {
  it('세션 파기 후 401', async () => {
    const login = await import('@/app/api/auth/login/route');
    const out = await import('@/app/api/auth/logout/route');
    const me = await import('@/app/api/me/route');
    const cookie = sessionCookie(await login.POST(jsonReq('/api/auth/login', { email: EMAIL, password: INITIAL })));
    expect((await me.GET(nx('/api/me', { cookie }))).status).toBe(200);
    await out.POST(nx('/api/auth/logout', { method: 'POST', cookie }));
    expect((await me.GET(nx('/api/me', { cookie }))).status).toBe(401);
  });
});
