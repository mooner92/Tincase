// HM-52 · HM-58 — 모델 문과 「잡은 것」은 **모듈 사본이 달라도 하나**다.
//
// Next는 같은 파일을 번들 층마다 따로 싣는다 — 스케줄러(instrumentation)와 [지금 병합](라우트 처리기)이 gate.ts · inflight.ts의
// 서로 다른 사본을 가질 수 있다(rollup/lock.ts가 같은 이유로 표를 globalThis에 둔다). 모듈 변수로 두면 두 사본이 서로를 못 봐서
// 문(HM-52)도 잡기(HM-58)도 그 둘 사이에서는 없는 것과 같다. 여기서는 `vi.resetModules()`로 두 번째 사본을 만들어 본다.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-shared-state.db'; // DB는 쓰지 않는다 — env 검증만 통과시킨다
const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-shared-'));
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
process.env.MERGE_MODEL = 'test-model';
process.env.MERGE_MODEL_URL = 'http://shared.test';
delete process.env.DEV_IDENTITY;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('모듈 사본이 달라도 표는 하나 (Next 번들 층)', () => {
  it('[HM-T158] 한 사본이 잡은 부서·주차는 다른 사본에서 잡히지 않는다 — 놓으면 다른 사본에서 잡힌다', async () => {
    const a = await import('@/server/merge/inflight');
    vi.resetModules();
    const b = await import('@/server/merge/inflight');
    expect(b).not.toBe(a); // 정말 다른 사본이다

    const release = a.claimMergeUnit('div-x', 'slot-x');
    expect(release).not.toBeNull();
    expect(b.claimMergeUnit('div-x', 'slot-x')).toBeNull();
    release!();
    const again = b.claimMergeUnit('div-x', 'slot-x');
    expect(again).not.toBeNull();
    again!();
  });

  it('[HM-T163] (HM-59d) 줄의 일꾼도 하나다 — 한 사본이 깨운 일꾼이 돌고 있으면 다른 사본은 새 일꾼을 세우지 않고 그 일꾼을 돌려받는다', async () => {
    // DB는 없다 — 일꾼은 첫 집기에서 오류를 로그로 남기고 쉰다. 여기서 보는 것은 「하나」뿐이다
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await import('@/server/merge/queue');
    vi.resetModules();
    const b = await import('@/server/merge/queue');
    expect(b).not.toBe(a);
    const first = a.kickMergeQueue();
    expect(b.kickMergeQueue()).toBe(first);
    await first;
    await b.settleMergeQueue();
  });

  it('[HM-T149] 한 사본이 문을 쥐고 있으면 다른 사본의 호출은 줄을 선다 — 모델 서버에 동시에 둘이 들어가지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let inFlight = 0;
    let maxInFlight = 0;
    const finishers: (() => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((r) => finishers.push(r));
        inFlight--;
        return { ok: true, status: 200, body: null, json: async () => ({ response: '' }) };
      }),
    );
    const a = await import('@/server/merge/gate');
    vi.resetModules();
    const b = await import('@/server/merge/gate');
    expect(b).not.toBe(a);

    const first = a.callModel({ label: '스케줄러 · 실적 중복 묶기', retries: 0, body: { prompt: 'x' } });
    await vi.waitFor(() => expect(finishers).toHaveLength(1));
    const second = b.callModel({ label: '[지금 병합] · 실적 중복 묶기', retries: 0, body: { prompt: 'y' } });
    // 다른 사본에서도 같은 문이 보인다
    await vi.waitFor(() => expect(b.modelGateState('http://shared.test').waitingLabels).toEqual(['[지금 병합] · 실적 중복 묶기']));
    expect(b.modelGateState('http://shared.test').holder?.label).toBe('스케줄러 · 실적 중복 묶기');
    expect(finishers).toHaveLength(1);

    finishers[0]();
    await vi.waitFor(() => expect(finishers).toHaveLength(2));
    finishers[1]();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(maxInFlight).toBe(1);
  });
});
