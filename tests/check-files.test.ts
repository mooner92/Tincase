// OPS-49 — 운영 파일 점검(`scripts/check-files.ts`). 운영 데이터에 돌리므로 지키는 것은 셋이다:
//   숫자만 찍는다(경로·이름·오류 문구 없음) · DB를 읽기 전용으로 연다 · 꺼진 부서 양식이 없는 것은 문제로 치지 않는다.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errorKey, sqliteFileOf, tally, verdict, type Tally } from '../scripts/lib/file-tally';

const root = path.resolve(__dirname, '..');

describe('[OPS-T36] 파일 점검 — 순수한 부분', () => {
  const files: Record<string, Buffer> = { 'a.hwp': Buffer.from('ok'), 'b.hwp': Buffer.from('bad') };
  const read = async (rel: string) => {
    const b = files[rel];
    if (!b) throw new Error(`ENOENT ${rel}`);
    return b;
  };
  const check = (buf: Buffer) => {
    if (buf.toString() === 'bad') throw Object.assign(new Error('홍길동 님의 문서 내용 /data/worklog/divisions/x'), { name: 'HwpFormatError', reason: 'not_ole' });
  };

  it('빈 경로는 세지 않고 · 없는 파일 · 읽힘 · 실패를 따로 센다', async () => {
    const t = await tally(['a.hwp', 'b.hwp', 'c.hwp', null, ''], read, check);
    expect(t).toEqual({ rows: 3, missing: 1, ok: 1, failed: 1, errors: { 'HwpFormatError:not_ole': 1 } });
  });

  it('양식은 부서 이름(꼬리표)을 붙일 수 있다 — 없거나 실패한 행만 · 꼬리표를 안 주면 이름 칸이 없다', async () => {
    const t = await tally(['a.hwp', 'b.hwp', 'c.hwp'], read, check, ['갑부서', '을부서', '병부서']);
    expect(t.problems).toEqual(['을부서', '병부서']);
    expect((await tally(['b.hwp'], read, check)).problems).toBeUndefined();
  });

  it('검사가 없으면 있는지만 본다', async () => {
    expect(await tally(['a.hwp', 'b.hwp', 'c.hwp'], read, null)).toEqual({ rows: 3, missing: 1, ok: 2, failed: 0, errors: {} });
  });

  it('오류는 이름·코드로만 묶는다 — 메시지(이름·경로·내용이 섞일 수 있다)는 버린다', () => {
    expect(errorKey(Object.assign(new Error('홍길동 /data/x'), { code: 'generate_failed' }))).toBe('Error:generate_failed');
    expect(errorKey(Object.assign(new Error('x'), { name: '이상한 이름', code: '코드 /경로' }))).toBe('Error');
    expect(errorKey('문자열')).toBe('unknown');
  });

  it('DATABASE_URL은 file:/절대 경로만', () => {
    expect(sqliteFileOf('file:/data/worklog/db/worklog.db')).toBe('/data/worklog/db/worklog.db');
    expect(sqliteFileOf('file:./dev.db')).toBeNull();
    expect(sqliteFileOf('file:/x.db?mode=ro')).toBeNull();
    expect(sqliteFileOf(undefined)).toBeNull();
  });

  it('종료 코드 — 없는 파일·실패는 1 · 꺼진 부서 양식(optional) 무리는 숫자만 보이고 넣지 않는다', () => {
    const t = (o: Partial<Tally>): Tally => ({ rows: 1, missing: 0, ok: 1, failed: 0, errors: {}, ...o });
    expect(verdict({ a: t({}), off: t({ missing: 1, ok: 0 }) }, ['off'])).toBe(0);
    expect(verdict({ a: t({}), off: t({ failed: 1, ok: 0 }) }, ['off'])).toBe(0);
    expect(verdict({ a: t({ missing: 1, ok: 0 }) }, ['off'])).toBe(1);
    expect(verdict({ a: t({ failed: 1, ok: 0 }) }, ['off'])).toBe(1);
  });
});

const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'check-files-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!hasSqlite)('[OPS-T36b] 파일 점검 — 실제로 돌려 본다 (sqlite3 · tsx)', () => {
  it('숫자만 찍고 · 문제가 있으면 종료 코드 1 · DB 파일은 그대로다', () => {
    const db = path.join(tmp, 'w.db');
    execFileSync('sqlite3', [
      db,
      `CREATE TABLE Division (id TEXT PRIMARY KEY, isActive INTEGER, nameKo TEXT);
       CREATE TABLE Submission (id TEXT, filePath TEXT, isLatest INTEGER);
       CREATE TABLE MergeRun (id TEXT, outputPath TEXT, status TEXT);
       CREATE TABLE Template (id TEXT, divisionId TEXT, filePath TEXT, isActive INTEGER);
       INSERT INTO Division VALUES ('on', 1, '켠부서'), ('off', 0, '꺼진부서');
       INSERT INTO Submission VALUES ('s1', 'divisions/On/개인이름-주간.hwp', 1), ('s2', 'divisions/On/사라진파일.hwp', 0);
       INSERT INTO MergeRun VALUES ('m1', NULL, 'succeeded'), ('m2', 'divisions/On/x.hwp', 'failed');
       INSERT INTO Template VALUES ('t1', 'off', 'divisions/Off/template/active.hwp', 1);`,
    ]);
    mkdirSync(path.join(tmp, 'divisions/On'), { recursive: true });
    writeFileSync(path.join(tmp, 'divisions/On/개인이름-주간.hwp'), 'hwp가 아님');
    const before = createHash('sha256').update(readFileSync(db)).digest('hex');

    const r = spawnSync('npx', ['tsx', 'scripts/check-files.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `file:${db}`, STORAGE_ROOT: tmp, CF_ACCESS_TEAM: '' },
      timeout: 60_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.status, out).toBe(1);
    expect(r.stdout).toContain('submission(최신): 1행 · 읽힘 0 · 파일 없음 0 · 실패 1');
    expect(r.stdout).toContain('submission(옛 판): 1행 · 읽힘 0 · 파일 없음 1 · 실패 0');
    expect(r.stdout).toContain('mergeRun(성공): 0행'); // 결과 파일이 없는 옛 실행 · 실패한 실행은 세지 않는다
    expect(r.stdout).toContain('template(꺼진 부서 · 있는지만): 1행 · 읽힘 0 · 파일 없음 1 · 실패 0');
    for (const leak of ['개인이름', '사라진파일', 'divisions/', tmp, '꺼진부서']) expect(out).not.toContain(leak); // 꺼진 부서 이름은 --all-templates일 때만
    expect(createHash('sha256').update(readFileSync(db)).digest('hex')).toBe(before);
  }, 90_000);

  it('--all-templates — 꺼진 부서 양식도 채워 보고, 그 무리는 종료 코드에 넣지 않는다', () => {
    const db = path.join(tmp, 'w2.db');
    execFileSync('sqlite3', [
      db,
      `CREATE TABLE Division (id TEXT PRIMARY KEY, isActive INTEGER);
       CREATE TABLE Submission (id TEXT, filePath TEXT, isLatest INTEGER);
       CREATE TABLE MergeRun (id TEXT, outputPath TEXT, status TEXT);
       CREATE TABLE Template (id TEXT, divisionId TEXT, filePath TEXT, isActive INTEGER);
       ALTER TABLE Division ADD COLUMN nameKo TEXT;
       INSERT INTO Division VALUES ('off', 0, '꺼진부서');
       INSERT INTO Template VALUES ('t1', 'off', 'divisions/Off/template/active.hwp', 1);`,
    ]);
    mkdirSync(path.join(tmp, 'divisions/Off/template'), { recursive: true });
    writeFileSync(path.join(tmp, 'divisions/Off/template/active.hwp'), 'hwp가 아님');
    const r = spawnSync('npx', ['tsx', 'scripts/check-files.ts', '--all-templates'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `file:${db}`, STORAGE_ROOT: tmp },
      timeout: 60_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/template\(꺼진 부서 · 웹 작성으로 채워 봄\): 1행 · 읽힘 0 · 파일 없음 0 · 실패 1 \(\w+:\w+ 1\)/);
    expect(r.stdout).toContain('  └ 부서: 꺼진부서'); // 어느 부서 양식을 다시 받을지 — 부서 이름만, 경로는 없다
    expect(r.stdout).not.toContain('divisions/');
  }, 90_000);

  it('DATABASE_URL이 절대 경로가 아니면 종료 코드 2', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/check-files.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'file:./dev.db', STORAGE_ROOT: tmp },
      timeout: 60_000,
    });
    expect(r.status).toBe(2);
  }, 90_000);
});
