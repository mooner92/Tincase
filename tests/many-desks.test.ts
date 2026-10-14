// ADR-0022 — 한 사람이 여러 자리: 소속 고정(D1) · 본부 담당 지정(D2) · 알림 묶기(D4).
// 운영자(2026-10-14): 「지속센터 담당은 기획경영본부 소속 · 기획조정실 담당이 기획경영본부 담당 겸임 — 두 번 알림 가지 않게」.
// 메신저는 시험 안의 가짜 서버로 받는다. 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-desks-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-desks.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_ALLOWLIST = '*';
delete process.env.DEV_IDENTITY;
delete process.env.NOTIFY_BATCH_MS;

const DIV = {
  hq: { slug: 'MD_HQ', nameKo: '본부가', parentKo: '한국환경연구원', self: false },
  u1: { slug: 'MD_U1', nameKo: '실하나', parentKo: '본부가', self: true },
  u2: { slug: 'MD_U2', nameKo: '실둘', parentKo: '본부가', self: true },
  center: { slug: 'MD_C', nameKo: '센터다', parentKo: '한국환경연구원', self: true },
} as const;
type Key = keyof typeof DIV;
const P = {
  op: { email: 'md-op@test.local', no: '8000', div: 'center', role: 'member', op: true },
  hqHead: { email: 'md-hq-head@test.local', no: '8001', div: 'hq', role: 'head' },
  hqLead: { email: 'md-hq-lead@test.local', no: '8002', div: 'hq', role: 'lead' },
  u1Lead: { email: 'md-u1-lead@test.local', no: '8101', div: 'u1', role: 'lead' },
  u1Head: { email: 'md-u1-head@test.local', no: '8102', div: 'u1', role: 'head' },
  u2Member: { email: 'md-u2-member@test.local', no: '8201', div: 'u2', role: 'member' },
} as const;
const divId = {} as Record<Key, string>;
const userId = {} as Record<keyof typeof P, string>;

interface Got {
  to: string;
  subject: string;
  contents: string;
}
const inbox: Got[] = [];
let calls = 0;
const take = () => inbox.splice(0, inbox.length);
const mailbox = { fail: false };
let server: Server;

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const db = async () => (await import('@/server/db')).prisma;
const scopeOf = async (email: string) => (await import('@/server/authz')).requireScope(new Headers({ 'x-test-identity': email }));

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      if (mailbox.fail) {
        res.writeHead(500);
        res.end('down\n');
        return;
      }
      const f = new URLSearchParams(body);
      for (const r of (f.get('RecvId') ?? '').split(',')) inbox.push({ to: r, subject: f.get('Subject') ?? '', contents: f.get('Contents') ?? '' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('send ok\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.MESSENGER_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-desks.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  for (const [key, d] of Object.entries(DIV) as [Key, (typeof DIV)[Key]][]) {
    const row = await prisma.division.create({
      data: { slug: d.slug, nameKo: d.nameKo, nameEn: d.slug, isActive: true, parentKo: d.parentKo, rollupSelf: d.self, deadlineDow: 1, deadlineTime: '00:00' },
    });
    divId[key] = row.id;
  }
  for (const [k, p] of Object.entries(P) as [keyof typeof P, (typeof P)[keyof typeof P]][]) {
    const u = await prisma.user.create({
      data: {
        email: p.email,
        name: k,
        employeeNo: p.no,
        divisionId: divId[p.div as Key],
        divisionRole: p.role,
        isOperator: 'op' in p && p.op,
        jobTitle: p.role === 'head' ? '실장' : '담당',
      },
    });
    userId[k] = u.id;
  }
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true, unitDueMinutes: 60, hqDueMinutes: 120 } });
}, 60_000);

afterAll(async () => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

describe('ADR-0022 D1 — 소속 고정', () => {
  it('[RS-T40] 고정한 사람은 ERP 부서가 달라도 옮기지 않고 「고정」으로 알리기만 — 고정 안 한 사람은 그대로 옮긴다', async () => {
    const { planRosterSync } = await import('@/server/roster/sync');
    const base = { divisionRole: 'member', onRoster: true, rosterNote: null, isActive: true, isOperator: false, isCoordinator: false, jobTitle: '담당' };
    const db = [
      { ...base, id: 'a', email: 'a@x', name: '가', divisionId: 'c', divisionKo: '센터다', employeeNo: '1', divisionPinned: true },
      { ...base, id: 'b', email: 'b@x', name: '나', divisionId: 'c', divisionKo: '센터다', employeeNo: '2' },
    ];
    const erp = [
      { name: '가', email: 'a@x', employeeNo: '1', divisionKo: '본부가', parentKo: '한국환경연구원', jobTitle: '담당' },
      { name: '나', email: 'b@x', employeeNo: '2', divisionKo: '본부가', parentKo: '한국환경연구원', jobTitle: '담당' },
    ];
    const plan = planRosterSync(db, erp as never, ['센터다', '본부가']);
    expect(plan.changes.map((c) => [c.name, c.kind])).toEqual([['나', 'move']]);
    expect(plan.pinned).toEqual(['가 — ERP 소속 본부가 · Tincase 소속 센터다(고정 — 옮기지 않음)']);
  });

  it('[RS-T41] /ops에서 소속을 옮기면 고정 · 고정 풀기 · 감사 기록 — 운영자만', async () => {
    const prisma = await db();
    const { PUT } = await import('@/app/api/ops/roster/route');
    const put = (who: string, updates: unknown[]) => PUT(nx('/api/ops/roster', who, jsonInit('PUT', { updates })));
    expect((await put(P.u1Lead.email, [{ userId: userId.u2Member, divisionId: divId.center }])).status).toBe(404); // 운영자만
    expect((await put(P.op.email, [{ userId: userId.u2Member, divisionId: 'nope' }])).status).toBe(422);
    expect((await put(P.op.email, [{ userId: userId.u2Member, divisionId: divId.center }])).status).toBe(200);
    let u = await prisma.user.findUniqueOrThrow({ where: { id: userId.u2Member } });
    expect([u.divisionId, u.divisionPinned]).toEqual([divId.center, true]);
    expect(await prisma.auditLog.count({ where: { action: 'roster_move', target: `user:${userId.u2Member}` } })).toBe(1);
    expect((await put(P.op.email, [{ userId: userId.u2Member, divisionPinned: false }])).status).toBe(200);
    u = await prisma.user.findUniqueOrThrow({ where: { id: userId.u2Member } });
    expect([u.divisionId, u.divisionPinned]).toEqual([divId.center, false]); // 부서는 그대로 — 다음 인원 최신화가 옮긴다
    expect((await put(P.op.email, [{ userId: userId.u2Member, divisionPinned: true }])).status).toBe(422); // 고정은 옮겨서만
    await prisma.user.update({ where: { id: userId.u2Member }, data: { divisionId: divId.u2 } });
  });
});

describe('ADR-0022 D2 — 본부 담당 지정 (TACP-21 개정)', () => {
  const desk = async (who: keyof typeof P, hq: string | null) => {
    const { PUT } = await import('@/app/api/ops/roster/route');
    return PUT(nx('/api/ops/roster', P.op.email, jsonInit('PUT', { updates: [{ userId: userId[who], hqDesk: hq }] })));
  };

  it('[RU-T170] 지정은 운영자만 · 본부(산하가 있는 부서)만 · 한 사람에 하나 · 해제 · 감사', async () => {
    const prisma = await db();
    expect((await desk('u1Lead', divId.u1)).status).toBe(422); // 실은 본부가 아니다
    expect((await desk('u1Lead', divId.hq)).status).toBe(200);
    expect((await desk('u1Lead', divId.hq)).status).toBe(200); // 다시 해도 하나
    expect(await prisma.hqDesk.count({ where: { userId: userId.u1Lead } })).toBe(1);
    const { GET } = await import('@/app/api/ops/roster/route');
    const b = await (await GET(nx(`/api/ops/roster?division=${divId.hq}`, P.op.email))).json();
    expect(b.desks).toEqual([{ userId: userId.u1Lead, name: 'u1Lead', divisionName: '실하나' }]);
    const mine = await (await GET(nx(`/api/ops/roster?division=${divId.u1}`, P.op.email))).json();
    expect(mine.users.find((u: { id: string }) => u.id === userId.u1Lead).hqDeskIds).toEqual([divId.hq]);
    expect(await prisma.auditLog.count({ where: { action: 'hq_desk' } })).toBeGreaterThanOrEqual(2);
  });

  it('[RU-T171] 지정된 본부 담당은 그 본부를 담당 권한으로 연다(쓰기 · 비상구 · 산하 사본 · 본부본) — 승인은 없다 · 지정이 없으면 404', async () => {
    const prisma = await db();
    const authz = await import('@/server/authz');
    const s = await scopeOf(P.u1Lead.email);
    const view = await authz.resolveHqView(s, null);
    expect([view.node.node.id, view.canWrite, view.via]).toEqual([divId.hq, true, 'desk']);
    expect((await authz.hqNodeOfManager(s)).node.id).toBe(divId.hq);
    expect((await authz.hqNodeOfManager(s, DIV.hq.slug)).node.id).toBe(divId.hq);
    await expect(authz.hqNodeOfManager(s, DIV.center.slug)).rejects.toMatchObject({ status: 404 });
    expect(await authz.hasHqDesk(s)).toBe(true);
    const esc = await authz.requireHandoffEscape(new Headers({ 'x-test-identity': P.u1Lead.email }), 'hq');
    expect(esc.node?.node.id).toBe(divId.hq);
    // 산하(실둘)가 보낸 사본 · 본부본 — 읽힌다(소속 밖이라 감사)
    const slot = await (await import('@/server/worklog')).ensureCurrentSlot();
    const unitCopy = await prisma.reportSubmission.create({
      data: { level: 'unit', divisionId: divId.u2, weekSlotId: slot.id, filePath: 'x', sha256: 'x', byteSize: 1, submittedBy: 'system', basis: 'no_head' },
    });
    expect((await authz.findReadableReport(s, unitCopy.id)).id).toBe(unitCopy.id);
    const hqRun = await prisma.rollupRun.create({ data: { level: 'hq', divisionId: divId.hq, weekSlotId: slot.id, status: 'succeeded', outputPath: 'y', inputIds: '[]', createdBy: 'system' } });
    expect((await authz.findReadableRollup(s, hqRun.id)).id).toBe(hqRun.id);
    expect(await prisma.auditLog.count({ where: { action: 'cross_division_read', actor: P.u1Lead.email } })).toBeGreaterThanOrEqual(2);
    // 승인은 지정으로 생기지 않는다 — 실장(head)에게 본부를 맡겨도 본부본 승인은 404
    expect((await desk('u1Head', divId.hq)).status).toBe(200);
    await expect(authz.requireHqReviewer(new Headers({ 'x-test-identity': P.u1Head.email }))).rejects.toMatchObject({ status: 404 });
    // 소속 본부장은 그대로
    expect((await authz.requireHqReviewer(new Headers({ 'x-test-identity': P.hqHead.email }))).node.node.id).toBe(divId.hq);
    // 지정이 없는 실 사람은 지금처럼 404
    await expect(authz.resolveHqView(await scopeOf(P.u2Member.email), null)).rejects.toMatchObject({ status: 404 });
    expect((await desk('u1Head', null)).status).toBe(200);
  });

  it('[RU-T172] 본부 알림은 소속 담당 + 지정된 담당에게 한 번씩 · 링크는 그 본부 · 지정된 사람이 소속 실의 부서원이어도 담당 문구', async () => {
    const prisma = await db();
    const { noticeRollupFailed } = await import('@/server/rollup/notices');
    const { loadTree, hqNodeOf } = await import('@/server/rollup/tree');
    const node = hqNodeOf(await loadTree(), divId.hq)!;
    const slot = await (await import('@/server/worklog')).ensureCurrentSlot();
    const run = await prisma.rollupRun.create({ data: { level: 'hq', divisionId: divId.hq, weekSlotId: slot.id, status: 'failed', inputIds: '[]', createdBy: 'system', inputKey: 'k-fail-1', errorText: '양식 없음' } });
    take();
    await noticeRollupFailed('hq', node, slot, run);
    const got = take();
    expect(got.map((g) => g.to).sort()).toEqual([P.hqLead.no, P.u1Lead.no].sort());
    // 실둘의 부서원에게 본부를 맡겨도 본부 쪽지는 담당의 것이다 (hqReadyMessage의 담당 문구)
    expect((await desk('u2Member', divId.hq)).status).toBe(200);
    const { hqReadyMessage } = await import('@/server/rollup/notices');
    void hqReadyMessage; // 문구 자체는 rollup-notices 시험이 본다 — 여기서는 받는 사람의 역할이 담당으로 넘어가는지만
    const run2 = await prisma.rollupRun.create({ data: { level: 'hq', divisionId: divId.hq, weekSlotId: slot.id, status: 'failed', inputIds: '[]', createdBy: 'system', inputKey: 'k-fail-2', errorText: '양식 없음' } });
    await noticeRollupFailed('hq', node, slot, run2);
    expect(take().map((g) => g.to).sort()).toEqual([P.hqLead.no, P.u1Lead.no, P.u2Member.no].sort());
    expect((await desk('u2Member', null)).status).toBe(200);
  });
});

describe('ADR-0022 D4 — 알림 묶기', () => {
  const send = async (no: string, subject: string, kind: string, url?: string) => {
    const { sendOrQueue } = await import('@/server/notify/outbox');
    return sendOrQueue({ recvIds: [no], subject, contents: `${subject} 본문`, url, kind });
  };

  it('[NT-T95] 창이 0이면(기본) 지금처럼 바로 보낸다', async () => {
    delete process.env.NOTIFY_BATCH_MS;
    take();
    const r = await send('9001', '[Tincase] 하나', 'merge_approved');
    expect(r.sent).toEqual(['9001']);
    expect(take().map((g) => g.subject)).toEqual(['[Tincase] 하나']);
  });

  it('[NT-T96] 창 안에 같은 사람에게 둘 → 한 통(「알림 2건」 · 건마다 제목 · 첫 링크) · 하나뿐이면 그대로 · 같은 글은 받는 사람을 묶어 한 번에', async () => {
    process.env.NOTIFY_BATCH_MS = '60000';
    try {
      const prisma = await db();
      const { flushOutbox } = await import('@/server/notify/outbox');
      take();
      const r1 = await send('9101', '[Tincase] 실하나 승인 완료', 'merge_approved', 'http://x/manage');
      await send('9101', '[Tincase] 본부가 본부본이 준비됐어요', 'ru_hq_ready', 'http://x/hq');
      await send('9102', '[Tincase] 마감 1시간 전', 'deadline_1h');
      await send('9103', '[Tincase] 마감 1시간 전', 'deadline_1h');
      expect(r1.sent).toEqual(['9101']); // 함에 넣은 것이 「보냄」 — NotifyLog가 그대로 적는다
      expect(take()).toEqual([]); // 아직 안 나갔다
      expect(await prisma.notifyOutbox.count({ where: { sentAt: null } })).toBe(4);
      // 창이 안 지났으면 비우지 않는다
      expect((await flushOutbox(new Date())).sent).toBe(0);
      const before = calls;
      const f = await flushOutbox(new Date(Date.now() + 61_000));
      expect([f.batches, f.sent, f.failed]).toEqual([2, 4, 0]);
      expect(calls - before).toBe(2); // 묶은 한 통 + 같은 글 둘을 한 번에
      const got = take();
      const one = got.filter((g) => g.to === '9101');
      expect(one).toHaveLength(1);
      expect(one[0].subject).toBe('[Tincase] 알림 2건 — 실하나 승인 완료');
      expect(one[0].contents).toContain('■ 1. 실하나 승인 완료');
      expect(one[0].contents).toContain('■ 2. 본부가 본부본이 준비됐어요');
      expect(got.filter((g) => g.subject === '[Tincase] 마감 1시간 전').map((g) => g.to).sort()).toEqual(['9102', '9103']);
      expect(await prisma.notifyOutbox.count({ where: { sentAt: null } })).toBe(0);
    } finally {
      delete process.env.NOTIFY_BATCH_MS;
    }
  });

  it('[NT-T97] 메신저가 실패하면 다음 비움에 다시 · 세 번이면 그만(오류로 남는다) · 허용 목록 밖은 함에 넣지 않는다', async () => {
    process.env.NOTIFY_BATCH_MS = '1000';
    try {
      const prisma = await db();
      const { flushOutbox } = await import('@/server/notify/outbox');
      take();
      await send('9201', '[Tincase] 다시 보내기', 'merge_done');
      mailbox.fail = true;
      for (let i = 1; i <= 3; i++) {
        const f = await flushOutbox(new Date(Date.now() + 5_000));
        expect(f.failed).toBe(1);
      }
      expect(await prisma.notifyOutbox.findFirstOrThrow({ where: { recvId: '9201' } })).toMatchObject({ attempts: 3, sentAt: null });
      mailbox.fail = false;
      expect((await flushOutbox(new Date(Date.now() + 5_000))).sent).toBe(0); // 세 번 넘은 줄은 다시 집지 않는다
      // 허용 목록 밖
      process.env.MESSENGER_ALLOWLIST = '9301';
      const { env } = await import('@/server/env');
      (env as { MESSENGER_ALLOWLIST: string }).MESSENGER_ALLOWLIST = '9301';
      const r = await send('9302', '[Tincase] 막힘', 'merge_done');
      expect([r.sent, r.blocked]).toEqual([[], ['9302']]);
      expect(await prisma.notifyOutbox.count({ where: { recvId: '9302' } })).toBe(0);
      (env as { MESSENGER_ALLOWLIST: string }).MESSENGER_ALLOWLIST = '*';
      process.env.MESSENGER_ALLOWLIST = '*';
    } finally {
      delete process.env.NOTIFY_BATCH_MS;
      mailbox.fail = false;
    }
  });
});
