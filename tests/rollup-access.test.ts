// TACP-21 · RU-01~07 — 위로 올린 제출과 본부·전사 취합의 **경계**.
//
// 새로 열린 것은 하나다: 본부 담당자·본부장이 산하 실·팀이 **보낸 사본**을 읽는다.
// 그래서 테스트는 「열린 것이 열렸나」와 「나머지는 그대로 닫혀 있나」를 같은 무게로 본다 (TACP §10-4).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-ru-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-ru.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
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

// 실명 없이 — 본부가(산하 실하나·실둘, 본부 자체는 안 넣음), 본부나(자체 + 실셋), 단독단(본부 밖)
const DIV = {
  hq: { slug: 'HQ_A', nameKo: '본부가' },
  u1: { slug: 'Unit_1', nameKo: '실하나', parentKo: '본부가' },
  u2: { slug: 'Unit_2', nameKo: '실둘', parentKo: '본부가' },
  hq2: { slug: 'HQ_B', nameKo: '본부나' },
  u3: { slug: 'Unit_3', nameKo: '실셋', parentKo: '본부나' },
  solo: { slug: 'Solo', nameKo: '단독단' },
};
const ID = {
  hqLead: 'hq-lead@test.kei.re.kr',
  hqHead: 'hq-head@test.kei.re.kr',
  hqMember: 'hq-member@test.kei.re.kr',
  u1Lead: 'u1-lead@test.kei.re.kr',
  u1Member: 'u1-member@test.kei.re.kr',
  u2Lead: 'u2-lead@test.kei.re.kr',
  hq2Lead: 'hq2-lead@test.kei.re.kr',
  soloLead: 'solo-lead@test.kei.re.kr',
  coord: 'coord@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

let isoKey = '';
const divId: Record<string, string> = {};

/** 실·팀 병합본을 만든 것처럼 — 파일과 MergeRun */
async function merged(key: keyof typeof DIV, content: string) {
  const { prisma } = await import('@/server/db');
  const { composeMergedHwp } = await import('@/server/merge');
  const { writeFileAtomic } = await import('@/server/storage');
  const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
  const bytes = composeMergedHwp(
    readFileSync(path.join(FIX, 'master-template.hwp')),
    { achievements: [['1-1', content, '', '', '']], plans: [['2-1', `${content} 계획`, '', '', '']], notes: [] },
    { achievements: [true] },
    DIV[key].nameKo,
  ).bytes;
  const rel = `divisions/${DIV[key].slug}/merged/${Date.now()}_${Math.random().toString(36).slice(2)}.hwp`;
  await writeFileAtomic(rel, bytes);
  return prisma.mergeRun.create({
    data: { divisionId: divId[key], weekSlotId: slot.id, status: 'succeeded', outputPath: rel, sourceIds: '[]', ruleSnapshot: '{}', finishedAt: new Date() },
  });
}

async function submitUnit(identity: string) {
  const { POST } = await import('@/app/api/rollup/report/route');
  return POST(nx('/api/rollup/report', identity, jsonInit('POST', { level: 'unit', isoKey })));
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-ru.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  isoKey = (await ensureCurrentSlot()).isoKey;

  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  for (const [key, d] of Object.entries(DIV)) {
    const row = await prisma.division.create({
      data: {
        slug: d.slug,
        nameKo: d.nameKo,
        nameEn: d.slug,
        isActive: true,
        parentKo: 'parentKo' in d ? d.parentKo : '한국환경연구원',
        // RU-08 — 본부가는 산하 실 것만 모은다
        rollupSelf: key !== 'hq',
      },
    });
    divId[key] = row.id;
    const rel = `divisions/${d.slug}/template/active.hwp`;
    await writeFileAtomic(rel, tpl);
    await prisma.template.create({ data: { divisionId: row.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'seed' } });
  }
  const mk = (email: string, key: keyof typeof DIV, extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: divId[key], ...extra } });
  await mk(ID.hqLead, 'hq', { divisionRole: 'lead' });
  await mk(ID.hqHead, 'hq', { divisionRole: 'head' });
  await mk(ID.hqMember, 'hq');
  await mk(ID.u1Lead, 'u1', { divisionRole: 'lead' });
  await mk(ID.u1Member, 'u1');
  await mk(ID.u2Lead, 'u2', { divisionRole: 'lead' });
  await mk(ID.hq2Lead, 'hq2', { divisionRole: 'lead' });
  await mk(ID.soloLead, 'solo', { divisionRole: 'lead' });
  await mk(ID.coord, 'solo', { isCoordinator: true });
  // RU-52 — 3단계를 켠 상태에서 시험한다 (꺼졌을 때는 RU-T40이 따로 본다)
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('RU-09 단위 나무 (순수)', () => {
  const base = (id: string, nameKo: string, parentKo = '한국환경연구원', extra: object = {}) => ({
    id,
    slug: id,
    nameKo,
    parentKo,
    isActive: true,
    rollupOrder: '[]',
    rollupSelf: true,
    rollupPageBreak: true,
    boardStatus: 'confirmed',
    createdAt: new Date(2026, 0, 1, 0, 0, Number(id.replace(/\D/g, '')) || 0),
    ...extra,
  });

  it('[RU-T20] 기여 단위가 둘 이상이면 본부 단계, 하나면 바로 총괄로 (RU-07)', async () => {
    const { buildTree, submitTarget } = await import('@/server/rollup/tree');
    const tree = buildTree(
      [
        base('d1', '기획본부'),
        base('d2', '가실', '기획본부'),
        base('d3', '나실', '기획본부'),
        base('d4', '연구본부'), // 본부가 직접 씀, 산하는 꺼져 있음
        base('d5', '연구실', '연구본부', { isActive: false, boardStatus: 'none' }),
        base('d6', '대기본부', '한국환경연구원', { isActive: false }),
        base('d7', '탄소실', '대기본부'), // 산하 하나만 씀
      ],
      [],
    );
    expect(tree.nodes.map((n) => [n.node.nameKo, n.hasHqStep, n.contributors.map((c) => c.nameKo)])).toEqual([
      ['기획본부', true, ['기획본부', '가실', '나실']],
      ['연구본부', false, ['연구본부']],
      ['대기본부', false, ['탄소실']],
    ]);
    expect(submitTarget(tree, 'd2')).toMatchObject({ kind: 'hq' });
    expect(submitTarget(tree, 'd7')).toEqual({ kind: 'org' });
    expect(submitTarget(tree, 'd5')).toBeNull(); // 꺼진 부서는 보낼 곳이 없다
    expect(tree.offline.map((d) => d.nameKo)).toEqual(['대기본부']); // 게시판으로 내는데 꺼진 곳
  });

  it('[RU-T21] 정한 순서가 먼저, 목록에 없는 단위는 ERP 순서로 뒤에 — 새로 켠 실이 사라지지 않는다', async () => {
    const { buildTree } = await import('@/server/rollup/tree');
    const tree = buildTree(
      [base('d1', '본부', '한국환경연구원', { rollupOrder: '["d3","d1"]' }), base('d2', '가실', '본부'), base('d3', '나실', '본부'), base('d4', '다실', '본부')],
      [],
    );
    expect(tree.nodes[0].contributors.map((c) => c.nameKo)).toEqual(['나실', '본부', '가실', '다실']);
  });

  it('[RU-T22] 본부 자체 문서를 끄면(rollupSelf) 산하만 — 산하가 하나 남으면 본부 단계가 없어진다', async () => {
    const { buildTree } = await import('@/server/rollup/tree');
    const off = { rollupSelf: false };
    const two = buildTree([base('d1', '본부', undefined, off), base('d2', '가실', '본부'), base('d3', '나실', '본부')], []);
    expect(two.nodes[0].contributors.map((c) => c.nameKo)).toEqual(['가실', '나실']);
    const one = buildTree([base('d1', '본부', undefined, off), base('d2', '가실', '본부')], []);
    expect(one.nodes[0].hasHqStep).toBe(false);
    // 산하가 없으면 끄더라도 본부 자신이 쓴다 — 안 그러면 아무것도 안 간다
    const alone = buildTree([base('d1', '본부', undefined, off)], []);
    expect(alone.nodes[0].contributors.map((c) => c.nameKo)).toEqual(['본부']);
  });
});

d('TACP-21 위로 올린 제출', () => {
  it('[RU-T33] member는 [제출] 404 · coordinator도 남의 것을 대신 내지 못한다(자기 부서 manager가 아니면 404)', async () => {
    await merged('u1', '실하나 첫 판');
    expect((await submitUnit(ID.u1Member)).status).toBe(404);
    expect((await submitUnit(ID.coord)).status).toBe(404);
  });

  it('[RU-T23] 실·팀 담당자가 [제출] → 본부로 간다. 같은 판을 또 내면 새 행을 만들지 않는다', async () => {
    const res = await submitUnit(ID.u1Lead);
    expect(res.status).toBe(200);
    const first = await res.json();
    expect(first.unchanged).toBe(false);
    const again = await (await submitUnit(ID.u1Lead)).json();
    expect(again).toEqual({ id: first.id, unchanged: true });

    const { GET } = await import('@/app/api/rollup/report/route');
    const state = (await (await GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Lead))).json()).state;
    expect(state.targetLabel).toBe('본부가');
    const solo = (await (await GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.soloLead))).json()).state;
    expect(solo.targetLabel).toBe('총괄'); // RU-07 — 본부 밖 단위는 바로 총괄
  });

  it('[RU-T30] ★ 본부 담당자는 산하가 **보낸 사본**을 읽고 이어 붙인다 + 감사 기록', async () => {
    const { prisma } = await import('@/server/db');
    const report = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.u1 } });
    const { GET } = await import('@/app/api/rollup/report/[id]/route');
    const res = await GET(nx(`/api/rollup/report/${report.id}`, ID.hqLead), { params: Promise.resolve({ id: report.id }) });
    expect(res.status).toBe(200);
    const log = await prisma.auditLog.findFirst({ where: { action: 'cross_division_read', target: `report:${report.id}`, actor: ID.hqLead } });
    expect(log).not.toBeNull();

    const hq = await import('@/app/api/rollup/hq/route');
    const run = await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    expect(run.status).toBe(200);
    // 본부장(head)도 같다 — TACP-16
    expect((await hq.POST(nx('/api/rollup/hq', ID.hqHead, jsonInit('POST', { isoKey })))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'rollup', actor: ID.hqLead } })).toBe(1);
  });

  it('[RU-T31] ★ 본부 담당자도 산하의 **병합본 원본**은 404 — 열린 것은 보낸 사본뿐이다', async () => {
    const { GET } = await import('@/app/api/division/merged/route');
    const res = await GET(nx(`/api/division/merged?division=${DIV.u1.slug}&isoKey=${isoKey}`, ID.hqLead));
    expect(res.status).toBe(404);
  });

  it('[RU-T32] 다른 본부의 실이 보낸 사본 → 404 · 본부원(member)·본부 아닌 부서 → 본부 화면 404', async () => {
    const { prisma } = await import('@/server/db');
    const report = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.u1 } });
    const { GET } = await import('@/app/api/rollup/report/[id]/route');
    expect((await GET(nx(`/api/rollup/report/${report.id}`, ID.hq2Lead), { params: Promise.resolve({ id: report.id }) })).status).toBe(404);
    expect((await GET(nx(`/api/rollup/report/${report.id}`, ID.u2Lead), { params: Promise.resolve({ id: report.id }) })).status).toBe(404);

    const hq = await import('@/app/api/rollup/hq/route');
    expect((await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqMember))).status).toBe(404);
    expect((await hq.POST(nx('/api/rollup/hq', ID.hqMember, jsonInit('POST', { isoKey })))).status).toBe(404);
    expect((await hq.POST(nx('/api/rollup/hq', ID.soloLead, jsonInit('POST', { isoKey })))).status).toBe(404);
    // 남의 본부를 이름으로 가리키면 404 — 남의 본부는 readAll(읽기만)이다 (TACP-5)
    expect((await hq.GET(nx(`/api/rollup/hq?node=${DIV.hq.slug}&isoKey=${isoKey}`, ID.hq2Lead))).status).toBe(404);
    const own = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hq2Lead))).json();
    expect(own.board.node.nameKo).toBe('본부나');
    // 총괄은 남의 본부를 **읽기만** — canWrite=false
    const ro = await (await hq.GET(nx(`/api/rollup/hq?node=${DIV.hq.slug}&isoKey=${isoKey}`, ID.coord))).json();
    expect([ro.board.node.nameKo, ro.canWrite]).toEqual(['본부가', false]);
  });

  it('[RU-T24] RU-02 — 보낸 뒤 다시 병합하면 「바뀜」이 뜨고, 본부는 여전히 보낸 판을 쓴다', async () => {
    await merged('u1', '실하나 둘째 판');
    const { GET } = await import('@/app/api/rollup/report/route');
    const state = (await (await GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Lead))).json()).state;
    expect(state.changedSinceSubmit).toBe(true);

    const hq = await import('@/app/api/rollup/hq/route');
    await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    const { prisma } = await import('@/server/db');
    const run = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'hq' }, orderBy: { startedAt: 'desc' } });
    const { readStoredFile } = await import('@/server/storage');
    const { readUnits } = await import('@/lib/hwp/rollup');
    const units = readUnits(await readStoredFile(run.outputPath!), 'x').units;
    expect(units.map((u) => u.tables.achievements[0].content)).toEqual(['실하나 첫 판']);
  });

  it('[RU-T25] 다시 제출하면 본부의 이어 붙인 결과가 「바뀜」 — 다시 이어 붙이면 새 판', async () => {
    await submitUnit(ID.u1Lead);
    const hq = await import('@/app/api/rollup/hq/route');
    const before = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(before.board.lastRun.stale).toBe(true);
    await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    const after = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(after.board.lastRun.stale).toBe(false);
    expect(after.board.lastRun.units.map((u: { name: string }) => u.name)).toEqual(['실하나']);
  });

  it('[RU-T26] 순서 — 본부가 정한 대로 이어 붙고, 모르는 단위를 끼우면 422', async () => {
    await merged('u2', '실둘 내용');
    await submitUnit(ID.u2Lead);
    const order = await import('@/app/api/rollup/hq/order/route');
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u2, divId.u1] })))).status).toBe(200);
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u3] })))).status).toBe(422);
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.u1Lead, jsonInit('PUT', { order: [divId.u1] })))).status).toBe(404);

    const hq = await import('@/app/api/rollup/hq/route');
    await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    const b = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(b.board.lastRun.units.map((u: { name: string }) => u.name)).toEqual(['실둘', '실하나']);
  });

  it('[RU-T34] ★ 전사 취합본 — 총괄 허용, 본부 담당자 404. 섹션마다: 본부가 낸 판의 실 사본 / 단독 단위의 제출 / 본부 제출 전', async () => {
    const report = await import('@/app/api/rollup/report/route');
    expect((await report.POST(nx('/api/rollup/report', ID.hqLead, jsonInit('POST', { level: 'hq', isoKey })))).status).toBe(200);
    // 본부 밖 단위 — 실·팀 [제출]이 곧 총괄로
    await merged('solo', '단독단 내용');
    await submitUnit(ID.soloLead);

    // RU-60 — 시험용 섹션 4개 (실제 기본 13개는 실제 부서 이름으로 찾는다)
    const { prisma } = await import('@/server/db');
    await prisma.orgSection.createMany({
      data: [
        { sortOrder: 10, title: '본부가(실하나)', divisionId: divId.u1 },
        { sortOrder: 20, title: '본부가(실둘)', divisionId: divId.u2 },
        { sortOrder: 30, title: '본부나(실셋)', divisionId: divId.u3 },
        { sortOrder: 40, title: '단독단', divisionId: divId.solo },
      ],
    });

    const org = await import('@/app/api/rollup/org/route');
    expect((await org.POST(nx('/api/rollup/org', ID.hqLead, jsonInit('POST', { isoKey })))).status).toBe(404);
    const res = await org.POST(nx('/api/rollup/org', ID.coord, jsonInit('POST', { isoKey })));
    expect(res.status).toBe(200);
    const board = await (await org.GET(nx(`/api/rollup/org?isoKey=${isoKey}`, ID.coord))).json();
    expect(board.sections.map((x: { title: string; source: string }) => [x.title, x.source])).toEqual([
      ['본부가(실하나)', 'tincase'],
      ['본부가(실둘)', 'tincase'],
      ['본부나(실셋)', 'waiting_hq'], // 본부나는 아직 총괄에 내지 않았다 — 실이 냈어도 본부를 거친다
      ['단독단', 'tincase'],
    ]);
    expect(board.lastRun.sections.map((x: { title: string; status: string }) => [x.title, x.status])).toEqual([
      ['본부가(실하나)', 'copied'],
      ['본부가(실둘)', 'copied'],
      ['본부나(실셋)', 'missing'],
      ['단독단', 'copied'],
    ]);
    // 결과 문서 — 본부가 총괄에 낸 판에 든 것(RU-T25에서 다시 낸 둘째 판)이 들어갔다
    const { readStoredFile } = await import('@/server/storage');
    const run = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'org' }, orderBy: { startedAt: 'desc' } });
    const { readWorklog } = await import('@/lib/hwp/reader');
    const bytes = await readStoredFile(run.outputPath!);
    expect(readWorklog(bytes).worklog.achievements[0].content).toBe('실하나 둘째 판');
  });

  it('[RU-T28] RU-10·61 — 본부 이어 붙이기도 전사와 같은 섹션 제목을 단다 (섹션이 없는 부서는 부서 이름 — RU-T25·26)', async () => {
    // RU-T34가 섹션을 만들었다: 본부가(실하나)·본부가(실둘). 본부가의 순서는 RU-T26에서 실둘 → 실하나
    const hq = await import('@/app/api/rollup/hq/route');
    expect((await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })))).status).toBe(200);
    const b = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(b.board.lastRun.status).toBe('succeeded');
    expect(b.board.lastRun.units.map((u: { name: string }) => u.name)).toEqual(['본부가(실둘)', '본부가(실하나)']);
    // 화면의 행 수는 보낸 사본에서 센다 — 정규화가 넣는 「특이사항 없음」은 세지 않는다
    expect(b.board.lastRun.units.map((u: { rows: unknown; emphasis: number }) => [u.rows, u.emphasis])).toEqual([
      [{ achievements: 1, plans: 1, notes: 0 }, 1],
      [{ achievements: 1, plans: 1, notes: 0 }, 1],
    ]);
    // 문서 안의 제목도 같다 — 원본 맨 위 부서명 줄(「실둘」)은 빠지고 생성한 제목이 단위명이 된다
    const { prisma } = await import('@/server/db');
    const run = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'hq' }, orderBy: { startedAt: 'desc' } });
    const { readStoredFile } = await import('@/server/storage');
    const { readUnits } = await import('@/lib/hwp/rollup');
    const units = readUnits(await readStoredFile(run.outputPath!), 'x').units;
    expect(units.map((u) => u.name)).toEqual(['본부가(실둘)', '본부가(실하나)']);
    // RU-19 — 자동 수정은 「확인해 주세요」(warnings)가 아니라 단위의 fixed로 따로 (2026-10-08). 생성한 제목으로 바꾼 부서명 줄은 소음이라 알리지 않는다
    const warnings: string[] = JSON.parse(run.warnings ?? '[]');
    expect(warnings.join(' ')).not.toContain('자동 수정');
    expect(b.board.lastRun.units.every((u: { fixed: string[] }) => u.fixed.length > 0)).toBe(true); // 빈 3번 표에 「특이사항 없음」
    expect(warnings.join(' ')).not.toContain('제목 「실둘」');
    // 섹션 설정을 읽기만 한다 — 본부 실행이 총괄의 섹션 목록을 만들거나 바꾸지 않는다
    expect(await prisma.orgSection.count()).toBe(4);
  });

  it('[RU-T27] 제출 취소 — 내 부서 것만. 취소하면 위의 결과가 「바뀜」', async () => {
    const { prisma } = await import('@/server/db');
    const r = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.u2, withdrawnAt: null } });
    const route = await import('@/app/api/rollup/report/route');
    expect((await route.DELETE(nx(`/api/rollup/report?id=${r.id}`, ID.u1Lead, { method: 'DELETE' }))).status).toBe(404);
    expect((await route.DELETE(nx(`/api/rollup/report?id=${r.id}`, ID.u2Lead, { method: 'DELETE' }))).status).toBe(200);
    const hq = await import('@/app/api/rollup/hq/route');
    const b = await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(b.board.lastRun.stale).toBe(true);
    expect(b.board.units.find((u: { division: { nameKo: string } }) => u.division.nameKo === '실둘').report).toBeNull();
  });
});

d('RU-50~58 단계 일정 · 스위치 · 본부장 승인', () => {
  it('[RU-T40] ★ 3단계가 꺼져 있으면 [제출]·본부·전사 문이 닫힌다 — 운영자의 설정 화면만 열린다', async () => {
    const { prisma } = await import('@/server/db');
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    try {
      expect((await submitUnit(ID.u1Lead)).status).toBe(404);
      const hq = await import('@/app/api/rollup/hq/route');
      expect((await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).status).toBe(404);
      const org = await import('@/app/api/rollup/org/route');
      expect((await org.GET(nx(`/api/rollup/org?isoKey=${isoKey}`, ID.coord))).status).toBe(404);
      const { rollupNav } = await import('@/server/authz');
      const { requireScope } = await import('@/server/authz');
      const lead = await requireScope(new Headers({ 'x-test-identity': ID.hqLead }));
      expect(await rollupNav(lead)).toEqual({ hqDesk: false, orgDesk: false });
    } finally {
      await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: true } });
    }
  });

  it('[RU-T45] ★ 전사 취합의 문은 하나(canOpenOrgDesk) — 꺼져 있으면 총괄에게도 닫힌다. 「전사」 화면의 취합 부분도 같은 게이트', async () => {
    const { prisma } = await import('@/server/db');
    const { canOpenOrgDesk, requireScope } = await import('@/server/authz');
    const opEmail = 'op@test.kei.re.kr';
    await prisma.user.upsert({ where: { email: opEmail }, update: {}, create: { email: opEmail, name: 'op', divisionId: divId.solo, isOperator: true } });
    const as = (who: string) => requireScope(new Headers({ 'x-test-identity': who }));
    const [coord, op, lead] = [await as(ID.coord), await as(opEmail), await as(ID.hqLead)];
    expect([await canOpenOrgDesk(coord), await canOpenOrgDesk(op), await canOpenOrgDesk(lead)]).toEqual([true, true, false]);
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    try {
      // RU-52 — 꺼져 있으면 켜는 사람(운영자)만
      expect([await canOpenOrgDesk(coord), await canOpenOrgDesk(op), await canOpenOrgDesk(lead)]).toEqual([false, true, false]);
    } finally {
      await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: true } });
    }
    // 페이지가 canRunOrgRollup만 보면 스위치를 건너뛴다 — 판정을 복사하지 않고 게이트를 부른다 (TACP-12).
    // 「전사」 화면은 orgPageView를 부르고, 그 안의 「취합 부분」(desk)이 이 게이트다 (PG-49f·51e)
    const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    for (const f of ['src/app/org/page.tsx', 'src/app/ops/monitor/page.tsx']) {
      expect(src(f), f).toContain('orgPageView(');
      expect(src(f), f).not.toMatch(/canRunOrgRollup\(/);
    }
    const authz = src('src/server/authz.ts');
    const view = authz.slice(authz.indexOf('export async function orgPageView'));
    expect(view.slice(0, view.indexOf('\n}\n'))).toContain('const desk = await canOpenOrgDesk(scope);');
    const { orgPageView } = await import('@/server/authz');
    expect((await orgPageView(coord)).desk).toBe(await canOpenOrgDesk(coord));
  });

  it('[RU-T46] [제출] 카드는 내 부서 lead·head에게만 — 총괄(readAll)에게는 누르면 404인 버튼을 그리지 않는다', async () => {
    const { canSendReport, requireScope } = await import('@/server/authz');
    const can = async (who: string) => canSendReport(await requireScope(new Headers({ 'x-test-identity': who })));
    expect([await can(ID.u1Lead), await can(ID.hqHead), await can(ID.u1Member), await can(ID.coord)]).toEqual([true, true, false, false]);
    // 화면은 canMerge(readAll 포함)가 아니라 이 판정을 쓴다 — API(requireReportSender)와 같은 것
    for (const f of ['src/app/[division]/manage/page.tsx', 'src/app/[division]/manage/[isoKey]/page.tsx']) {
      expect(readFileSync(path.resolve(__dirname, '..', f), 'utf8'), f).toContain('canSendReport={view.isOwn && canSendReport(view.scope)}');
    }
  });

  it('[RU-T41] 단계 시각은 기준 시각에서 — 기준이 하루 당겨지면 기한도 하루 당겨진다 (WS-19와 함께)', async () => {
    const { stagesFrom } = await import('@/server/rollup/schedule');
    const normal = new Date('2026-10-08T05:00:00Z'); // 목 14:00 KST
    const holiday = new Date('2026-10-07T05:00:00Z'); // 수 14:00 KST
    const a = stagesFrom(normal, { unitDueMinutes: 60, hqDueMinutes: 120 });
    const b = stagesFrom(holiday, { unitDueMinutes: 60, hqDueMinutes: 120 });
    expect(a.hqDue.getTime() - b.hqDue.getTime()).toBe(24 * 3600_000);
    expect(b.unitDue.toISOString()).toBe('2026-10-07T06:00:00.000Z'); // 수 15:00
    expect(b.hqDue.toISOString()).toBe('2026-10-07T07:00:00.000Z'); // 수 16:00
  });

  it('[RU-T42] 단계 시각 설정 — 총괄 허용, 본부가 실·팀보다 이르면 422, 담당자 404', async () => {
    const { PUT } = await import('@/app/api/rollup/org/settings/route');
    const put = (who: string, body: unknown) =>
      PUT(nx('/api/rollup/org/settings', who, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    expect((await put(ID.coord, { unitDueMinutes: 60, hqDueMinutes: 180 })).status).toBe(200);
    expect((await put(ID.coord, { unitDueMinutes: 120, hqDueMinutes: 60 })).status).toBe(422);
    expect((await put(ID.hqLead, { hqDueMinutes: 240 })).status).toBe(404);
    const { prisma } = await import('@/server/db');
    expect((await prisma.orgRollupSetting.findUniqueOrThrow({ where: { id: 'org' } })).hqDueMinutes).toBe(180);
  });

  it('[RU-T43] ★ 본부장 승인 — head만, 같은 판은 한 번. 다시 이어 붙이면 「승인 뒤 바뀜」', async () => {
    const { POST } = await import('@/app/api/rollup/hq/approve/route');
    const approve = (who: string) => POST(nx('/api/rollup/hq/approve', who, jsonInit('POST', { isoKey })));
    expect((await approve(ID.hqLead)).status).toBe(404); // 담당자는 자기가 만든 것을 승인하지 않는다
    expect((await approve(ID.hqMember)).status).toBe(404);
    const ok = await approve(ID.hqHead);
    expect(ok.status).toBe(200);
    expect((await ok.json()).unchanged).toBe(false);
    expect((await (await approve(ID.hqHead)).json()).unchanged).toBe(true);

    const { prisma } = await import('@/server/db');
    const { hqApproval } = await import('@/server/rollup/notices');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
    expect((await hqApproval(divId.hq, slot))?.changedAfter).toBe(false);
    const hq = await import('@/app/api/rollup/hq/route');
    await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    expect((await hqApproval(divId.hq, slot))?.changedAfter).toBe(true);
  });

  it('[RU-T44] 알림 문구 — 본부 담당자에게 제출·미제출, 총괄에게 도착·미도착, 할 일 한 줄', async () => {
    const { hqCollectMessage, orgArrivalMessage, hqDueSoonMessage } = await import('@/server/rollup/notices');
    const slot = { label: '10월 2주차', opensAt: new Date('2026-10-11T15:00:00Z'), year: 2026, month: 10, weekOfMonth: 2 } as never;
    const p = { name: '담당', employeeNo: '1' };
    const a = hqCollectMessage(p, slot, '기획경영본부', ['기획조정실', 'AI홍보전략실'], ['인사관리실']);
    expect(a.subject).toContain('2/3곳 제출');
    expect(a.contents).toContain('아직 1곳: 인사관리실');
    expect(a.contents).toContain('본부장 검토');
    const b = orgArrivalMessage(p, slot, ['기획경영본부'], ['환경평가본부', '임원실']);
    expect(b.subject).toContain('1/3곳 도착');
    expect(b.contents).toContain('아직 2곳: 환경평가본부·임원실');
    expect(hqDueSoonMessage(p, slot, new Date('2026-10-15T07:00:00Z')).contents).toContain('16:00까지');
  });

  it('[RU-T76] RU-59 — 두 기한의 이름은 어디서나 한 쌍(「실·팀 → 본부」·「본부 → 총괄」) · 알림에도 시각이 있다 (RU-53)', async () => {
    const { hqCollectMessage, orgArrivalMessage, hqDueSoonMessage } = await import('@/server/rollup/notices');
    const { submitLines } = await import('@/server/notify/merge-notices');
    const slot = { label: '10월 2주차', opensAt: new Date('2026-10-11T15:00:00Z'), year: 2026, month: 10, weekOfMonth: 2 } as never;
    const p = { name: '담당', employeeNo: '1' };
    expect(hqCollectMessage(p, slot, '본부가', ['실하나'], [], new Date('2026-10-15T06:00:00Z')).contents).toContain('「실·팀 → 본부」 기한(15:00)이 됐어요');
    expect(orgArrivalMessage(p, slot, ['본부가'], []).contents).toContain('「본부 → 총괄」 기한이 됐어요');
    expect(hqDueSoonMessage(p, slot, new Date('2026-10-15T07:00:00Z')).subject).toContain('「본부 → 총괄」 기한 15분 전');
    // 실·팀 담당자의 마감 +30분 알림 — 언제까지 어느 버튼인지 (3단계를 안 쓰면 게시판 문구 그대로)
    expect(submitLines({ submitTo: '본부가', submitDue: '15:00' })).toEqual(['15:00까지 Tincase 수합 관리에서 [본부가에 제출]을 눌러주세요.']);
    expect(submitLines({ submitTo: null, submitDue: null })[0]).toContain('취합게시판');
    // 옛 이름이 화면·알림 글자에 남지 않는다 (주석은 보지 않는다 — 사용 안내는 따로 다시 쓰는 중이라 뺀다)
    const walk = (dir: string): string[] =>
      readdirSync(path.resolve(__dirname, '..', dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
      );
    const old = ['본부 기한', '총괄 기한', '실·팀 기한', '실·팀 제출', '본부 제출 기한', '총괄 제출 기한', '→ 위로'];
    const hits = walk('src')
      .filter((f) => !f.startsWith(path.join('src', 'app', 'guide')))
      .flatMap((f) => {
        const code = readFileSync(path.resolve(__dirname, '..', f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        return old.filter((w) => code.includes(w)).map((w) => `${f}: ${w}`);
      });
    expect(hits).toEqual([]);
  });
});

d('PG-51 「전사」 한 화면 — 섹션 표', () => {
  it('[PG-T81] ★ 열마다 그 열을 보는 사람에게만 값이 온다 · 본부 단계가 있는 섹션은 본부 취합 길 · 어느 섹션에도 안 닿는 집계 부서는 「섹션 밖」', async () => {
    const { prisma } = await import('@/server/db');
    const { orgBoard } = await import('@/server/org-board');
    const { progressNodes } = await import('@/server/monitor');
    const { rollupSlot } = await import('@/server/rollup/slot');
    const { layoutOrg } = await import('@/lib/orgtree');
    const slot = await rollupSlot(isoKey);
    const ids = Object.values(divId);
    // 모든 단위를 집계 대상으로. 섹션은 RU-T34의 넷(실하나·실둘·실셋·단독단) — 본부가·본부나 자신은 섹션이 없다
    await prisma.division.updateMany({ where: { id: { in: ids } }, data: { boardStatus: 'confirmed' } });
    try {
      const titles = ['본부가(실하나)', '본부가(실둘)', '본부나(실셋)', '단독단'];
      const full = await orgBoard(slot, { progress: true, desk: true }, 'isoKey=2026-W01');
      expect(full.rows.map((r) => r.title)).toEqual([...titles, '섹션 밖']);
      expect(full.rows.map((r) => r.progress?.teams.map((t) => t.name))).toEqual([['실하나'], ['실둘'], ['실셋'], ['단독단'], ['본부가', '본부나']]);
      // 최종본 열 — 섹션마다 RU-60의 출처 판정 그대로, 「섹션 밖」에는 없다
      expect(full.rows.map((r) => r.final && r.final.sectionId === r.key)).toEqual([true, true, true, true, null]);
      expect(full.rows.slice(0, 4).every((r) => ['tincase', 'upload', 'waiting_hq', 'missing'].includes(r.final!.source))).toBe(true);
      // 본부 단계가 있는 본부(본부가: 실 둘 · 본부나: 자체 + 실 하나)의 섹션만 본부 취합으로 — 보던 주차를 들고 간다
      expect(full.rows.map((r) => r.hq?.href ?? null)).toEqual([
        '/hq?node=HQ_A&isoKey=2026-W01',
        '/hq?node=HQ_A&isoKey=2026-W01',
        '/hq?node=HQ_B&isoKey=2026-W01',
        null,
        null,
      ]);
      // 합계 = 섹션 + 「섹션 밖」 = 감사 문서 (PG-T73과 같은 약속을 실제 DB로)
      const report = layoutOrg((await progressNodes(slot)).nodes);
      expect([full.totals!.submitted, full.totals!.roster]).toEqual([report.totals.submitted, report.totals.roster]);
      expect(full.ready).toBe(full.rows.filter((r) => r.final?.source === 'tincase' || r.final?.source === 'upload').length);
      expect(full.editor?.sections.map((x) => x.title)).toEqual(titles);

      // 읽기만(3단계가 꺼진 총괄) — 최종본 열·본부 취합 길·만들기·편집기 값이 아예 없다
      const read = await orgBoard(slot, { progress: true, desk: false }, '');
      expect(read.rows.map((r) => r.title)).toEqual([...titles, '섹션 밖']);
      expect(read.rows.every((r) => r.final === null && r.hq === null)).toBe(true);
      expect([read.ready, read.run, read.editor]).toEqual([null, null, null]);
      expect(read.totals).toEqual(full.totals);

      // 취합만(전 부서 읽기 없이) — 제출 열·이름·합계가 없고, 사람을 세는 「섹션 밖」 줄도 없다
      const desk = await orgBoard(slot, { progress: false, desk: true }, '');
      expect(desk.rows.map((r) => r.title)).toEqual(titles);
      expect(desk.rows.every((r) => r.progress === null && r.final !== null)).toBe(true);
      expect([desk.totals, desk.excludedNote, desk.capturedAtKst]).toEqual([null, null, null]);
    } finally {
      await prisma.division.updateMany({ where: { id: { in: ids } }, data: { boardStatus: 'none' } });
    }
  });
});

d('RU-02 · RU-08 · HM-47 · RU-57 — 바뀜 판정 · 본부 스위치 · 승인 분리 · 도착 알림', () => {
  /** 저장된 파일을 그대로 새 자리에 — 「다시 돌렸더니 같은 파일이 나왔다」를 만든다 */
  async function copyStored(from: string, dir: string) {
    const { readStoredFile, writeFileAtomic } = await import('@/server/storage');
    const rel = `${dir}/${Date.now()}_${Math.random().toString(36).slice(2)}.hwp`;
    await writeFileAtomic(rel, await readStoredFile(from));
    return rel;
  }

  it('[RU-T37] ★ RU-02 — 다시 병합해 **같은 파일**이 나오면 「바뀜」이 아니다 (실·팀 사본·본부본 모두 내용으로 본다)', async () => {
    const { prisma } = await import('@/server/db');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
    // 실·팀 — 보낸 사본과 같은 바이트의 새 병합 실행
    const unitRep = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.u1, level: 'unit', withdrawnAt: null }, orderBy: { submittedAt: 'desc' } });
    await prisma.mergeRun.create({
      data: {
        divisionId: divId.u1,
        weekSlotId: slot.id,
        status: 'succeeded',
        outputPath: await copyStored(unitRep.filePath, `divisions/${DIV.u1.slug}/merged`),
        sourceIds: '[]',
        ruleSnapshot: '{}',
        finishedAt: new Date(),
      },
    });
    const { GET } = await import('@/app/api/rollup/report/route');
    const state = (await (await GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Lead))).json()).state;
    expect(state.changedSinceSubmit).toBe(false);

    // 본부 — 보낸 본부본과 같은 바이트의 새 이어 붙이기 실행
    const hqRep = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.hq, level: 'hq', withdrawnAt: null } });
    const last = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'hq', divisionId: divId.hq, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    const hq = await import('@/app/api/rollup/hq/route');
    expect((await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json()).board.hqReportOutdated).toBe(true); // RU-T43이 다시 이어 붙였다
    await prisma.rollupRun.create({
      data: {
        level: 'hq',
        divisionId: divId.hq,
        weekSlotId: slot.id,
        status: 'succeeded',
        inputIds: last.inputIds,
        unitsJson: last.unitsJson,
        outputPath: await copyStored(hqRep.filePath, `divisions/${DIV.hq.slug}/rollup`),
        createdBy: 'test',
        finishedAt: new Date(),
      },
    });
    expect((await (await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead))).json()).board.hqReportOutdated).toBe(false);
    const hqState = (await (await GET(nx(`/api/rollup/report?level=hq&isoKey=${isoKey}`, ID.hqLead))).json()).state;
    expect(hqState.changedSinceSubmit).toBe(false);
  });

  it('[RU-T38] ★ HM-47 — 본부장의 본부본 승인(hq_approve)은 본부 **자체 병합본**의 승인이 아니다', async () => {
    const { prisma } = await import('@/server/db');
    const { latestReview } = await import('@/server/merge/review');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
    expect(await prisma.mergeReview.count({ where: { divisionId: divId.hq, kind: 'hq_approve' } })).toBeGreaterThan(0); // RU-T43
    await merged('hq', '본부 자체 문서');
    expect(await latestReview(divId.hq, slot.id)).toBeNull(); // 본부본 승인이 병합본 승인으로 보이지 않는다

    // #2 — 승인은 **본 판**에만. 화면처럼 먼저 열어 판(runId·sha256)을 받고 그것을 보낸다
    const unitApprove = async () => {
      const { GET } = await import('@/app/api/division/merged/content/route');
      const view = await (await GET(nx(`/api/division/merged/content?isoKey=${isoKey}`, ID.hqHead))).json();
      const { POST } = await import('@/app/api/division/merged/approve/route');
      return POST(nx('/api/division/merged/approve', ID.hqHead, jsonInit('POST', { isoKey, runId: view.runId, sha256: view.sha256 })));
    };
    expect((await (await unitApprove()).json()).unchanged).toBe(false);
    // 그 사이 본부본을 승인해도(가장 최근 행이 hq_approve가 되어도) 같은 병합본을 두 번 승인하지 않는다
    const hqApprove = await import('@/app/api/rollup/hq/approve/route');
    const hq = await import('@/app/api/rollup/hq/route');
    await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey })));
    expect((await (await hqApprove.POST(nx('/api/rollup/hq/approve', ID.hqHead, jsonInit('POST', { isoKey })))).json()).unchanged).toBe(false);
    const again = await (await unitApprove()).json();
    expect(again.unchanged).toBe(true);
    expect(again.review.kind).toBe('approve');
  });

  it('[RU-T39] ★ RU-08 — 본부 문서를 빼면 본부 단계가 사라지는 경우 422 (끄면 다시 켤 화면이 없어진다)', async () => {
    const order = await import('@/app/api/rollup/hq/order/route');
    const put = (who: string, body: unknown) => order.PUT(nx('/api/rollup/hq/order', who, jsonInit('PUT', body)));
    // 본부나 = 자체 + 실셋 — 자체를 빼면 실셋 하나만 남는다
    const res = await put(ID.hq2Lead, { order: [divId.hq2, divId.u3], self: false });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain('본부 취합 단계가 없어집니다');
    const { prisma } = await import('@/server/db');
    expect((await prisma.division.findUniqueOrThrow({ where: { id: divId.hq2 } })).rollupSelf).toBe(true);
    expect((await put(ID.hq2Lead, { order: [divId.hq2, divId.u3], self: true })).status).toBe(200);
    // 본부가 = 산하 둘(실하나·실둘) — 이미 빠져 있고 둘이 남으니 그대로 받는다
    expect((await put(ID.hqLead, { order: [divId.u2, divId.u1], self: false })).status).toBe(200);
  });

  it('[RU-T47] ★ RU-57 — 총괄 도착 알림은 총괄 **각자**에게(같은 부서에 둘이어도), 이름은 **낸 단위**의 것', async () => {
    const { createServer } = await import('node:http');
    const received: URLSearchParams[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(new URLSearchParams(body));
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('send ok\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const prev = { url: process.env.MESSENGER_URL, allow: process.env.MESSENGER_ALLOWLIST };
    process.env.MESSENGER_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    process.env.MESSENGER_ALLOWLIST = '*';
    try {
      const { prisma } = await import('@/server/db');
      // Tincase를 쓰지 않는 본부 아래 한 실만 쓴다 — 그 실이 바로 총괄에 낸다 (RU-07)
      await prisma.division.create({ data: { slug: 'HQ_Off', nameKo: '꺼진본부', nameEn: 'HQ_Off', isActive: false, parentKo: '한국환경연구원' } });
      await prisma.division.create({ data: { slug: 'Unit_Lone', nameKo: '외딴실', nameEn: 'Unit_Lone', isActive: true, parentKo: '꺼진본부' } });
      const c1 = await prisma.user.create({ data: { email: 'coord1@test.kei.re.kr', name: '총괄하나', employeeNo: '9001', isCoordinator: true, divisionId: divId.solo } });
      const c2 = await prisma.user.create({ data: { email: 'coord2@test.kei.re.kr', name: '총괄둘', employeeNo: '9002', isCoordinator: true, divisionId: divId.solo } });

      vi.resetModules(); // env(메신저 주소)는 모듈 로드 때 굳는다
      const { runDueRollupNotices, orgArrivalKind } = await import('@/server/rollup/notices');
      const { stageTimes } = await import('@/server/rollup/schedule');
      const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
      const now = new Date((await stageTimes(slot)).hqDue.getTime() + 60_000); // 본부 → 총괄 기한 직후

      const sent = await runDueRollupNotices(now);
      expect(sent.map((r) => r.kind).sort()).toEqual([orgArrivalKind(c1.id), orgArrivalKind(c2.id)].sort());
      expect(received.map((f) => f.get('RecvId')).sort()).toEqual(['9001', '9002']);
      for (const f of received) {
        expect(f.get('Contents')).toContain('외딴실');
        expect(f.get('Contents')).not.toContain('꺼진본부');
      }
      // 같은 창에서 다시 돌아도 두 번 가지 않는다
      expect(await runDueRollupNotices(now)).toEqual([]);
      expect(received).toHaveLength(2);
    } finally {
      if (prev.url === undefined) delete process.env.MESSENGER_URL;
      else process.env.MESSENGER_URL = prev.url;
      if (prev.allow === undefined) delete process.env.MESSENGER_ALLOWLIST;
      else process.env.MESSENGER_ALLOWLIST = prev.allow;
      vi.resetModules();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

d('RU-60~68 · TACP-21 — 전사 섹션: 경계 · 본부본에 없음 · 본부 자신의 섹션 · 누락·중복 · 양식 (2026-10-08 점검)', () => {
  const U3_LEAD = 'u3-lead@test.kei.re.kr';
  const OP2 = 'op2@test.kei.re.kr';
  type SectionRow = { id: string; title: string; divisionId: string | null; isActive: boolean };
  const activeSections = async (): Promise<SectionRow[]> => {
    const { prisma } = await import('@/server/db');
    return (await prisma.orgSection.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })).map((x) => ({
      id: x.id,
      title: x.title,
      divisionId: x.divisionId,
      isActive: true,
    }));
  };
  const putSections = async (who: string, list: SectionRow[]) => {
    const { PUT } = await import('@/app/api/rollup/org/sections/route');
    return PUT(nx('/api/rollup/org/sections', who, jsonInit('PUT', { sections: list })));
  };
  const orgView = async () => {
    const { orgBoard } = await import('@/server/org-board');
    const { rollupSlot } = await import('@/server/rollup/slot');
    return orgBoard(await rollupSlot(isoKey), { progress: false, desk: true }, '');
  };
  const lastOrgRunOf = async (who: string) => {
    const org = await import('@/app/api/rollup/org/route');
    return (await (await org.GET(nx(`/api/rollup/org?isoKey=${isoKey}`, who))).json()).lastRun as {
      stale: boolean;
      template: string | null;
      warnings: string[];
      sections: { title: string; status: string; source: string }[];
    };
  };
  const makeOrg = async (who: string) => {
    const org = await import('@/app/api/rollup/org/route');
    return (await org.POST(nx('/api/rollup/org', who, jsonInit('POST', { isoKey })))).status;
  };

  it('[RU-T70] ★ TACP-21 — 전사 섹션 경로(파일 올리기·받기·취소, 섹션 저장, 전사본 받기): member·lead·본부 담당자 404, 총괄 200 + 기록 1건 · 취소한 파일은 받기 404', async () => {
    const { prisma } = await import('@/server/db');
    const { readStoredFile } = await import('@/server/storage');
    const section = await prisma.orgSection.findFirstOrThrow({ where: { title: '단독단' } });
    const solo = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.solo, level: 'unit', withdrawnAt: null } });
    const bytes = await readStoredFile(solo.filePath);
    const outsiders = [ID.u1Member, ID.u1Lead, ID.hqLead];
    const logs = () => prisma.auditLog.count({ where: { actor: ID.coord } });

    // 파일 올리기
    const upload = await import('@/app/api/rollup/org/sections/upload/route');
    const post = (who: string) => {
      const fd = new FormData();
      fd.set('file', new File([new Uint8Array(bytes)], 'board.hwp'));
      fd.set('sectionId', section.id);
      fd.set('isoKey', isoKey);
      return upload.POST(nx('/api/rollup/org/sections/upload', who, { method: 'POST', body: fd }));
    };
    for (const who of outsiders) expect((await post(who)).status, who).toBe(404);
    let before = await logs();
    const res = await post(ID.coord);
    expect(res.status).toBe(200);
    const uploadId: string = (await res.json()).id;
    expect(await logs()).toBe(before + 1);

    // 올린 파일 받기 — 판정·기록은 findReadableSectionUpload 하나 (라우트가 직접 조회하지 않는다)
    const one = await import('@/app/api/rollup/org/sections/upload/[id]/route');
    const get = (who: string) => one.GET(nx(`/api/rollup/org/sections/upload/${uploadId}`, who), { params: Promise.resolve({ id: uploadId }) });
    for (const who of outsiders) expect((await get(who)).status, who).toBe(404);
    before = await logs();
    expect((await get(ID.coord)).status).toBe(200);
    expect(await logs()).toBe(before + 1);
    expect(await prisma.auditLog.count({ where: { actor: ID.coord, action: 'download', target: `org-section-upload:${uploadId}` } })).toBe(1);
    expect(readFileSync(path.resolve(__dirname, '../src/app/api/rollup/org/sections/upload/[id]/route.ts'), 'utf8')).not.toContain('prisma');

    // 섹션 저장
    const list = await activeSections();
    for (const who of outsiders) expect((await putSections(who, list)).status, who).toBe(404);
    before = await logs();
    expect((await putSections(ID.coord, list)).status).toBe(200);
    expect(await logs()).toBe(before + 1);

    // 전사본 받기 — 본부 담당자도 전사본은 404 (본부본만 그 본부의 것)
    const orgRun = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'org', status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    const run = await import('@/app/api/rollup/run/[id]/route');
    const getRun = (who: string) => run.GET(nx(`/api/rollup/run/${orgRun.id}`, who), { params: Promise.resolve({ id: orgRun.id }) });
    for (const who of outsiders) expect((await getRun(who)).status, who).toBe(404);
    before = await logs();
    expect((await getRun(ID.coord)).status).toBe(200);
    expect(await logs()).toBe(before + 1);

    // 취소 — 취소한 파일은 id를 알아도 받기 404 (최종본에서 빠진 파일이 계속 받히면 취소가 화면에서만 일어난 일이 된다)
    const del = (who: string) => upload.DELETE(nx(`/api/rollup/org/sections/upload?id=${uploadId}`, who, { method: 'DELETE' }));
    for (const who of outsiders) expect((await del(who)).status, who).toBe(404);
    before = await logs();
    expect((await del(ID.coord)).status).toBe(200);
    expect(await logs()).toBe(before + 1);
    expect((await get(ID.coord)).status).toBe(404);
  });

  it('[RU-T71] ★ RU-32 — 실은 냈는데 본부가 낸 판에 없으면 「본부본에 없음」(그 본부 취합 길), 회색 「미제출」이 아니다', async () => {
    const { prisma } = await import('@/server/db');
    await prisma.user.create({ data: { email: U3_LEAD, name: 'u3-lead', divisionId: divId.u3, divisionRole: 'lead' } });
    const hq = await import('@/app/api/rollup/hq/route');
    const report = await import('@/app/api/rollup/report/route');
    // 본부나 = 자체 + 실셋 (RU-T39에서 자체 켬). 본부나가 자기 몫만 이어 붙여 총괄에 낸 **뒤에** 실셋이 낸다
    await merged('hq2', '본부나 자체 내용');
    expect((await submitUnit(ID.hq2Lead)).status).toBe(200);
    expect((await hq.POST(nx('/api/rollup/hq', ID.hq2Lead, jsonInit('POST', { isoKey })))).status).toBe(200);
    expect((await report.POST(nx('/api/rollup/report', ID.hq2Lead, jsonInit('POST', { level: 'hq', isoKey })))).status).toBe(200);
    await merged('u3', '실셋 내용');
    expect((await submitUnit(U3_LEAD)).status).toBe(200);

    const row = (await orgView()).rows.find((r) => r.title === '본부나(실셋)')!;
    expect(row.final).toMatchObject({ source: 'not_in_hq', label: '본부나에서 다시 이어 붙여야 합니다' });
    expect(row.hq?.href).toBe('/hq?node=HQ_B');
  });

  it('[RU-T72] ★ RU-67 · RU-64 — 본부 자신의 섹션은 본부본의 남은 사본을 다 담는다 · 어느 섹션에도 없는 사본은 「전사」 화면과 결과에 경고', async () => {
    const { prisma } = await import('@/server/db');
    // 점검의 buildTree 사례 그대로 — 본부가 직접 쓰고(rollupSelf) 산하 실도 켜져 기여 단위가 둘 → 본부 단계가 있다
    const { loadTree } = await import('@/server/rollup/tree');
    const node = (await loadTree()).nodes.find((x) => x.node.id === divId.hq2)!;
    expect([node.hasHqStep, node.contributors.map((c) => c.nameKo)]).toEqual([true, ['본부나', '실셋']]);
    // 본부나의 본부본에는 본부나 자기 사본이 있는데 그 부서를 가리키는 섹션이 없다 → 최종본에서 빠진다는 경고
    let board = await orgView();
    expect(board.coverage).toEqual([expect.stringContaining('「본부나」 사본이 어느 섹션에도 없어 최종본에서 빠집니다')]);
    expect(await makeOrg(ID.coord)).toBe(200);
    expect((await lastOrgRunOf(ID.coord)).warnings[0]).toContain('「본부나」 사본이 어느 섹션에도 없어');

    // 본부나가 실셋까지 넣어 다시 이어 붙여 내면 실셋 섹션은 Tincase로
    const hq = await import('@/app/api/rollup/hq/route');
    const report = await import('@/app/api/rollup/report/route');
    expect((await hq.POST(nx('/api/rollup/hq', ID.hq2Lead, jsonInit('POST', { isoKey })))).status).toBe(200);
    expect((await report.POST(nx('/api/rollup/report', ID.hq2Lead, jsonInit('POST', { level: 'hq', isoKey })))).status).toBe(200);
    board = await orgView();
    expect(board.rows.find((r) => r.title === '본부나(실셋)')!.final!.source).toBe('tincase');

    // 본부 자신의 섹션을 두면 — 실셋 사본은 실셋 섹션이 가져가고, 본부나 섹션에는 본부나 사본만
    await prisma.orgSection.create({ data: { sortOrder: 35, title: '본부나', divisionId: divId.hq2 } });
    const ownCopy = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.hq2, level: 'unit', withdrawnAt: null } });
    const hqRep = await prisma.reportSubmission.findFirstOrThrow({ where: { divisionId: divId.hq2, level: 'hq', withdrawnAt: null }, orderBy: { submittedAt: 'desc' } });
    board = await orgView();
    expect(board.coverage).toEqual([]);
    const own = board.rows.find((r) => r.title === '본부나')!.final!;
    expect([own.source, own.refId]).toEqual(['tincase', ownCopy.id]);

    // 실셋 섹션을 끄면 본부나 섹션이 실셋 사본까지 — 본부본에 붙은 순서·제목 그대로(본부장이 검토한 꼴, RU-11).
    // 예전에는 본부 자신의 섹션이 본부의 실·팀 사본 하나만 집어 실셋의 것이 경고 없이 빠졌다
    await prisma.orgSection.updateMany({ where: { title: '본부나(실셋)' }, data: { isActive: false } });
    board = await orgView();
    expect(board.coverage).toEqual([]);
    const both = board.rows.find((r) => r.title === '본부나')!.final!;
    expect(both.label).toContain('2개 단위');
    expect(both.refId).toBe(hqRep.id); // 받기는 본부가 낸 본부본 그대로
    expect(await makeOrg(ID.coord)).toBe(200);
    const last = await lastOrgRunOf(ID.coord);
    expect(last.warnings.join(' ')).not.toContain('어느 섹션에도 없어');
    expect(last.sections.find((x) => x.title === '본부나')).toMatchObject({ status: 'copied', source: 'tincase' });
    const run = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'org' }, orderBy: { startedAt: 'desc' } });
    const { readStoredFile } = await import('@/server/storage');
    const { readUnits } = await import('@/lib/hwp/rollup');
    const names = readUnits(await readStoredFile(run.outputPath!), 'x').units.map((u) => u.name);
    const at = names.indexOf('본부나');
    expect(names.slice(at, at + 2)).toEqual(['본부나', '본부나(실셋)']);
  });

  it('[RU-T73] RU-60 · RU-64 — 같은 부서를 두 섹션에 두면 422(어느 부서·어느 섹션인지) · 만든 뒤 제목만 고쳐도 「섹션이 바뀜」', async () => {
    const list = await activeSections();
    const res = await putSections(
      ID.coord,
      list.map((x) => (x.title === '단독단' ? { ...x, divisionId: divId.u1 } : x)),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe('한 부서는 한 섹션에만 둘 수 있습니다 — 실하나(「본부가(실하나)」·「단독단」)');
    // 바로 앞(RU-T72)에서 만든 전사본은 아직 그대로다. 제목만 바꿔도 받은 파일의 제목은 옛것이므로 「바뀜」
    expect((await lastOrgRunOf(ID.coord)).stale).toBe(false);
    expect((await putSections(ID.coord, list.map((x) => (x.title === '단독단' ? { ...x, title: '단독단(새 제목)' } : x)))).status).toBe(200);
    expect((await lastOrgRunOf(ID.coord)).stale).toBe(true);
  });

  it('[RU-T74] RU-68 — 전사본 양식은 누가 눌렀나와 상관없이 총괄 부서의 것 · 쓴 양식이 결과에 남는다', async () => {
    const { prisma } = await import('@/server/db');
    // 총괄은 모두 단독단 소속이다. 실하나 소속 운영자가 눌러도 실하나 양식이 아니다
    await prisma.user.create({ data: { email: OP2, name: 'op2', divisionId: divId.u1, isOperator: true } });
    expect(await makeOrg(ID.coord)).toBe(200);
    expect((await lastOrgRunOf(ID.coord)).template).toBe('단독단 양식 v1');
    expect(await makeOrg(OP2)).toBe(200);
    expect((await lastOrgRunOf(OP2)).template).toBe('단독단 양식 v1');
  });

  it('[RU-T75] RU-30 — [제출] 카드의 기한은 그 단위의 것: 본부로 내면 실·팀 → 본부, 바로 총괄로 내면(본부본 포함) 본부 → 총괄', async () => {
    const { prisma } = await import('@/server/db');
    const { stageTimes, stageCells } = await import('@/server/rollup/schedule');
    const { GET } = await import('@/app/api/rollup/report/route');
    const dueOf = async (who: string, level = 'unit') =>
      (await (await GET(nx(`/api/rollup/report?level=${level}&isoKey=${isoKey}`, who))).json()).state.dueKo as string;
    const t = await stageTimes(await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } }));
    const cells = stageCells(t.anchor, t);
    expect(cells.unitDueKo).not.toBe(cells.hqDueKo); // RU-T42가 간격을 60·180으로 두었다
    expect(await dueOf(ID.u1Lead)).toBe(cells.unitDueKo); // 실하나 → 본부가
    expect(await dueOf(ID.soloLead)).toBe(cells.hqDueKo); // 단독단 → 바로 총괄 (RU-07)
    expect(await dueOf(ID.hq2Lead, 'hq')).toBe(cells.hqDueKo); // 본부본 → 총괄
  });
});
