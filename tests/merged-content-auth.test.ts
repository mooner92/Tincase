// API-50a (2026-10-10) — 병합본 수정(`PUT /api/division/merged/content`)은 **인증·역할을 본문보다 먼저** 본다 (TACP §5 판정 순서).
//
// 2026-10-10 점검: 본문 검사(422 「표 내용이 없습니다」)가 인증보다 앞이라, 로그인하지 않은 요청과 권한 없는 사람(부서원·총괄)이
// 본문 모양에 따라 401·404 대신 422를 받았다 — 이 경로가 있고 무엇을 받는지 알려 주는 셈이다(TACP-5 「권한 없음은 404」).
// DB: prisma/test-merged-auth.db — 이 파일 전용. 사람은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-mauth-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-merged-auth.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const ID = { lead: 'ma-lead@example.invalid', member: 'ma-member@example.invalid', coord: 'ma-coord@example.invalid' };

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-merged-auth.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const d = await prisma.division.create({ data: { slug: 'Ma_Div', nameKo: '수정시험실', nameEn: 'Ma Div', isActive: true } });
  await prisma.user.create({ data: { email: ID.lead, name: '담당', divisionId: d.id, divisionRole: 'lead', mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.member, name: '부서원', divisionId: d.id, mustChangePassword: false } });
  await prisma.user.create({ data: { email: ID.coord, name: '총괄', divisionId: d.id, isCoordinator: true, mustChangePassword: false } });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-merged-auth.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

async function put(identity: string | null, body: string) {
  const { PUT } = await import('@/app/api/division/merged/content/route');
  const r = new Request('http://test.local/api/division/merged/content', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(identity ? { 'x-test-identity': identity } : {}) },
    body,
  }) as Request & { nextUrl: URL };
  r.nextUrl = new URL('http://test.local/api/division/merged/content');
  return PUT(r as never);
}

describe('[API-T30] 병합본 수정 — 인증·역할이 본문 검사보다 먼저 (API-50a · TACP §5 판정 순서)', () => {
  it('본문이 틀려도 로그인 없음 401 · 부서원 404 · 총괄 404 — 422가 아니다', async () => {
    for (const bad of ['{}', 'not json', JSON.stringify({ tables: null })]) {
      expect((await put(null, bad)).status, `no identity · ${bad}`).toBe(401);
      expect((await put(ID.member, bad)).status, `member · ${bad}`).toBe(404);
      expect((await put(ID.coord, bad)).status, `coordinator · ${bad}`).toBe(404); // §3.2 「병합본 수정」의 coordinator 칸은 「—」
    }
  });

  it('권한 있는 사람(담당)에게만 본문 검사가 말한다 — 422 「표 내용이 없습니다」', async () => {
    const res = await put(ID.lead, '{}');
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe('표 내용이 없습니다.');
  });
});
