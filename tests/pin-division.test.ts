// DM-26 · RS-17 · API-67 (ADR-0022 D1) — 소속 고정. ERP 소속과 다른 부서의 글을 맡는 사람을 운영자가 /ops에서 옮기면
// 인원 최신화가 매주 되돌리지 않는다. 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-pin-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-pin.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const DIV = {
  hq: { slug: 'PN_HQ', nameKo: '본부가', parentKo: '한국환경연구원' },
  unit: { slug: 'PN_U', nameKo: '실하나', parentKo: '본부가' },
  center: { slug: 'PN_C', nameKo: '센터다', parentKo: '한국환경연구원' },
} as const;
type Key = keyof typeof DIV;
const P = {
  op: { email: 'pn-op@test.local', div: 'center', role: 'member', op: true },
  lead: { email: 'pn-lead@test.local', div: 'unit', role: 'lead' },
  member: { email: 'pn-member@test.local', div: 'hq', role: 'member' },
} as const;
const divId = {} as Record<Key, string>;
const userId = {} as Record<keyof typeof P, string>;

function nx(url: string, identity: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-test-identity': identity },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const db = async () => (await import('@/server/db')).prisma;

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-pin.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  for (const [key, d] of Object.entries(DIV) as [Key, (typeof DIV)[Key]][]) {
    divId[key] = (await prisma.division.create({ data: { slug: d.slug, nameKo: d.nameKo, nameEn: d.slug, parentKo: d.parentKo, isActive: true } })).id;
  }
  for (const [k, p] of Object.entries(P) as [keyof typeof P, (typeof P)[keyof typeof P]][]) {
    const u = await prisma.user.create({
      data: { email: p.email, name: k, divisionId: divId[p.div as Key], divisionRole: p.role, isOperator: 'op' in p && p.op, jobTitle: '담당' },
    });
    userId[k] = u.id;
  }
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('DM-26 소속 고정 (ADR-0022 D1)', () => {
  it('[RS-T40] 고정한 사람은 ERP 부서가 달라도 옮기지 않고 「고정」으로 알리기만 — 고정 안 한 사람은 그대로 옮긴다', async () => {
    const { planRosterSync } = await import('@/server/roster/sync');
    const base = { divisionRole: 'member', onRoster: true, rosterNote: null, isActive: true, isOperator: false, isCoordinator: false, jobTitle: '담당' };
    const people = [
      { ...base, id: 'a', email: 'a@x', name: '가', divisionId: 'u', divisionKo: '실하나', employeeNo: '1', divisionPinned: true },
      { ...base, id: 'b', email: 'b@x', name: '나', divisionId: 'u', divisionKo: '실하나', employeeNo: '2' },
    ];
    const erp = [
      { name: '가', email: 'a@x', employeeNo: '1', divisionKo: '본부가', parentKo: '한국환경연구원', jobTitle: '담당' },
      { name: '나', email: 'b@x', employeeNo: '2', divisionKo: '본부가', parentKo: '한국환경연구원', jobTitle: '담당' },
    ];
    const plan = planRosterSync(people, erp as never, ['실하나', '본부가']);
    expect(plan.changes.map((c) => [c.name, c.kind])).toEqual([['나', 'move']]);
    expect(plan.pinned).toEqual(['가 — ERP 소속 본부가 · Tincase 소속 실하나(고정 — 옮기지 않음)']);
    expect(plan.blockers).toEqual([]);

    // 고정한 사람도 이름·직책 같은 다른 변화는 그대로 맞춘다 — 부서만 옮기지 않는다
    const renamed = planRosterSync(people, [{ ...erp[0], name: '가가' }] as never, ['실하나', '본부가']);
    const ga = renamed.changes.find((c) => c.name === '가가' || c.name === '가');
    expect(ga?.apply).toEqual({ name: '가가' });
  });

  it('[RS-T41] /ops에서 소속을 옮기면 고정 · GET에 보인다 · 고정 풀기 · 사람마다 감사 — 운영자만, 잘못된 값은 전체를 막는다', async () => {
    const prisma = await db();
    const { GET, PUT } = await import('@/app/api/ops/roster/route');
    const put = (who: string, updates: unknown[]) =>
      PUT(nx('/api/ops/roster', who, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates }) }));

    expect((await put(P.lead.email, [{ userId: userId.member, divisionId: divId.unit }])).status).toBe(404); // 운영자만
    expect((await put(P.op.email, [{ userId: userId.member, divisionId: 'nope' }])).status).toBe(422);
    // 하나라도 잘못되면 아무것도 바뀌지 않는다(API-27)
    expect((await put(P.op.email, [{ userId: userId.member, divisionId: divId.unit }, { userId: userId.lead, divisionPinned: true }])).status).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId.member } })).divisionId).toBe(divId.hq);

    expect((await put(P.op.email, [{ userId: userId.member, divisionId: divId.unit, divisionRole: 'lead' }])).status).toBe(200);
    let u = await prisma.user.findUniqueOrThrow({ where: { id: userId.member } });
    expect([u.divisionId, u.divisionPinned, u.divisionRole]).toEqual([divId.unit, true, 'lead']);
    const moved = await prisma.auditLog.findMany({ where: { action: 'roster_move', target: `user:${userId.member}` } });
    expect(moved.map((a) => [a.actor, a.divisionId])).toEqual([[P.op.email, divId.unit]]);

    const got = await (await GET(nx(`/api/ops/roster?division=${divId.unit}`, P.op.email))).json();
    expect(got.users.map((x: { name: string; divisionPinned: boolean }) => [x.name, x.divisionPinned]).sort()).toEqual([
      ['lead', false],
      ['member', true],
    ]);

    expect((await put(P.op.email, [{ userId: userId.member, divisionPinned: false }])).status).toBe(200);
    u = await prisma.user.findUniqueOrThrow({ where: { id: userId.member } });
    expect([u.divisionId, u.divisionPinned]).toEqual([divId.unit, false]); // 부서는 그대로 — 다음 인원 최신화가 옮긴다
    expect(await prisma.auditLog.count({ where: { action: 'roster_unpin', target: `user:${userId.member}` } })).toBe(1);
    expect((await put(P.op.email, [{ userId: userId.member, divisionPinned: true }])).status).toBe(422); // 고정은 옮겨서만
  });
});
