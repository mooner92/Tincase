// AU-30a · AU-32a · AU-32b — 로그인 없이 열리는 비밀번호 길의 세 제한 (TACP §6 v1.14 · ADR-0020).
//
// 2026-10-10 출시 전 점검에서 실측된 셋을 그대로 시험으로 옮겼다(사람·부서는 지어낸 것):
//   AU-T92  꺼진 부서 사람에게도 실제 메신저 쪽지가 나갔다 — 이제 같은 응답 · 쪽지 0 · 토큰 0 · 기록 0. 꺼진 부서의 운영자에게는 간다
//   AU-T93  IP 한도는 x-forwarded-for를 바꾸면 없었다 — 이제 전체 한도에서 429 · 사람마다 하루 3통(재시작해도)
//   AU-T94  새 링크가 운영자의 링크를 「이미 사용한 링크 — 비밀번호가 이미 설정되었습니다」로 바꿔 보였다 — 이제 「새 링크가 다시 발급된 링크」
//
// 메신저는 가짜다 — 전역 fetch를 바꿔 끼워 나간 쪽지(받는 사번 · 제목)만 적는다. 운영 메신저에 닿는 길이 없다.
// DB: prisma/test-password-paths.db — 이 파일 전용.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-pw-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-password-paths.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_URL = 'http://messenger.invalid/alert';
process.env.MESSENGER_ALLOWLIST = '*'; // 10/13 운영과 같다 — 허용 목록이 거르지 않는다
process.env.MESSENGER_LINK_BASE = 'http://tincase.invalid:11111';
delete process.env.DEV_IDENTITY;
delete process.env.TINCASE_ENV;
delete process.env.MESSENGER_SINK;

const sent: { recv: string; subject: string; contents: string }[] = [];
let db: typeof import('@/server/db').prisma;

const OFF = 'off-member@example.invalid';
const OFF_OP = 'off-operator@example.invalid';
const on = (i: number) => `on${i}@example.invalid`;

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-password-paths.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  db = (await import('@/server/db')).prisma;
  const off = await db.division.create({ data: { slug: 'Off_Div', nameKo: '꺼진부서', nameEn: 'Off', isActive: false, notifyEnabled: false } });
  const live = await db.division.create({ data: { slug: 'On_Div', nameKo: '켠부서', nameEn: 'On', isActive: true, notifyEnabled: true } });
  await db.user.create({ data: { email: OFF, name: '꺼진부서원', divisionId: off.id, employeeNo: 'E9001' } });
  // 운영자는 부서가 꺼져 있어도 들어온다(requireScope) — 그 사람의 비밀번호 찾기는 그대로 간다
  await db.user.create({ data: { email: OFF_OP, name: '꺼진부서운영', divisionId: off.id, employeeNo: 'E9002', isOperator: true } });
  for (let i = 0; i < 40; i++) {
    await db.user.create({ data: { email: on(i), name: `켠부서원${i}`, divisionId: live.id, employeeNo: `E8${String(i).padStart(3, '0')}` } });
  }
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body));
    sent.push({ recv: form.get('RecvId') ?? '', subject: form.get('Subject') ?? '', contents: form.get('Contents') ?? '' });
    return new Response('send ok\n', { status: 200 });
  });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-password-paths.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

beforeEach(async () => {
  const { resetRateLimitsForTest } = await import('@/server/http');
  resetRateLimitsForTest();
});

function forgotReq(email: string, xff: string) {
  const r = new Request('http://t.local/api/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ email }),
  }) as Request & { nextUrl: URL };
  r.nextUrl = new URL('http://t.local/api/forgot');
  return r as never;
}
async function forgot(email: string, xff = '10.0.0.1') {
  const { POST } = await import('@/app/api/forgot/route');
  return POST(forgotReq(email, xff));
}
const userId = async (email: string) => (await db.user.findUniqueOrThrow({ where: { email } })).id;

describe('[AU-T92] ★ 비밀번호 찾기는 로그인할 수 있는 사람에게만 (AU-32a — v1.14 새로 금지된 것)', () => {
  it('꺼진 부서 사람 — 같은 응답 · 쪽지 0 · 토큰 0 · 감사 기록 0', async () => {
    const before = sent.length;
    const res = await forgot(OFF);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent.slice(before)).toEqual([]);
    const id = await userId(OFF);
    expect(await db.setupToken.count({ where: { userId: id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'setup_link', target: `user:${id}` } })).toBe(0);
  });

  it('없는 메일과 응답이 같다 — 꺼진 부서라는 것도 드러나지 않는다', async () => {
    const a = await forgot(OFF, '10.0.0.2');
    const b = await forgot('nobody-here@example.invalid', '10.0.0.3');
    expect([a.status, await a.json()]).toEqual([b.status, await b.json()]);
  });

  it('꺼진 부서의 운영자에게는 간다 — 운영자는 부서와 상관없이 들어온다(그대로 허용인 것)', async () => {
    const before = sent.length;
    expect((await forgot(OFF_OP)).status).toBe(200);
    expect(sent.slice(before).map((s) => s.recv)).toEqual(['E9002']);
    const id = await userId(OFF_OP);
    expect(await db.setupToken.count({ where: { userId: id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'setup_link', target: `user:${id}` } })).toBe(1);
  });

  it('판정은 authz.ts의 canSignIn — requireScope와 같은 식 (TACP-12)', async () => {
    const { canSignIn } = await import('@/server/authz');
    expect(canSignIn({ isActive: true, isOperator: false }, { isActive: false })).toBe(false);
    expect(canSignIn({ isActive: true, isOperator: true }, { isActive: false })).toBe(true);
    expect(canSignIn({ isActive: false, isOperator: true }, { isActive: true })).toBe(false);
    expect(canSignIn({ isActive: true, isOperator: false }, { isActive: true })).toBe(true);
  });
});

describe('[AU-T93] ★ 한도는 요청 머리로 넘지 못한다 (AU-32b — v1.14 새로 금지된 것)', () => {
  it('x-forwarded-for를 매번 바꿔도 전체 한도(10분에 30번)에서 429 — 그 뒤로는 쪽지가 하나도 안 나간다', async () => {
    const { FORGOT_GLOBAL_LIMIT } = await import('@/server/setup-token');
    const statuses: number[] = [];
    for (let i = 0; i < FORGOT_GLOBAL_LIMIT + 3; i++) statuses.push((await forgot(on(i), `10.8.${i}.${i}`)).status);
    expect(statuses.slice(0, FORGOT_GLOBAL_LIMIT).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(FORGOT_GLOBAL_LIMIT)).toEqual([429, 429, 429]);
    // 한도를 넘은 사람에게는 토큰이 없다 — 429는 사람을 찾기 전이다
    expect(await db.setupToken.count({ where: { userId: await userId(on(FORGOT_GLOBAL_LIMIT + 1)) } })).toBe(0);
  }, 60_000);

  it('같은 머리면 IP 한도(10분에 10번)가 먼저 — 거드는 신호는 그대로 둔다', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await forgot(`ghost-${i}@example.invalid`, '10.9.9.9')).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('한 사람에게는 하루 3통 — 메모리 한도가 비어도(재시작) DB가 센다 · 넘으면 같은 응답, 쪽지·토큰 없음', async () => {
    const { SELF_LINKS_PER_DAY } = await import('@/server/setup-token');
    const { resetRateLimitsForTest } = await import('@/server/http');
    const who = on(39);
    const id = await userId(who);
    const before = sent.length;
    for (let i = 0; i < SELF_LINKS_PER_DAY + 2; i++) {
      resetRateLimitsForTest(); // 재시작과 같다 — 메모리 한도(메일 주소 30분 3번)는 사라진다
      const r = await forgot(who, `10.7.0.${i}`);
      expect([r.status, await r.json()]).toEqual([200, { ok: true }]);
    }
    expect(sent.slice(before).filter((s) => s.recv === 'E8039')).toHaveLength(SELF_LINKS_PER_DAY);
    expect(await db.setupToken.count({ where: { userId: id } })).toBe(SELF_LINKS_PER_DAY);
    expect(await db.auditLog.count({ where: { action: 'setup_link', target: `user:${id}` } })).toBe(SELF_LINKS_PER_DAY);
  });
});

describe('[AU-T94] ★ 밀린 링크는 「이미 사용함」이 아니다 (AU-30a)', () => {
  it('운영자가 보낸 링크 뒤에 비밀번호 찾기 — 옛 링크는 superseded, 새 링크는 산다, 옛 링크로는 설정하지 못한다', async () => {
    const { issueSetupToken, readSetupToken, consumeSetupToken } = await import('@/server/setup-token');
    const id = await userId(on(38));
    const { token: opLink } = await issueSetupToken(id, 'operator@example.invalid');
    expect((await readSetupToken(opLink)).ok).toBe(true);
    expect((await forgot(on(38), '10.6.0.1')).status).toBe(200);
    expect(await readSetupToken(opLink)).toEqual({ ok: false, reason: 'superseded' }); // 예전: 'used'
    const live = await db.setupToken.findMany({ where: { userId: id, usedAt: null, supersededAt: null } });
    expect(live).toHaveLength(1); // 살아 있는 링크는 하나 (AU-30 안전 성질 4)
    expect(await consumeSetupToken(opLink)).toBe(false);

    const { POST } = await import('@/app/api/setup/route');
    const req = new Request('http://t.local/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: opLink, password: 'Correct-Horse-Battery-9' }),
    }) as Request & { nextUrl: URL };
    req.nextUrl = new URL('http://t.local/api/setup');
    const res = await POST(req as never);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'token_superseded', message: '더 새 링크가 나갔어요 — 가장 최근 쪽지의 링크를 쓰세요.' });
    expect((await db.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull(); // 아무것도 바뀌지 않았다
  });

  it('화면 — 밀린 링크는 「새 링크가 다시 발급된 링크입니다」, 쓴 링크만 「이미 사용한 링크입니다」, 만료는 「비밀번호를 잊으셨나요?」를 말한다', async () => {
    const { issueSetupToken, consumeSetupToken, SETUP_TOKEN_DAYS } = await import('@/server/setup-token');
    const Page = (await import('@/app/setup/[token]/page')).default;
    const html = async (token: string) => renderToStaticMarkup((await Page({ params: Promise.resolve({ token }) })) as never);
    const id = await userId(on(37));
    const first = await issueSetupToken(id, 'operator@example.invalid');
    const second = await issueSetupToken(id, 'operator@example.invalid');
    const page1 = await html(first.token);
    expect(page1).toContain('새 링크가 다시 발급된 링크입니다');
    expect(page1).toContain('비밀번호는 아직 바뀌지 않았습니다');
    expect(page1).not.toContain('이미 사용한 링크');
    expect(page1).not.toContain('이미 설정되었습니다');
    expect(await consumeSetupToken(second.token)).toBe(true);
    expect(await html(second.token)).toContain('이미 사용한 링크입니다');
    // 만료 — 날짜만 지난 링크
    const third = await issueSetupToken(id, 'operator@example.invalid', new Date(Date.now() - (SETUP_TOKEN_DAYS + 1) * 86_400_000));
    const expired = await html(third.token);
    expect(expired).toContain('기한이 지난 링크입니다');
    expect(expired).toContain('비밀번호를 잊으셨나요?');
  });

  it('이 열이 생기기 전에 밀린 링크(「쓴 시각」 = 「만료」)도 밀린 것으로 읽는다 · 정말 쓴 링크는 그대로 used', async () => {
    const { readSetupToken } = await import('@/server/setup-token');
    const { createHash } = await import('node:crypto');
    const id = await userId(on(36));
    const at = new Date(Date.now() - 60_000);
    const legacy = 'legacy-superseded-token-0123456789';
    await db.setupToken.create({
      data: { userId: id, tokenHash: createHash('sha256').update(legacy).digest('hex'), expiresAt: at, usedAt: at, createdBy: 'operator@example.invalid' },
    });
    expect(await readSetupToken(legacy)).toEqual({ ok: false, reason: 'superseded' });
    const usedOne = 'legacy-used-token-0123456789abcdef';
    await db.setupToken.create({
      data: {
        userId: id,
        tokenHash: createHash('sha256').update(usedOne).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: at,
        createdBy: 'operator@example.invalid',
      },
    });
    expect(await readSetupToken(usedOne)).toEqual({ ok: false, reason: 'used' });
  });
});
