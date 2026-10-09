// AU-09a · TACP §3.1 (v1.14) — 감사 로그는 **운영자만** 읽는다.
//
// 2026-10-10 출시 전 점검: `/ops/audit`가 readAll(총괄)로 문을 열었고 actor를 거르지 않아, 총괄이 남의 로그인·비밀번호 초기화·
// 내려받기 기록 전부를 읽었다. 「전사」 화면도 그 링크를 총괄에게 그렸다. 기획조정실(총괄의 부서)을 켜는 10/13에 열릴 참이었다.
// 지키는 것: 문은 `canReadAuditLog` 하나 — 총괄·담당·부서원 404, 운영자만 그린다 · 링크도 같은 판정(「전사」 `orgPageView().audit`).
//
// DB: prisma/test-audit-access.db — 이 파일 전용. 사람·부서는 모두 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-audit-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-audit-access.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));

const ID = {
  op: 'audit-op@example.invalid',
  coord: 'audit-coord@example.invalid',
  lead: 'audit-lead@example.invalid',
  member: 'audit-member@example.invalid',
};
const NF = 'NEXT_HTTP_ERROR_FALLBACK;404';

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-audit-access.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const d = await prisma.division.create({ data: { slug: 'Audit_Div', shortSlug: 'ad', nameKo: '감사시험실', nameEn: 'Audit Div', isActive: true } });
  await prisma.user.create({ data: { email: ID.op, name: '운영', divisionId: d.id, isOperator: true, mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.coord, name: '총괄', divisionId: d.id, isCoordinator: true, mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.lead, name: '담당', divisionId: d.id, divisionRole: 'lead', mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.member, name: '부서원', divisionId: d.id, mustChangePassword: false } });
  // 남의 기록 — 총괄이 읽으면 안 되는 것들(로그인·비밀번호 초기화·내려받기)
  await prisma.auditLog.create({ data: { actor: ID.member, action: 'login_ok', target: 'session' } });
  await prisma.auditLog.create({ data: { actor: ID.op, action: 'password_reset', target: 'user:someone' } });
  await prisma.auditLog.create({ data: { actor: ID.lead, action: 'download', target: 'submission:abc' } });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-audit-access.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

/** 페이지를 그 사람으로 그린다 — 던진 Next 신호(notFound)의 digest, 그렸으면 'rendered' */
async function openAudit(who: string): Promise<string> {
  const page = (await import('@/app/ops/audit/page')).default;
  pageAs.who = who;
  try {
    await page({ searchParams: Promise.resolve({}) });
    return 'rendered';
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  } finally {
    pageAs.who = '';
  }
}

type El = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && 'type' in node && 'props' in node) {
    out.push(node as El);
    for (const v of Object.values((node as El).props ?? {})) elements(v, out);
  }
  return out;
}

describe('[AU-T91] ★ 감사 로그는 운영자만 (TACP §3.1 · v1.14 — 고친 위반)', () => {
  it('/ops/audit — 총괄·담당·부서원은 404, 운영자만 그린다', async () => {
    expect(await openAudit(ID.coord)).toBe(NF); // 고친 것 — 예전에는 readAll로 열렸다
    expect(await openAudit(ID.lead)).toBe(NF);
    expect(await openAudit(ID.member)).toBe(NF);
    expect(await openAudit(ID.op)).toBe('rendered');
  });

  it('판정은 authz.ts의 canReadAuditLog 하나 — 페이지가 readAll을 직접 보지 않는다 (TACP-12)', async () => {
    const { canReadAuditLog } = await import('@/server/authz');
    expect(canReadAuditLog({ isOperator: true })).toBe(true);
    expect(canReadAuditLog({ isOperator: false })).toBe(false);
    const src = readFileSync(path.join(ROOT, 'src/app/ops/audit/page.tsx'), 'utf8');
    expect(src).toContain('canReadAuditLog(scope.user)');
    expect(src).not.toMatch(/if \(!scope\.readAll\)/);
  });

  it('「전사」(/org) — 감사 로그 링크는 운영자에게만, 감사 문서·CSV는 readAll 그대로', async () => {
    const { prisma } = await import('@/server/db');
    const OrgPage = (await import('@/app/org/page')).default;
    const hrefsOf = async (who: string) => {
      pageAs.who = who;
      try {
        return elements(await OrgPage({ searchParams: Promise.resolve({}) }))
          .map((e) => e.props.href)
          .filter((h): h is string => typeof h === 'string');
      } finally {
        pageAs.who = '';
      }
    };
    try {
      const coord = await hrefsOf(ID.coord);
      expect(coord).not.toContain('/ops/audit');
      expect(coord.some((h) => h.startsWith('/api/ops/report?'))).toBe(true);
      const op = await hrefsOf(ID.op);
      expect(op).toContain('/ops/audit');
      const { orgPageView, requireScope } = await import('@/server/authz');
      const as = (who: string) => requireScope(new Headers({ 'x-test-identity': who }));
      expect((await orgPageView(await as(ID.coord))).audit).toBe(false);
      expect((await orgPageView(await as(ID.op))).audit).toBe(true);
    } finally {
      await prisma.orgSection.deleteMany({}); // 「전사」를 처음 열면 기본 섹션이 저장된다 — 다른 시험에 남기지 않는다
    }
  }, 60_000);
});
