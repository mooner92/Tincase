// HM-49 · API-55 — 사람이 고친 병합본은 **묻기 전에는 덮지 않는다.**
//
// 다시 병합은 같은 경로에 새로 쓰므로 고친 내용이 어디에도 남지 않는다. 그래서 저장마다 「누가 몇 곳」을
// 그 실행에 남기고, [다시 병합]은 그 기록이 있으면 409로 멈춘 뒤 확인(`overwriteEdits: true`)을 받는다.
// 병합 본체(모델·제출물)는 흉내 낸다 — 여기서 보는 것은 「덮기 전에 멈추는가」다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-edits-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-edits.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
delete process.env.DEV_IDENTITY;

const MERGED = 'divisions/Edit_A/merged/m.hwp';

// 병합 본체만 흉내 낸다. 조립(composeMergedHwp)은 진짜를 쓴다 — 수정 저장이 그것으로 파일을 만든다
const runMergeMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/merge/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/merge/index')>()),
  runMerge: runMergeMock,
}));

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

const ID = {
  head: 'e-head@test.kei.re.kr',
  lead: 'e-lead@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}

let isoKey = '';
let divId = '';
let slotId = '';

/** 화면의 실제 동선 — 열어 본 판으로 고쳐 저장한다 */
async function save(identity: string, ach: string[]) {
  const { GET, PUT } = await import('@/app/api/division/merged/content/route');
  const v = await (await GET(nx(`/api/division/merged/content?isoKey=${isoKey}`, identity))).json();
  return PUT(
    nx('/api/division/merged/content', identity, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        isoKey,
        runId: v.runId,
        sha256: v.sha256,
        tables: [
          { key: 'achievements', rows: ach.map((c) => ['', c, '', '', '']) },
          { key: 'plans', rows: [['', '포럼 참석', '', '', '']] },
          { key: 'notes', rows: [] },
        ],
      }),
    }),
  );
}

async function merge(identity: string, body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/division/merge/route');
  return POST(
    nx('/api/division/merge', identity, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isoKey, ...body }),
    }),
  );
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-edits.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const slot = await ensureCurrentSlot();
  isoKey = slot.isoKey;
  slotId = slot.id;
  if (!hasFixtures) return;

  const { composeMergedHwp } = await import('@/server/merge');
  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  const div = await prisma.division.create({ data: { slug: 'Edit_A', nameKo: '수정실', nameEn: 'Edit_A', isActive: true } });
  divId = div.id;
  await writeFileAtomic('divisions/Edit_A/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Edit_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });

  const bytes = composeMergedHwp(
    tpl,
    { achievements: [['1-1', '보도자료 배포(1건)', '', '', ''], ['1-2', '웹진 발송', '', '', '']], plans: [['2-1', '포럼 참석', '', '', '']], notes: [] },
    undefined,
    '수정실',
  ).bytes;
  await writeFileAtomic(MERGED, bytes);
  await prisma.mergeRun.create({
    data: { divisionId: div.id, weekSlotId: slot.id, status: 'succeeded', outputPath: MERGED, sourceIds: '[]', ruleSnapshot: '{}', reviewJson: JSON.stringify({ missing: ['누군가'] }), finishedAt: new Date() },
  });
  await prisma.user.create({ data: { email: ID.head, name: '머리', divisionId: div.id, divisionRole: 'head', jobTitle: '실장' } });
  await prisma.user.create({ data: { email: ID.lead, name: '담당', divisionId: div.id, divisionRole: 'lead' } });

  // 다시 병합 — 같은 경로에 새로 쓴다 (실제 병합과 같은 모양). 사람이 고친 것은 그래서 사라진다
  runMergeMock.mockImplementation(async () => {
    await writeFileAtomic(MERGED, bytes);
    return {
      outputRelPath: MERGED,
      bytes: bytes.length,
      rowCounts: { achievements: 2, plans: 1, notes: 0 },
      mergedGroups: [],
      warnings: [],
      model: { used: false, reason: null, elapsedMs: 0, name: '' },
      categories: null,
      sourceIds: [],
      missing: [],
      rowAuthors: { achievements: [], plans: [], notes: [] },
      flagged: [],
    };
  });
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('HM-49 사람이 고친 병합본은 묻기 전에는 덮지 않는다', () => {
  it('[HM-T135] ★ 수정 저장은 「누가 몇 곳」을 남긴다 — 담당자 저장도 · 바뀐 곳 없는 저장은 남기지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { latestEdits } = await import('@/server/merge/edits');
    expect((await latestEdits(divId, slotId))?.edits).toBeNull(); // 아직 아무도 안 고쳤다

    // 담당자가 한 줄 고친다 — 승인은 아니지만, 다시 병합하면 사라지는 것은 같다
    expect((await save(ID.lead, ['보도자료 배포(2건)', '웹진 발송'])).status).toBe(200);
    // 부서장이 한 줄 더한다 (= 승인, HM-47)
    expect((await save(ID.head, ['보도자료 배포(2건)', '웹진 발송', '기자 간담회'])).status).toBe(200);
    // 아무것도 안 바꾸고 다시 저장 — [다시 병합]을 막을 근거가 아니다
    expect((await save(ID.lead, ['보도자료 배포(2건)', '웹진 발송', '기자 간담회'])).status).toBe(200);

    const latest = await latestEdits(divId, slotId);
    expect(latest?.edits).toMatchObject({ places: 2, saves: 2, by: ['담당', '머리 실장'] });
    expect(latest?.edits?.lastAtKst).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    // 병합이 남긴 나머지(검토 정보)는 그대로다
    const run = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: divId } });
    expect(JSON.parse(run.reviewJson!).missing).toEqual(['누군가']);
    const edits = JSON.parse(run.reviewJson!).edits as { role: string; places: number }[];
    expect(edits.map((e) => [e.role, e.places])).toEqual([
      ['lead', 1],
      ['head', 1],
    ]);
  });

  it('[HM-T136] [API-T14] ★ [다시 병합]은 409 edited — 확인(overwriteEdits: true)을 받아야 돈다 · 덮은 곳은 감사 로그에', async () => {
    const { prisma } = await import('@/server/db');
    const runsBefore = await prisma.mergeRun.count({ where: { divisionId: divId } });
    runMergeMock.mockClear();

    const res = await merge(ID.lead, {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('edited');
    expect(body.message).toBe('병합본에 사람이 고친 곳이 2곳 있어요 (담당, 머리 실장). 다시 병합하면 고친 내용이 사라져요.');
    // 화면이 확인 창을 그리는 데 쓰는 것
    expect(body.detail.edits).toMatchObject({ places: 2, saves: 2, by: ['담당', '머리 실장'] });
    expect(typeof body.detail.runId).toBe('string');

    // 참(true)만 확인이다 — 문자열 'true'나 1은 아니다
    expect((await merge(ID.lead, { overwriteEdits: 'true' })).status).toBe(409);
    expect((await merge(ID.lead, { overwriteEdits: 1 })).status).toBe(409);
    expect(runMergeMock).not.toHaveBeenCalled();
    expect(await prisma.mergeRun.count({ where: { divisionId: divId } })).toBe(runsBefore);

    // 확인하면 돈다 — 새 실행, 고친 기록 없음
    const ok = await merge(ID.lead, { overwriteEdits: true });
    expect(ok.status).toBe(200);
    expect(runMergeMock).toHaveBeenCalledTimes(1);
    const { latestEdits } = await import('@/server/merge/edits');
    expect((await latestEdits(divId, slotId))?.edits).toBeNull();

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { divisionId: divId, action: 'merge', target: `slot:${isoKey}` },
      orderBy: { at: 'desc' },
    });
    expect(JSON.parse(log.detail!).overwroteEdits).toMatchObject({ places: 2, by: ['담당', '머리 실장'] });

    // 고친 기록이 없는 병합본은 묻지 않는다 — 지금까지와 같다
    expect((await merge(ID.lead, {})).status).toBe(200);
    expect(runMergeMock).toHaveBeenCalledTimes(2);
  });
});
