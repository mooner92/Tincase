// HM-58 · HM-55 · HM-53 — 같은 부서 병합은 하나만 · 멈춘 실행 회수 · 마감 전 데우기.
//
// 시계는 Date만 가짜로 돌린다(타이머·DB는 그대로). 병합 본체와 메신저는 흉내 낸다 — 여기서 보는 것은
// 「언제 시작하지 않는가」와 「멈춘 기록이 무엇을 막지 않는가」다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-inflight-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-inflight.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
// 데우기는 모델이 설정돼 있어야 돈다. 병합 본체는 흉내 내므로 이 값으로 실제 묶기를 부르지 않는다
process.env.MERGE_MODEL = 'test-model';
process.env.MERGE_MODEL_URL = 'http://model.test';
delete process.env.DEV_IDENTITY;

const outbox = vi.hoisted(() => [] as { to: string; subject: string; contents: string; at: number }[]);
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: true, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string }) => {
    for (const to of input.recvIds) outbox.push({ to, subject: input.subject, contents: input.contents, at: Date.now() });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

const runMergeMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/merge/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/merge/index')>()),
  runMerge: runMergeMock,
}));

/**
 * 병합 뒤 맞추기(RU-72 `afterMerged`)에 끼어들 자리. 원래 동작은 그대로 부른다 — 이 파일은 3단계를 켜지 않으므로 아무것도 하지 않는다
 */
const afterHook = vi.hoisted(() => ({ fn: null as null | (() => Promise<void>) }));
vi.mock('@/server/rollup/auto', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/server/rollup/auto')>();
  return {
    ...orig,
    onUnitVersionChanged: async (...args: Parameters<typeof orig.onUnitVersionChanged>) => {
      await afterHook.fn?.();
      return orig.onUnitVersionChanged(...args);
    },
  };
});

const MIN = 60_000;
/** 목 2026-10-15 14:00 KST — 기본 마감(목 14:00)인 주 */
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

const OUTCOME = {
  outputRelPath: 'm.hwp',
  // 엔진은 쓰지 않는다 — runMergeRecorded가 잠금 안에서 이 바이트를 쓰고 기록한다 (RU-75 결정 c)
  output: Buffer.from('m'),
  bytes: 1,
  rowCounts: { achievements: 1, plans: 1, notes: 0 },
  mergedGroups: [],
  warnings: [],
  model: { used: true, reason: null, elapsedMs: 1, name: 'mock' },
  categories: null,
  sourceIds: [],
  missing: [],
  rowAuthors: { achievements: [], plans: [], notes: [] },
  flagged: [],
};

let slotId = '';
let isoKey = '';
let seq = 0;

async function mkDivision(name: string) {
  const { prisma } = await import('@/server/db');
  const n = ++seq;
  const div = await prisma.division.create({
    data: { slug: `Inflight_${n}`, nameKo: name, nameEn: `I${n}`, isActive: true, notifyEnabled: true },
  });
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'x/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });
  const head = await prisma.user.create({
    data: { email: `i${n}-head@test.kei.re.kr`, name: `장${n}`, divisionId: div.id, divisionRole: 'head', jobTitle: '실장', employeeNo: `8${n}01` },
  });
  const lead = await prisma.user.create({
    data: { email: `i${n}-lead@test.kei.re.kr`, name: `담${n}`, divisionId: div.id, divisionRole: 'lead', employeeNo: `8${n}02` },
  });
  const member = await prisma.user.create({ data: { email: `i${n}-m@test.kei.re.kr`, name: `원${n}`, divisionId: div.id } });
  await prisma.submission.create({
    data: { divisionId: div.id, userId: member.id, weekSlotId: slotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', uploadedAt: at(-60) },
  });
  return { div, head, lead, member };
}

/** 돌고 있는(또는 재시작에 끊긴) 병합 기록 */
async function runningRun(divisionId: string, startedAt: Date) {
  const { prisma } = await import('@/server/db');
  return prisma.mergeRun.create({
    data: { divisionId, weekSlotId: slotId, status: 'running', sourceIds: '[]', ruleSnapshot: '{}', startedAt },
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
async function mergeNow(identity: string) {
  const { POST } = await import('@/app/api/division/merge/route');
  return POST(
    nx('/api/division/merge', identity, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isoKey }),
    }),
  ) as Promise<Response>;
}

/** 흉내 낸 모델 서버 — 받은 요청만 적고 바로 답한다 */
let modelCalls: Record<string, unknown>[] = [];
function stubModel() {
  modelCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      modelCalls.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, body: null, json: async () => ({ response: '' }) };
    }),
  );
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-inflight.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const slot = await ensureCurrentSlot(D);
  slotId = slot.id;
  isoKey = slot.isoKey;
}, 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(D);
  outbox.length = 0;
  runMergeMock.mockReset();
  runMergeMock.mockImplementation(async () => OUTCOME);
  stubModel();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // 각 테스트는 자기 부서만 본다 — 앞 테스트의 부서는 끈다. 줄(HM-59)도 비운다
  const { prisma } = await import('@/server/db');
  await prisma.division.updateMany({ data: { isActive: false } });
  await prisma.mergeJob.deleteMany({});
  const { resetMergeQueueForTest } = await import('@/server/merge/queue');
  resetMergeQueueForTest();
});
afterEach(async () => {
  // 줄의 일꾼이 다음 시험으로 넘어가지 않게 — 남은 병합을 끝낸다
  const { settleMergeQueue } = await import('@/server/merge/queue');
  await settleMergeQueue();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MERGE_JOB_BUDGET_MS;
  delete process.env.MERGE_PAUSE_UNTIL;
  delete process.env.MERGE_MODEL_KEEP_ALIVE;
  process.env.MERGE_SCHEDULER = 'off'; // vitest.config 기본값으로 되돌린다
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('HM-58 · API-31 같은 부서·주차 병합은 하나만 — [지금 병합]은 409 merging', () => {
  it('[HM-T157] ★ 돌고 있으면 409 「이미 병합 중입니다」 — 시작하지 않고 기록도 남기지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { div, lead } = await mkDivision('겹침실');
    const live = await runningRun(div.id, at(1)); // 14:01 자동 병합이 돌고 있다
    vi.setSystemTime(at(2.5));

    const res = await mergeNow(lead.email);
    expect(res.status).toBe(409);
    const b = await res.json();
    expect(b).toMatchObject({ error: 'merging', message: '이미 병합 중입니다', detail: { runId: live.id } });
    expect(b.detail.startedAt).toBe('2026-10-15T14:01:00+09:00');
    expect(runMergeMock).not.toHaveBeenCalled();
    expect(await prisma.mergeRun.count({ where: { divisionId: div.id } })).toBe(1);
  });

  it('[HM-T157] 멈춘 실행(10분 넘은 running)은 막지 않는다 — 죽은 기록이 [지금 병합]을 영영 막으면 안 된다', async () => {
    const { settleMergeQueue } = await import('@/server/merge/queue');
    const { div, lead } = await mkDivision('끊김실');
    await runningRun(div.id, at(1));
    vi.setSystemTime(at(11.5)); // 10분 30초 지남
    const res = await mergeNow(lead.email);
    expect(res.status).toBe(202); // 2단계(HM-60b) — 줄에 넣고 바로 돌아온다
    await settleMergeQueue();
    expect(runMergeMock).toHaveBeenCalledTimes(1);
  });

  it('[HM-T157] ★ 같은 순간 두 번 누르면 하나만 돈다 (다른 탭 · Cloudflare 524 뒤 다시 누름) — 2단계부터 둘째는 409가 아니라 같은 작업에 합류(202)', async () => {
    const { prisma } = await import('@/server/db');
    const { settleMergeQueue } = await import('@/server/merge/queue');
    const { div, lead } = await mkDivision('동시실');
    let finish!: () => void;
    runMergeMock.mockImplementationOnce(() => new Promise((r) => (finish = () => r(OUTCOME))));

    const [first, second] = await Promise.all([mergeNow(lead.email), mergeNow(lead.email)]);
    expect([first.status, second.status]).toEqual([202, 202]);
    const [a, b] = [await first.json(), await second.json()];
    expect(a.jobId).toBe(b.jobId);
    expect([a.joined, b.joined].sort()).toEqual([false, true]);
    await vi.waitFor(() => expect(runMergeMock).toHaveBeenCalledTimes(1));
    finish();
    await settleMergeQueue();
    expect(runMergeMock).toHaveBeenCalledTimes(1);
    expect(await prisma.mergeRun.count({ where: { divisionId: div.id } })).toBe(1);

    // 끝나면 다시 누를 수 있다 — 새 작업
    const again = await mergeNow(lead.email);
    expect(again.status).toBe(202);
    expect((await again.json()).jobId).not.toBe(a.jobId);
  });

  it('[HM-T158] ★ 스케줄러는 [지금 병합]이 돌고 있는 부서를 건너뛴다 · 멈춘 실행은 회수하고 다시 돈다', async () => {
    const { prisma } = await import('@/server/db');
    const { runDueMerges } = await import('@/server/merge/run');
    const { div } = await mkDivision('수동실');
    const manual = await runningRun(div.id, at(1.5)); // 14:01:30 담당자가 [지금 병합]

    vi.setSystemTime(at(2));
    expect(await runDueMerges(at(2))).toEqual({ queued: 0, skipped: 1 });
    expect(runMergeMock).not.toHaveBeenCalled();

    // 그 실행이 재시작에 끊겼다 — 10분이 지나면 실패로 회수되고, 재시도 간격(HM-43, 1분)은 이미 지났으니 바로 줄에 선다
    vi.setSystemTime(at(12));
    expect(await runDueMerges(at(12))).toEqual({ queued: 1, skipped: 0 });
    const { settleMergeQueue } = await import('@/server/merge/queue');
    await settleMergeQueue();
    expect(runMergeMock).toHaveBeenCalledTimes(1);
    const old = await prisma.mergeRun.findUniqueOrThrow({ where: { id: manual.id } });
    expect(old).toMatchObject({ status: 'failed', errorText: '중단됨(재시작 등)' });
    expect(old.finishedAt?.getTime()).toBe(at(12).getTime());
  });

  it('[HM-T158] 같은 프로세스에서 [지금 병합]이 도는 동안 스케줄러도, 직접 부른 병합도 끼어들지 않는다', async () => {
    const { runDueMerges, runMergeRecorded } = await import('@/server/merge/run');
    const { div } = await mkDivision('틈실');
    let finish!: () => void;
    runMergeMock.mockImplementationOnce(() => new Promise((r) => (finish = () => r(OUTCOME))));
    vi.setSystemTime(at(2));
    const manual = runMergeRecorded(div.id, slotId, 'manual');
    await vi.waitFor(() => expect(runMergeMock).toHaveBeenCalledTimes(1));

    expect(await runDueMerges(at(2))).toEqual({ queued: 0, skipped: 1 });
    // 직접 불러도 시작하지 않는다 — 프로세스 안에서 먼저 잡은 쪽이 있다 (DB를 보기 전에 걸린다)
    expect(await runMergeRecorded(div.id, slotId, 'auto')).toEqual({ runId: '', status: 'busy', errorText: '이미 병합 중입니다', outcome: null });
    finish();
    expect((await manual).status).toBe('succeeded');
    expect(runMergeMock).toHaveBeenCalledTimes(1);
  });

  it('[HM-T158] (병합 뒤 맞추기와 함께) 기록이 succeeded가 된 뒤에도 맞추기(afterMerged)가 끝날 때까지는 잡은 채다 — 다음 병합의 맞추기가 앞지르지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { mergeInFlight } = await import('@/server/merge/inflight');
    const { div } = await mkDivision('맞춤실');
    vi.setSystemTime(at(2));
    const seen: { status?: string; second?: string; inFlight?: boolean } = {};
    afterHook.fn = async () => {
      afterHook.fn = null;
      // 쓰기·기록은 이미 끝났다(잠금 안의 두 걸음) — 맞추기는 그 뒤
      const run = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: div.id }, orderBy: { startedAt: 'desc' } });
      seen.status = run.status;
      seen.inFlight = !!(await mergeInFlight(div.id, slotId));
      seen.second = (await runMergeRecorded(div.id, slotId, 'auto')).status;
    };
    try {
      expect((await runMergeRecorded(div.id, slotId, 'manual')).status).toBe('succeeded');
    } finally {
      afterHook.fn = null;
    }
    expect(seen).toEqual({ status: 'succeeded', inFlight: true, second: 'busy' });
    expect(runMergeMock).toHaveBeenCalledTimes(1);
    // 끝나면 놓았다 — 다음 병합은 바로 돈다
    expect(await mergeInFlight(div.id, slotId)).toBeNull();
    expect((await runMergeRecorded(div.id, slotId, 'manual')).status).toBe('succeeded');
  });

  it('[HM-T158] 쓰기가 실패해도(디스크 등) 잡은 것을 놓는다 — 실행은 failed로 남고 다음 병합은 막히지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { mergeInFlight } = await import('@/server/merge/inflight');
    const { div } = await mkDivision('쓰기실패실');
    vi.setSystemTime(at(2));
    // 저장소 밖으로 나가는 경로 — writeFileAtomic이 거절한다
    runMergeMock.mockImplementationOnce(async () => ({ ...OUTCOME, outputRelPath: '../escape.hwp' }));
    const r = await runMergeRecorded(div.id, slotId, 'manual');
    expect(r.status).toBe('failed');
    expect(await prisma.mergeRun.findUniqueOrThrow({ where: { id: r.runId } })).toMatchObject({ status: 'failed' });
    expect(await mergeInFlight(div.id, slotId)).toBeNull();
    expect((await runMergeRecorded(div.id, slotId, 'manual')).status).toBe('succeeded');
  });
});

describe('HM-55 멈춘 실행 회수', () => {
  it('[HM-T159] 예산 + 여유(기본 10분)보다 오래된 running만 「중단됨(재시작 등)」으로 — 기준은 예산을 따른다', async () => {
    const { prisma } = await import('@/server/db');
    const { recoverStaleMergeRuns } = await import('@/server/merge/inflight');
    const { div } = await mkDivision('회수실');
    const old = await runningRun(div.id, at(1));
    const fresh = await runningRun(div.id, at(3));

    const got = await recoverStaleMergeRuns(at(12));
    expect(got.map((r) => r.id)).toEqual([old.id]);
    expect(await prisma.mergeRun.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: 'failed', errorText: '중단됨(재시작 등)' });
    expect((await prisma.mergeRun.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('running');

    // 예산을 1분으로 줄이면 기준은 7분 — 살아 있는 실행이 그보다 오래 갈 수 없다
    process.env.MERGE_JOB_BUDGET_MS = '60000';
    expect((await recoverStaleMergeRuns(at(10.5))).map((r) => r.id)).toEqual([fresh.id]);
  });

  it('[HM-T159] ★ 병합 안내는 멈춘 running을 「돌고 있음」으로 기다리지 않는다 — 담당자가 「병합본이 아직 없어요」를 받는다', async () => {
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    const { div, lead, head } = await mkDivision('안내실');
    void div;
    // 14:01 자동 병합 도중 재시작 — 기록이 running으로 남았다. 아직 회수 전이다
    await runningRun(div.id, at(1));

    // 14:10 — 9분째. 아직은 돌고 있을 수 있으므로 기다린다 (HM-35)
    vi.setSystemTime(at(10));
    await runDueMergeNotices(at(10));
    expect(outbox).toHaveLength(0);

    // 14:12 — 11분째. 멈춘 것이다. 예전에는 창(+22분)이 닫힐 때까지 기다리다 아무것도 안 보냈다
    vi.setSystemTime(at(12));
    await runDueMergeNotices(at(12));
    expect(outbox.map((m) => m.to)).toEqual([lead.employeeNo]);
    expect(outbox[0].subject).toContain('병합본이 아직 없어요');
    expect(outbox.some((m) => m.to === head.employeeNo)).toBe(false);
  });

  it('[HM-T159] ★ 기동 때는 남은 running을 모두 치운다(10분 전이어도) — 스케줄러가 꺼진 서버(테스트)도, 그러나 데우기·주기는 걸지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { div, lead } = await mkDivision('기동실');
    const old = await runningRun(div.id, at(1));
    // 14:03:50에 시작해 14:04 재시작에 끊겼다 — 10분 규칙이면 14:13:50까지 「병합 중」으로 막는다
    const fresh = await runningRun(div.id, at(3.8));
    vi.setSystemTime(at(4));
    process.env.MERGE_SCHEDULER = 'off';
    const env = process.env as Record<string, string | undefined>;
    const before = env.NEXT_RUNTIME;
    env.NEXT_RUNTIME = 'nodejs';
    const interval = vi.spyOn(globalThis, 'setInterval');
    try {
      const { register } = await import('@/instrumentation');
      await register();
    } finally {
      env.NEXT_RUNTIME = before;
    }
    expect(await prisma.mergeRun.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: 'failed', errorText: '중단됨(재시작 등)' });
    expect(await prisma.mergeRun.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: 'failed', errorText: '중단됨(재시작 등)' });
    expect(interval).not.toHaveBeenCalled(); // 1분 주기(데우기 포함)를 걸지 않았다
    expect(modelCalls).toHaveLength(0);
    // 끊긴 부서는 곧바로 다시 누를 수 있다 — 아무것도 돌지 않는데 「이미 병합 중」으로 막지 않는다
    expect((await mergeNow(lead.email)).status).toBe(202);
  });
});

describe('HM-53 마감 전 데우기', () => {
  it('[HM-T156] ★ 가장 이른 병합 기준 시각 10분 전에 한 번 — 빈 프롬프트 · keep_alive -1(상주) · 같은 기준 시각에는 다시 안 보낸다', async () => {
    process.env.MERGE_SCHEDULER = 'on';
    const { warmModelIfDue, resetWarmupForTest } = await import('@/server/merge/warmup');
    const { modelGateState } = await import('@/server/merge/gate');
    resetWarmupForTest();
    await mkDivision('데움실');

    expect(await warmModelIfDue(at(-11))).toBeNull();
    expect(modelCalls).toHaveLength(0);

    const w = await warmModelIfDue(at(-10));
    expect(w).toMatchObject({ ok: true, gate: D });
    expect(modelCalls).toEqual([{ model: 'test-model', stream: false, prompt: '', keep_alive: -1 }]);
    expect(modelGateState().lastWarmup).toMatchObject({ ok: true });

    for (const m of [-9, -1, 0, 0.5]) expect(await warmModelIfDue(at(m))).toBeNull();
    expect(modelCalls).toHaveLength(1);
  });

  it('[HM-T156] 마감 열기가 닫히는 시각도 기준 시각이다 (DM-20) — 그 시각마다 한 번', async () => {
    process.env.MERGE_SCHEDULER = 'on';
    const { prisma } = await import('@/server/db');
    const { warmModelIfDue, resetWarmupForTest } = await import('@/server/merge/warmup');
    resetWarmupForTest();
    await mkDivision('그대로실');
    const b = await mkDivision('열림실');
    await prisma.slotOpening.create({ data: { divisionId: b.div.id, weekSlotId: slotId, openUntil: at(40), openedBy: '담당' } });

    expect(await warmModelIfDue(at(-10))).toMatchObject({ gate: D });
    expect(await warmModelIfDue(at(29))).toBeNull();
    expect(await warmModelIfDue(at(30))).toMatchObject({ gate: at(40) });
    expect(await warmModelIfDue(at(31))).toBeNull();
    expect(modelCalls).toHaveLength(2);
  });

  it('[HM-T156] 스케줄러가 꺼진 서버 · 일시정지 중에는 데우지 않는다 · 실패해도 던지지 않는다', async () => {
    const { warmModelIfDue, resetWarmupForTest } = await import('@/server/merge/warmup');
    resetWarmupForTest();
    await mkDivision('끈실');

    process.env.MERGE_SCHEDULER = 'off'; // 테스트·시연 서버 — 운영 마감 시각에 같은 GPU를 붙잡으면 안 된다
    expect(await warmModelIfDue(at(-10))).toBeNull();

    process.env.MERGE_SCHEDULER = 'on';
    process.env.MERGE_PAUSE_UNTIL = at(60).toISOString(); // HM-44
    expect(await warmModelIfDue(at(-10))).toBeNull();
    expect(modelCalls).toHaveLength(0);

    delete process.env.MERGE_PAUSE_UNTIL;
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const r = await warmModelIfDue(at(-10));
    expect(r).toMatchObject({ ok: false, reason: '모델 호출 연결 실패' }); // 데우기는 다시 부르지 않는다
  });

  it('[HM-T161] ★ (2026-10-08 상주) 기동할 때 한 번 데운다 — 마감을 기다리지 않는다 · 스케줄러가 꺼진 서버 · 일시정지면 안 데운다', async () => {
    const { warmModelAtBoot } = await import('@/server/merge/warmup');
    const { modelGateState } = await import('@/server/merge/gate');
    vi.setSystemTime(at(-3 * 24 * 60)); // 월요일 — 어느 기준 시각에서도 먼 때

    process.env.MERGE_SCHEDULER = 'off';
    expect(await warmModelAtBoot()).toBeNull();
    process.env.MERGE_SCHEDULER = 'on';
    process.env.MERGE_PAUSE_UNTIL = at(60).toISOString(); // HM-44
    expect(await warmModelAtBoot()).toBeNull();
    expect(modelCalls).toHaveLength(0);

    delete process.env.MERGE_PAUSE_UNTIL;
    expect(await warmModelAtBoot()).toMatchObject({ ok: true, gate: null });
    expect(modelCalls).toEqual([{ model: 'test-model', stream: false, prompt: '', keep_alive: -1 }]);
    expect(modelGateState().lastWarmup).toMatchObject({ ok: true });
    expect(modelGateState().lastCall).toMatchObject({ label: '데우기(기동)' });

    // 설정한 값을 그대로 붙인다 — 데우기도 병합 호출과 같은 `MERGE_MODEL_KEEP_ALIVE`다 (HM-53b)
    process.env.MERGE_MODEL_KEEP_ALIVE = '45m';
    expect(await warmModelAtBoot()).toMatchObject({ ok: true });
    expect(modelCalls[1]).toEqual({ model: 'test-model', stream: false, prompt: '', keep_alive: '45m' });
    delete process.env.MERGE_MODEL_KEEP_ALIVE;

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await warmModelAtBoot()).toMatchObject({ ok: false, reason: '모델 호출 연결 실패' }); // 던지지 않는다 · 다시 부르지 않는다
  });

  it('[HM-T161] 스케줄러가 켜진 서버는 register()가 기동하자마자 데운다 — 첫 주기(20초 뒤)를 기다리지 않는다', async () => {
    await mkDivision('기동데움실');
    vi.setSystemTime(at(-3 * 24 * 60));
    process.env.MERGE_SCHEDULER = 'on';
    const env = process.env as Record<string, string | undefined>;
    const before = env.NEXT_RUNTIME;
    env.NEXT_RUNTIME = 'nodejs';
    // 주기는 걸지 않는다 — 이 시험이 보는 것은 기동 때의 데우기 하나다
    const realSetTimeout = globalThis.setTimeout;
    const firstTick = vi.fn();
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({ unref() {} })) as never);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
      ms === 20_000 ? (firstTick(), { unref() {} }) : realSetTimeout(fn, ms, ...rest)) as never);
    try {
      const { register } = await import('@/instrumentation');
      await register();
    } finally {
      env.NEXT_RUNTIME = before;
    }
    expect(firstTick).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(modelCalls).toHaveLength(1));
    expect(modelCalls[0]).toEqual({ model: 'test-model', stream: false, prompt: '', keep_alive: -1 });
  });
});
