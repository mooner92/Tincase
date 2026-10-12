// HM-52 · HM-57 · HM-53 — 모델 문 · 호출 재시도 · 실행 예산 · keep_alive(상주).
//
// 모델 서버는 흉내 낸다: 받은 요청을 적고, 정해 둔 시간만큼 걸린 뒤 답한다. 시계는 가짜다 — 「50초 걸리는 호출」을
// 50초 기다리지 않고 잰다. 여기서 보려는 것은 시간의 순서다: 서버에 동시에 몇 개가 들어갔나, 제한 시간은 언제부터 흘렀나.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-gate.db'; // 이 파일은 DB를 쓰지 않는다 — env 검증만 통과시킨다
const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-gate-'));
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
// vitest.config가 모델을 끈다(MERGE_MODEL='') — 이 파일은 흉내 낸 모델 서버를 켠다
process.env.MERGE_MODEL = 'test-model';
process.env.MERGE_MODEL_URL = 'http://model.test';
process.env.MERGE_MODEL_TIMEOUT_MS = '60000';
delete process.env.DEV_IDENTITY;

const S = 1000;

type Gate = typeof import('@/server/merge/gate');
type Model = typeof import('@/server/merge/model');
type Classify = typeof import('@/server/merge/classify');
type Budget = typeof import('@/server/merge/budget');
let gate: Gate;
let model: Model;
let classify: Classify;
let budget: Budget;

/** 서버가 이 요청에 어떻게 답하나 — n은 0부터 센 요청 순번 */
type Reply = { ms: number; status?: number; response?: string; drop?: boolean };
interface Seen {
  at: number;
  end: number | null;
  body: Record<string, unknown>;
}
let seen: Seen[] = [];
let inFlight = 0;
let maxInFlight = 0;

function serve(plan: (n: number, body: Record<string, unknown>) => Reply) {
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const n = seen.length;
    const me: Seen = { at: Date.now(), end: null, body };
    seen.push(me);
    const r = plan(n, body);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise<void>((resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) return reject(signal.reason);
        const t = setTimeout(resolve, r.ms);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    } finally {
      inFlight--;
      me.end = Date.now();
    }
    if (r.drop) throw new TypeError('fetch failed'); // 연결 실패
    const status = r.status ?? 200;
    return { ok: status < 400, status, body: null, json: async () => ({ response: r.response ?? DUP_OK }) };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const DUP_OK = '{"duplicates":[]}';
const ASSIGN_OK = '{"assign":{"1":"홍보","2":"홍보"}}';
/** 분류 요청이면 분류 답, 데우기면 빈 답, 아니면 중복 묶기 답 */
const okFor = (body: Record<string, unknown>) =>
  body.prompt === '' ? '' : JSON.stringify(body.format).includes('assign') ? ASSIGN_OK : DUP_OK;

const rows = [
  { id: 1, who: '가', content: '보도자료 배포', date: '', place: '', attendee: '' },
  { id: 2, who: '나', content: '포럼 참석', date: '', place: '', attendee: '' },
];

beforeAll(async () => {
  gate = await import('@/server/merge/gate');
  model = await import('@/server/merge/model');
  classify = await import('@/server/merge/classify');
  budget = await import('@/server/merge/budget');
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-15T14:01:00+09:00') });
  seen = [];
  inFlight = 0;
  maxInFlight = 0;
  delete process.env.MERGE_MODEL_RETRIES;
  delete process.env.MERGE_JOB_BUDGET_MS;
  delete process.env.MERGE_MODEL_KEEP_ALIVE;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('HM-52 모델 문 — 같은 모델 서버에는 한 번에 한 호출만', () => {
  it('[HM-T149] ★ 자동 병합 · 수동 병합 · 분류 · 데우기가 한꺼번에 와도 서버에 들어가는 요청은 늘 하나 — 먼저 온 순서로', async () => {
    serve((_n, body) => ({ ms: 10 * S, response: okFor(body) }));
    const t0 = Date.now();
    const all = Promise.all([
      model.groupDuplicates(rows, '', { label: '가실 · 실적 중복 묶기' }), // 스케줄러
      model.groupDuplicates(rows, '', { label: '나실 · 실적 중복 묶기' }), // [지금 병합]
      classify.classifyRows(rows, ['홍보'], '', { label: '가실 · 분류' }),
      gate.callModel({ label: '데우기', warmup: true, retries: 0, body: { prompt: '' } }),
    ]);
    await vi.advanceTimersByTimeAsync(40 * S);
    const [a, b, c, w] = await all;

    expect(maxInFlight).toBe(1);
    expect(seen.map((s) => s.at - t0)).toEqual([0, 10 * S, 20 * S, 30 * S]);
    // 앞 호출이 끝나야 다음 호출이 나간다 — 끝과 시작이 겹치지 않는다
    for (let i = 1; i < seen.length; i++) expect(seen[i].at).toBeGreaterThanOrEqual(seen[i - 1].end!);
    expect([a.usedModel, b.usedModel, c.usedModel, w.ok]).toEqual([true, true, true, true]);
    expect(b.waitedMs).toBe(10 * S);
    expect(c.waitedMs).toBe(20 * S);
  });

  it('[HM-T150] ★ 제한 시간은 문을 통과한 뒤부터 — 앞 호출이 50초를 잡아도 뒤 호출(30초)은 폴백하지 않는다', async () => {
    serve((n) => ({ ms: n === 0 ? 50 * S : 30 * S }));
    const t0 = Date.now();
    const first = model.groupDuplicates(rows, '', { label: '앞' });
    const second = model.groupDuplicates(rows, '', { label: '뒤' });
    await vi.advanceTimersByTimeAsync(90 * S);
    const [a, b] = await Promise.all([first, second]);

    // 예전에는 뒤 호출의 60초가 줄에 선 순간부터 흘러 50 + 30 = 80초에서 「시간 초과」로 모델 없이 병합됐다
    expect(a.usedModel).toBe(true);
    expect(b.usedModel).toBe(true);
    expect(b.fallbackKind).toBeNull();
    expect(b.attempts).toBe(1);
    expect(b.waitedMs).toBe(50 * S);
    expect(seen[1].end! - t0).toBe(80 * S);
  });

  it('[HM-T150] 문을 통과한 뒤 제한을 넘기면 그때는 시간 초과다 — 제한이 사라진 것이 아니다', async () => {
    process.env.MERGE_MODEL_RETRIES = '0';
    serve(() => ({ ms: 70 * S }));
    const p = model.groupDuplicates(rows, '', { label: '느림' });
    await vi.advanceTimersByTimeAsync(61 * S);
    const r = await p;
    expect(r.usedModel).toBe(false);
    expect(r.fallbackKind).toBe('timeout');
    expect(r.fallbackReason).toBe('모델 호출 시간 초과');
    expect(seen[0].end! - seen[0].at).toBe(60 * S);
  });

  it('[HM-T151] 문 상태 — 지금 쥔 호출 · 줄 선 수 · 마지막 호출 시간을 읽을 수 있다', async () => {
    serve(() => ({ ms: 10 * S }));
    expect(gate.modelGateState()).toMatchObject({ url: 'http://model.test', holder: null, waiting: 0 });

    const all = Promise.all([
      model.groupDuplicates(rows, '', { label: 'A' }),
      model.groupDuplicates(rows, '', { label: 'B' }),
      model.groupDuplicates(rows, '', { label: 'C' }),
    ]);
    await vi.advanceTimersByTimeAsync(4 * S);
    const mid = gate.modelGateState();
    expect(mid.holder).toEqual({ label: 'A', heldMs: 4 * S });
    expect(mid.waiting).toBe(2);
    expect(mid.waitingLabels).toEqual(['B', 'C']);

    await vi.advanceTimersByTimeAsync(30 * S);
    await all;
    const end = gate.modelGateState();
    expect(end.holder).toBeNull();
    expect(end.waiting).toBe(0);
    expect(end.lastCall).toMatchObject({ label: 'C', ok: true, kind: null, ms: 10 * S, waitedMs: 20 * S });
  });
});

describe('HM-57 호출 재시도 — 다음에는 될 수 있는 실패만, 한 번, 예산이 허락할 때', () => {
  it('[HM-T152] 재시도 판정표', () => {
    const o = { retries: 1, remainingMs: 200 * S, timeoutMs: 60 * S };
    // 다음에는 될 수 있는 실패
    expect(gate.shouldRetry('timeout', null, 1, o)).toBe(true);
    expect(gate.shouldRetry('connection', null, 1, o)).toBe(true);
    expect(gate.shouldRetry('http', 500, 1, o)).toBe(true);
    expect(gate.shouldRetry('http', 503, 1, o)).toBe(true);
    // 다시 해도 같은 것 — temperature 0이라 같은 입력에 같은 답
    expect(gate.shouldRetry('invalid', null, 1, o)).toBe(false);
    expect(gate.shouldRetry('http', 400, 1, o)).toBe(false);
    expect(gate.shouldRetry('http', 404, 1, o)).toBe(false);
    expect(gate.shouldRetry('budget', null, 1, o)).toBe(false);
    expect(gate.shouldRetry('skipped', null, 0, o)).toBe(false);
    // 한 번만
    expect(gate.shouldRetry('timeout', null, 2, o)).toBe(false);
    expect(gate.shouldRetry('timeout', null, 2, { ...o, retries: 2 })).toBe(true);
    expect(gate.shouldRetry('timeout', null, 1, { ...o, retries: 0 })).toBe(false);
    // 남은 예산이 호출 한 번보다 적으면 부르지 않는다 — 부르다 잘리면 기다린 시간만 버린다
    expect(gate.shouldRetry('timeout', null, 1, { ...o, remainingMs: 59 * S })).toBe(false);
    expect(gate.shouldRetry('timeout', null, 1, { ...o, remainingMs: 60 * S })).toBe(true);
  });

  it('[HM-T153] ★ 5xx · 시간 초과 · 연결 실패는 한 번 더 불러 모델을 쓴다', async () => {
    serve((n) => (n === 0 ? { ms: 1 * S, status: 503 } : { ms: 1 * S }));
    let p = model.groupDuplicates(rows, '', { label: '5xx' });
    await vi.advanceTimersByTimeAsync(5 * S);
    let r = await p;
    expect(r).toMatchObject({ usedModel: true, attempts: 2, fallbackKind: null });

    seen = [];
    serve((n) => (n === 0 ? { ms: 70 * S } : { ms: 5 * S }));
    p = model.groupDuplicates(rows, '', { label: '시간 초과' });
    await vi.advanceTimersByTimeAsync(70 * S);
    r = await p;
    expect(r).toMatchObject({ usedModel: true, attempts: 2 });
    expect(seen.map((s) => s.end! - s.at)).toEqual([60 * S, 5 * S]);

    seen = [];
    serve((n) => (n === 0 ? { ms: 0, drop: true } : { ms: 1 * S }));
    p = model.groupDuplicates(rows, '', { label: '연결' });
    await vi.advanceTimersByTimeAsync(5 * S);
    r = await p;
    expect(r).toMatchObject({ usedModel: true, attempts: 2 });
  });

  it('[HM-T153] 잘못된 JSON과 4xx는 다시 부르지 않는다 · 두 번 다 실패하면 사유에 횟수를 붙인다', async () => {
    serve(() => ({ ms: 1 * S, response: '묶을 게 없습니다' }));
    let p = model.groupDuplicates(rows, '', { label: 'JSON' });
    await vi.advanceTimersByTimeAsync(5 * S);
    let r = await p;
    expect(seen).toHaveLength(1);
    expect(r).toMatchObject({ usedModel: false, fallbackKind: 'invalid', attempts: 1, fallbackReason: '모델이 JSON을 내지 않았습니다' });

    seen = [];
    serve(() => ({ ms: 1 * S, status: 400 }));
    p = model.groupDuplicates(rows, '', { label: '400' });
    await vi.advanceTimersByTimeAsync(5 * S);
    r = await p;
    expect(seen).toHaveLength(1);
    expect(r).toMatchObject({ fallbackKind: 'http', attempts: 1, fallbackReason: '모델 응답 오류 (HTTP 400)' });

    seen = [];
    serve(() => ({ ms: 1 * S, status: 500 }));
    const c = classify.classifyRows(rows, ['홍보'], '', { label: '분류 500' });
    await vi.advanceTimersByTimeAsync(5 * S);
    const cr = await c;
    expect(seen).toHaveLength(2);
    expect(cr).toMatchObject({ usedModel: false, fallbackKind: 'http', attempts: 2, fallbackReason: '모델 응답 오류 (HTTP 500) (2번 시도)' });
  });

  it('[HM-T153] 남은 예산이 호출 한 번보다 적으면 다시 부르지 않는다 · MERGE_MODEL_RETRIES=0이면 부르지 않는다', async () => {
    serve(() => ({ ms: 70 * S }));
    const b = budget.startMergeBudget(90 * S); // 60초에서 끊기면 30초가 남는다 < 60초
    const p = model.groupDuplicates(rows, '', { budget: b, label: '예산' });
    await vi.advanceTimersByTimeAsync(61 * S);
    const r = await p;
    expect(seen).toHaveLength(1);
    expect(r).toMatchObject({ usedModel: false, fallbackKind: 'timeout', attempts: 1 });

    seen = [];
    process.env.MERGE_MODEL_RETRIES = '0';
    serve(() => ({ ms: 1 * S, status: 503 }));
    const q = model.groupDuplicates(rows, '', { label: '끔' });
    await vi.advanceTimersByTimeAsync(5 * S);
    expect(await q).toMatchObject({ fallbackKind: 'http', attempts: 1 });
    expect(seen).toHaveLength(1);
  });
});

describe('HM-57 실행 예산 — 기다림까지 포함해 실행의 끝을 정한다', () => {
  it('[HM-T155] ★ 문 앞에서 기다리다 예산이 다 되면 서버에 보내지 않고 폴백한다 — 실행은 예산 안에 끝난다', async () => {
    serve(() => ({ ms: 150 * S }));
    const t0 = Date.now();
    const holder = model.groupDuplicates(rows, '', { label: '오래 쥔 호출' }); // 예산 없는 쪽 — 60초 동안 문을 쥔다
    const b = budget.startMergeBudget(50 * S);
    const waiting = model.groupDuplicates(rows, '', { budget: b, label: '기다리는 실행' });
    await vi.advanceTimersByTimeAsync(50 * S);
    const r = await waiting;
    expect(r).toMatchObject({ usedModel: false, fallbackKind: 'budget', attempts: 0, fallbackReason: '병합 시간 예산 초과' });
    expect(r.elapsedMs).toBe(50 * S);
    expect(r.waitedMs).toBe(50 * S);
    expect(Date.now() - t0).toBe(50 * S);
    // 기다리던 실행의 요청은 서버에 한 번도 가지 않았고, 줄에서도 빠졌다
    expect(seen).toHaveLength(1);
    expect(gate.modelGateState().waiting).toBe(0);
    // 앞 호출은 그대로 간다 — 60초에 끊기고 한 번 더 (예산이 없으니 남은 예산은 무한)
    await vi.advanceTimersByTimeAsync(80 * S);
    expect(await holder).toMatchObject({ fallbackKind: 'timeout', attempts: 2 });
    expect(seen).toHaveLength(2);
  });

  it('[HM-T155] 도는 중에 예산이 다 되면 그 호출을 끊는다 · 이미 다 됐으면 부르지도 않는다', async () => {
    serve(() => ({ ms: 50 * S }));
    const b = budget.startMergeBudget(30 * S);
    const p = model.groupDuplicates(rows, '', { budget: b, label: '끊김' });
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(await p).toMatchObject({ fallbackKind: 'budget', attempts: 1 });
    expect(seen[0].end! - seen[0].at).toBe(30 * S);

    const q = classify.classifyRows(rows, ['홍보'], '', { budget: b, label: '이미 끝남' });
    await vi.advanceTimersByTimeAsync(1);
    expect(await q).toMatchObject({ usedModel: false, fallbackKind: 'budget', attempts: 0 });
    expect(seen).toHaveLength(1);
  });

  it('[HM-T155] 예산 · 재시도 값을 못 읽으면 기본값으로 돈다 — 멈출 이유가 아니다', () => {
    expect(budget.mergeBudgetMs(undefined)).toBe(240 * S);
    expect(budget.mergeBudgetMs('90000')).toBe(90 * S);
    expect(budget.mergeBudgetMs('열 초')).toBe(240 * S);
    expect(budget.mergeBudgetMs('10')).toBe(240 * S); // 1초 미만 — 모델을 한 번도 못 부른다
    expect(budget.modelRetries(undefined)).toBe(1);
    expect(budget.modelRetries('0')).toBe(0);
    expect(budget.modelRetries('-1')).toBe(1);
    // 멈춘 실행 기준 = 예산 + 여유 6분 → 기본 10분
    expect(budget.mergeStaleAfterMs()).toBe(10 * 60 * S);
  });
});

describe('HM-53 keep_alive — 상주 (2026-10-08 개정)', () => {
  it('[HM-T154] ★ 모든 호출(병합 · 분류 · 데우기)이 시각과 상관없이 keep_alive -1(숫자)을 붙인다 — 기준 시각을 몰라도(스케줄러 꺼짐)', async () => {
    const g = new Date('2026-10-15T14:00:00+09:00').getTime();
    serve((_n, body) => ({ ms: 1 * S, response: okFor(body) }));
    const at = async (min: number, call: () => Promise<unknown>) => {
      vi.setSystemTime(g + min * 60 * S);
      const p = call();
      await vi.advanceTimersByTimeAsync(2 * S);
      await p;
      return seen[seen.length - 1].body.keep_alive;
    };
    // 예전에는 기준 −10분 ~ +60분만 "30m", 그 밖은 붙이지 않았다(서버 기본 5분에 내려가 다음 호출이 올리는 시간을 떠안았다)
    for (const min of [-24 * 60, -11, -10, 1, 59, 61, 3 * 24 * 60]) {
      expect(await at(min, () => model.groupDuplicates(rows, '', { label: `${min}분` }))).toBe(-1);
    }
    expect(await at(5, () => classify.classifyRows(rows, ['홍보'], '', { label: '분류' }))).toBe(-1);
    expect(await at(-10, () => gate.callModel({ label: '데우기', warmup: true, retries: 0, body: { prompt: '' } }))).toBe(-1);
  });

  it('[HM-T154] MERGE_MODEL_KEEP_ALIVE — 숫자는 숫자(초)로, 기간은 문자열 그대로. ollama는 본문의 "-1"(단위 없는 문자열)을 400으로 거절한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(gate.DEFAULT_KEEP_ALIVE).toBe('-1');
    expect(gate.modelKeepAlive(undefined)).toBe(-1);
    expect(gate.modelKeepAlive('')).toBe(-1);
    expect(gate.modelKeepAlive(' -1 ')).toBe(-1);
    expect(gate.modelKeepAlive('3600')).toBe(3600);
    expect(gate.modelKeepAlive('0')).toBe(0); // 바로 내린다 — 고른 사람의 뜻대로
    expect(gate.modelKeepAlive('30m')).toBe('30m');
    expect(gate.modelKeepAlive('1h30m')).toBe('1h30m');
    expect(gate.modelKeepAlive('-1m')).toBe('-1m');
    expect(warn).not.toHaveBeenCalled();
    // 읽을 수 없으면 기본값(-1)으로 돌고 한 번만 경고한다
    expect(gate.modelKeepAlive('forever')).toBe(-1);
    expect(gate.modelKeepAlive('forever')).toBe(-1);
    expect(gate.modelKeepAlive('30 m')).toBe(-1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('MERGE_MODEL_KEEP_ALIVE="forever"'))).toHaveLength(1);

    // 호출 본문에 그대로 실린다
    serve(() => ({ ms: 1 * S }));
    process.env.MERGE_MODEL_KEEP_ALIVE = '30m';
    let p = model.groupDuplicates(rows, '', { label: '30분' });
    await vi.advanceTimersByTimeAsync(2 * S);
    await p;
    expect(seen[seen.length - 1].body.keep_alive).toBe('30m');
    process.env.MERGE_MODEL_KEEP_ALIVE = '-1';
    p = model.groupDuplicates(rows, '', { label: '상주' });
    await vi.advanceTimersByTimeAsync(2 * S);
    await p;
    expect(seen[seen.length - 1].body.keep_alive).toBe(-1);
    expect(typeof seen[seen.length - 1].body.keep_alive).toBe('number');
  });
});
