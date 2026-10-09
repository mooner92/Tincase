// OPS-50 — 브라우저 e2e 스모크(`scripts/e2e-v2.cjs` · `scripts/e2e-seed.ts`)의 **지키는 부품**. 흐름 자체는 브라우저·빌드가 필요해
// 이 스위트에서 돌리지 않는다(docs/REHEARSAL.md — 손으로, 전환 전 스모크로). 여기서는 그것이 엉뚱한 곳을 건드리지 않는다는 것만 본다:
//   셸의 환경(DB·메신저 주소)을 하위 프로세스에 넘기지 않는다 · 운영·테스트·시연 포트를 받지 않는다 · 시드는 임시 디렉터리의 리허설 저장소만 받는다.
// OPS-50h — 출시 범위(`--scope=launch`)의 모양과, 수신함을 판정하는 함수가 정말 새는 쪽지를 잡는지(판정이 늘 통과하는 검사가 되지 않게).
import { afterAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { E2E_SCOPES, LAUNCH_ACTIVE, LAUNCH_LEFTOVER, LAUNCH_ROLES, launchDivisionState, parseScope } from '../scripts/e2e-plan';

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/e2e-v2.cjs');
interface SinkEntry {
  kind: string;
  subject?: string;
  contents?: string;
  recipients: { employeeNo: string; email: string; name: string }[];
}
interface LaunchFacts {
  people: Record<string, { div: string; active: boolean }>;
}
const e2e = createRequire(__filename)(script) as {
  cleanEnv: (extra: Record<string, string>) => Record<string, string>;
  FORBIDDEN_PORTS: number[];
  SCOPES: string[];
  mondayOf: (ms: number) => number;
  judgeLaunchSink: (
    entries: SinkEntry[],
    facts: LaunchFacts,
  ) => { counts: Record<string, number>; leaks: string[]; unknown: string[]; unlabeled: string[]; stage3: string[]; batchTo: string[]; approved: SinkEntry[] };
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

  const tsx = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('npx', ['tsx', 'scripts/e2e-seed.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });

  it('시드 — 임시 디렉터리 밖은 거절 · DB 없는 저장소는 거절 (종료 코드 2, 아무것도 만들지 않는다)', () => {
    // 「밖」의 예는 체크아웃이다. 체크아웃이 /tmp 아래에 있어도(작업 트리를 임시 디렉터리에 둔 기계) 밖이 되게, 하위 프로세스의 임시 디렉터리를
    // 이 시험만의 빈 디렉터리로 준다 — os.tmpdir()은 TMPDIR을 읽는다. 예전에는 그런 체크아웃에서 이 한 줄만 「DB가 없습니다」로 떨어졌다
    const onlyTmp = path.join(tmp, 'only-tmp');
    mkdirSync(onlyTmp, { recursive: true });
    const out = tsx([`--root=${root}`], { TMPDIR: onlyTmp });
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

describe('[OPS-T37b] e2e 출시 범위 (--scope=launch · OPS-50h)', () => {
  it('범위 이름 — 둘뿐 · 없으면 full · 모르는 값은 멈춘다(스크립트는 작업 디렉터리를 만들기 전에, 시드는 저장소를 보기 전에)', () => {
    expect(E2E_SCOPES).toEqual(['full', 'launch']);
    expect(e2e.SCOPES).toEqual([...E2E_SCOPES]); // .cjs는 TS를 못 불러 목록을 따로 적었다 — 둘이 갈라지지 않게
    expect(parseScope([])).toBe('full');
    expect(parseScope(['--scope=launch'])).toBe('launch');
    expect(() => parseScope(['--scope=all'])).toThrow(/--scope/);
    expect(() => parseScope(['--scope'])).toThrow(/--scope/);

    const work = path.join(tmp, 'w-scope');
    const r = spawnSync(process.execPath, [script, '--scope=everything', `--work=${work}`], { encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--scope');
    expect(existsSync(work)).toBe(false);

    const empty = path.join(tmp, 'scope-empty');
    mkdirSync(empty, { recursive: true });
    const seed = spawnSync('npx', ['tsx', 'scripts/e2e-seed.ts', `--root=${empty}`, '--scope=everything'], { cwd: root, encoding: 'utf8', env: { ...process.env }, timeout: 60_000 });
    expect(seed.status).toBe(2);
    expect(seed.stderr).toContain('--scope');
    expect(existsSync(path.join(empty, 'e2e'))).toBe(false);
  }, 90_000);

  it('모양 — 켜는 부서 둘(LAUNCH-v2 「범위」) · 알림은 그 둘 + 범위 밖 한 줄(꺼진 부서 — 운영자가 끈다) · 기획조정실 부서장 없음 · 총괄은 담당 아님', () => {
    expect([...LAUNCH_ACTIVE]).toEqual(['기획조정실', 'AI홍보전략실']);
    for (const d of LAUNCH_ACTIVE) expect(launchDivisionState(d), d).toEqual({ isActive: true, notifyEnabled: true });
    expect(LAUNCH_ACTIVE).not.toContain(LAUNCH_LEFTOVER);
    expect(launchDivisionState(LAUNCH_LEFTOVER)).toEqual({ isActive: false, notifyEnabled: true });
    for (const d of ['기획경영본부', '인사관리실', '경영지원실', '환경평가본부', '국가지속가능발전연구센터']) {
      expect(launchDivisionState(d), d).toEqual({ isActive: false, notifyEnabled: false });
    }
    // 기획조정실: 담당 하나(총괄이 아닌 사람) · 부서장이던 사람과 총괄은 역할 없음
    expect(LAUNCH_ROLES).toEqual({ 'pc-02': 'lead', coord: 'member', 'pc-head': 'member' });
  });

  it('수신함 판정 — 꺼진 부서로 간 쪽지 · 모르는 사번 · 3단계 쪽지 · 종류 없는 쪽지를 잡는다 (늘 통과하는 검사가 아니다)', () => {
    const facts: LaunchFacts = {
      people: {
        'on@example.invalid': { div: '켠실', active: true },
        'lead@example.invalid': { div: '켠실', active: true },
        'off@example.invalid': { div: '꺼진실', active: false },
      },
    };
    const to = (email: string, no = 'RH001') => ({ employeeNo: no, email, name: '가' });
    const ok = e2e.judgeLaunchSink(
      [
        { kind: 'deadline_10m', recipients: [to('on@example.invalid')] },
        { kind: 'merge_batch:1:u1', recipients: [to('lead@example.invalid')] },
        { kind: 'merge_approved:r1', recipients: [to('lead@example.invalid')], contents: 'Tincase에서 받아 취합게시판에 올려주세요.' },
      ],
      facts,
    );
    expect([ok.leaks, ok.unknown, ok.unlabeled, ok.stage3]).toEqual([[], [], [], []]);
    expect(ok.batchTo).toEqual(['lead@example.invalid']);
    expect(ok.approved).toHaveLength(1);
    expect(ok.counts).toEqual({ deadline_10m: 1, merge_batch: 1, merge_approved: 1 });

    const bad = e2e.judgeLaunchSink(
      [
        { kind: 'deadline_10m', recipients: [to('on@example.invalid'), to('off@example.invalid', 'RH002')] },
        { kind: 'ru_hq_ready', recipients: [to('on@example.invalid')] },
        { kind: 'merge_reapprove:r1', recipients: [to('on@example.invalid')] },
        { kind: '', subject: '종류 없음', recipients: [to('', 'RH999')] },
      ],
      facts,
    );
    expect(bad.leaks).toEqual(['deadline_10m → off@example.invalid (꺼진실)']);
    expect(bad.stage3).toEqual(['ru_hq_ready', 'merge_reapprove']);
    expect(bad.unlabeled).toEqual(['종류 없음']);
    expect(bad.unknown).toEqual([' → RH999']);
  });
});

