// TACP-21 · RU-01~07 — 위로 올린 제출과 본부·전사 취합의 **경계**.
//
// 새로 열린 것은 하나다: 본부 담당자·본부장이 산하 실·팀이 **보낸 사본**을 읽는다.
// 그래서 테스트는 「열린 것이 열렸나」와 「나머지는 그대로 닫혀 있나」를 같은 무게로 본다 (TACP §10-4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  it('[RU-T34] ★ 전사 이어 붙이기 — 총괄 허용, 본부 담당자 404. 본부는 [총괄에 제출]한 것만, 단독 단위는 바로', async () => {
    const report = await import('@/app/api/rollup/report/route');
    expect((await report.POST(nx('/api/rollup/report', ID.hqLead, jsonInit('POST', { level: 'hq', isoKey })))).status).toBe(200);
    // 본부 밖 단위 — 실·팀 [제출]이 곧 총괄로
    await merged('solo', '단독단 내용');
    await submitUnit(ID.soloLead);

    const org = await import('@/app/api/rollup/org/route');
    expect((await org.POST(nx('/api/rollup/org', ID.hqLead, jsonInit('POST', { isoKey })))).status).toBe(404);
    const res = await org.POST(nx('/api/rollup/org', ID.coord, jsonInit('POST', { isoKey })));
    expect(res.status).toBe(200);
    const board = await (await org.GET(nx(`/api/rollup/org?isoKey=${isoKey}`, ID.coord))).json();
    // 본부나는 아무것도 안 냈다 — 빠지고, 화면에 「도착 전」으로 남는다 (RU-04)
    expect(board.board.lastRun.units.map((u: { name: string }) => u.name)).toEqual(['실둘', '실하나', '단독단']);
    expect(board.board.nodes.find((n: { node: { nameKo: string } }) => n.node.nameKo === '본부나').ready).toBe(false);
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
