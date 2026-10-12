// AU-34 (2026-10-10) — 로그인 뒤 **가려던 화면으로** 돌아간다. 열린 리다이렉트는 만들지 않는다.
//
// 2026-10-10 알림 점검: 메신저 쪽지의 링크(부서장 검토 요청 → `/{부서}/manage`)를 로그인하지 않은 브라우저로 열면 가드가 `/login`으로 보냈고,
// 로그인하면 홈에 떨어졌다 — 쪽지가 가리킨 화면을 다시 찾아가야 했다.
//   AU-T95  가드는 지금 주소를 `?next=`로 싣는다(proxy가 붙인 머리) · 로그인 화면·폼은 같은 사이트 경로만 받는다 — `//` · `/\` · 제어 문자 ·
//           다른 호스트 · `/login` · `/api/`는 없는 것 · 이미 로그인 상태면 그 화면으로 바로
//
// DB: prisma/test-login-next.db — 이 파일 전용. 사람은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-next-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-login-next.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

// 페이지가 읽는 요청 머리 — 사람(x-test-identity)과 proxy가 붙이는 지금 주소(x-tincase-path)
const req = vi.hoisted(() => ({ who: '', path: '' }));
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (req.who) h.set('x-test-identity', req.who);
    if (req.path) h.set('x-tincase-path', req.path);
    return h;
  },
}));

const LEAD = 'next-lead@example.invalid';

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-login-next.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const d = await prisma.division.create({ data: { slug: 'Next_Div', nameKo: '돌아가기시험실', nameEn: 'Next Div', isActive: true } });
  await prisma.user.create({ data: { email: LEAD, name: '담당', divisionId: d.id, divisionRole: 'lead', mustChangePassword: false } });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-login-next.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

/** 서버 컴포넌트가 던진 redirect의 행선지 — 던지지 않았으면 null */
async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? '');
    if (!digest.startsWith('NEXT_REDIRECT')) throw e;
    return digest.split(';')[2] ?? null;
  }
}

describe('[AU-T95] ★ 로그인 뒤 가려던 화면으로 — 같은 사이트 경로만 (AU-34)', () => {
  it('safeNextPath — 같은 사이트 경로는 그대로, 열린 리다이렉트 시도는 모두 null', async () => {
    const { safeNextPath } = await import('@/lib/next-path');
    for (const ok of ['/Next_Div/manage', '/org?isoKey=2026-W42', '/hq', '/ops', '/Next_Div', '/%2F%2Fevil.example']) {
      expect(safeNextPath(ok), ok).toBe(ok);
    }
    for (const bad of [
      '//evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '/\\\\evil.example',
      'https://evil.example/',
      'http:evil.example',
      'evil.example',
      'javascript:alert(1)',
      '/\t/evil.example', // 탭 — 브라우저가 지워 「//evil」이 된다
      '/\n/evil.example',
      '/a\\b',
      '/login',
      '/login?next=%2Fops',
      '/api/health',
      `/${'a'.repeat(600)}`,
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad as string | null | undefined), JSON.stringify(bad)).toBeNull();
    }
  });

  it('loginHref · requestPath — 홈은 싣지 않는다 · 화면 이동 요청의 _rsc는 뺀다', async () => {
    const { loginHref, requestPath } = await import('@/lib/next-path');
    expect(loginHref('/Next_Div/manage')).toBe('/login?next=%2FNext_Div%2Fmanage');
    expect(loginHref('/')).toBe('/login');
    expect(loginHref('//evil.example')).toBe('/login');
    expect(loginHref(null)).toBe('/login');
    expect(requestPath(new URL('http://t.local/org?isoKey=2026-W42&_rsc=abc123'))).toBe('/org?isoKey=2026-W42');
    expect(requestPath(new URL('http://t.local/Next_Div/manage?_rsc=1'))).toBe('/Next_Div/manage');
  });

  it('proxy가 지금 주소를 머리로 붙인다 — 요청이 보낸 같은 이름의 머리는 덮어쓴다 · 화면만(API·정적 파일 제외)', async () => {
    const { NextRequest } = await import('next/server');
    const { proxy, config } = await import('@/proxy');
    const res = proxy(new NextRequest('http://t.local/Next_Div/manage?isoKey=2026-W42&_rsc=x', { headers: { 'x-tincase-path': '//evil.example' } }));
    // NextResponse.next({ request: { headers } })는 바꾼 요청 머리를 x-middleware-request-* 로 실어 보낸다
    expect(res.headers.get('x-middleware-request-x-tincase-path')).toBe('/Next_Div/manage?isoKey=2026-W42');
    expect(config.matcher[0]).toContain('api/');
    expect(config.matcher[0]).toContain('_next/');
  });

  it('가드 — 로그인하지 않은 사람을 /login?next={지금 주소}로 보낸다 (부서 레이아웃 · 수합 관리 · 표준 진입점 · 홈)', async () => {
    req.who = '';
    req.path = '/Next_Div/manage';
    try {
      const { requirePageScope } = await import('@/server/page-scope');
      expect(await redirectOf(() => requirePageScope())).toBe('/login?next=%2FNext_Div%2Fmanage');
      const Layout = (await import('@/app/[division]/layout')).default;
      expect(await redirectOf(() => Layout({ children: null, params: Promise.resolve({ division: 'Next_Div' }) }))).toBe('/login?next=%2FNext_Div%2Fmanage');
      req.path = '/';
      const Home = (await import('@/app/page')).default;
      expect(await redirectOf(() => Home())).toBe('/login'); // 홈은 싣지 않는다
      req.path = '//evil.example'; // 머리를 위조해도(proxy가 덮어쓰지만) 가드는 같은 사이트 경로만 싣는다
      expect(await redirectOf(() => requirePageScope())).toBe('/login');
    } finally {
      req.path = '';
    }
    // 가드가 `/login`을 직접 적은 곳이 남지 않았다 — 모두 loginPath()를 거친다
    for (const f of ['src/app/[division]/layout.tsx', 'src/app/[division]/manage/page.tsx', 'src/app/ops/page.tsx', 'src/app/page.tsx', 'src/server/page-scope.ts']) {
      expect(readFileSync(path.join(ROOT, f), 'utf8'), f).not.toContain("redirect('/login')");
    }
  });

  it('로그인 화면 — 로그인 폼에 거른 next를 넘기고, 이미 로그인 상태면 그 화면으로 바로 · 다른 곳을 가리키면 홈', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    const { LoginForm } = await import('@/app/login/LoginForm');
    const formNext = async (next: string) => {
      req.who = '';
      const el = (await LoginPage({ searchParams: Promise.resolve({ next }) })) as { props: { children: { props: { children: unknown[] } } } };
      const kids = el.props.children.props.children as { type: unknown; props: { next?: string | null } }[];
      return kids.find((k) => k && k.type === LoginForm)?.props.next;
    };
    expect(await formNext('/Next_Div/manage')).toBe('/Next_Div/manage');
    expect(await formNext('//evil.example')).toBeNull();
    expect(await formNext('https://evil.example')).toBeNull();
    req.who = LEAD;
    try {
      expect(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({ next: '/Next_Div/manage' }) }))).toBe('/Next_Div/manage');
      expect(await redirectOf(() => LoginPage({ searchParams: Promise.resolve({ next: '//evil.example' }) }))).toBe('/');
    } finally {
      req.who = '';
    }
    // 폼도 한 번 더 거른다 — 로그인이 끝나면 safeNextPath(next) ?? '/'
    const form = readFileSync(path.join(ROOT, 'src/app/login/LoginForm.tsx'), 'utf8');
    expect(form).toContain("safeNextPath(next) ?? '/'");
  });
});
