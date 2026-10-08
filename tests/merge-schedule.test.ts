// HM-49 · HM-50 · NT-51 — 마감 뒤 스케줄러가 **무엇을 언제** 하는가.
//
// 시계를 돌려 본다: Date만 가짜로 바꾸고(타이머는 그대로), 병합 본체는 「부서당 100초 걸리는 모델」로 흉내 낸다.
// 메신저도 흉내 낸다 — 누구에게 몇 시에 무엇이 갔는지를 기록할 뿐 아무에게도 보내지 않는다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-sched-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-sched.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
delete process.env.DEV_IDENTITY;

/** 보낸 알림 — 받은 사번 · 제목 · 본문 · 그때 시각 */
const outbox = vi.hoisted(() => [] as { to: string; subject: string; contents: string; at: number }[]);
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: true, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string }) => {
    for (const to of input.recvIds) outbox.push({ to, subject: input.subject, contents: input.contents, at: Date.now() });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

/** 병합 한 번에 걸리는 시간 — GPU가 붐비는 목요일 (모델 호출 2번 × 50초) */
const MERGE_MS = vi.hoisted(() => ({ value: 100_000 }));
const runMergeMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/merge/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/merge/index')>()),
  runMerge: runMergeMock,
}));

const MIN = 60_000;
/** 목 2026-10-15 14:00 KST — 기본 마감(목 14:00)인 주 */
const D = new Date('2026-10-15T14:00:00+09:00');
const at = (minutes: number) => new Date(D.getTime() + minutes * MIN);

let slotId = '';
let seq = 0;

async function mkDivision(name: string, opts: { notify?: boolean } = {}) {
  const { prisma } = await import('@/server/db');
  const n = ++seq;
  const div = await prisma.division.create({
    data: { slug: `Sched_${n}`, nameKo: name, nameEn: `S${n}`, isActive: true, notifyEnabled: opts.notify ?? true },
  });
  const head = await prisma.user.create({
    data: { email: `s${n}-head@test.kei.re.kr`, name: `장${n}`, divisionId: div.id, divisionRole: 'head', jobTitle: '실장', employeeNo: `9${n}01` },
  });
  const lead = await prisma.user.create({
    data: { email: `s${n}-lead@test.kei.re.kr`, name: `담${n}`, divisionId: div.id, divisionRole: 'lead', employeeNo: `9${n}02` },
  });
  const member = await prisma.user.create({ data: { email: `s${n}-m@test.kei.re.kr`, name: `원${n}`, divisionId: div.id } });
  return { div, head, lead, member };
}

async function submit(divisionId: string, userId: string, uploadedAt: Date) {
  const { prisma } = await import('@/server/db');
  return prisma.submission.create({
    data: { divisionId, userId, weekSlotId: slotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', uploadedAt },
  });
}

/** 마감 뒤 만든 최종본. `edited`면 부서장이 고친 기록이 붙는다 (HM-49) */
async function finalRun(divisionId: string, startedAt: Date, sourceIds: string[], edited: boolean) {
  const { prisma } = await import('@/server/db');
  const { withEdit } = await import('@/server/merge/edits');
  return prisma.mergeRun.create({
    data: {
      divisionId,
      weekSlotId: slotId,
      status: 'succeeded',
      outputPath: 'm.hwp',
      sourceIds: JSON.stringify(sourceIds),
      ruleSnapshot: '{}',
      startedAt,
      finishedAt: new Date(startedAt.getTime() + MIN),
      reviewJson: edited ? withEdit(null, { by: '장 실장', role: 'head', at: at(12).toISOString(), places: 3 }) : null,
    },
  });
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-sched.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { ensureCurrentSlot } = await import('@/server/worklog');
  slotId = (await ensureCurrentSlot(D)).id;

  runMergeMock.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + MERGE_MS.value); // 모델이 그만큼 걸린다
    return {
      outputRelPath: 'm.hwp',
      output: Buffer.from('m'), // 2026-10-08 결정 c — 엔진은 쓰지 않고 바이트만 돌려준다(쓰기는 runMergeRecorded가 잠금 안에서)
      bytes: 1,
      rowCounts: { achievements: 1, plans: 1, notes: 0 },
      mergedGroups: [],
      warnings: [],
      model: { used: true, reason: null, elapsedMs: MERGE_MS.value, name: 'mock' },
      categories: null,
      sourceIds: [],
      missing: [],
      rowAuthors: { achievements: [], plans: [], notes: [] },
      flagged: [],
    };
  });
}, 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  outbox.length = 0;
  runMergeMock.mockClear();
  // 각 테스트는 자기 부서만 본다 — 앞 테스트의 부서는 끈다
  const { prisma } = await import('@/server/db');
  await prisma.division.updateMany({ data: { isActive: false } });
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('HM-49 · NT-51 마감 열기가 닫힌 뒤 — 사람이 고친 최종본은 자동으로 덮지 않는다', () => {
  it('[HM-T137] ★ 14:10 실장 수정 → 마감 열기 → 닫힘: 다시 병합하지 않고, 늦게 낸 사람이 있으면 담당자에게 한 번 알린다', async () => {
    const { prisma } = await import('@/server/db');
    const { runDueMerges } = await import('@/server/merge/run');
    const { div, lead, head, member } = await mkDivision('보류실');
    const s1 = await submit(div.id, member.id, at(-60));
    await finalRun(div.id, at(1), [s1.id], true); // 14:01 최종본 → 14:12 실장이 고쳐 저장
    // 14:20 담당자가 마감을 연다 → 14:50 닫힘. 그 사이 담당자 본인이 늦게 낸다
    await prisma.slotOpening.create({ data: { divisionId: div.id, weekSlotId: slotId, openUntil: at(50), openedBy: '담당' } });
    await submit(div.id, lead.id, at(30));

    vi.setSystemTime(at(51));
    const r = await runDueMerges(at(51));
    expect(r.ran).toBe(0);
    expect(runMergeMock).not.toHaveBeenCalled(); // 실장 수정이 그대로 남는다
    expect(await prisma.mergeRun.count({ where: { divisionId: div.id } })).toBe(1);

    // 담당자에게만, 사실 → 할 일 → 그 대가
    expect(outbox.map((m) => m.to)).toEqual([lead.employeeNo]);
    expect(outbox[0].to).not.toBe(head.employeeNo);
    expect(outbox[0].subject).toContain('늦게 낸 1명이 빠져 있어요');
    expect(outbox[0].contents).toContain('마감 열기가 끝났어요. 병합본을 만든 뒤에 1명이 더 냈는데 지금 병합본에는 빠져 있어요.');
    expect(outbox[0].contents).toContain('장 실장님이 병합본을 3곳 고쳐서 자동으로 다시 병합하지 않았어요');
    expect(outbox[0].contents).toContain('[다시 병합]');
    expect(outbox[0].contents).toContain('다시 병합하면 고친 내용은 사라져요');
    expect(await prisma.notifyLog.count({ where: { divisionId: div.id, kind: `merge_held:${at(50).getTime()}` } })).toBe(1);

    // 1분 뒤 다시 돌아도 같은 닫힘에는 다시 보내지 않는다 — 그리고 여전히 덮지 않는다
    vi.setSystemTime(at(52));
    await runDueMerges(at(52));
    expect(outbox).toHaveLength(1);
    expect(runMergeMock).not.toHaveBeenCalled();

    // 다시 열었다 닫으면 그 닫힘에 한 번 더
    await prisma.slotOpening.update({ where: { divisionId_weekSlotId: { divisionId: div.id, weekSlotId: slotId } }, data: { openUntil: at(80) } });
    vi.setSystemTime(at(82));
    await runDueMerges(at(82));
    expect(outbox).toHaveLength(2);
    expect(runMergeMock).not.toHaveBeenCalled();
  });

  it('[HM-T138] 지키는 것은 「사람이 고친 최종본」뿐 — 안 고친 최종본은 닫힌 뒤 다시 병합하고, 고친 미리보기는 마감 병합이 덮는다 (HM-34)', async () => {
    const { prisma } = await import('@/server/db');
    const { runDueMerges } = await import('@/server/merge/run');

    // 안 고친 최종본 + 열었다 닫음 → 늦게 낸 사람을 넣으려고 다시 돈다 (DM-20 그대로)
    const a = await mkDivision('그대로실');
    const s1 = await submit(a.div.id, a.member.id, at(-60));
    await finalRun(a.div.id, at(1), [s1.id], false);
    await prisma.slotOpening.create({ data: { divisionId: a.div.id, weekSlotId: slotId, openUntil: at(50), openedBy: '담당' } });
    await submit(a.div.id, a.lead.id, at(30));
    vi.setSystemTime(at(51));
    expect((await runDueMerges(at(51))).ran).toBe(1);
    expect(outbox).toHaveLength(0);

    // 마감 **전** 미리보기를 고쳤어도, 마감이 오면 최종본은 반드시 한 번 만든다
    await prisma.division.update({ where: { id: a.div.id }, data: { isActive: false } });
    runMergeMock.mockClear();
    const b = await mkDivision('미리보기실');
    const s2 = await submit(b.div.id, b.member.id, at(-120));
    await finalRun(b.div.id, at(-90), [s2.id], true);
    vi.setSystemTime(at(2));
    expect((await runDueMerges(at(2))).ran).toBe(1);
    expect(runMergeMock).toHaveBeenCalledTimes(1);
  });

  it('[HM-T139] 알림이 꺼진 부서도 덮지 않는다 — 멈추는 것이 본업이고 알림은 그 결과다 · 늦게 낸 사람이 없으면 조용히', async () => {
    const { prisma } = await import('@/server/db');
    const { runDueMerges } = await import('@/server/merge/run');
    const q = await mkDivision('조용실', { notify: false });
    const s1 = await submit(q.div.id, q.member.id, at(-60));
    await finalRun(q.div.id, at(1), [s1.id], true);
    await prisma.slotOpening.create({ data: { divisionId: q.div.id, weekSlotId: slotId, openUntil: at(50), openedBy: '담당' } });
    await submit(q.div.id, q.lead.id, at(30));

    const n = await mkDivision('아무도안낸실');
    const s2 = await submit(n.div.id, n.member.id, at(-60));
    await finalRun(n.div.id, at(1), [s2.id], true);
    await prisma.slotOpening.create({ data: { divisionId: n.div.id, weekSlotId: slotId, openUntil: at(50), openedBy: '담당' } });

    vi.setSystemTime(at(51));
    expect((await runDueMerges(at(51))).ran).toBe(0);
    expect(runMergeMock).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
  });
});

describe('HM-50 마감 뒤 병합과 알림이 서로를 기다리지 않는다', () => {
  it('[HM-T140] 창은 병합이 끝난 시각부터 연다 — 대외 마감(+60분)이 지나 끝난 병합에는 보내지 않는다', async () => {
    const { noticeDue, REVIEW_MINUTES: R, SUBMIT_MINUTES: S } = await import('@/server/notify/merge-notices');
    // 제때 끝난 병합 — 지금까지와 같다: [+10, +22]
    expect(noticeDue(9.9, R, 2)).toBe(false);
    expect(noticeDue(10, R, 2)).toBe(true);
    expect(noticeDue(22, R, 2)).toBe(true);
    expect(noticeDue(22.1, R, 2)).toBe(false);
    // 병합이 없었으면(제출 0건 등) 마감 기준 그대로
    expect(noticeDue(15, R, null)).toBe(true);
    // 14:23에 끝난 병합 — 검토 요청 창이 14:23에 열린다 (예전에는 이미 닫혀 있었다)
    expect(noticeDue(23, R, 23)).toBe(true);
    expect(noticeDue(35, R, 23)).toBe(true);
    expect(noticeDue(35.1, R, 23)).toBe(false);
    // 최종 안내(+30)는 병합이 그보다 먼저 끝났으면 그대로 +30
    expect(noticeDue(30, S, 23)).toBe(true);
    expect(noticeDue(29, S, 23)).toBe(false);
  });

  it('[HM-T142] 대외 마감(+60분)이 지나서 끝난 병합에는 검토 요청도 최종 안내도 보내지 않는다 — 할 수 있는 일이 없는 소음이다', async () => {
    const { noticeDue, REVIEW_MINUTES: R, SUBMIT_MINUTES: S, LATE_LIMIT_MINUTES } = await import('@/server/notify/merge-notices');
    expect(LATE_LIMIT_MINUTES).toBe(60);
    expect(noticeDue(60, R, 60)).toBe(true);
    expect(noticeDue(61, R, 61)).toBe(false);
    expect(noticeDue(65, S, 65)).toBe(false);
  });

  it('[HM-T141] ★ 13개 부서 · 부서당 100초 — 모든 부서장이 검토 요청을 받는다, 먼저 끝난 부서는 기다리지 않는다', async () => {
    const { runDueMerges } = await import('@/server/merge/run');
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    const heads: string[] = [];
    for (let i = 0; i < 13; i++) {
      const x = await mkDivision(`부서${i + 1}`);
      await submit(x.div.id, x.member.id, at(-30));
      heads.push(x.head.employeeNo!);
    }

    // 14:01 한 번의 주기 — 스케줄러(instrumentation)와 같은 배선: 부서 하나 끝날 때마다 안내를 다시 본다
    vi.setSystemTime(at(1));
    const { ran } = await runDueMerges(at(1), { afterEach: async () => void (await runDueMergeNotices()) });
    const loopEnd = Date.now();
    await runDueMergeNotices(); // 주기 끝의 판정
    expect(ran).toBe(13);
    expect(loopEnd - at(1).getTime()).toBe(13 * MERGE_MS.value); // 마지막 병합은 14:22:40에 끝났다

    const reviews = outbox.filter((m) => m.subject.includes('검토 부탁드려요'));
    // 열세 명 전원, 한 번씩
    expect(reviews.map((m) => m.to).sort()).toEqual([...heads].sort());
    // 먼저 끝난 부서는 마지막 병합을 기다리지 않았다 (예전에는 모두 14:22:40 이후에 한꺼번에 판정 → 창 밖)
    expect(Math.min(...reviews.map((m) => m.at))).toBeLessThan(loopEnd);
    // 마지막 부서는 +22분 창이 닫힌 뒤에 끝났는데도 받았다 — 창이 병합이 끝난 시각부터 열린다
    expect(Math.max(...reviews.map((m) => m.at))).toBeGreaterThan(at(22).getTime());
    // 실패 경보(merge_missing)는 한 통도 없다 — 돌고 있는 것을 실패로 보지 않는다
    expect(outbox.filter((m) => m.subject.includes('아직 없어요'))).toHaveLength(0);
  }, 60_000); // 부서 13개를 만들고 병합 13번 + 알림 판정 14번 — DB 왕복이 수백 번이다
});
