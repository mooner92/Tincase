// RU-75 — 자동 진행의 줄 세우기. **한 프로세스가 전제다** (한 컨테이너 · SQLite — ADR-0003).
//
// 둘이 필요하다:
//   withLock   같은 열쇠의 일을 **차례로**. 같은 (부서, 주차)의 승인·수정 저장·비상구가 「본 판 확인 → 불변 사본 → 기록」을
//              한 덩어리로 하게 한다 — 둘이 같은 판을 보고 거의 동시에 저장하면 뒤의 것이 앞의 것을 덮던 틈도 함께 닫힌다
//   coalesce   조립(본부본·전사본)은 **한 번에 하나, 밀린 것은 한 번만 더** (single-flight + dirty). 승인 다섯이 1분 안에 몰려도
//              본부본은 많아야 두 번 만들어지고 마지막 것이 마지막 입력을 담는다. 기다리는 쪽(읽기 수리)은 돌고 있는 것이 끝날 때까지 기다린다
//
// 프로세스가 둘이 되면 이것으로는 못 막는다 — 그때는 DB 임대로 바꾼다. 그래도 DB 쪽 막이(사본의 `reviewId` 유일,
// 「가장 최근 승인만」 트랜잭션 재확인)가 중복·뒤바뀜은 막는다 (12 §2a 「동시성」).

/*
 * 표는 `globalThis`에 둔다. Next는 같은 파일을 번들 층마다 따로 싣는다 — 스케줄러(instrumentation)·라우트 처리기·서버 컴포넌트(읽기 수리)가
 * 서로 다른 모듈 사본을 가질 수 있고, 그러면 모듈 변수로 둔 잠금은 서로를 못 본다(스케줄러의 맞추기와 승인 요청이 같은 열쇠를 동시에 쥔다).
 * 한 프로세스라는 전제(위)는 그대로이고, 그 프로세스 안의 사본끼리 표 하나를 나눈다 — db.ts의 prisma와 같은 이유.
 */
const shared = globalThis as unknown as { __tincaseLockTails?: Map<string, Promise<void>>; __tincaseFlights?: Map<string, Flight<unknown>> };

const tails = (shared.__tincaseLockTails ??= new Map<string, Promise<void>>());

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

interface Flight<C> {
  promise: Promise<void>;
  /** 도는 사이에 또 시켰다 — 끝나면 한 번 더 */
  again: boolean;
  /** 다음 번에 쓸 값 — 가장 최근에 시킨 것 (`merge`로 앞의 것과 합친다) */
  next: C;
}

const flights = (shared.__tincaseFlights ??= new Map<string, Flight<unknown>>());

/**
 * 한 번에 하나. 돌고 있으면 「한 번 더」만 표시하고 **돌고 있는 그 약속**을 돌려준다 — 기다리면 다시 돈 것까지 끝난 뒤다.
 * `merge`는 밀린 요청 둘을 하나로 합치는 법이다(예: 누가 [다시 시도]를 눌렀으면 다음 번도 다시 시도로).
 */
export function coalesce<C>(key: string, arg: C, fn: (arg: C) => Promise<void>, merge: (a: C, b: C) => C = (_a, b) => b): Promise<void> {
  const cur = flights.get(key) as Flight<C> | undefined;
  if (cur) {
    cur.next = cur.again ? merge(cur.next, arg) : arg;
    cur.again = true;
    return cur.promise;
  }
  const f: Flight<C> = { promise: Promise.resolve(), again: false, next: arg };
  flights.set(key, f as Flight<unknown>);
  f.promise = (async () => {
    await null; // 표에 먼저 올린 뒤에 시작한다 — fn 안에서 같은 열쇠를 다시 시켜도 새 줄을 세우지 않게
    try {
      do {
        const a = f.next;
        f.again = false;
        await fn(a);
      } while (f.again);
    } finally {
      flights.delete(key);
    }
  })();
  return f.promise;
}

/** RU-75 — 같은 (부서, 주차)의 줄 이름. 승인·수정 저장·비상구·따라잡기, 그리고 병합의 「파일 쓰기 → 성공 기록」이 이 줄에 선다 */
export const unitLockKey = (divisionId: string, slotId: string) => `unit:${divisionId}:${slotId}`;

/**
 * RU-75 — 같은 (부서, 주차)의 일은 줄을 선다. 여기(잠금 표 옆)에 두는 이유: 병합 기록(`merge/run.ts`)도 이 줄에 서야 하는데
 * handoff.ts를 정적으로 이으면 merge/run → rollup → schedule → slot-deadline → merge/run 고리가 된다. 이 파일은 아무것도 잇지 않는다.
 * **다시 들어가지 못한다**(재진입 없음) — 이 줄 안에서 같은 줄을 쥐는 함수(`syncUnit` 등)를 부르면 멈춘다. 그런 일은 잠금 밖에서 한다.
 */
export function withUnitLock<T>(divisionId: string, slotId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(unitLockKey(divisionId, slotId), fn);
}

/** 돌고 있는 조립이 있으면 끝날 때까지 기다린다(없으면 바로). 읽기 수리가 반쯤 만든 상태를 그리지 않게 */
export async function settled(key: string): Promise<void> {
  const cur = flights.get(key);
  if (cur) await cur.promise.catch(() => {});
}
