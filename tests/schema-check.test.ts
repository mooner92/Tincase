// OPS-48 — 기동 스키마 검사. 배포에서 `prisma db push`를 빠뜨리면 서버가 **뜨지 않고** 무엇이 없는지 말한다.
//
// 2026-10-09 v2 전환 점검: 운영 main(v1.39.0) 스키마 DB에 이 판을 띄우면 health는 `ok:true`인데 화면은 모두 500,
// 병합 줄은 로그 오류만 남겼다(조용한 실패). 지키는 것:
//   ① 판정 — 없는 표 · 있는 표의 없는 열을 잡고, DB에만 있는 것(지난 판 · 옛 앱)은 문제로 치지 않는다
//   ② 기준 — 이 판의 Prisma 클라이언트에서 나온다. v2 전환으로 더해지는 표 7 · 열 6(DEPLOY.md §2b-5)이 모두 들어 있다
//   ③ 실제 DB — push한 DB는 모자람 0, 표 하나·열 하나를 지우면 그 둘을 이름으로 말한다
//   ④ 기동 — instrumentation이 회수·스케줄러보다 먼저 부르고, 모자라면 멈춘다(process.exit). push하면 다시 뜬다
//
// DB: prisma/test-schema.db — 이 파일 전용.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-schema-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-schema.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** v2 전환(main v1.39.0 → v2)으로 더해지는 것 — docs/DEPLOY.md §2b-5의 표와 같다 */
const V2_TABLES = ['ReportSubmission', 'RollupRun', 'OrgRollupSetting', 'OrgSection', 'OrgSectionUpload', 'MergeJob', 'GuideTourSeen'];
const V2_COLUMNS = [
  'Division.rollupOrder',
  'Division.rollupNote',
  'Division.rollupPageBreak',
  'Division.rollupSelf',
  'MergeReview.filePath',
  'MergeRun.outputSha',
];

beforeAll(() => {
  rmSync(path.join(ROOT, 'prisma/test-schema.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
}, 60_000);

afterAll(async () => {
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(STORAGE, { recursive: true, force: true });
  rmSync(path.join(ROOT, 'prisma/test-schema.db'), { force: true });
});

describe('[OPS-T35] 기동 스키마 검사 — push를 빠뜨리면 뜨지 않고, 무엇이 없는지 말한다', () => {
  it('① 판정 — 없는 표 · 없는 열을 잡는다. DB에만 있는 표·열은 문제가 아니다', async () => {
    const { schemaGaps } = await import('@/server/schema-check');
    const expected = new Map([
      ['A', ['id', 'x']],
      ['B', ['id']],
    ]);
    const actual = new Map([
      ['A', new Set(['id', 'old'])],
      ['Legacy', new Set(['id'])],
    ]);
    expect(schemaGaps(expected, actual)).toEqual({ tables: ['B'], columns: ['A.x'] });
    expect(schemaGaps(expected, new Map([['A', new Set(['id', 'x'])], ['B', new Set(['id', 'extra'])]]))).toEqual({ tables: [], columns: [] });
  });

  it('② 기준은 이 판의 클라이언트 — v2로 더해지는 표 7 · 열 6이 모두 있고, 관계 필드는 열이 아니다', async () => {
    const { expectedSchema } = await import('@/server/schema-check');
    const exp = expectedSchema();
    for (const t of V2_TABLES) expect(exp.has(t), t).toBe(true);
    for (const tc of V2_COLUMNS) {
      const [t, c] = tc.split('.');
      expect(exp.get(t), tc).toContain(c);
    }
    // 관계만 더해진 것(DEPLOY.md 「관계만 (열 없음)」)은 기대하지 않는다 — 기대하면 push한 DB에서도 「없는 열」이 된다
    expect(exp.get('Division')).not.toContain('reportSubmissions');
    expect(exp.get('Division')).not.toContain('users');
    expect(exp.get('User')).not.toContain('guideTours');
    // DEPLOY.md가 같은 목록을 적고 있다 — 표가 늘면 두 곳이 함께 늘어야 한다
    const deploy = read('docs/DEPLOY.md');
    for (const t of V2_TABLES) expect(deploy, t).toContain(t);
  });

  it('③ push한 DB는 모자람 0 — 표 하나 · 열 하나를 지우면 그 둘을 이름으로 말하고 할 일(db push)을 적는다', async () => {
    const { actualSchema, expectedSchema, schemaGaps, schemaGapMessage, schemaProblemAtBoot } = await import('@/server/schema-check');
    const { prisma } = await import('@/server/db');
    expect(schemaGaps(expectedSchema(), await actualSchema())).toEqual({ tables: [], columns: [] });
    expect(await schemaProblemAtBoot()).toBeNull();

    // 운영 main DB에 v2를 그대로 띄운 모양 — 병합 줄 표가 없고, 병합 실행의 sha 열이 없다
    await prisma.$executeRawUnsafe('DROP TABLE "MergeJob"');
    await prisma.$executeRawUnsafe('ALTER TABLE "MergeRun" DROP COLUMN "outputSha"');
    const gap = schemaGaps(expectedSchema(), await actualSchema());
    expect(gap).toEqual({ tables: ['MergeJob'], columns: ['MergeRun.outputSha'] });
    const msg = schemaGapMessage(gap)!;
    expect(msg).toContain('MergeJob');
    expect(msg).toContain('MergeRun.outputSha');
    expect(msg).toContain('prisma db push');
    expect(msg).toContain('OPS-48');
    expect(await schemaProblemAtBoot()).toBe(msg);
  });

  it('④ 기동 — instrumentation이 env 검사 뒤 · 회수와 스케줄러 앞에 부르고, 모자라면 멈춘다', () => {
    const src = read('src/instrumentation.ts');
    const at = (s: string) => {
      const i = src.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const check = at('.stopIfSchemaBehind()');
    expect(at("await import('./server/env')")).toBeLessThan(check);
    expect(check).toBeLessThan(at('recoverStaleMergeRuns('));
    expect(check).toBeLessThan(at('recoverMergeJobs('));
    expect(check).toBeLessThan(at('makeSchedulerTick()'));
    // 검사를 try로 감싸 삼키지 않는다 — 감싸면 「모자람」도 로그 한 줄로 끝난다(지금까지의 조용한 실패)
    const before = src.slice(at("await import('./server/env')"), check);
    expect(before).not.toMatch(/try \{/);
    // 멈추는 쪽은 모듈 안 — 모자라면 FATAL 한 줄 뒤 exit(1)
    const mod = read('src/server/schema-check.ts');
    const fn = mod.slice(mod.indexOf('export async function stopIfSchemaBehind'));
    expect(fn).toMatch(/if \(!problem\) return;/);
    expect(fn).toMatch(/\[boot\] FATAL/);
    expect(fn).toMatch(/process\.exit\(1\)/);
  });

  it('④′ stopIfSchemaBehind — 모자라면 FATAL을 찍고 exit(1), 맞으면 아무것도 하지 않는다', async () => {
    const { stopIfSchemaBehind } = await import('@/server/schema-check');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await stopIfSchemaBehind(); // ③에서 표 하나 · 열 하나를 지운 DB
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/^\[boot\] FATAL: .*MergeJob/s);
      exit.mockClear();
      execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' }); // 빠뜨린 push를 한다
      await stopIfSchemaBehind();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  }, 60_000);
});
