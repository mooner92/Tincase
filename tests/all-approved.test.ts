// NT-62 (2026-10-12 운영자) — 「켜진 부서 모두 승인 완료」 한 통 → 총괄.
//
// 부서마다 승인될 때 총괄에게 가면 많다 — 켜진 부서가 **모두** 끝났을 때 한 번. 끝 = 부서장 승인(그 뒤 안 바뀜) · 부서장이 없으면
// 최종본 · 낸 사람이 없으면 제출 없음. 3단계가 켜져 있으면 보내지 않는다(그때는 3단계 쪽지가 같은 일을 한다).
// 병합 기록·승인은 시험이 직접 만든다. 메신저는 흉내 낸다(적기만 한다). 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-allok-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-allok.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_LINK_BASE = 'http://tincase.test';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 30_000 });

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

const msgr = vi.hoisted(() => ({ on: true, outbox: [] as { to: string; subject: string; contents: string; url?: string; kind?: string }[] }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => (msgr.on ? { enabled: true, reason: '', allow: '전원' } : { enabled: false, reason: 'MESSENGER_URL 미설정', allow: '' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string; url?: string; kind?: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, subject: input.subject, contents: input.contents, url: input.url, kind: input.kind });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

const MIN = 60_000;
/** 목 2026-10-15 14:00 KST — 기본 마감(목 14:00)인 주 */
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

let slotId = '';
const ids = { coord: '', coordOff: '', head: '', a: '', b: '' };

async function db() {
  return (await import('@/server/db')).prisma;
}

/** 켜진 부서 하나 — 부서장 있음, 낸 사람 하나 */
async function unit(slug: string, name: string, o: { head?: boolean } = {}) {
  const prisma = await db();
  const div = await prisma.division.create({ data: { slug, nameKo: name, nameEn: slug, isActive: true, notifyEnabled: true } });
  const u = await prisma.user.create({ data: { email: `${slug}-m@test.local`, name: `${name}부서원`, divisionId: div.id } });
  await prisma.submission.create({
    data: { divisionId: div.id, userId: u.id, weekSlotId: slotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', uploadedAt: at(-60) },
  });
  const head = o.head === false ? null : await prisma.user.create({ data: { email: `${slug}-h@test.local`, name: `${name}실장`, divisionId: div.id, divisionRole: 'head', onRoster: false } });
  return { div, head };
}

/** 마감 뒤 성공 실행(최종본) — 파일까지 */
async function finalRun(divisionId: string, body = `병합본 ${divisionId}`, startedAt = at(1)) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const rel = `merged/${divisionId}.hwp`;
  await writeFileAtomic(rel, Buffer.from(body));
  return prisma.mergeRun.create({
    data: { divisionId, weekSlotId: slotId, status: 'succeeded', outputPath: rel, outputSha: sha(body), sourceIds: '[]', ruleSnapshot: '{}', startedAt, finishedAt: new Date(startedAt.getTime() + MIN) },
  });
}

async function approve(run: { id: string; divisionId: string }, reviewerId: string, body: string, when: Date) {
  const prisma = await db();
  return prisma.mergeReview.create({
    data: { divisionId: run.divisionId, weekSlotId: slotId, mergeRunId: run.id, reviewerId, kind: 'approve', sha256: sha(body), createdAt: when },
  });
}

async function tick(now: Date) {
  const { runAllApprovedNotice } = await import('@/server/notify/all-approved');
  return runAllApprovedNotice(now);
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-allok.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { ensureCurrentSlot } = await import('@/server/worklog');
  slotId = (await ensureCurrentSlot(D)).id;
}, 120_000);

beforeEach(async () => {
  const prisma = await db();
  msgr.on = true;
  msgr.outbox.length = 0;
  await prisma.notifyLog.deleteMany();
  await prisma.mergeReview.deleteMany();
  await prisma.mergeRun.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.orgRollupSetting.deleteMany();
  await prisma.user.deleteMany();
  await prisma.division.deleteMany();
  // 총괄의 부서 — 켜져 있지 않아도 총괄은 받는다(총괄은 부서가 아니라 역할이다). 꺼진 부서는 「모두」에 들지 않는다
  const home = await prisma.division.create({ data: { slug: 'Allok_home', nameKo: '조정실', nameEn: 'Home', isActive: false } });
  ids.coord = (await prisma.user.create({ data: { email: 'coord@test.local', name: '총괄가', divisionId: home.id, isCoordinator: true, employeeNo: '7001' } })).id;
  ids.coordOff = (
    await prisma.user.create({ data: { email: 'coord2@test.local', name: '총괄나', divisionId: home.id, isCoordinator: true, employeeNo: '7002', notifyEnabled: false } })
  ).id;
});

afterAll(async () => {
  await (await db()).$disconnect();
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('[NT-T93] 켜진 부서 모두 승인 → 총괄에게 한 통 (NT-62)', () => {
  it('하나만 승인 → 없음 · 둘 다 승인 → 총괄 한 통(알림 끈 총괄은 빼고) · 다시 돌려도 한 통', async () => {
    const a = await unit('Allok_a', '가실');
    const b = await unit('Allok_b', '나실');
    const ra = await finalRun(a.div.id);
    const rb = await finalRun(b.div.id);
    await approve(ra, a.head!.id, `병합본 ${a.div.id}`, at(20));
    expect(await tick(at(21))).toBeNull();
    expect(msgr.outbox).toHaveLength(0);

    await approve(rb, b.head!.id, `병합본 ${b.div.id}`, at(48));
    expect(await tick(at(49))).toEqual({ isoKey: expect.any(String), sent: 1, targets: 1 });
    expect(msgr.outbox).toHaveLength(1);
    const m = msgr.outbox[0];
    expect(m.to).toBe('7001');
    expect(m.kind).toBe(`all_approved:${ids.coord}`);
    expect(m.url).toBe('http://tincase.test/org');
    expect(m.subject).toMatch(/^\[Tincase\] 10월 \d주차 주간 — 부서 2곳 모두 승인 완료$/);
    expect(m.contents).toContain('[7001]총괄가님 Tincase로 내는 부서 2곳의');
    expect(m.contents).toContain('· 가실 — 14:20 부서장 승인');
    expect(m.contents).toContain('· 나실 — 14:48 부서장 승인');
    expect(m.contents).toContain('각 부서 담당자가 승인본을 취합게시판에 올려요.');
    // 승인한 사람 이름은 넣지 않는다
    expect(m.contents).not.toMatch(/실장/);

    expect(await tick(at(50))).toBeNull();
    expect(await tick(at(120))).toBeNull();
    expect(msgr.outbox).toHaveLength(1);
  });

  it('승인한 뒤 병합본이 바뀌면 그 부서는 아직이다 — 다시 승인되면 그때 한 통', async () => {
    const a = await unit('Allok_c', '가실');
    const b = await unit('Allok_d', '나실');
    const ra = await finalRun(a.div.id);
    await approve(ra, a.head!.id, `병합본 ${a.div.id}`, at(20));
    const rb = await finalRun(b.div.id, '처음 판');
    await approve(rb, b.head!.id, '처음 판', at(25));
    // 담당자가 고쳐 저장 — 같은 실행의 파일이 바뀌었다
    const { writeFileAtomic } = await import('@/server/storage');
    await writeFileAtomic(rb.outputPath!, Buffer.from('고친 판'));
    expect(await tick(at(30))).toBeNull();
    await approve(rb, b.head!.id, '고친 판', at(40));
    expect((await tick(at(41)))?.sent).toBe(1);
  });

  it('부서장이 없는 부서는 최종본이 곧 끝 · 낸 사람이 없는 부서는 「제출 없음」으로 기다리지 않는다', async () => {
    const a = await unit('Allok_e', '가실');
    const b = await unit('Allok_f', '나실', { head: false });
    const prisma = await db();
    const c = await prisma.division.create({ data: { slug: 'Allok_g', nameKo: '다실', nameEn: 'g', isActive: true } });
    void c;
    const ra = await finalRun(a.div.id);
    await finalRun(b.div.id, `병합본 ${b.div.id}`, at(5));
    expect(await tick(at(10))).toBeNull(); // 가실이 아직
    await approve(ra, a.head!.id, `병합본 ${a.div.id}`, at(15));
    expect((await tick(at(16)))?.sent).toBe(1);
    const body = msgr.outbox[0].contents;
    expect(body).toContain('부서 3곳');
    expect(body).toContain('· 나실 — 14:06 병합본 확정(부서장 없음)');
    expect(body).toContain('· 다실 — 이번 주 제출 없음');
  });

  it('마감 전 미리보기 승인은 세지 않는다 · 낸 사람이 있는데 최종본이 없으면 기다린다', async () => {
    const a = await unit('Allok_h', '가실');
    const pre = await finalRun(a.div.id, `병합본 ${a.div.id}`, at(-30)); // 마감 전 실행 = 미리보기
    await approve(pre, a.head!.id, `병합본 ${a.div.id}`, at(-20));
    expect(await tick(at(5))).toBeNull();
    expect(msgr.outbox).toHaveLength(0);
  });

  it('보내지 않는 때 — 3단계 켜짐 · 메신저 꺼짐 · 마감 전 · 마감 +24시간 뒤 · 모두 「제출 없음」', async () => {
    const a = await unit('Allok_i', '가실');
    const ra = await finalRun(a.div.id);
    await approve(ra, a.head!.id, `병합본 ${a.div.id}`, at(20));
    const prisma = await db();
    await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });
    expect(await tick(at(30))).toBeNull();
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    msgr.on = false;
    expect(await tick(at(30))).toBeNull();
    msgr.on = true;
    expect(await tick(at(-1))).toBeNull();
    expect(await tick(at(24 * 60 + 1))).toBeNull();
    expect(msgr.outbox).toHaveLength(0);
    // 창 안이면 그제야
    expect((await tick(at(30)))?.sent).toBe(1);

    // 아무도 안 냈다 — 알릴 것이 없다
    const { allDone } = await import('@/server/notify/all-approved');
    expect(allDone([{ id: 'x', name: '가', state: 'nothing', at: null }])).toBe(false);
    expect(allDone([])).toBe(false);
    expect(allDone([{ id: 'x', name: '가', state: 'approved', at: at(1) }, { id: 'y', name: '나', state: 'waiting', at: null }])).toBe(false);
  });

  it('스케줄러가 병합 안내와 같은 묶음에서 부른다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(path.resolve(__dirname, '../src/server/scheduler.ts'), 'utf8');
    expect(src).toMatch(/const r = await runAllApprovedNotice\(\);/);
    expect(src.indexOf('runAllApprovedNotice()')).toBeGreaterThan(src.indexOf('runDueMergeBatchNotices()'));
  });
});
