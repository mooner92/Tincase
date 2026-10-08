// HM-54 · NT-60 · TACP-30 — 「병합 점검」 요약: 마감 병합이 다 끝났는지, 문제없는지를 운영자와 기획조정실 담당에게 한 통으로.
//
// 병합 기록(MergeRun)과 줄(MergeJob)은 시험이 직접 만든다 — 여기서 보는 것은 병합이 아니라 「언제 · 누구에게 · 무엇을」이다.
// 메신저는 흉내 낸다(적기만 하고 아무에게도 보내지 않는다). 사람·부서 이름은 지어낸 것이다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-batch-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-batch.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_LINK_BASE = 'http://tincase.test';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 30_000 });

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

const msgr = vi.hoisted(() => ({ on: true, outbox: [] as { to: string; subject: string; contents: string; url?: string; at: number }[] }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => (msgr.on ? { enabled: true, reason: '', allow: '전원' } : { enabled: false, reason: 'MESSENGER_URL 미설정', allow: '' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string; url?: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, subject: input.subject, contents: input.contents, url: input.url, at: Date.now() });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

const MIN = 60_000;
/** 목 2026-10-15 14:00 KST — 기본 마감(목 14:00)인 주 */
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

let slotId = '';
let seq = 0;
/** 받는 사람 / 받지 않는 사람 (TACP-30) */
const P = {} as Record<'op' | 'coordLead' | 'coordHead' | 'coord' | 'otherLead' | 'otherHead' | 'member', { id: string; employeeNo: string; name: string }>;

async function db() {
  return (await import('@/server/db')).prisma;
}

async function mkDivision(name: string, subs = 1) {
  const prisma = await db();
  const n = ++seq;
  const div = await prisma.division.create({ data: { slug: `Batch_${n}`, nameKo: name, nameEn: `B${n}`, isActive: true, notifyEnabled: true } });
  const ids: string[] = [];
  for (let i = 0; i < subs; i++) {
    const u = await prisma.user.create({ data: { email: `b${n}-m${i}@test.local`, name: `제출${n}-${i}`, divisionId: div.id } });
    const s = await prisma.submission.create({
      data: { divisionId: div.id, userId: u.id, weekSlotId: slotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', uploadedAt: at(-60) },
    });
    ids.push(s.id);
  }
  return { div, submissionIds: ids };
}

/** 마감 뒤 성공 실행(최종본) — 파일까지 */
async function finalRun(divisionId: string, o: { sourceIds: string[]; finishedAt?: Date; tables?: unknown[]; badSha?: boolean; edited?: boolean }) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const { withEdit } = await import('@/server/merge/edits');
  const rel = `merged/${divisionId}.hwp`;
  await writeFileAtomic(rel, Buffer.from(`병합본 ${divisionId}`));
  const review = JSON.stringify({ model: { used: true, reason: null, tables: o.tables ?? [{ table: 'achievements', used: true, reason: null, kind: null }] } });
  return prisma.mergeRun.create({
    data: {
      divisionId,
      weekSlotId: slotId,
      status: 'succeeded',
      outputPath: rel,
      outputSha: o.badSha ? sha('다른 바이트') : sha(`병합본 ${divisionId}`),
      sourceIds: JSON.stringify(o.sourceIds),
      ruleSnapshot: '{}',
      reviewJson: o.edited ? withEdit(review, { by: '장 실장', role: 'head', at: at(3).toISOString(), places: 1 }) : review,
      startedAt: at(1),
      finishedAt: o.finishedAt ?? at(2),
    },
  });
}

async function failedRun(divisionId: string, startedAt: Date, errorText: string) {
  const prisma = await db();
  return prisma.mergeRun.create({
    data: { divisionId, weekSlotId: slotId, status: 'failed', sourceIds: '[]', ruleSnapshot: '{}', errorText, startedAt, finishedAt: startedAt },
  });
}

async function queuedJob(divisionId: string, orderKey: number, status: 'queued' | 'running' = 'queued') {
  const prisma = await db();
  return prisma.mergeJob.create({
    data: { divisionId, weekSlotId: slotId, trigger: 'auto', orderKey, status, enqueuedAt: at(1), ...(status === 'running' && { startedAt: at(1), leaseUntil: at(30), attempt: 1 }) },
  });
}

const to = (k: keyof typeof P) => msgr.outbox.filter((m) => m.to === P[k].employeeNo);

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-batch.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const { ensureCurrentSlot } = await import('@/server/worklog');
  slotId = (await ensureCurrentSlot(D)).id;

  // 기획조정실 = 총괄(isCoordinator)이 있는 부서. 이름으로 찾지 않는다 — 여기서는 일부러 다른 이름이다
  const coordDiv = await prisma.division.create({ data: { slug: 'Batch_coord', nameKo: '조정실', nameEn: 'Coord', isActive: false } });
  const opsDiv = await prisma.division.create({ data: { slug: 'Batch_ops', nameKo: '운영실', nameEn: 'Ops', isActive: false } });
  const other = await prisma.division.create({ data: { slug: 'Batch_other', nameKo: '다른실', nameEn: 'Other', isActive: false } });
  const mk = async (key: keyof typeof P, divisionId: string, extra: Record<string, unknown>, no: string) => {
    const u = await prisma.user.create({ data: { email: `${key}@test.local`, name: `이름${no}`, divisionId, employeeNo: no, ...extra } });
    P[key] = { id: u.id, employeeNo: no, name: u.name };
  };
  await mk('op', opsDiv.id, { isOperator: true, divisionRole: 'lead' }, '6001');
  await mk('coord', coordDiv.id, { isCoordinator: true }, '6002');
  await mk('coordLead', coordDiv.id, { divisionRole: 'lead' }, '6003');
  await mk('coordHead', coordDiv.id, { divisionRole: 'head' }, '6004');
  await mk('otherLead', other.id, { divisionRole: 'lead' }, '6005');
  await mk('otherHead', other.id, { divisionRole: 'head' }, '6006');
  await mk('member', coordDiv.id, {}, '6007');
}, 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(1));
  msgr.on = true;
  msgr.outbox.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const prisma = await db();
  // 각 시험은 자기 묶음만 — 앞 시험의 부서 · 줄 · 기록은 치운다
  await prisma.division.updateMany({ where: { slug: { startsWith: 'Batch_' }, NOT: { slug: { in: ['Batch_coord', 'Batch_ops', 'Batch_other'] } } }, data: { isActive: false } });
  await prisma.mergeJob.deleteMany({});
  await prisma.notifyLog.deleteMany({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.MERGE_PAUSE_UNTIL;
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('HM-54 「병합 점검」 요약 — 언제 · 누구에게', () => {
  it('[HM-T169] ★ 줄이 비는 순간(+15분 전이면) 한 통 — 다 끝났으면 그것으로 끝, 다시 보내지 않는다 · [HM-T171] 받는 사람은 운영자와 기획조정실 담당뿐', async () => {
    const { runDueMergeBatchNotices } = await import('@/server/notify/merge-batch');
    const a = await mkDivision('가실');
    const b = await mkDivision('나실', 2);
    await finalRun(a.div.id, { sourceIds: a.submissionIds, finishedAt: at(2) });
    await queuedJob(b.div.id, 1, 'running');

    vi.setSystemTime(at(4));
    expect(await runDueMergeBatchNotices(at(4))).toEqual([]); // 줄이 아직 돈다
    expect(msgr.outbox).toHaveLength(0);

    const prisma = await db();
    await prisma.mergeJob.updateMany({ data: { status: 'done', finishedAt: at(6) } });
    await finalRun(b.div.id, { sourceIds: b.submissionIds, finishedAt: at(6) });
    vi.setSystemTime(at(6));
    const r = await runDueMergeBatchNotices(at(6));
    expect(r).toEqual([{ kind: 'merge_batch', deadline: D, sent: 2, targets: 2 }]);
    // TACP-30 — 운영자 · 기획조정실 담당(총괄이 있는 부서의 lead)만. 그 부서장 · 총괄 본인 · 다른 부서 lead · head · 부서원은 받지 않는다
    expect(msgr.outbox.map((m) => m.to).sort()).toEqual([P.op.employeeNo, P.coordLead.employeeNo].sort());
    for (const k of ['coord', 'coordHead', 'otherLead', 'otherHead', 'member'] as const) expect(to(k)).toHaveLength(0);
    expect(to('op')[0].subject).toBe('[Tincase] 병합 점검 14:06 · 2/2 끝');
    // 링크는 운영자에게만 — 기획조정실 담당은 「병합 줄」 화면을 열 수 없다
    expect(to('op')[0].url).toBe('http://tincase.test/ops');
    expect(to('coordLead')[0].url).toBeUndefined();

    // 다 끝난 첫 통 뒤에는 아무것도 없다 — +15분에도 「완료」도
    for (const m of [7, 15, 30]) {
      vi.setSystemTime(at(m));
      expect(await runDueMergeBatchNotices(at(m))).toEqual([]);
    }
    expect(msgr.outbox).toHaveLength(2);
    // NT-T90 — 기록은 사람마다, 그 사람의 부서로
    const logs = await prisma.notifyLog.findMany({ where: { kind: { startsWith: 'merge_batch' } }, orderBy: { kind: 'asc' } });
    expect(logs.map((l) => l.kind).sort()).toEqual([`merge_batch:${D.getTime()}:${P.op.id}`, `merge_batch:${D.getTime()}:${P.coordLead.id}`].sort());
  });

  it('[HM-T169] ★ 남은 부서가 있으면 +15분에 목록과 예상 끝 — 다 끝나는 순간 「완료」 한 통 더 · 한 기준 시각에 사람마다 많아야 두 통', async () => {
    const prisma = await db();
    const { runDueMergeBatchNotices } = await import('@/server/notify/merge-batch');
    const a = await mkDivision('다실');
    const b = await mkDivision('라실');
    const c = await mkDivision('마실');
    await finalRun(a.div.id, { sourceIds: a.submissionIds, finishedAt: at(3) });
    await queuedJob(c.div.id, 1, 'running');
    await queuedJob(b.div.id, 2);

    vi.setSystemTime(at(14));
    expect(await runDueMergeBatchNotices(at(14))).toEqual([]);
    vi.setSystemTime(at(15));
    expect((await runDueMergeBatchNotices(at(15))).map((r) => r.kind)).toEqual(['merge_batch']);
    const first = to('op')[0];
    expect(first.subject).toBe('[Tincase] 병합 점검 14:15 · 1/3 끝 · 2곳 남음');
    expect(first.contents).toContain('1/3 끝 · 모델 사용 1 · 모델 못 씀 0 · 실패 0 · 보류 0 · 대기 2');
    expect(first.contents).toContain('예상 끝 14:');
    expect(first.contents).toContain('· 마실 — 병합 중');
    expect(first.contents).toContain('· 라실 — 대기 2번째');

    // 아직 남았다 — 「완료」는 없다
    vi.setSystemTime(at(16));
    expect(await runDueMergeBatchNotices(at(16))).toEqual([]);

    // 둘이 끝난다
    await prisma.mergeJob.updateMany({ data: { status: 'done', finishedAt: at(20) } });
    await finalRun(b.div.id, { sourceIds: b.submissionIds, finishedAt: at(19) });
    await finalRun(c.div.id, { sourceIds: c.submissionIds, finishedAt: at(20) });
    vi.setSystemTime(at(20));
    expect((await runDueMergeBatchNotices(at(20))).map((r) => r.kind)).toEqual(['merge_batch_done']);
    const done = to('coordLead').at(-1)!;
    expect(done.subject).toBe('[Tincase] 병합 점검 완료 14:20 · 3/3 끝');
    expect(done.contents).toContain('마지막 끝 14:20:00');

    for (const m of [21, 40, 120]) {
      vi.setSystemTime(at(m));
      expect(await runDueMergeBatchNotices(at(m))).toEqual([]);
    }
    expect(to('op')).toHaveLength(2);
    expect(to('coordLead')).toHaveLength(2);
  });

  it('[HM-T169] 메신저가 꺼져 있으면 아무것도 안 나가고 기록도 없다 · 일시정지(HM-44) 중이면 스케줄러가 판정하지 않는다 · 대외 마감(+60분)이 지나면 첫 통은 없다', async () => {
    const prisma = await db();
    const { runDueMergeBatchNotices } = await import('@/server/notify/merge-batch');
    const { runMergeNotices } = await import('@/server/scheduler');
    const a = await mkDivision('바실');
    await finalRun(a.div.id, { sourceIds: a.submissionIds });

    msgr.on = false;
    vi.setSystemTime(at(5));
    expect(await runDueMergeBatchNotices(at(5))).toEqual([]);
    expect(await prisma.notifyLog.count()).toBe(0);
    msgr.on = true;

    process.env.MERGE_PAUSE_UNTIL = at(30).toISOString();
    await runMergeNotices();
    expect(msgr.outbox).toHaveLength(0);
    delete process.env.MERGE_PAUSE_UNTIL;

    vi.setSystemTime(at(61));
    expect(await runDueMergeBatchNotices(at(61))).toEqual([]);
    expect(msgr.outbox).toHaveLength(0);

    // 그 전이면 스케줄러의 판정 그대로 나간다
    vi.setSystemTime(at(59));
    await runMergeNotices();
    expect(to('op')).toHaveLength(1);
  });
});

describe('HM-54e·f 「병합 점검」 요약 — 무엇을', () => {
  it('[HM-T170] ★ 표별 폴백 사유 · 파일 ≠ 기록 · 늦게 낸 사람 · 실패(다음 재시도) · 보류 · 제출 없음 — 사람 이름 · 문서 내용은 없다', async () => {
    const { runDueMergeBatchNotices, mergeBatchReport } = await import('@/server/notify/merge-batch');
    const { HELD_TEXT } = await import('@/server/merge/edits');
    const fb = await mkDivision('폴백실');
    const bad = await mkDivision('어긋남실');
    const late = await mkDivision('늦음실', 2);
    const fail = await mkDivision('실패실');
    const held = await mkDivision('보류실');
    const none = await mkDivision('빈실', 0);
    await finalRun(fb.div.id, {
      sourceIds: fb.submissionIds,
      tables: [
        { table: 'achievements', used: false, reason: '모델 호출 시간 초과 (2번 시도)', kind: 'timeout' },
        { table: 'plans', used: true, reason: null, kind: null },
        { table: 'notes', used: false, reason: '묶을 행 없음', kind: 'skipped' },
        { table: 'categories', used: false, reason: '병합 시간 예산 초과', kind: 'budget' },
      ],
    });
    await finalRun(bad.div.id, { sourceIds: bad.submissionIds, badSha: true });
    await finalRun(late.div.id, { sourceIds: late.submissionIds.slice(0, 1) });
    await failedRun(fail.div.id, at(1.5), '표 개수가 달라졌습니다 (3 → 2)');
    await failedRun(held.div.id, at(2), HELD_TEXT);

    const { ensureCurrentSlot } = await import('@/server/worklog');
    const prisma = await db();
    const slot = await ensureCurrentSlot(D);
    const divisions = await prisma.division.findMany({ where: { id: { in: [fb, bad, late, fail, held, none].map((x) => x.div.id) } }, orderBy: { nameKo: 'asc' } });
    const report = await mergeBatchReport(slot, D, divisions, at(3));
    expect(report).toMatchObject({ total: 5, done: 4, left: 1, drained: true, complete: false });
    expect(report.counts).toEqual({ used: 2, fallback: 1, failed: 1, held: 1, waiting: 0, nothing: 1 });

    vi.setSystemTime(at(3));
    await runDueMergeBatchNotices(at(3));
    const m = to('op')[0];
    expect(m.subject).toBe('[Tincase] 병합 점검 14:03 · 4/5 끝 · 1곳 남음');
    expect(m.contents).toContain('4/5 끝 · 모델 사용 2 · 모델 못 씀 1 · 실패 1 · 보류 1 · 대기 0 · 제출 없음 1');
    expect(m.contents).toContain('· 폴백실 — 실적 중복 묶기 못 함(시간 초과)');
    expect(m.contents).toContain('· 폴백실 — 분류 못 함(시간 예산 초과)');
    expect(m.contents).not.toContain('특이 중복 묶기'); // 부르지 않은 표(skipped)는 문제가 아니다
    expect(m.contents).toContain('· 어긋남실 — 파일이 기록과 다름');
    expect(m.contents).toContain('· 늦음실 — 늦게 낸 1명 빠짐');
    expect(m.contents).toContain('· 실패실 — 실패 — 다음 재시도 14:02 (표 개수가 달라졌습니다 (3 → 2))');
    expect(m.contents).toContain('· 보류실 — 보류 — 병합하는 동안 고친 판을 덮지 않음');
    // 사람 이름은 받는 사람 자신의 것뿐이다 — 제출자 · 고친 사람 이름이 없다
    expect(m.contents).not.toMatch(/제출\d|장 실장/);
    expect(m.contents.startsWith(`[${P.op.employeeNo}]${P.op.name}님 `)).toBe(true);
  });
});
