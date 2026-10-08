// HM-57 — 병합 실행은 **표마다** 모델을 썼는지와 못 쓴 이유를 남긴다. 실행 예산이 다 되어도 병합은 끝까지 간다.
//
// 병합은 진짜로 돌린다(양식 픽스처 · 제출 두 건). 모델 서버만 흉내 낸다 — 표마다 다르게 답하게 해서,
// 「실적은 묶었는데 계획은 5xx로 못 묶었다」가 기록에서 그대로 보이는지 본다.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-mrec-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-mrec.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
process.env.MERGE_MODEL = 'test-model';
process.env.MERGE_MODEL_URL = 'http://model.test';
process.env.MERGE_MODEL_TIMEOUT_MS = '60000';
delete process.env.DEV_IDENTITY;

const FIX = path.resolve(__dirname, '../fixtures');
const hasFixtures = (() => {
  try {
    readFileSync(path.join(FIX, 'master-template.hwp'));
    return true;
  } catch {
    return false;
  }
})();
const d = hasFixtures ? describe : describe.skip;

type Cell = [content: string, date: string];
const table = (prefix: number, cells: Cell[]) => cells.map(([c, dt], i) => [`${prefix}-${i + 1}`, c, dt, '', '']);
/** 실적 셋 · 계획 둘 · 특이 하나 — 특이는 한 줄뿐이라 묶을 것이 없다 */
const PEOPLE: Record<'achievements' | 'plans' | 'notes', Cell[]>[] = [
  { achievements: [['보도자료 배포', ''], ['포럼 개최', '']], plans: [['정례 회의', '']], notes: [['정전 안내', '']] },
  { achievements: [['위원회 참석', '']], plans: [['워크숍 개최', '']], notes: [] },
];

let divId = '';
let slotId = '';

async function mergeAndRead() {
  const { runMergeRecorded } = await import('@/server/merge/run');
  const { prisma } = await import('@/server/db');
  const r = await runMergeRecorded(divId, slotId, 'manual');
  const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: r.runId } });
  return { r, run, review: JSON.parse(run.reviewJson ?? '{}') };
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-mrec.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  if (!hasFixtures) return;
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { composeMergedHwp } = await import('@/server/merge');
  const { ensureCurrentSlot } = await import('@/server/worklog');

  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  const div = await prisma.division.create({
    data: { slug: 'Mrec_A', nameKo: '기록실', nameEn: 'Mrec_A', isActive: true, mergeCategories: '홍보' },
  });
  divId = div.id;
  slotId = (await ensureCurrentSlot()).id;
  await writeFileAtomic('divisions/Mrec_A/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Mrec_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });
  for (const [i, rows] of PEOPLE.entries()) {
    const user = await prisma.user.create({ data: { email: `mrec${i}@test.kei.re.kr`, name: `사람${i}`, divisionId: div.id, sortOrder: i } });
    const bytes = composeMergedHwp(tpl, { achievements: table(1, rows.achievements), plans: table(2, rows.plans), notes: table(3, rows.notes) }).bytes;
    const rel = `divisions/Mrec_A/submissions/${i}.hwp`;
    await writeFileAtomic(rel, bytes);
    await prisma.submission.create({
      data: { divisionId: div.id, userId: user.id, weekSlotId: slotId, version: 1, filePath: rel, originalName: `${i}.hwp`, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    });
  }
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MERGE_JOB_BUDGET_MS;
});
afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('HM-57 표별 모델 기록 · 실행 예산', () => {
  it('[HM-T160] ★ 표마다 썼는지 · 못 쓴 이유 · 보낸 횟수 — 폴백은 실패가 아니다 (succeeded)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prompts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { prompt: string; format: unknown };
        prompts.push(body.prompt);
        const isClassify = JSON.stringify(body.format).includes('assign');
        if (isClassify) return { ok: true, status: 200, body: null, json: async () => ({ response: '분류했습니다' }) }; // JSON 아님
        if (body.prompt.includes('정례 회의')) return { ok: false, status: 503, body: null, json: async () => ({}) }; // 계획 표
        return { ok: true, status: 200, body: null, json: async () => ({ response: '{"duplicates":[]}' }) };
      }),
    );

    const { r, review } = await mergeAndRead();
    expect(r.status).toBe('succeeded');
    const byTable = Object.fromEntries((review.model.tables as { table: string }[]).map((t) => [t.table, t]));
    expect(byTable.achievements).toMatchObject({ used: true, reason: null, kind: null, attempts: 1 });
    expect(byTable.plans).toMatchObject({ used: false, kind: 'http', attempts: 2, reason: '모델 응답 오류 (HTTP 503) (2번 시도)' });
    expect(byTable.notes).toMatchObject({ used: false, kind: 'skipped', attempts: 0, reason: '묶을 행이 없습니다' });
    expect(byTable.categories).toMatchObject({ used: false, kind: 'invalid', attempts: 1, reason: '모델이 JSON을 내지 않았습니다' });
    // 실적 1 + 계획 2(재시도) + 분류 1 — 잘못된 JSON은 다시 부르지 않았다
    expect(prompts).toHaveLength(4);
  });

  it('[HM-T160] 예산이 다 되면 남은 표는 부르지 않고 결정론으로 — 병합은 예산 안에 끝까지 간다', async () => {
    process.env.MERGE_JOB_BUDGET_MS = '1000';
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            calls++;
            // 답하지 않는 모델 — 끊길 때까지 붙잡는다
            init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
          }),
      ),
    );
    const t0 = Date.now();
    const { r, review } = await mergeAndRead();
    expect(Date.now() - t0).toBeLessThan(10_000); // 제한 시간(60초)이 아니라 예산(1초)에서 끊겼다
    expect(r.status).toBe('succeeded');
    const kinds = (review.model.tables as { table: string; kind: string; attempts: number }[]).map((t) => [t.table, t.kind, t.attempts]);
    expect(kinds).toEqual([
      ['achievements', 'budget', 1],
      ['plans', 'budget', 0],
      ['notes', 'skipped', 0],
      ['categories', 'budget', 0],
    ]);
    expect(calls).toBe(1);
  });
});
