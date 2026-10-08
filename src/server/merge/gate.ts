// HM-52 — 모델 문: 같은 모델 서버(`MERGE_MODEL_URL`)에는 **한 번에 한 호출만** 보낸다.
// HM-57 — 호출이 일시적으로 실패하면(시간 초과·연결 실패·5xx) 한 번 더 부른다.
// HM-53 — 모든 호출이 모델을 **내리지 않게** 한다(keep_alive, 기본 -1 — 상주).
//
// ── 왜 문이 필요한가 ───────────────────────────────────────
// 모델 서버는 한 번에 하나만 처리한다(NUM_PARALLEL=1). 그런데 스케줄러 자동 병합과 [지금 병합]은 서로를 모르고
// 같은 서버를 동시에 부른다. 예전에는 제한 시간(60초)이 **요청을 보낸 순간부터** 흘렀다 — 앞 호출이 끝나기를
// 서버 안에서 기다린 시간까지 제한에 들어가, 모델은 멀쩡한데 「시간 초과」로 모델 없이 병합됐다.
// 그 결과가 `succeeded`로 남으니 다시 병합하지도 않는다. 2026-10-07 14:02에 실제로 그랬고,
// 시뮬레이션(s45)에서는 겹친 요청 하나로 시간 초과 7번 · 모델 없이 병합 4건이 났다.
//
// 그래서 줄을 **앱 안에서** 세운다. 문을 통과한 호출만 서버에 가고, 제한 시간은 문을 통과한 **뒤부터** 잰다.
// 줄에서 기다린 시간은 모델의 잘못이 아니다. (기다림의 위는 실행 예산이 정한다 — budget.ts)
//
// 이 문은 프로세스 안의 것이다. 테스트·시연 서버와 호스트의 다른 프로그램은 컨테이너가 달라 이 문을 볼 수 없다 —
// 그쪽은 운영으로 정한다(다른 모델 서버를 쓰게 한다, HM-52d).
//
// ── 왜 재시도는 「한 번」이고 잘못된 JSON은 빼나 ────────────
// 시간 초과·연결 실패·5xx는 다음에는 될 수 있다(모델을 올리는 중이었다, GPU를 잠깐 다퉜다).
// 잘못된 JSON은 다시 불러도 같다 — temperature 0이라 같은 입력에 같은 답이 나온다. 부르는 만큼 줄만 길어진다.
// 그리고 남은 예산이 호출 한 번(제한 시간)보다 적으면 다시 부르지 않는다 — 부르다 예산에 잘리면 기다린 시간만 버린다.

import { env } from '../env';
import { modelRetries, type MergeBudget } from './budget';

/** 모델을 부르다 못 쓴 이유의 종류 — 표별 기록(HM-57c)과 2단계의 알림·점검이 「다시 하면 될 폴백인가」를 이것으로 가른다 */
export type ModelFailKind = 'timeout' | 'connection' | 'http' | 'budget' | 'invalid';
/** 표별 기록에 남는 폴백 종류. `skipped`는 부르지 않은 것이다 — 모델 없음·행 없음·행이 너무 많음·분류 없음 (중복 묶기는 늘 켠다 — HM-51) */
export type FallbackKind = ModelFailKind | 'skipped';

export interface ModelCallMeta {
  /** 서버에 실제로 보낸 횟수 (예산이 먼저 다 됐으면 0) */
  attempts: number;
  /** 문 앞에서 기다린 시간 합 */
  waitedMs: number;
  /** 부른 순간부터 끝까지 (기다림 포함) */
  elapsedMs: number;
}
export type ModelReply =
  | ({ ok: true; text: string } & ModelCallMeta)
  | ({ ok: false; kind: ModelFailKind; status: number | null; reason: string } & ModelCallMeta);

export const BUDGET_REASON = '병합 시간 예산 초과';

// ── 문 ────────────────────────────────────────────────────

interface Waiter {
  label: string;
  since: number;
  grant: () => void;
}
interface CallRecord {
  label: string;
  ok: boolean;
  kind: ModelFailKind | null;
  /** 문을 쥐고 있던 시간 = 모델이 실제로 쓴 시간 */
  heldMs: number;
  waitedMs: number;
  at: number;
}
interface Gate {
  holder: { label: string; since: number } | null;
  queue: Waiter[];
  lastCall: CallRecord | null;
  lastWarmup: CallRecord | null;
}

const gates = new Map<string, Gate>();

function gateOf(url: string): Gate {
  let g = gates.get(url);
  if (!g) {
    g = { holder: null, queue: [], lastCall: null, lastWarmup: null };
    gates.set(url, g);
  }
  return g;
}

/**
 * 차례가 오면 돌아온다 (먼저 온 순서). `signal`이 끊기면 줄에서 빠지고 그 이유로 던진다.
 * 놓을 때 다음 사람에게 **직접 넘긴다** — 문이 잠깐 비는 틈이 없어야 새로 온 호출이 줄을 새치기하지 않는다.
 */
function acquire(gate: Gate, label: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!gate.holder && gate.queue.length === 0) {
    gate.holder = { label, since: Date.now() };
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const i = gate.queue.indexOf(w);
      if (i >= 0) gate.queue.splice(i, 1);
      reject(signal!.reason);
    };
    const w: Waiter = {
      label,
      since: Date.now(),
      grant: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    gate.queue.push(w);
  });
}

function release(gate: Gate): void {
  const next = gate.queue.shift();
  if (next) {
    gate.holder = { label: next.label, since: Date.now() };
    next.grant();
  } else {
    gate.holder = null;
  }
}

export interface ModelGateState {
  url: string;
  /** 지금 문을 쥔 호출과 쥔 지 얼마나 됐나. 비어 있으면 null */
  holder: { label: string; heldMs: number } | null;
  /** 줄에 선 호출 수와 이름 (먼저 온 순서) */
  waiting: number;
  waitingLabels: string[];
  /** 마지막으로 끝난 호출 — `ms`는 문을 쥐고 있던 시간(모델이 쓴 시간) */
  lastCall: { label: string; ok: boolean; kind: ModelFailKind | null; ms: number; waitedMs: number; at: Date } | null;
  /** 마지막 데우기 (HM-53) */
  lastWarmup: { ok: boolean; kind: ModelFailKind | null; ms: number; at: Date } | null;
}

/** HM-52 — 문 상태. 화면(운영자 「병합 줄」 카드, 2단계)과 로그가 읽는다. 읽기만 한다 */
export function modelGateState(url: string = env.MERGE_MODEL_URL, now: number = Date.now()): ModelGateState {
  const g = gates.get(url);
  const rec = (r: CallRecord | null) =>
    r ? { label: r.label, ok: r.ok, kind: r.kind, ms: r.heldMs, waitedMs: r.waitedMs, at: new Date(r.at) } : null;
  const warm = g?.lastWarmup ?? null;
  return {
    url,
    holder: g?.holder ? { label: g.holder.label, heldMs: now - g.holder.since } : null,
    waiting: g?.queue.length ?? 0,
    waitingLabels: g?.queue.map((w) => w.label) ?? [],
    lastCall: rec(g?.lastCall ?? null),
    lastWarmup: warm ? { ok: warm.ok, kind: warm.kind, ms: warm.heldMs, at: new Date(warm.at) } : null,
  };
}

// ── keep_alive — 상주 (HM-53, 2026-10-08 개정) ─────────────
//
// 처음에는 마감 시간대(기준 −10분 ~ +60분)에만 30분 붙잡았다 — 같은 GPU를 쓰는 다른 사람을 생각해서였다.
// 2026-10-08 사용자 결정(「독점하듯이 사용해도 돼」): data04의 tincase-ollama(11437)는 이 앱 말고 쓰는 곳이 없다.
// 그래서 **모든 호출이 모델을 내리지 않게** 한다. 마감 시간대만 붙잡으면 [지금 병합](마감 전 미리 보기 · 마감 뒤 다시 병합)이
// 5분 쉰 모델을 올리는 25~46초를 떠안는다 — 첫 표가 그 시간 때문에 60초 제한에 걸려 모델 없이 확정된다(2026-10-07에 두 번).
// 테스트·시연 서버도 같은 모델 서버의 **같은 모델**을 쓰므로(compose) 그쪽 호출이 붙잡아도 운영과 다투지 않는다.
// 값은 `MERGE_MODEL_KEEP_ALIVE`로 바꿀 수 있다 — 모델 서버를 나눠 쓰게 되면 그 서버에서 "30m" 같은 값으로 되돌린다.

/** ollama `keep_alive` — 숫자는 초(음수면 내리지 않는다), 문자열은 Go 기간("30m" · "1h30m" · "-1m") */
export type KeepAlive = number | string;
/** HM-53 — `MERGE_MODEL_KEEP_ALIVE`의 기본값. 내리지 않는다 */
export const DEFAULT_KEEP_ALIVE = '-1';

const GO_DURATION = /^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+$/;
const SECONDS = /^-?\d+(?:\.\d+)?$/;
const keepAliveWarned = new Set<string>();

/**
 * HM-53 — 호출마다 붙일 keep_alive (`MERGE_MODEL_KEEP_ALIVE`, 기본 "-1").
 *
 * **숫자로 된 값은 숫자로 보낸다.** ollama는 본문의 문자열을 Go 기간으로만 읽어 `"-1"`(단위 없음)을 거절한다(400) —
 * 서버 쪽 환경변수 `OLLAMA_KEEP_ALIVE`는 초로 읽어 주지만 요청 본문은 아니다. 그래서 "-1" → -1, "3600" → 3600(초).
 * 기간 문자열("30m" · "24h" · "-1m")은 그대로. 읽을 수 없는 값은 기본값으로 돌고 한 번 경고한다(budget.ts와 같은 방식 —
 * 품질 조절이지 안전장치가 아니라서 병합을 멈출 이유가 없다).
 * 환경변수를 env.ts가 아니라 여기서 읽는 이유도 budget.ts와 같다.
 */
export function modelKeepAlive(raw: string | undefined = process.env.MERGE_MODEL_KEEP_ALIVE): KeepAlive {
  const v = (raw ?? '').trim();
  const pick = (x: string): KeepAlive => (SECONDS.test(x) ? Number(x) : x);
  if (!v) return pick(DEFAULT_KEEP_ALIVE);
  if (SECONDS.test(v) || GO_DURATION.test(v)) return pick(v);
  if (!keepAliveWarned.has(v)) {
    keepAliveWarned.add(v);
    console.warn(`[merge] MERGE_MODEL_KEEP_ALIVE="${v}"를 읽을 수 없어 기본값 ${DEFAULT_KEEP_ALIVE}(내리지 않음)으로 돈다`);
  }
  return pick(DEFAULT_KEEP_ALIVE);
}

// ── 재시도 판정 (HM-57) ───────────────────────────────────

/**
 * 다시 부를 것인가. 순수 함수다 (시험할 수 있게).
 *   - 시간 초과 · 연결 실패 · HTTP 5xx만 — 다음에는 될 수 있는 실패
 *   - 잘못된 JSON(`invalid`) · 4xx · 예산 초과 · 부르지 않은 것(`skipped`)은 아니다
 *   - 지금까지 보낸 횟수가 `1 + retries`보다 적어야 한다
 *   - 남은 예산이 호출 한 번의 제한 시간 이상이어야 한다
 */
export function shouldRetry(
  kind: FallbackKind,
  status: number | null,
  attemptsSoFar: number,
  opts: { retries: number; remainingMs: number; timeoutMs: number },
): boolean {
  if (attemptsSoFar > opts.retries) return false;
  const transient = kind === 'timeout' || kind === 'connection' || (kind === 'http' && (status ?? 0) >= 500);
  if (!transient) return false;
  return opts.remainingMs >= opts.timeoutMs;
}

// ── 호출 ──────────────────────────────────────────────────

export interface ModelRequest {
  /** 문 상태에 보이는 이름 — 「연구관리실 · 실적 중복 묶기」 */
  label: string;
  /** `/api/generate` 본문 중 `model`·`stream`·`keep_alive`를 뺀 것 */
  body: Record<string, unknown>;
  /** 실행 예산. 없으면 호출 제한만 본다 */
  budget?: MergeBudget | null;
  /** 다시 부르는 횟수. 없으면 `MERGE_MODEL_RETRIES` */
  retries?: number;
  /** 데우기면 참 — 문 상태에 따로 남는다. keep_alive는 데우기든 병합이든 같다(`modelKeepAlive`, HM-53) */
  warmup?: boolean;
}

type Attempt = { ok: true; text: string } | { ok: false; kind: ModelFailKind; status: number | null; reason: string };

/**
 * HM-52 · HM-57 — 모델을 부른다. 문을 지나서만, 제한 시간은 문을 통과한 뒤부터, 일시적 실패면 한 번 더.
 * 던지지 않는다 — 실패는 이유와 함께 돌려주고, 부르는 쪽이 결정론으로 폴백한다 (HM-24).
 */
export async function callModel(req: ModelRequest): Promise<ModelReply> {
  const gate = gateOf(env.MERGE_MODEL_URL);
  const timeoutMs = env.MERGE_MODEL_TIMEOUT_MS;
  const retries = req.retries ?? modelRetries();
  const started = Date.now();
  let attempts = 0;
  let waitedMs = 0;

  const meta = (): ModelCallMeta => ({ attempts, waitedMs, elapsedMs: Date.now() - started });
  const fail = (kind: ModelFailKind, status: number | null, reason: string): ModelReply => ({
    ok: false,
    kind,
    status,
    reason: attempts > 1 ? `${reason} (${attempts}번 시도)` : reason,
    ...meta(),
  });

  for (;;) {
    if (req.budget?.signal.aborted) return fail('budget', null, BUDGET_REASON);
    const w0 = Date.now();
    try {
      await acquire(gate, req.label, req.budget?.signal);
    } catch {
      // 줄에서 기다리다 예산이 다 됐다 — 서버에는 보내지 않았다
      waitedMs += Date.now() - w0;
      return fail('budget', null, BUDGET_REASON);
    }
    waitedMs += Date.now() - w0;
    attempts++;

    const r = await attemptOnce(gate, req, timeoutMs, Date.now() - w0);
    if (r.ok) return { ok: true, text: r.text, ...meta() };

    const remainingMs = req.budget ? req.budget.remainingMs() : Number.POSITIVE_INFINITY;
    if (!shouldRetry(r.kind, r.status, attempts, { retries, remainingMs, timeoutMs })) {
      return fail(r.kind, r.status, r.reason);
    }
    console.warn(`[merge] 모델 다시 부름 — ${req.label}: ${r.reason}`);
  }
}

/** 문을 쥔 상태에서 한 번 보낸다. 끝나면(성공이든 실패든, 예상 못 한 예외든) 문을 놓는다 — 못 놓으면 모델이 영영 막힌다 */
async function attemptOnce(gate: Gate, req: ModelRequest, timeoutMs: number, waitedMs: number): Promise<Attempt> {
  const t0 = Date.now();
  let out: Attempt = { ok: false, kind: 'connection', status: null, reason: '모델 호출 연결 실패' };
  try {
    out = await send(req, timeoutMs);
    return out;
  } finally {
    const rec: CallRecord = {
      label: req.label,
      ok: out.ok,
      kind: out.ok ? null : out.kind,
      heldMs: Date.now() - t0,
      waitedMs,
      at: Date.now(),
    };
    gate.lastCall = rec;
    if (req.warmup) gate.lastWarmup = rec;
    release(gate);
  }
}

async function send(req: ModelRequest, timeoutMs: number): Promise<Attempt> {
  /*
   * 제한 시간은 **여기서**, 문을 통과한 뒤에 만든다 (HM-52). 예전에는 요청을 보내기 전, 즉 줄에 서기 전에 만들었다.
   * AbortSignal.timeout과 같은 일이지만 setTimeout으로 만든다 — 끝나면 치울 수 있고, 시험이 가짜 시계로 잴 수 있다.
   */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('모델 호출 시간 초과', 'TimeoutError')), timeoutMs);
  const signal = req.budget ? AbortSignal.any([ctrl.signal, req.budget.signal]) : ctrl.signal;

  let out: Attempt;
  let reading = false;
  try {
    const res = await fetch(`${env.MERGE_MODEL_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: env.MERGE_MODEL,
        stream: false,
        ...req.body,
        keep_alive: modelKeepAlive(),
      }),
    });
    if (!res.ok) {
      // 읽지 않은 본문은 연결을 붙잡는다 — 버린다
      res.body?.cancel().catch(() => {});
      out = { ok: false, kind: 'http', status: res.status, reason: `모델 응답 오류 (HTTP ${res.status})` };
    } else {
      reading = true;
      const body = (await res.json()) as { response?: unknown };
      out = { ok: true, text: typeof body.response === 'string' ? body.response : '' };
    }
  } catch {
    // 무엇이 끊었나로 가른다 — 오류 이름은 런타임마다 다르다
    if (req.budget?.signal.aborted) out = { ok: false, kind: 'budget', status: null, reason: BUDGET_REASON };
    else if (ctrl.signal.aborted) out = { ok: false, kind: 'timeout', status: null, reason: '모델 호출 시간 초과' };
    else if (reading) out = { ok: false, kind: 'invalid', status: null, reason: '모델 응답을 읽지 못했습니다' };
    else out = { ok: false, kind: 'connection', status: null, reason: '모델 호출 연결 실패' };
  } finally {
    clearTimeout(timer);
  }
  return out;
}
