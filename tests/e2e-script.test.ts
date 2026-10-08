// OPS-50 — 브라우저 e2e 스모크(`scripts/e2e-v2.cjs` · `scripts/e2e-seed.ts`)의 **지키는 부품**. 흐름 자체는 브라우저·빌드가 필요해
// 이 스위트에서 돌리지 않는다(docs/REHEARSAL.md — 손으로, 월요일 스모크로). 여기서는 그것이 엉뚱한 곳을 건드리지 않는다는 것만 본다:
//   셸의 환경(DB·메신저 주소)을 하위 프로세스에 넘기지 않는다 · 운영·테스트·시연 포트를 받지 않는다 · 시드는 임시 디렉터리의 리허설 저장소만 받는다.
import { afterAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/e2e-v2.cjs');
const e2e = createRequire(__filename)(script) as {
  cleanEnv: (extra: Record<string, string>) => Record<string, string>;
  FORBIDDEN_PORTS: number[];
  mondayOf: (ms: number) => number;
};
const tmp = mkdtempSync(path.join(os.tmpdir(), 'e2e-script-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('[OPS-T37] e2e 스모크 — 엉뚱한 곳을 건드리지 않는다', () => {
  it('하위 프로세스 환경 — 셸의 DB·저장소·메신저·모델·DEV_IDENTITY를 넘기지 않는다 · 시계는 KST', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        DATABASE_URL: 'file:/data/worklog/db/worklog.db',
        STORAGE_ROOT: '/data/worklog',
        MESSENGER_URL: 'http://메신저.example/api',
        MESSENGER_ALLOWLIST: '*',
        MERGE_MODEL_URL: 'http://127.0.0.1:11437',
        DEV_IDENTITY: 'someone@example.invalid',
        TINCASE_ENV: 'test',
      });
      const env = e2e.cleanEnv({ PORT: '3460' });
      for (const k of ['DATABASE_URL', 'STORAGE_ROOT', 'MESSENGER_URL', 'MESSENGER_ALLOWLIST', 'MERGE_MODEL_URL', 'DEV_IDENTITY', 'TINCASE_ENV']) {
        expect(env[k], k).toBeUndefined();
      }
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.TZ).toBe('Asia/Seoul');
      expect(env.PORT).toBe('3460');
    } finally {
      process.env = saved;
    }
  });

  it('운영(11111)·테스트(11112)·시연(11113) 포트는 받지 않는다 — 작업 디렉터리도 만들기 전에 멈춘다', () => {
    expect(e2e.FORBIDDEN_PORTS).toEqual([11111, 11112, 11113]);
    for (const port of e2e.FORBIDDEN_PORTS) {
      const work = path.join(tmp, `w-${port}`);
      const r = spawnSync(process.execPath, [script, `--port=${port}`, `--work=${work}`], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(String(port));
      expect(existsSync(work)).toBe(false);
    }
  });

  it('다음 주 수요일을 셀 때 쓰는 월요일 — KST 달력 (일요일 밤 23:59 KST는 그 주, 월요일 0시는 다음 주)', () => {
    const kst = (iso: string) => Date.parse(`${iso}+09:00`);
    expect(e2e.mondayOf(kst('2026-10-11T23:59:00'))).toBe(kst('2026-10-05T00:00:00'));
    expect(e2e.mondayOf(kst('2026-10-12T00:00:00'))).toBe(kst('2026-10-12T00:00:00'));
  });

  const tsx = (args: string[]) =>
    spawnSync('npx', ['tsx', 'scripts/e2e-seed.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: 60_000 });

  it('시드 — 임시 디렉터리 밖은 거절 · DB 없는 저장소는 거절 (종료 코드 2, 아무것도 만들지 않는다)', () => {
    const out = tsx([`--root=${root}`]);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('임시 디렉터리');
    const empty = path.join(tmp, 'empty');
    mkdirSync(empty);
    const r = tsx([`--root=${empty}`]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('DB가 없습니다');
    expect(existsSync(path.join(empty, 'e2e'))).toBe(false);
  }, 90_000);

  it('시드 — 리허설 표식이 없는 저장소(rehearsal.ts prepare가 만든 것이 아님)는 거절', () => {
    const store = path.join(tmp, 'store');
    mkdirSync(path.join(store, 'db'), { recursive: true });
    execSync('npx prisma db push --skip-generate', {
      cwd: root,
      env: { ...process.env, DATABASE_URL: `file:${path.join(store, 'db', 'worklog.db')}` },
      stdio: 'pipe',
    });
    const r = tsx([`--root=${store}`]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('리허설 표식');
    expect(existsSync(path.join(store, 'e2e'))).toBe(false);
  }, 120_000);
});
