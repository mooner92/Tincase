// OPS-52 · NT-12 — **쓰기가 막힌 날**(2026-11-25 사고의 재현).
//
// 그날: 호스트의 취약점 조치가 데이터 폴더의 주인을 root로 바꿨다. 앱은 열어 둔 파일로 읽기는 계속 됐고 쓰기만 실패했다
// (SQLite 1032 「attempt to write a readonly database」). 마감 전 알림이 「보냈음」을 적지 못해 1분마다 다시 나갔다 — 8번 × 9명.
//
// 여기서는 같은 조건을 만든다: DB를 연 뒤 그 폴더를 못 들어가게(0000) 한다. 그 상태에서
//   ① 쓰기 탐침이 `readonly`로 잡는다(읽기는 된다)                                   [OPS-T43]
//   ② 마감 전 알림은 한 통도 나가지 않는다 — 기록을 먼저 잡고 보낸다                   [NT-T94]
//   ③ 스케줄러 주기는 통째로 건너뛰고, 운영자에게 **한 번만** 알린다(6시간 뒤 다시)    [OPS-T44]
//   ④ 풀리면 알림이 한 번 나가고(되풀이 없음) 표식이 지워진다                          [OPS-T44]
// 메신저는 흉내 낸다. 사람·부서 이름은 지어낸 것이다. root로 돌리면 폴더 권한이 통하지 않아 건너뛴다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(tmpdir(), 'repman-wb-'));
const DB_DIR = path.join(TMP, 'db');
mkdirSync(DB_DIR);
mkdirSync(path.join(TMP, 'storage'));
mkdirSync(path.join(TMP, 'tmp'));
(process.env as Record<string, string>).NODE_ENV = 'test';
// 연결 하나 — 「이미 열어 둔 파일」이 그날의 조건이다(새로 여는 연결은 폴더가 막히면 열리지도 않는다)
process.env.DATABASE_URL = `file:${DB_DIR}/test.db?connection_limit=1`;
process.env.STORAGE_ROOT = path.join(TMP, 'storage');
process.env.TMPDIR = path.join(TMP, 'tmp'); // 운영자 알림 표식 파일(os.tmpdir())을 이 시험만의 폴더에
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 30_000 });

const msgr = vi.hoisted(() => ({ outbox: [] as { to: string; kind?: string; subject: string }[], enabled: true }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: msgr.enabled, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; kind?: string; subject: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, kind: input.kind, subject: input.subject });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

const isRoot = process.getuid?.() === 0;
/** 수 2026-11-25 11:46 KST — 목 14:00 마감의 「하루 전 알림」(11:45) 창 안 */
const NOW = new Date('2026-11-25T11:46:00+09:00');
const MIN = 60_000;
const block = () => chmodSync(DB_DIR, 0o000);
const unblock = () => chmodSync(DB_DIR, 0o700);
const of = (kind: string) => msgr.outbox.filter((m) => m.kind === kind);

async function db() {
  return (await import('@/server/db')).prisma;
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const d = await prisma.division.create({ data: { slug: 'WB_Div', nameKo: '가나실', nameEn: 'WB', isActive: true, notifyEnabled: true } });
  await prisma.template.create({ data: { divisionId: d.id, filePath: 'x', sha256: 'x', version: 1, uploadedBy: 'seed' } });
  // 운영자 — 집계 대상이 아니라(onRoster false) 마감 전 알림은 받지 않는다
  await prisma.user.create({ data: { email: 'op@test.local', name: '운영자', divisionId: d.id, isOperator: true, employeeNo: 'OP1', onRoster: false } });
  await prisma.user.create({ data: { email: 'm1@test.local', name: '부서원', divisionId: d.id, employeeNo: 'M1' } });
  await prisma.user.create({ data: { email: 'm2@test.local', name: '부서원둘', divisionId: d.id, employeeNo: 'M2' } });
  const { ensureCurrentSlot } = await import('@/server/worklog');
  await ensureCurrentSlot(NOW);
}, 60_000);

beforeEach(async () => {
  unblock();
  msgr.outbox.length = 0;
  msgr.enabled = true;
  const { resetWriteGuardForTest } = await import('@/server/write-guard');
  resetWriteGuardForTest();
  await (await db()).notifyLog.deleteMany({});
});

afterAll(() => {
  vi.useRealTimers();
  try {
    unblock();
  } catch {
    /* 이미 지워졌다 */
  }
  rmSync(TMP, { recursive: true, force: true });
});

describe('OPS-52 쓰기 탐침', () => {
  it('[OPS-T43] 평소에는 ok — 남는 것이 없다(user_version 그대로 · 저널 파일 없음)', async () => {
    const prisma = await db();
    const { probeDbWrite } = await import('@/server/db-write');
    const before = await prisma.$queryRawUnsafe<{ user_version: number | bigint }[]>('PRAGMA user_version');
    expect(await probeDbWrite()).toEqual({ ok: true });
    expect(await probeDbWrite()).toEqual({ ok: true });
    const after = await prisma.$queryRawUnsafe<{ user_version: number | bigint }[]>('PRAGMA user_version');
    expect(Number(after[0].user_version)).toBe(Number(before[0].user_version));
    expect(readdirSync(DB_DIR).filter((f) => f.includes('journal'))).toEqual([]);
  });

  it.skipIf(isRoot)('[OPS-T43] ★ 폴더가 막히면 읽기는 되고 탐침은 readonly — 풀면 다시 ok', async () => {
    const prisma = await db();
    const { probeDbWrite } = await import('@/server/db-write');
    await prisma.division.count(); // 연결을 열어 둔다
    block();
    try {
      expect(await prisma.division.count()).toBe(1); // 읽기는 된다 — 그래서 `SELECT 1`로는 보이지 않았다
      const r = await probeDbWrite();
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ kind: 'readonly' });
      expect((r as { error: string }).error).toContain('readonly');
    } finally {
      unblock();
    }
    expect(await probeDbWrite()).toEqual({ ok: true });
  });

  it('[OPS-T43] 오류 원문 → 종류 · 잠김·시간 초과는 고장이 아니다', async () => {
    const { classifyWriteError } = await import('@/server/db-write');
    expect(classifyWriteError('Raw query failed. Code: `1032`. Message: `attempt to write a readonly database`')).toBe('readonly');
    expect(classifyWriteError('database or disk is full')).toBe('full');
    expect(classifyWriteError('disk I/O error')).toBe('io');
    expect(classifyWriteError('Error code 14: Unable to open the database file')).toBe('open');
    expect(classifyWriteError('database is locked')).toBe('busy');
    expect(classifyWriteError('Transaction API error: Unable to start a transaction in the given time.')).toBe('busy');
    expect(classifyWriteError('something else')).toBe('other');
  });

  it.skipIf(isRoot)('[OPS-T43] health — 평소 dbWrite ok · 막히면 503에 `fail: readonly`(원문은 싣지 않는다)', async () => {
    const { GET } = await import('@/app/api/health/route');
    const fine = await (await GET()).json();
    expect(fine.checks.dbWrite).toBe('ok');
    await (await db()).division.count();
    block();
    try {
      const res = await GET();
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.checks.db).toBe('ok'); // 읽기 검사는 그날도 통과했다
      expect(body.checks.dbWrite).toBe('fail: readonly');
      expect(JSON.stringify(body)).not.toContain('attempt to write');
    } finally {
      unblock();
    }
  });
});

describe('NT-12 기록을 먼저 잡고 보낸다', () => {
  it.skipIf(isRoot)('[NT-T94] ★ 쓰기가 막힌 채 마감 전 알림을 여러 번 판정해도 한 통도 나가지 않는다 (그날은 주기마다 다시 나갔다)', async () => {
    const { runDueReminders } = await import('@/server/notify/deadline-reminder');
    await (await db()).division.count();
    block();
    try {
      for (let k = 0; k < 4; k++) {
        await expect(runDueReminders(new Date(NOW.getTime() + k * MIN))).rejects.toThrow(/readonly/);
      }
      expect(msgr.outbox).toEqual([]);
    } finally {
      unblock();
    }
  });

  it('[NT-T94] 평소 — 미제출자에게 한 번, 다음 주기에는 다시 보내지 않는다 · 기록에 받은 사람이 남는다', async () => {
    const { runDueReminders } = await import('@/server/notify/deadline-reminder');
    const first = await runDueReminders(NOW);
    expect(first.map((r) => [r.kind, r.sent, r.targets])).toEqual([['deadline_1d', 2, 2]]);
    expect(await runDueReminders(new Date(NOW.getTime() + MIN))).toEqual([]);
    expect(of('deadline_1d').map((m) => m.to).sort()).toEqual(['M1', 'M2']);
    const rows = await (await db()).notifyLog.findMany({});
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].recipients).sort()).toEqual(['M1', 'M2']);
    expect(JSON.parse(rows[0].detail!)).toMatchObject({ targets: 2 });
    expect(JSON.parse(rows[0].detail!).claimed).toBeUndefined(); // 잡아 둔 표시는 보낸 뒤 지워진다
  });

  it('[NT-T94] 누가 이미 잡았으면(보내는 중) 보내지 않는다 · 아무에게도 못 보냈으면 잡은 줄을 놓아 다음 주기가 다시 시도한다', async () => {
    const prisma = await db();
    const { runDueReminders } = await import('@/server/notify/deadline-reminder');
    const { claimNotice } = await import('@/server/notify/claim');
    const d = await prisma.division.findFirstOrThrow({});
    const slot = await prisma.weekSlot.findFirstOrThrow({});
    const held = await claimNotice(d.id, slot.id, 'deadline_1d');
    expect(held).toBeTruthy();
    expect(await runDueReminders(NOW)).toEqual([]);
    expect(msgr.outbox).toEqual([]);
    await prisma.notifyLog.deleteMany({});

    // 메신저가 잠깐 죽었다 — 아무에게도 못 감 → 줄이 남지 않는다 → 다음 주기에 나간다
    const messenger = await import('@/server/messenger');
    const spy = vi.spyOn(messenger, 'sendAlert').mockResolvedValue({ requested: 1, sent: [], blocked: [], disabled: false, errors: ['down'] } as never);
    await runDueReminders(NOW);
    expect(await prisma.notifyLog.count()).toBe(0);
    spy.mockRestore();
    await runDueReminders(new Date(NOW.getTime() + MIN));
    expect(of('deadline_1d')).toHaveLength(2);
  });

  it('[NT-T94] 알림 기록을 만드는 곳은 claim.ts 하나다 — 「보내고 → 기록」이 다시 생기지 않게', async () => {
    const { readFileSync } = await import('node:fs');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
    const root = path.resolve(__dirname, '../src');
    const hits = walk(root)
      .filter((f) => /notifyLog\s*\.\s*(create|createMany|upsert)\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual(['server/notify/claim.ts']);
  });
});

describe('OPS-52 스케줄러의 문 — 막히면 건너뛰고 운영자에게 한 번', () => {
  it.skipIf(isRoot)('[OPS-T44] ★ 그날의 재현 — 막힌 동안 주기를 돌려도 마감 전 알림 0통 · 운영자 알림 1통 · 풀리면 알림이 한 번 나간다', async () => {
    const { makeSchedulerTick } = await import('@/server/scheduler');
    const latch = path.join(process.env.TMPDIR!, 'tincase-write-alert');
    await (await db()).division.count();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      block();
      const tick = makeSchedulerTick();
      for (let k = 0; k < 5; k++) {
        vi.setSystemTime(new Date(NOW.getTime() + k * MIN));
        await tick();
      }
      expect(of('deadline_1d')).toEqual([]);
      expect(of('write_blocked').map((m) => m.to)).toEqual(['OP1']);
      expect(of('write_blocked')[0].subject).toContain('저장이 안 돼요');
      expect(existsSync(latch)).toBe(true);

      // 프로세스가 다시 떠도(메모리 초기화) 표식 파일이 있어 되풀이하지 않는다
      vi.resetModules();
      const again = (await import('@/server/scheduler')).makeSchedulerTick();
      await (await db()).division.count();
      vi.setSystemTime(new Date(NOW.getTime() + 5 * MIN));
      await again();
      expect(of('write_blocked')).toHaveLength(1);

      // 풀린다 — 창 안이면 알림이 한 번 나가고, 표식이 지워진다
      unblock();
      vi.setSystemTime(new Date(NOW.getTime() + 6 * MIN));
      await again();
      vi.setSystemTime(new Date(NOW.getTime() + 7 * MIN));
      await again();
      expect(of('deadline_1d').map((m) => m.to).sort()).toEqual(['M1', 'M2']);
      expect(existsSync(latch)).toBe(false);
      expect(of('write_blocked')).toHaveLength(1);
    } finally {
      unblock();
      vi.useRealTimers();
    }
  });

  it('[OPS-T44] 같은 고장은 6시간에 한 번 · 메신저가 꺼져 있어도 막는다 · 검사가 죽으면 막지 않는다', async () => {
    const { guardWrites, WRITE_ALERT_EVERY_MS } = await import('@/server/write-guard');
    const down = async () => ({ ok: false as const, what: 'db' as const, reason: 'attempt to write a readonly database' });
    const t0 = NOW.getTime();
    expect(await guardWrites(new Date(t0), down)).toBe(true);
    expect(await guardWrites(new Date(t0 + 5 * MIN), down)).toBe(true);
    expect(await guardWrites(new Date(t0 + WRITE_ALERT_EVERY_MS - MIN), down)).toBe(true);
    expect(of('write_blocked')).toHaveLength(1);
    expect(await guardWrites(new Date(t0 + WRITE_ALERT_EVERY_MS + MIN), down)).toBe(true);
    expect(of('write_blocked')).toHaveLength(2);

    // 풀렸다가 다시 막히면 새 고장이다 — 바로 알린다
    expect(await guardWrites(new Date(t0 + WRITE_ALERT_EVERY_MS + 2 * MIN), async () => ({ ok: true as const }))).toBe(false);
    expect(await guardWrites(new Date(t0 + WRITE_ALERT_EVERY_MS + 3 * MIN), async () => ({ ok: false as const, what: 'storage' as const, reason: '저장소' }))).toBe(true);
    expect(of('write_blocked')).toHaveLength(3);

    msgr.outbox.length = 0;
    msgr.enabled = false;
    const { resetWriteGuardForTest } = await import('@/server/write-guard');
    resetWriteGuardForTest();
    expect(await guardWrites(new Date(t0), down)).toBe(true);
    expect(msgr.outbox).toEqual([]);

    expect(
      await guardWrites(new Date(t0), async () => {
        throw new Error('probe broke');
      }),
    ).toBe(false);
  });

  it('[OPS-T44] 주기의 순서 — 쓰기 확인이 마감 전 알림보다 먼저다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(path.resolve(__dirname, '../src/server/scheduler.ts'), 'utf8');
    const guard = src.indexOf('if (await guardWrites()) return;');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf('await runReminders();'));
  });
});
