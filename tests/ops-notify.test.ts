// API-66 · NT-30 · NT-61 — 부서 알림 스위치를 운영자 화면(`/ops`)에서 바꾼다.
//
// 지키는 것 둘:
//   ① 바꾸는 길은 운영자에게만 있고(그 밖은 404), 불리언이 아니면 아무것도 바꾸지 않으며, 감사 기록에 **어느 쪽으로** 바꿨는지 남는다
//   ② 스위치는 켜짐과 따로라 꺼진 부서에도 켤 수 있다 — 그래서 꺼진 부서에 켜 둔 스위치가 정말 아무것도 보내지 않는지 함께 본다(NT-30의 「그리고」)
// 메신저는 흉내 낸다(적기만 하고 아무에게도 보내지 않는다). 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-ops-notify-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-ops-notify.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 30_000 });

const msgr = vi.hoisted(() => ({ outbox: [] as { to: string; kind?: string }[] }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: true, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; kind?: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, kind: input.kind });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

/** 목 2026-10-15 14:00 KST(기본 마감) — 1시간 전 알림 창 안 */
const NOW = new Date('2026-10-15T13:01:00+09:00');

const ID = {
  op: 'op@test.local', // 운영자 — 켜진 본실의 담당
  lead: 'lead@test.local',
  head: 'head@test.local',
  member: 'member@test.local',
  coord: 'coord@test.local',
  onHead: 'on-head@test.local',
  offOpHead: 'off-op-head@test.local', // 운영자 겸 꺼진 부서의 부서장 — 꺼진 부서에서도 요청이 들어오는 유일한 사람
};
/** 사번 — 받은 쪽지를 사람으로 가른다 */
const NO = { onMember: 'N100', onLead: 'N101', onHead: 'N102', offMember: 'N200', offLead: 'N201', offOpHead: 'N202' };

const div = {} as Record<'home' | 'on' | 'off', { id: string; slug: string }>;
let slotId = '';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://t.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://t.local${url}`);
  return r as never;
}
const putReq = (identity: string, body: unknown) =>
  nx('/api/ops/divisions', identity, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function db() {
  return (await import('@/server/db')).prisma;
}
async function route() {
  return import('@/app/api/ops/divisions/route');
}
async function divRow(id: string) {
  return (await db()).division.findUniqueOrThrow({ where: { id } });
}
async function auditRows(slug: string) {
  // 같은 밀리초에 둘이 남을 수 있다 — cuid는 한 프로세스 안에서 만든 순서로 커진다
  return (await db()).auditLog.findMany({ where: { action: 'rule_update', target: `ops:division:${slug}` }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-ops-notify.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const { ensureCurrentSlot } = await import('@/server/worklog');
  slotId = (await ensureCurrentSlot(NOW)).id;

  const mkDiv = async (key: keyof typeof div, nameKo: string, isActive: boolean, notifyEnabled: boolean) => {
    const d = await prisma.division.create({ data: { slug: `OpsNotify_${key}`, nameKo, nameEn: key, isActive, notifyEnabled } });
    div[key] = { id: d.id, slug: d.slug };
  };
  await mkDiv('home', '본실', true, false);
  await mkDiv('on', '켠실', true, true);
  await mkDiv('off', '꺼진실', false, false);

  const mk = (email: string, key: keyof typeof div, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: div[key].id, ...extra } });
  await mk(ID.op, 'home', { isOperator: true, divisionRole: 'lead' });
  await mk(ID.lead, 'home', { divisionRole: 'lead' });
  await mk(ID.head, 'home', { divisionRole: 'head' });
  await mk(ID.member, 'home');
  await mk(ID.coord, 'home', { isCoordinator: true });
  await mk('on-member@test.local', 'on', { employeeNo: NO.onMember });
  await mk('on-lead@test.local', 'on', { divisionRole: 'lead', employeeNo: NO.onLead });
  await mk(ID.onHead, 'on', { divisionRole: 'head', employeeNo: NO.onHead, onRoster: false });
  await mk('off-member@test.local', 'off', { employeeNo: NO.offMember });
  await mk('off-lead@test.local', 'off', { divisionRole: 'lead', employeeNo: NO.offLead });
  await mk(ID.offOpHead, 'off', { isOperator: true, divisionRole: 'head', employeeNo: NO.offOpHead, onRoster: false });
}, 60_000);

beforeEach(() => {
  msgr.outbox.length = 0;
});

afterAll(async () => {
  const { settleLater } = await import('@/server/after');
  await settleLater(); // PUT 뒤의 이번 주 맞추기(RU-72)가 끝난 뒤에 저장소를 지운다
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('[API-T26] PUT /api/ops/divisions — notifyEnabled (API-66 · NT-61)', () => {
  it('운영자 → 200 · 저장 · 꺼진 부서는 꺼진 채로 · 감사 기록에 바꾼 칸과 어느 쪽인지', async () => {
    const { PUT } = await route();
    const before = await divRow(div.off.id);

    const on = await PUT(putReq(ID.op, { id: div.off.id, notifyEnabled: true }));
    expect(on.status).toBe(200);
    expect((await on.json()).division).toEqual({ id: div.off.id, isActive: false, notifyEnabled: true });
    const after = await divRow(div.off.id);
    expect(after.notifyEnabled).toBe(true);
    // 스위치만 바뀐다 — 켜짐(로그인·제출)은 그대로 꺼져 있다. 켜짐과 따로 움직이는 것이 NT-61이다
    expect({ ...after, notifyEnabled: before.notifyEnabled }).toEqual(before);

    const off = await PUT(putReq(ID.op, { id: div.off.id, notifyEnabled: false }));
    expect(off.status).toBe(200);
    expect((await divRow(div.off.id)).notifyEnabled).toBe(false);

    const rows = await auditRows(div.off.slug);
    expect(rows.map((r) => [r.actor, r.divisionId, JSON.parse(r.detail ?? '{}')])).toEqual([
      [ID.op, div.off.id, { changed: ['notifyEnabled'], notifyEnabled: true }],
      [ID.op, div.off.id, { changed: ['notifyEnabled'], notifyEnabled: false }],
    ]);
  });

  it('GET — 부서마다 notifyEnabled', async () => {
    const { GET } = await route();
    const res = await GET(nx('/api/ops/divisions', ID.op));
    expect(res.status).toBe(200);
    const byId = new Map(((await res.json()).divisions as { id: string; notifyEnabled: boolean }[]).map((d) => [d.id, d.notifyEnabled]));
    expect([byId.get(div.home.id), byId.get(div.on.id), byId.get(div.off.id)]).toEqual([false, true, false]);
  });

  it('불리언이 아니면 422 — 아무것도 바뀌지 않는다(같이 보낸 다른 칸도) · 감사 기록 없음', async () => {
    const { PUT } = await route();
    const before = await divRow(div.on.id);
    const audits = (await auditRows(div.on.slug)).length;
    for (const bad of [null, 'false', 'true', 0, 1, {}, []]) {
      const res = await PUT(putReq(ID.op, { id: div.on.id, notifyEnabled: bad, boardStatus: 'confirmed' }));
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect((await res.json()).error).toBe('invalid_request');
    }
    expect(await divRow(div.on.id)).toEqual(before);
    expect((await auditRows(div.on.slug)).length).toBe(audits);
  });

  it('운영자가 아니면 404 — 담당 · 부서장 · 부서원 · 총괄(readAll이어도). 값은 그대로', async () => {
    const { PUT } = await route();
    for (const who of [ID.lead, ID.head, ID.member, ID.coord]) {
      const res = await PUT(putReq(who, { id: div.on.id, notifyEnabled: false }));
      expect(res.status, who).toBe(404);
    }
    expect((await divRow(div.on.id)).notifyEnabled).toBe(true);
  });

  it('없는 id → 404 (남의 것과 구별되지 않는다 — TACP-5)', async () => {
    const { PUT } = await route();
    const res = await PUT(putReq(ID.op, { id: 'no-such-division', notifyEnabled: true }));
    expect(res.status).toBe(404);
  });
});

describe('[NT-T91] 꺼진 부서는 알림 스위치가 켜져 있어도 받지 않는다 (NT-30)', () => {
  beforeAll(async () => {
    // 위 시험과 순서에 기대지 않는다 — 이 상태(꺼짐 + 스위치 켬)를 화면에서 만들 수 있게 된 것이 NT-61이다
    const { PUT } = await route();
    expect((await PUT(putReq(ID.op, { id: div.off.id, notifyEnabled: true }))).status).toBe(200);
    expect(await divRow(div.off.id)).toMatchObject({ isActive: false, notifyEnabled: true });
  });

  it('마감 1시간 전 — 켠 부서의 미제출자에게만 간다', async () => {
    const { runDueReminders } = await import('@/server/notify/deadline-reminder');
    const out = await runDueReminders(NOW);
    expect(out.map((o) => [o.division, o.kind])).toEqual([['켠실', 'deadline_1h']]);
    const to = msgr.outbox.map((m) => m.to).sort();
    expect(to).toEqual([NO.onMember, NO.onLead].sort());
  });

  it('승인 완료 — 켠 부서는 담당에게 가고, 운영자 겸 부서장이 꺼진 부서에서 승인해도 그 부서 담당에게는 가지 않는다', async () => {
    const prisma = await db();
    const { requireScope } = await import('@/server/authz');
    const { recordReview } = await import('@/server/merge/review');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { id: slotId } });
    const approve = async (identity: string, key: 'on' | 'off') => {
      const run = await prisma.mergeRun.create({
        data: { divisionId: div[key].id, weekSlotId: slotId, status: 'succeeded', outputPath: `m-${key}.hwp`, sourceIds: '[]', ruleSnapshot: '{}', finishedAt: NOW },
      });
      const scope = await requireScope(new Headers({ 'x-test-identity': identity }));
      // 운영자는 꺼진 부서에 속해도 문을 지난다(AU-04b의 예외) — 이 시험이 보려는 길이 그것이다
      expect(scope.division.id).toBe(div[key].id);
      const { notified } = await recordReview({
        scope,
        run,
        slot,
        kind: 'approve',
        changes: [],
        frozen: { filePath: `frozen-${key}.hwp`, sha256: `sha-${key}`, byteSize: 1 },
      });
      return notified;
    };

    expect(await approve(ID.onHead, 'on')).toEqual({ sent: 1, targets: 1 });
    expect(msgr.outbox.map((m) => m.to)).toEqual([NO.onLead]);
    expect(msgr.outbox[0].kind).toMatch(/^merge_approved:/);

    msgr.outbox.length = 0;
    expect(await approve(ID.offOpHead, 'off')).toEqual({ sent: 0, targets: 0 });
    expect(msgr.outbox).toEqual([]);
    // 승인 자체는 남는다 — 알림은 승인의 결과이지 조건이 아니다(HM-47)
    expect(await prisma.mergeReview.count({ where: { divisionId: div.off.id } })).toBe(1);
  });
});
