// HM-59~61 · HM-56 · API-31a · API-65 · TACP-30 — 병합 **줄** (2026-10-08 마감 병합 2단계).
//
// 시계는 Date만 가짜로 돌린다(타이머·DB는 그대로). 병합 본체(runMerge)는 흉내 낸다 — 손으로 풀어 주기 전까지 끝나지 않게 해서,
// 「줄이 도는 동안 무엇이 일어나나」(합류 · 다시 한 번 · 틱 · 쓰기 직전 확인)를 그 순간에 멈춰 본다. 메신저도 흉내 낸다 —
// 누구에게 무엇이 갔는지 적기만 하고 아무에게도 보내지 않는다. 사람·부서 이름은 지어낸 것이다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-queue-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-queue.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
// 한 시험이 일꾼의 병합 여러 번(DB 왕복 수백 번)을 기다린다
vi.setConfig({ testTimeout: 30_000 });

const outbox = vi.hoisted(() => [] as { to: string; subject: string; contents: string; at: number }[]);
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: true, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string }) => {
    for (const to of input.recvIds) outbox.push({ to, subject: input.subject, contents: input.contents, at: Date.now() });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

/**
 * 병합 본체 흉내. 부를 때마다 `pending`에 하나가 쌓이고, 시험이 `release()`로 하나씩 끝낸다. 동시에 몇 개가 돌았는지(`maxLive`)를 센다 —
 * 일꾼이 하나면 언제나 1이다. 돌려주는 바이트는 부서마다 `bytesFor`로 정한다(기본은 부서 id) — 같은 바이트면 판이 같다(HM-56)
 */
const engine = vi.hoisted(() => ({
  pending: [] as { divisionId: string; finish: () => void; fail: (e: Error) => void }[],
  live: 0,
  maxLive: 0,
  calls: [] as string[],
  bytesFor: new Map<string, string>(),
  /** 참이면 기다리지 않고 바로 끝난다 — 이 시간만큼 시계를 민다 */
  instantMs: null as number | null,
  /** 엔진이 바이트를 만든 뒤(모델 호출이 끝난 순간) — 쓰기 직전 확인(HM-61) 시험이 여기서 사람의 저장을 끼워 넣는다 */
  during: null as null | ((divisionId: string) => Promise<void>),
}));
vi.mock('@/server/merge/index', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/server/merge/index')>();
  return {
    ...orig,
    runMerge: async (divisionId: string) => {
      engine.calls.push(divisionId);
      engine.live++;
      engine.maxLive = Math.max(engine.maxLive, engine.live);
      try {
        if (engine.instantMs !== null) {
          vi.setSystemTime(Date.now() + engine.instantMs);
        } else {
          await new Promise<void>((resolve, reject) => engine.pending.push({ divisionId, finish: resolve, fail: reject }));
        }
        await engine.during?.(divisionId);
      } finally {
        engine.live--;
      }
      return {
        outputRelPath: `merged/${divisionId}.hwp`,
        output: Buffer.from(engine.bytesFor.get(divisionId) ?? divisionId),
        bytes: 1,
        rowCounts: { achievements: 1, plans: 1, notes: 0 },
        mergedGroups: [],
        warnings: [],
        model: { used: true, reason: null, elapsedMs: 1, name: 'mock', tables: [] },
        categories: null,
        sourceIds: [],
        missing: [],
        rowAuthors: { achievements: [], plans: [], notes: [] },
        flagged: [],
      };
    },
  };
});

/** 틱이 3단계 알림 · 맞추기 · 마감 전 알림을 언제 불렀나 (HM-T164) */
const tickCalls = vi.hoisted(() => ({ rollupNotices: [] as number[], rollupSync: [] as number[], reminders: [] as number[] }));
vi.mock('@/server/rollup/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/rollup/notices')>()),
  runDueRollupNotices: async () => {
    tickCalls.rollupNotices.push(Date.now());
    return [];
  },
}));
vi.mock('@/server/notify/deadline-reminder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/notify/deadline-reminder')>()),
  runDueReminders: async () => {
    tickCalls.reminders.push(Date.now());
    return [];
  },
}));
vi.mock('@/server/rollup/auto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/rollup/auto')>()),
  runDueRollupSync: async () => {
    tickCalls.rollupSync.push(Date.now());
    return false;
  },
}));

const MIN = 60_000;
/** 목 2026-10-15 14:00 KST — 기본 마감(목 14:00)인 주 */
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

let slotId = '';
let isoKey = '';
let seq = 0;

async function db() {
  return (await import('@/server/db')).prisma;
}

/** 부서 하나 — 부서장 · 담당자 · 부서원(제출 `subs`건, 사람마다 하나) */
async function mkDivision(name: string, subs = 1) {
  const prisma = await db();
  const n = ++seq;
  const div = await prisma.division.create({
    data: { slug: `Queue_${n}`, nameKo: name, nameEn: `Q${n}`, isActive: true, notifyEnabled: true },
  });
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'x/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });
  const head = await prisma.user.create({
    data: { email: `q${n}-head@test.local`, name: `장${n}`, divisionId: div.id, divisionRole: 'head', jobTitle: '실장', employeeNo: `7${n}01` },
  });
  const lead = await prisma.user.create({
    data: { email: `q${n}-lead@test.local`, name: `담${n}`, divisionId: div.id, divisionRole: 'lead', employeeNo: `7${n}02` },
  });
  const member = await prisma.user.create({ data: { email: `q${n}-m@test.local`, name: `원${n}`, divisionId: div.id } });
  for (let i = 0; i < subs; i++) await submit(div.id, i === 0 ? member.id : (await prisma.user.create({ data: { email: `q${n}-m${i}@test.local`, name: `원${n}-${i}`, divisionId: div.id } })).id);
  return { div, head, lead, member };
}

async function submit(divisionId: string, userId: string, uploadedAt = at(-60)) {
  const prisma = await db();
  return prisma.submission.create({
    data: { divisionId, userId, weekSlotId: slotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', uploadedAt },
  });
}

/** 성공한 병합 실행 하나(파일까지). 판정에 쓰이는 것은 시작 시각과 파일 바이트다 */
async function succeededRun(divisionId: string, startedAt: Date, bytes: string, reviewJson: string | null = null) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const rel = `merged/${divisionId}.hwp`;
  await writeFileAtomic(rel, Buffer.from(bytes));
  return prisma.mergeRun.create({
    data: {
      divisionId,
      weekSlotId: slotId,
      status: 'succeeded',
      outputPath: rel,
      outputSha: sha(bytes),
      sourceIds: '[]',
      ruleSnapshot: '{}',
      reviewJson,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + MIN),
    },
  });
}

/** 부서장의 승인(고칠 것 없이) — 그 판의 sha로 */
async function approve(divisionId: string, runId: string, reviewerId: string, bytes: string, when = new Date()) {
  const prisma = await db();
  return prisma.mergeReview.create({
    data: { divisionId, weekSlotId: slotId, mergeRunId: runId, reviewerId, kind: 'approve', changes: '[]', sha256: sha(bytes), createdAt: when },
  });
}

function nx(url: string, identity: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-test-identity': identity },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
async function mergeNow(identity: string, body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/division/merge/route');
  return POST(nx('/api/division/merge', identity, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isoKey, ...body }) })) as Promise<Response>;
}
async function jobStatus(identity: string, jobId: string) {
  const { GET } = await import('@/app/api/division/merge/route');
  return GET(nx(`/api/division/merge?jobId=${encodeURIComponent(jobId)}`, identity)) as Promise<Response>;
}

/** 흉내 낸 엔진에서 하나가 시작될 때까지 기다린다 */
async function untilPending(n = 1) {
  await vi.waitFor(() => expect(engine.pending.length).toBeGreaterThanOrEqual(n), WAIT);
}
/** 일꾼은 병합 하나를 끝낼 때마다 DB를 여러 번 오간다(기록 · 맞추기 · 다음 작업 잡기) — 기본 1초는 느린 디스크에서 모자란다 */
const WAIT = { timeout: 10_000, interval: 20 };
/** 돌고 있는 병합 하나를 끝낸다 (먼저 시작한 것부터) */
function release() {
  const p = engine.pending.shift();
  if (!p) throw new Error('끝낼 병합이 없다');
  p.finish();
}
/** 남은 병합을 모두 바로 끝내게 하고 줄이 빌 때까지 */
async function drainAll() {
  const { settleMergeQueue } = await import('@/server/merge/queue');
  engine.instantMs = 1000;
  while (engine.pending.length) release();
  await settleMergeQueue();
}
async function jobs(divisionId?: string) {
  const prisma = await db();
  return prisma.mergeJob.findMany({ where: { weekSlotId: slotId, ...(divisionId && { divisionId }) }, orderBy: [{ orderKey: 'asc' }, { id: 'asc' }] });
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-queue.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const slot = await ensureCurrentSlot(D);
  slotId = slot.id;
  isoKey = slot.isoKey;
}, 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(1));
  outbox.length = 0;
  engine.pending.length = 0;
  engine.live = 0;
  engine.maxLive = 0;
  engine.calls.length = 0;
  engine.bytesFor.clear();
  engine.instantMs = null;
  engine.during = null;
  tickCalls.rollupNotices.length = 0;
  tickCalls.rollupSync.length = 0;
  tickCalls.reminders.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const prisma = await db();
  // 각 시험은 자기 부서만 본다 — 앞 시험의 부서와 줄은 치운다
  await prisma.division.updateMany({ data: { isActive: false } });
  await prisma.mergeJob.deleteMany({});
  const { resetMergeQueueForTest } = await import('@/server/merge/queue');
  resetMergeQueueForTest();
});
afterEach(async () => {
  // 남은 병합을 끝내 다음 시험에 일꾼이 넘어가지 않게
  await drainAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.MERGE_PAUSE_UNTIL;
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('HM-59 병합 줄 — 순서 · 합류 · 일꾼 하나', () => {
  it('[HM-T162] ★ 스케줄러 한 주기는 제출 수가 적은 부서부터(같으면 이름순) · 수동은 맨 뒤 · 대기 중이면 합류 · 병합 중이면 합류하고 새 제출이면 한 번 더', async () => {
    const { runDueMerges } = await import('@/server/merge/run');
    const { enqueueMerge } = await import('@/server/merge/queue');
    const big = await mkDivision('다큰실', 3);
    const small = await mkDivision('가작은실', 1);
    const tieB = await mkDivision('라같은실', 2);
    const tieA = await mkDivision('나같은실', 2);

    expect(await runDueMerges(at(1))).toEqual({ queued: 4, skipped: 0 });
    await untilPending(1);
    expect((await jobs()).map((j) => j.divisionId)).toEqual([small.div.id, tieA.div.id, tieB.div.id, big.div.id]);
    expect(engine.calls).toEqual([small.div.id]); // 맨 앞이 먼저 돈다

    // 줄이 도는 중에 다른 부서의 수동 요청 → 맨 뒤
    const late = await mkDivision('마늦은실', 1);
    const m = await enqueueMerge(late.div.id, slotId, { trigger: 'manual', actorEmail: late.lead.email });
    expect(m).toMatchObject({ joined: false, status: 'queued', position: 5 });

    // 대기 중인 부서에 수동 요청 → 합류(새 작업 없음), trigger는 manual로
    const join = await enqueueMerge(big.div.id, slotId, { trigger: 'manual', actorEmail: big.lead.email });
    expect(join).toMatchObject({ joined: true, status: 'queued', position: 4 });
    expect((await jobs(big.div.id)).map((j) => [j.status, j.trigger, j.actorEmail])).toEqual([['queued', 'manual', big.lead.email]]);

    // 병합 중인 부서 — 바뀐 것이 없으면 그 작업에 합류
    const running = (await jobs(small.div.id))[0];
    expect(running.status).toBe('running');
    expect(await enqueueMerge(small.div.id, slotId, { trigger: 'manual', actorEmail: small.lead.email })).toMatchObject({ jobId: running.id, joined: true, status: 'running', position: 1 });
    // 그 사이 새 제출 → 끝난 뒤 한 번 더(대기 하나) · 그 뒤 요청은 그 대기에 합류
    await submit(small.div.id, small.lead.id, at(1));
    const again = await enqueueMerge(small.div.id, slotId, { trigger: 'manual', actorEmail: small.lead.email });
    expect(again.joined).toBe(false);
    expect(again.jobId).not.toBe(running.id);
    expect((await enqueueMerge(small.div.id, slotId, { trigger: 'manual' })).jobId).toBe(again.jobId);
    expect((await jobs(small.div.id)).map((j) => j.status)).toEqual(['running', 'queued']);

    await drainAll();
    // 넣은 순서대로 하나씩, 동시에는 늘 하나
    expect(engine.calls).toEqual([small.div.id, tieA.div.id, tieB.div.id, big.div.id, late.div.id, small.div.id]);
    expect(engine.maxLive).toBe(1);
    expect((await jobs()).every((j) => j.status === 'done')).toBe(true);
  }, 30_000);

  it('[HM-T162] 「덮기 확인」이 병합 중에 새로 붙으면 끝난 뒤 한 번 더 — 그 작업은 overwriteEdits를 가진다', async () => {
    const { enqueueMerge } = await import('@/server/merge/queue');
    const a = await mkDivision('덮기실');
    const first = await enqueueMerge(a.div.id, slotId, { trigger: 'manual' });
    await untilPending(1);
    const second = await enqueueMerge(a.div.id, slotId, { trigger: 'manual', overwriteEdits: true });
    expect(second.jobId).not.toBe(first.jobId);
    expect((await jobs(a.div.id)).map((j) => [j.status, j.overwriteEdits])).toEqual([
      ['running', false],
      ['queued', true],
    ]);
  });

  it('[HM-T163] ★ 여러 번 깨워도 일꾼은 하나 — 동시에 병합 둘이 돌지 않는다 · 같은 작업을 둘이 잡지 않는다', async () => {
    const { enqueueMerge, kickMergeQueue } = await import('@/server/merge/queue');
    const ds = [await mkDivision('일실'), await mkDivision('이실'), await mkDivision('삼실')];
    await Promise.all(ds.map((x) => enqueueMerge(x.div.id, slotId, { trigger: 'manual' })));
    for (let i = 0; i < 5; i++) void kickMergeQueue();
    await untilPending(1);
    expect(engine.live).toBe(1);
    release();
    await untilPending(1);
    expect(engine.live).toBe(1);
    await drainAll();
    expect(engine.maxLive).toBe(1);
    expect(engine.calls.sort()).toEqual(ds.map((x) => x.div.id).sort());
    expect((await jobs()).map((j) => j.attempt)).toEqual([1, 1, 1]);
  });

  it('[HM-T163] ★ 회수 — 기동 때 running 작업은 다시 대기(attempt < 2) 또는 실패 · 매분은 lease가 지난 것만', async () => {
    const prisma = await db();
    const { recoverMergeJobs } = await import('@/server/merge/queue');
    const a = await mkDivision('회수실');
    const mk = (attempt: number, leaseUntil: Date) =>
      prisma.mergeJob.create({
        data: { divisionId: a.div.id, weekSlotId: slotId, trigger: 'auto', orderKey: 100 + attempt, status: 'running', attempt, enqueuedAt: at(1), startedAt: at(1), leaseUntil },
      });
    const once = await mk(1, at(12));
    const twice = await mk(2, at(12));

    // 매분 — lease 전에는 건드리지 않는다
    expect(await recoverMergeJobs(at(5))).toEqual([]);
    // 기동 — 모두 죽은 것
    const got = await recoverMergeJobs(at(5), { atBoot: true });
    expect(got.map((j) => j.id).sort()).toEqual([once.id, twice.id].sort());
    expect(await prisma.mergeJob.findUniqueOrThrow({ where: { id: once.id } })).toMatchObject({ status: 'queued', startedAt: null, orderKey: 101 });
    expect(await prisma.mergeJob.findUniqueOrThrow({ where: { id: twice.id } })).toMatchObject({ status: 'failed', errorText: '중단됨(재시작 등)' });

    // 매분 — lease가 지난 것
    await prisma.mergeJob.update({ where: { id: once.id }, data: { status: 'running', attempt: 1, leaseUntil: at(12) } });
    expect((await recoverMergeJobs(at(12.5))).map((j) => j.id)).toEqual([once.id]);
    expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: once.id } })).status).toBe('queued');
  });

  it('[HM-T163] 매달린 일꾼은 회수가 버린다 — 다음 일꾼이 그 작업을 다시 돌리고, 버려진 일꾼은 돌아와도 아무것도 적지 않는다', async () => {
    const prisma = await db();
    const { enqueueMerge, recoverMergeJobs, kickMergeQueue, settleMergeQueue } = await import('@/server/merge/queue');
    const { mergeStaleAfterMs } = await import('@/server/merge/budget');
    const a = await mkDivision('매달림실');
    const { jobId } = await enqueueMerge(a.div.id, slotId, { trigger: 'manual' });
    await untilPending(1);
    const stuck = engine.pending.shift()!; // 끝나지 않는 병합

    vi.setSystemTime(new Date(at(1).getTime() + mergeStaleAfterMs() + 2 * MIN)); // lease(멈춤 기준 + 1분)가 지났다
    expect((await recoverMergeJobs(new Date())).map((j) => j.id)).toEqual([jobId]);
    engine.instantMs = 1000;
    void kickMergeQueue();
    await settleMergeQueue();
    const after = await prisma.mergeJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(after).toMatchObject({ status: 'done', attempt: 2 });
    const doneRun = after.mergeRunId;

    // 버려진 일꾼이 돌아온다 — 작업 기록은 그대로다
    stuck.finish();
    await vi.waitFor(() => expect(engine.live).toBe(0), WAIT);
    await new Promise((r) => setTimeout(r, 50));
    expect(await prisma.mergeJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'done', mergeRunId: doneRun });
  });

  it('[HM-T163] 요청이 깨운 일꾼도 요청 밖(기동 때) 맥락에서 돈다 — 요청의 비동기 저장소가 일꾼에 따라가지 않는다', async () => {
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const { bindMergeWorkerRoot, enqueueMerge, settleMergeQueue } = await import('@/server/merge/queue');
    const request = new AsyncLocalStorage<string>();
    bindMergeWorkerRoot(AsyncLocalStorage.snapshot()); // 기동 때(instrumentation)와 같다 — 요청 밖
    const seen: (string | undefined)[] = [];
    engine.instantMs = 1000;
    engine.during = async () => void seen.push(request.getStore());
    const a = await mkDivision('맥락실');
    await request.run('요청 A', () => enqueueMerge(a.div.id, slotId, { trigger: 'manual' }));
    await settleMergeQueue();
    expect(seen).toEqual([undefined]);
  });

  it('[HM-T163] 일시정지(HM-44) 중에는 수동만 집는다 — 자동 작업은 대기로 남았다가 풀리면 돈다', async () => {
    const { enqueueMerge, kickMergeQueue, settleMergeQueue } = await import('@/server/merge/queue');
    const auto = await mkDivision('자동실');
    const manual = await mkDivision('수동실');
    process.env.MERGE_PAUSE_UNTIL = at(30).toISOString();
    engine.instantMs = 1000;
    await enqueueMerge(auto.div.id, slotId, { trigger: 'auto' });
    await enqueueMerge(manual.div.id, slotId, { trigger: 'manual' });
    await settleMergeQueue();
    expect(engine.calls).toEqual([manual.div.id]);
    expect((await jobs(auto.div.id))[0].status).toBe('queued');

    delete process.env.MERGE_PAUSE_UNTIL;
    void kickMergeQueue();
    await settleMergeQueue();
    expect(engine.calls).toEqual([manual.div.id, auto.div.id]);
  });
});

describe('HM-60 모든 병합이 줄을 지난다 — 틱은 넣기만 · [지금 병합]은 202', () => {
  it('[HM-T164] ★ 틱은 병합을 기다리지 않는다 — 일꾼이 붙잡혀 있어도 14:45 · 15:00 틱이 3단계 알림 · 맞추기 · 마감 전 알림을 제때 부른다', async () => {
    const { makeSchedulerTick } = await import('@/server/scheduler');
    for (let i = 0; i < 3; i++) await mkDivision(`틱실${i}`);
    const tick = makeSchedulerTick();

    vi.setSystemTime(at(1));
    await tick(); // 넣기만 하고 돌아온다 — 병합은 아직 하나도 끝나지 않았다
    await untilPending(1);
    expect((await jobs()).map((j) => j.status).sort()).toEqual(['queued', 'queued', 'running']);

    // 줄은 15시를 넘겨 돈다 — 틱 1분 전에 앞 병합이 끝나고 다음 병합이 시작해 틱 동안 일꾼은 늘 붙잡혀 있다
    for (const m of [45, 60]) {
      vi.setSystemTime(at(m - 1));
      release();
      await vi.waitFor(async () => expect((await jobs()).filter((j) => j.status === 'done')).toHaveLength(m === 45 ? 1 : 2), WAIT);
      await untilPending(1);
      vi.setSystemTime(at(m));
      await tick(); // 돌고 있는 병합을 기다리지 않고 돌아온다
      expect(engine.pending.length).toBe(1);
    }
    expect(tickCalls.rollupNotices).toEqual([at(1).getTime(), at(45).getTime(), at(60).getTime()]);
    expect(tickCalls.rollupSync).toEqual([at(1).getTime(), at(45).getTime(), at(60).getTime()]);
    expect(tickCalls.reminders).toEqual([at(1).getTime(), at(45).getTime(), at(60).getTime()]);
    // 같은 부서를 줄에 두 번 넣지 않는다
    expect((await jobs()).map((j) => j.status)).toEqual(['done', 'done', 'running']);
  });

  it('[HM-T164] ★ 13개 부서 · 부서당 100초 — 줄로 돌아도 모든 부서장이 검토 요청을 받는다, 먼저 끝난 부서는 기다리지 않는다 (HM-T141을 줄로)', async () => {
    const { makeSchedulerTick, installMergeQueueHooks } = await import('@/server/scheduler');
    const { settleMergeQueue } = await import('@/server/merge/queue');
    const heads: string[] = [];
    for (let i = 0; i < 13; i++) heads.push((await mkDivision(`십삼실${String(i).padStart(2, '0')}`)).head.employeeNo!);
    installMergeQueueHooks();
    engine.instantMs = 100_000;
    vi.setSystemTime(at(1));
    await makeSchedulerTick()();
    await settleMergeQueue();
    const reviews = outbox.filter((m) => m.subject.includes('검토 부탁드려요'));
    expect(reviews.map((m) => m.to).sort()).toEqual([...heads].sort());
    expect(Math.min(...reviews.map((m) => m.at))).toBeLessThan(at(22).getTime());
    expect(Math.max(...reviews.map((m) => m.at))).toBeGreaterThan(at(22).getTime());
    expect(outbox.filter((m) => m.subject.includes('아직 없어요'))).toHaveLength(0);
  }, 60_000);

  it('[HM-T165 · API-T25] ★ [지금 병합] → 202 { jobId, position, joined } · GET ?jobId=로 대기 → 병합 중 → 끝 · 감사 로그는 넣을 때', async () => {
    const prisma = await db();
    const a = await mkDivision('이백이실');
    const b = await mkDivision('앞선실');
    const { enqueueMerge } = await import('@/server/merge/queue');
    await enqueueMerge(b.div.id, slotId, { trigger: 'auto' }); // 앞에 하나가 돌고 있다
    await untilPending(1);

    const res = await mergeNow(a.lead.email);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ joined: false, status: 'queued', position: 2 });
    expect(typeof body.jobId).toBe('string');
    expect(body.etaMinutes).toBeGreaterThanOrEqual(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { divisionId: a.div.id, action: 'merge' }, orderBy: { at: 'desc' } });
    expect(JSON.parse(audit.detail!)).toMatchObject({ status: 'queued', jobId: body.jobId, joined: false });

    let st = await (await jobStatus(a.lead.email, body.jobId)).json();
    expect(st).toMatchObject({ status: 'queued', position: 2, run: null });
    release(); // 앞의 것이 끝나면 차례가 온다
    await untilPending(1);
    st = await (await jobStatus(a.head.email, body.jobId)).json();
    expect(st).toMatchObject({ status: 'running', position: 1 });
    release();
    await vi.waitFor(async () => expect((await (await jobStatus(a.lead.email, body.jobId)).json()).status).toBe('done'), WAIT);
    st = await (await jobStatus(a.lead.email, body.jobId)).json();
    expect(st).toMatchObject({ status: 'done', position: null, run: { status: 'succeeded' } });
  });

  it('[HM-T165 · API-T25] 같은 순간 두 번 누르면 작업 하나 — 둘째는 합류(`joined`) · 병합은 한 번', async () => {
    const a = await mkDivision('두번실');
    const [r1, r2] = await Promise.all([mergeNow(a.lead.email), mergeNow(a.lead.email)]);
    expect([r1.status, r2.status]).toEqual([202, 202]);
    const [b1, b2] = [await r1.json(), await r2.json()];
    expect(b1.jobId).toBe(b2.jobId);
    expect([b1.joined, b2.joined].sort()).toEqual([false, true]);
    await drainAll();
    expect(engine.calls).toEqual([a.div.id]);
  });

  it('[HM-T165] 병합이 실패하면 GET이 `failed`와 그 문구를 준다 — 요청은 이미 202로 끝났다', async () => {
    const a = await mkDivision('실패실');
    const res = await mergeNow(a.lead.email);
    const { jobId } = await res.json();
    await untilPending(1);
    const { MergeFailed } = await import('@/server/merge/index');
    engine.pending.shift()!.fail(new MergeFailed('표 개수가 달라졌습니다 (3 → 2)'));
    await vi.waitFor(async () => expect((await (await jobStatus(a.lead.email, jobId)).json()).status).toBe('failed'), WAIT);
    const st = await (await jobStatus(a.lead.email, jobId)).json();
    expect(st).toMatchObject({ status: 'failed', errorText: '표 개수가 달라졌습니다 (3 → 2)', run: { status: 'failed' } });
  });

  it('[HM-T171 · API-T25] ★ (TACP-30 · API-65) 작업 상태는 내 부서 것만 — 남의 부서 작업 id · 없는 id · member는 404, 내 부서 lead · head는 200', async () => {
    const a = await mkDivision('내실');
    const b = await mkDivision('남실');
    const { jobId } = await (await mergeNow(a.lead.email)).json();
    expect((await jobStatus(a.lead.email, jobId)).status).toBe(200);
    expect((await jobStatus(a.head.email, jobId)).status).toBe(200);
    expect((await jobStatus(a.member.email, jobId)).status).toBe(404); // 실행 칸이 `—`
    expect((await jobStatus(b.lead.email, jobId)).status).toBe(404); // 남의 부서 작업 — 없는 것과 같다
    expect((await jobStatus(b.head.email, jobId)).status).toBe(404);
    expect((await jobStatus(a.lead.email, 'no-such-job')).status).toBe(404);
  });
});

describe('HM-61 쓰기 직전에 다시 본다 — 병합하는 동안 고친 판은 덮지 않는다', () => {
  it('[HM-T166] ★ 모델이 도는 동안 부서장이 고쳐 저장 → 병합은 쓰지 않는다 · 파일과 최신 성공 실행은 고친 그대로 · 작업은 failed + 그 문구', async () => {
    const prisma = await db();
    const { withEdit } = await import('@/server/merge/edits');
    const { readStoredFile } = await import('@/server/storage');
    const a = await mkDivision('고침실');
    const before = await succeededRun(a.div.id, at(1), '마감 병합본');

    vi.setSystemTime(at(5));
    const { jobId } = await (await mergeNow(a.lead.email)).json(); // 고친 기록이 없으니 묻지 않고 줄에 들어간다
    await untilPending(1);
    // 모델이 도는 사이 — 부서장의 저장(파일을 다시 쓰고 고친 기록을 남긴다)
    const { writeFileAtomic } = await import('@/server/storage');
    await writeFileAtomic(before.outputPath!, Buffer.from('부서장이 고친 판'));
    await prisma.mergeRun.update({ where: { id: before.id }, data: { reviewJson: withEdit(null, { by: '장 실장', role: 'head', at: at(6).toISOString(), places: 2 }) } });
    release();
    await vi.waitFor(async () => expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('failed'), WAIT);

    const job = await prisma.mergeJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.errorText).toBe('병합하는 동안 고친 판이 있어 덮지 않았어요');
    expect(await prisma.mergeRun.findUniqueOrThrow({ where: { id: job.mergeRunId! } })).toMatchObject({ status: 'failed', errorText: '병합하는 동안 고친 판이 있어 덮지 않았어요' });
    const latest = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: a.div.id, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    expect(latest.id).toBe(before.id);
    expect((await readStoredFile(before.outputPath!)).toString()).toBe('부서장이 고친 판');
  });

  it('[HM-T166] 「덮기 확인」(overwriteEdits)이면 덮는다 · 승인만 해도(파일은 그대로) 수동 병합은 지킨다', async () => {
    const prisma = await db();
    const { readStoredFile } = await import('@/server/storage');
    const { withEdit } = await import('@/server/merge/edits');
    const a = await mkDivision('확인실');
    const before = await succeededRun(a.div.id, at(1), '마감 병합본', withEdit(null, { by: '장 실장', role: 'head', at: at(3).toISOString(), places: 1 }));
    engine.bytesFor.set(a.div.id, '다시 병합한 판');

    // 이미 고친 판 — 확인하고 덮는다. 그 사이 또 고쳐도 확인한 요청은 덮는다
    vi.setSystemTime(at(5));
    expect((await mergeNow(a.lead.email)).status).toBe(409);
    const { jobId } = await (await mergeNow(a.lead.email, { overwriteEdits: true })).json();
    await untilPending(1);
    await prisma.mergeRun.update({ where: { id: before.id }, data: { reviewJson: withEdit(before.reviewJson, { by: '장 실장', role: 'head', at: at(6).toISOString(), places: 1 }) } });
    release();
    await vi.waitFor(async () => expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('done'), WAIT);
    expect((await readStoredFile(before.outputPath!)).toString()).toBe('다시 병합한 판');

    // 승인(고칠 것 없이)만 해도 — 수동 병합은 승인한 판을 덮지 않는다
    const b = await mkDivision('승인실');
    const run = await succeededRun(b.div.id, at(1), '승인할 판');
    vi.setSystemTime(at(7));
    const r2 = await (await mergeNow(b.lead.email)).json();
    await untilPending(1);
    await approve(b.div.id, run.id, b.head.id, '승인할 판', at(8));
    release();
    await vi.waitFor(async () => expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: r2.jobId } })).status).toBe('failed'), WAIT);
    expect((await readStoredFile(run.outputPath!)).toString()).toBe('승인할 판');
  });

  it('[HM-T166] ★ 자동 작업은 최종본만 지킨다 — 마감 전 미리보기를 고쳐도 마감 병합은 덮는다(HM-34), 마감 뒤 최종본을 고쳤으면 쓰지 않는다', async () => {
    const prisma = await db();
    const { readStoredFile } = await import('@/server/storage');
    const { withEdit } = await import('@/server/merge/edits');
    const { enqueueMerge } = await import('@/server/merge/queue');

    // 미리보기(마감 전 시작)를 줄에 들어간 뒤 고쳤다 — 마감은 이벤트다
    const p = await mkDivision('미리실');
    const preview = await succeededRun(p.div.id, at(-90), '미리보기');
    engine.bytesFor.set(p.div.id, '마감 병합본');
    const j1 = await enqueueMerge(p.div.id, slotId, { trigger: 'auto' });
    await untilPending(1);
    await prisma.mergeRun.update({ where: { id: preview.id }, data: { reviewJson: withEdit(null, { by: '장 실장', role: 'head', at: at(2).toISOString(), places: 1 }) } });
    release();
    await vi.waitFor(async () => expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: j1.jobId } })).status).toBe('done'), WAIT);
    expect((await readStoredFile(preview.outputPath!)).toString()).toBe('마감 병합본');

    // 마감 뒤 최종본을 마감 열기가 닫힌 뒤의 재병합(reopen)이 기다리는 사이 고쳤다 — 덮지 않는다
    const f = await mkDivision('최종실');
    const final = await succeededRun(f.div.id, at(1), '최종본');
    const j2 = await enqueueMerge(f.div.id, slotId, { trigger: 'reopen' });
    await untilPending(1);
    await prisma.mergeRun.update({ where: { id: final.id }, data: { reviewJson: withEdit(null, { by: '장 실장', role: 'head', at: at(40).toISOString(), places: 1 }) } });
    release();
    await vi.waitFor(async () => expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: j2.jobId } })).status).toBe('failed'), WAIT);
    expect((await readStoredFile(final.outputPath!)).toString()).toBe('최종본');
  });

  it('[HM-T166] 대기 중에 합류한 수동 요청은 기준을 그때로 다시 잡는다 — 누른 사람이 본 판(그 사이의 승인)을 덮어도 된다', async () => {
    const prisma = await db();
    const { enqueueMerge } = await import('@/server/merge/queue');
    const { readStoredFile } = await import('@/server/storage');
    const ahead = await mkDivision('앞실');
    const a = await mkDivision('합류실');
    const run = await succeededRun(a.div.id, at(1), '첫 판');
    engine.bytesFor.set(a.div.id, '늦게 낸 사람 넣은 판');
    await enqueueMerge(ahead.div.id, slotId, { trigger: 'manual' });
    await untilPending(1);
    const queued = await enqueueMerge(a.div.id, slotId, { trigger: 'manual' });
    await approve(a.div.id, run.id, a.head.id, '첫 판', at(2)); // 기다리는 사이 승인
    const joined = await enqueueMerge(a.div.id, slotId, { trigger: 'manual', actorEmail: a.lead.email }); // 승인을 보고 다시 누른다
    expect(joined).toMatchObject({ jobId: queued.jobId, joined: true });
    await drainAll();
    expect((await prisma.mergeJob.findUniqueOrThrow({ where: { id: queued.jobId } })).status).toBe('done');
    expect((await readStoredFile(run.outputPath!)).toString()).toBe('늦게 낸 사람 넣은 판');
  });
});

describe('HM-56 승인은 내용에 묶인다', () => {
  it('[HM-T167] ★ 승인 뒤 같은 입력으로 다시 병합(바이트 같음) → 화면 「승인 완료」 그대로 · +10분 검토 요청 없음 · +30분 「승인 완료」 · 같은 판 재승인은 이미 승인', async () => {
    const prisma = await db();
    const { latestReview, approvalOf, alreadyApproved } = await import('@/server/merge/review');
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    const a = await mkDivision('같은판실');
    const first = await succeededRun(a.div.id, at(1), '같은 내용');
    await approve(a.div.id, first.id, a.head.id, '같은 내용', at(3));

    // 담당자가 같은 입력으로 [다시 병합] — 바이트가 같다
    engine.bytesFor.set(a.div.id, '같은 내용');
    vi.setSystemTime(at(5));
    await mergeNow(a.lead.email);
    await drainAll();
    const second = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: a.div.id, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    expect(second.id).not.toBe(first.id);
    expect(second.outputSha).toBe(sha('같은 내용'));

    expect((await latestReview(a.div.id, slotId))?.changedAfter).toBe(false);
    expect((await approvalOf(second))?.changedAfter).toBe(false);
    expect(await alreadyApproved(second, sha('같은 내용'))).toBe(true);

    vi.setSystemTime(at(10));
    await runDueMergeNotices(at(10));
    expect(outbox.filter((m) => m.to === a.head.employeeNo)).toHaveLength(0); // 검토 요청을 다시 보내지 않는다
    vi.setSystemTime(at(30));
    await runDueMergeNotices(at(30));
    const done = outbox.filter((m) => m.to === a.lead.employeeNo);
    expect(done).toHaveLength(1);
    expect(done[0].contents).toContain('승인 완료');
  });

  it('[HM-T167] 내용이 다르면 「승인 뒤 바뀜」 — 마감 전 미리보기를 승인했는데 최종본이 달라도(예전에는 「승인 전」)', async () => {
    const { latestReview, approvalOf, alreadyApproved } = await import('@/server/merge/review');
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    const a = await mkDivision('다른판실');
    const preview = await succeededRun(a.div.id, at(-90), '미리보기');
    await approve(a.div.id, preview.id, a.head.id, '미리보기', at(-80));
    const final = await succeededRun(a.div.id, at(1), '마감 뒤 최종본');

    expect((await latestReview(a.div.id, slotId))?.changedAfter).toBe(true);
    expect((await approvalOf(final))?.changedAfter).toBe(true);
    expect(await alreadyApproved(final, sha('마감 뒤 최종본'))).toBe(false);
    vi.setSystemTime(at(10));
    await runDueMergeNotices(at(10));
    expect(outbox.filter((m) => m.to === a.head.employeeNo && m.subject.includes('검토 부탁드려요'))).toHaveLength(1);
  });
});
