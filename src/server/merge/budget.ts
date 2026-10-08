// HM-57 · HM-55 — 병합 한 번이 쓸 수 있는 시간(예산)과, 그것으로 정해지는 「멈춘 실행」의 기준.
//
// ── 왜 예산이 있어야 하나 ───────────────────────────────────
// 병합 한 번은 모델을 최대 네 번 부른다(표 셋 + 분류). 한 번에 60초까지이고, 재시도(HM-57)를 더하면 여덟 번이다.
// 거기에 모델 문(HM-52)에서 기다리는 시간까지 붙으면 **실행이 언제 끝날지 위가 없다.** 위가 없으면
// 「아직 돌고 있나, 죽었나」를 가를 수 없다 — 2026-09-03 14:18의 running 행이 운영 DB에 아직 남아 있는 것이 그것이다.
// 그래서 실행마다 예산을 박는다. 예산이 다 되면 남은 표는 모델 없이(결정론으로) 넣고 병합은 끝까지 간다 —
// 폴백은 실패가 아니다(HM-24). 대신 표별 기록에 「예산」으로 남는다.
//
// ── 그러면 「멈춘 실행」의 기준이 생긴다 (HM-55) ─────────────
// 예산이 모델 호출과 문 앞 대기를 끊으므로, 살아 있는 실행은 「예산 + 파일 읽기·조립·쓰기」보다 오래 running일 수 없다.
// 그 밖의 일은 몇 초다. 넉넉히 6분을 더해 기본 10분 — 3단계 취합 브랜치의 조립 기록 회수와 같은 값이다.
// 이 시각을 넘긴 running은 **어느 프로세스에서도** 살아 있을 수 없으므로, 도는 중(매분)에 회수해도 살아 있는 실행을 죽이지 않는다.
// (기동 때는 이 기준을 기다리지 않고 남은 running을 모두 치운다 — inflight.ts)
//
// 환경변수를 env.ts가 아니라 여기서 읽는 이유: 이 변경을 main과 기능 브랜치에 같은 파일로 골라 넣기 위해서다
// (`MERGE_PAUSE_UNTIL`을 pause.ts가 읽는 것과 같은 방식). 값이 이상하면 기본값으로 돌고 한 번 경고한다 —
// 예산·재시도는 품질 조절이지 안전장치가 아니라서, 못 읽었다고 병합을 멈출 이유가 없다.

/** HM-57 — 병합 한 번의 기본 예산. 지금 최악(모델 4번 × 60초)을 명시적인 상한으로 박은 값 */
export const DEFAULT_MERGE_BUDGET_MS = 240_000;
/** HM-57 — 모델 호출 한 번이 실패했을 때 다시 부르는 기본 횟수 */
export const DEFAULT_MODEL_RETRIES = 1;
/** HM-55 — 예산 위에 더하는 여유. 파일 읽기·조립·검증·쓰기는 몇 초지만, 디스크가 느린 날을 위해 넉넉히 */
export const STALE_MARGIN_MS = 6 * 60_000;

const warned = new Set<string>();

function readInt(name: string, raw: string | undefined, fallback: number, min: number): number {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isInteger(n) && n >= min) return n;
  if (!warned.has(`${name}=${v}`)) {
    warned.add(`${name}=${v}`);
    console.warn(`[merge] ${name}="${v}"를 읽을 수 없어 기본값 ${fallback}으로 돈다`);
  }
  return fallback;
}

/** HM-57 — `MERGE_JOB_BUDGET_MS` (기본 240초). 1초보다 짧은 값은 받지 않는다 — 모델을 한 번도 못 부르게 된다 */
export function mergeBudgetMs(raw = process.env.MERGE_JOB_BUDGET_MS): number {
  return readInt('MERGE_JOB_BUDGET_MS', raw, DEFAULT_MERGE_BUDGET_MS, 1_000);
}

/** HM-57 — `MERGE_MODEL_RETRIES` (기본 1). 0이면 다시 부르지 않는다 */
export function modelRetries(raw = process.env.MERGE_MODEL_RETRIES): number {
  return readInt('MERGE_MODEL_RETRIES', raw, DEFAULT_MODEL_RETRIES, 0);
}

/** HM-55 — 이보다 오래 running이면 멈춘 실행이다 (기본 10분) */
export function mergeStaleAfterMs(): number {
  return mergeBudgetMs() + STALE_MARGIN_MS;
}

/** HM-55 — 이 시각보다 먼저 시작해 아직 running인 실행은 멈춘 것이다 */
export function mergeStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - mergeStaleAfterMs());
}

/**
 * HM-57 — 실행 하나의 예산. 시계는 만든 순간부터 간다 — **문 앞에서 기다린 시간도 들어간다.**
 *
 * 호출 한 번의 제한(MERGE_MODEL_TIMEOUT_MS)은 문을 통과한 뒤부터 잰다(HM-52). 둘이 다른 이유:
 * 호출 제한은 「모델이 이 질문에 답을 못 하나」를 묻고, 예산은 「이 실행이 언제까지 running일 수 있나」를 묻는다.
 * 뒤의 것이 대기를 빼면 위가 다시 사라진다(HM-55가 기대는 상한).
 */
export interface MergeBudget {
  /** 예산이 끝나는 시각 (ms) */
  readonly until: number;
  /** 예산이 끝나면 끊긴다 — 모델 호출과 문 앞 대기가 함께 듣는다 */
  readonly signal: AbortSignal;
  remainingMs(): number;
}

export function startMergeBudget(ms: number = mergeBudgetMs()): MergeBudget {
  const until = Date.now() + ms;
  const ctrl = new AbortController();
  // AbortSignal.timeout이 아니라 setTimeout인 이유: 시험이 가짜 시계로 「예산이 다 됐다」를 만들 수 있어야 한다.
  // unref — 이 타이머 하나 때문에 스크립트(scripts/run-merge.ts)가 4분 동안 안 끝나는 일이 없게. 끝난 실행의 신호는 아무도 듣지 않는다
  const t = setTimeout(() => ctrl.abort(new DOMException('병합 시간 예산 초과', 'TimeoutError')), ms);
  (t as { unref?: () => void }).unref?.();
  return {
    until,
    signal: ctrl.signal,
    remainingMs: () => Math.max(0, until - Date.now()),
  };
}
