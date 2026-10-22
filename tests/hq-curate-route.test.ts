// RH-124 · RH-125 · TACP-21 v1.19 — 본부 다듬기 API와 본부본 반영. hwp 대신 JSON 「양식」으로 돈다(연구 본부 양식 hwp는 비공개 원본에서만
// 만들 수 있다 — 그 모양은 hq-form · project-form 시험이 본다). 여기서 보는 것은 권한 · 저장 · 열쇠 · 다시 만들기다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HqFormData } from '@/lib/hwp/hq-form';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-hc-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-hc.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
delete process.env.DEV_IDENTITY;

// 「PROJ」 + JSON = 연구 본부 양식(과제 표) · 「UNIT」 = 실형 양식
vi.mock('@/lib/hwp/hq-form', async (orig) => {
  const real = await orig<typeof import('@/lib/hwp/hq-form')>();
  const isProj = (b: Buffer) => b.subarray(0, 4).toString() === 'PROJ';
  return {
    ...real,
    isProjectForm: isProj,
    parseHqForm: (b: Buffer) => {
      if (!isProj(b)) throw new Error('not project');
      return JSON.parse(b.subarray(4).toString()) as HqFormData;
    },
    fillHqForm: (_t: Buffer, d: HqFormData) => Buffer.from('PROJ' + JSON.stringify(d)),
    consultLabels: () => ['국토환경연구본부', '국토관리연구실', '물관리연구실'],
  };
});

const HQ = '국토환경연구본부';
const DIV = {
  hq: { slug: 'Land_HQ', nameKo: HQ },
  u1: { slug: 'Land_U1', nameKo: '국토관리연구실', parentKo: HQ },
  u2: { slug: 'Land_U2', nameKo: '물관리연구실', parentKo: HQ },
  hq2: { slug: 'Other_HQ', nameKo: '생활환경연구본부' },
  u3: { slug: 'Other_U3', nameKo: '순환경제연구실', parentKo: '생활환경연구본부' },
  u4: { slug: 'Other_U4', nameKo: '환경보건연구실', parentKo: '생활환경연구본부' },
  solo: { slug: 'Solo', nameKo: '기획조정실' },
};
const ID = {
  hqLead: 'hq-lead@test.kei.re.kr',
  hqHead: 'hq-head@test.kei.re.kr',
  u1Lead: 'u1-lead@test.kei.re.kr',
  u1Member: 'u1-member@test.kei.re.kr',
  hq2Lead: 'hq2-lead@test.kei.re.kr',
  coord: 'coord@test.kei.re.kr',
  desk: 'desk@test.kei.re.kr',
};
const divId: Record<string, string> = {};
let isoKey = '';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, { ...init, headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) } });
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const item = (content: string, date: string) => ({ content, date, place: '서울역', people: '가나다 외' });
// 이번 주 월요일(슬롯) 기준 날짜를 「m/d」로
let mon = new Date();
const md = (offset: number) => {
  const d = new Date(mon.getTime() + offset * 86_400_000 + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

async function sendCopy(key: 'u1' | 'u2' | 'u3' | 'u4', data: HqFormData) {
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
  const bytes = Buffer.from('PROJ' + JSON.stringify(data));
  const rel = `divisions/${DIV[key].slug}/reports/${Date.now()}_${Math.random().toString(36).slice(2)}.hwp`;
  await writeFileAtomic(rel, bytes);
  return prisma.reportSubmission.create({
    data: { level: 'unit', divisionId: divId[key], weekSlotId: slot.id, filePath: rel, sha256: 'x', byteSize: bytes.length, submittedBy: 'system', basis: 'no_head' },
  });
}

async function latestHq(key: 'hq' | 'hq2') {
  const { prisma } = await import('@/server/db');
  const { readStoredFile } = await import('@/server/storage');
  const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
  const run = await prisma.rollupRun.findFirst({ where: { level: 'hq', divisionId: divId[key], weekSlotId: slot.id, status: 'succeeded' }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] });
  if (!run?.outputPath) return null;
  return { run, data: JSON.parse((await readStoredFile(run.outputPath)).subarray(4).toString()) as HqFormData };
}

async function sync(key: 'hq' | 'hq2') {
  const { prisma } = await import('@/server/db');
  const { loadTree, hqNodeOf } = await import('@/server/rollup/tree');
  const { syncHq } = await import('@/server/rollup/auto');
  const { settleLater } = await import('@/server/after');
  const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
  await syncHq(hqNodeOf(await loadTree(), divId[key])!, slot, { cause: 'test', causedBy: null });
  await settleLater();
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-hc.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const slot = await ensureCurrentSlot();
  isoKey = slot.isoKey;
  mon = slot.opensAt;
  for (const [key, d] of Object.entries(DIV)) {
    const row = await prisma.division.create({
      data: { slug: d.slug, nameKo: d.nameKo, nameEn: d.slug, isActive: true, parentKo: 'parentKo' in d ? d.parentKo : '한국환경연구원', rollupSelf: !['hq', 'hq2'].includes(key) },
    });
    divId[key] = row.id;
    const rel = `divisions/${d.slug}/template/active.hwp`;
    await writeFileAtomic(rel, Buffer.from(key === 'solo' ? 'UNIT' : 'PROJ{}'));
    await prisma.template.create({ data: { divisionId: row.id, filePath: rel, sha256: `t-${key}`, version: 1, uploadedBy: 'seed' } });
  }
  const mk = (email: string, key: keyof typeof DIV, extra: object = {}) => prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: divId[key], ...extra } });
  await mk(ID.hqLead, 'hq', { divisionRole: 'lead' });
  await mk(ID.hqHead, 'hq', { divisionRole: 'head' });
  await mk(ID.u1Lead, 'u1', { divisionRole: 'lead' });
  await mk(ID.u1Member, 'u1');
  await mk(ID.hq2Lead, 'hq2', { divisionRole: 'lead' });
  await mk(ID.coord, 'solo', { isCoordinator: true });
  const desk = await mk(ID.desk, 'u2', { divisionRole: 'lead' });
  await prisma.hqDesk.create({ data: { userId: desk.id, divisionId: divId.hq, createdBy: 'seed' } });
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });

  await sendCopy('u1', {
    results: [
      { unit: '국토실', type: '기본', title: '연구원 과제', owner: '가', items: [item('착수보고회', md(1))] },
      { unit: '국토실', type: '수탁', title: '수탁 과제', owner: '나', items: [item('중간보고회', md(2)), item('현장 회의', md(3))] },
    ],
    plans: [{ unit: '국토실', type: '수탁', title: '수탁 과제', owner: '나', items: [item('전문가 세미나', md(8))] }],
    notes: [item('협의체 발제', md(1)), item('내부 논의', md(2))],
    consult: [{ label: '국토관리연구실', values: ['-', '-', '-', '-'] }],
  });
  await sendCopy('u2', { results: [{ unit: '물실', type: '수탁', title: '물 과제', owner: '다', items: [item('실무자 회의', md(2))] }], plans: [], notes: [] });
  await sendCopy('u3', { results: [{ unit: '순환실', type: '기본', title: '순환 과제', owner: '라', items: [item('착수보고회', md(1))] }], plans: [], notes: [] });
  await sendCopy('u4', { results: [{ unit: '보건실', type: '수탁', title: '보건 과제', owner: '마', items: [item('강의', md(1))] }], plans: [], notes: [] });
  await sync('hq');
  await sync('hq2');
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('RH-125 — 다듬기의 문 (TACP-21 v1.19)', () => {
  it('[RH-T125] 실 담당 · 부서원 · 총괄(readAll) · 다른 본부 담당은 404 — 본부 담당 · 본부장 · 지정된 본부 담당은 열린다', async () => {
    const { GET, PUT } = await import('@/app/api/rollup/hq/curate/route');
    for (const who of [ID.u1Lead, ID.u1Member, ID.coord]) {
      expect((await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`, who))).status, who).toBe(404);
      expect((await PUT(nx('/api/rollup/hq/curate', who, put({ isoKey, decisions: {}, consult: {} })))).status, who).toBe(404);
    }
    expect((await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}&node=${DIV.hq.slug}`, ID.hq2Lead))).status).toBe(404);
    for (const who of [ID.hqLead, ID.hqHead]) expect((await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`, who))).status, who).toBe(200);
    expect((await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}&node=${DIV.hq.slug}`, ID.desk))).status).toBe(200);
    expect((await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`))).status).toBe(401);
  });

  it('[RH-T125] 요청 모양 — 열쇠 모양 · 값 넷이 아니면 422', async () => {
    const { PUT } = await import('@/app/api/rollup/hq/curate/route');
    expect((await PUT(nx('/api/rollup/hq/curate', ID.hqLead, put({ isoKey, decisions: { 'not-a-key': true }, consult: {} })))).status).toBe(422);
    expect((await PUT(nx('/api/rollup/hq/curate', ID.hqLead, put({ isoKey, decisions: {}, consult: { 국토관리연구실: ['1'] } })))).status).toBe(422);
  });
});

describe('RH-124 — 본부본에 반영', () => {
  it('[RH-T125] 규칙이 있는 본부는 손대지 않아도 규칙대로 덜어진 본부본 · 자문회의는 센 값', async () => {
    const hq = (await latestHq('hq'))!;
    expect(hq.data.results.flatMap((t) => t.items.map((i) => i.content))).toEqual(['중간보고회', '현장 회의', '실무자 회의']);
    expect(hq.data.notes.map((n) => n.content)).toEqual(['협의체 발제']);
    expect(hq.data.consult).toEqual([
      { label: '국토관리연구실', values: ['1', '-', '-', '2'] },
      { label: '물관리연구실', values: ['-', '-', '-', '1'] },
    ]);
  });

  it('[RH-T125] 규칙 없는 본부는 받은 그대로 · 열쇠에 다듬기가 없다', async () => {
    const other = (await latestHq('hq2'))!;
    expect(other.data.results.flatMap((t) => t.items.map((i) => i.content))).toEqual(['착수보고회', '강의']);
    const { prisma } = await import('@/server/db');
    const { loadTree, hqNodeOf } = await import('@/server/rollup/tree');
    const { hqInputs, hqInputKey, hqTemplateRef } = await import('@/server/rollup/run');
    const { sha256 } = await import('@/server/storage');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } });
    const node = hqNodeOf(await loadTree(), divId.hq2)!;
    const inputs = await hqInputs(node, slot);
    const legacy = sha256(
      Buffer.from(
        JSON.stringify({ v: 1, hq: node.node.id, units: inputs.map((i) => [i.division.id, i.report?.id ?? null]), pageBreak: node.node.rollupPageBreak, template: await hqTemplateRef(node) }),
      ),
    );
    expect(await hqInputKey(node, inputs, slot)).toBe(legacy);
    expect(other.run.inputKey).toBe(legacy);
  });

  it('[RH-T125] 저장 — 규칙과 다른 것만 남고, 본부본이 그 자리에서 다시 만들어진다 · 감사', async () => {
    const { GET, PUT } = await import('@/app/api/rollup/hq/curate/route');
    const board = await (await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`, ID.hqLead))).json();
    expect(board.rules.source).toContain('국토환경');
    expect(board.limit).toBeGreaterThanOrEqual(1);
    const before = (await latestHq('hq'))!.run.id;
    const key = (c: string) => board.items.find((i: { item: { content: string } }) => i.item.content === c).key;
    const decisions = Object.fromEntries(board.items.map((i: { key: string; included: boolean }) => [i.key, i.included]));
    decisions[key('현장 회의')] = false; // 뺌
    decisions[key('착수보고회')] = true; // 규칙과 달리 넣음
    const res = await PUT(nx('/api/rollup/hq/curate', ID.hqLead, put({ isoKey, decisions, consult: { 물관리연구실: ['-', '-', '-', '3'], 국토관리연구실: ['1', '-', '-', '2'] } })));
    expect(res.status).toBe(200);
    const after = await res.json();
    expect(after.saved.by).toBe(ID.hqLead);
    expect(after.items.find((i: { item: { content: string } }) => i.item.content === '현장 회의').included).toBe(false);

    const { prisma } = await import('@/server/db');
    const row = await prisma.hqCuration.findFirstOrThrow({ where: { divisionId: divId.hq } });
    // 규칙 답과 같은 것(나머지 항목 · 국토관리연구실의 센 값)은 남지 않는다
    expect(Object.keys(JSON.parse(row.decisions)).sort()).toEqual([key('현장 회의'), key('착수보고회')].sort());
    expect(JSON.parse(row.consult)).toEqual({ 물관리연구실: ['-', '-', '-', '3'] });

    const hq = (await latestHq('hq'))!;
    expect(hq.run.id).not.toBe(before);
    expect(hq.run.cause).toBe('curate');
    expect(hq.data.results.flatMap((t) => t.items.map((i) => i.content))).toEqual(['착수보고회', '중간보고회', '실무자 회의']);
    expect(hq.data.consult?.find((c) => c.label === '물관리연구실')?.values).toEqual(['-', '-', '-', '3']);
    expect(await prisma.auditLog.count({ where: { action: 'hq_curate', actor: ID.hqLead } })).toBe(1);
  });

  it('[RH-T125] 실이 다시 내도 같은 항목에는 같은 결정 · 모두 규칙대로면 저장값이 지워진다', async () => {
    await sendCopy('u1', {
      results: [{ unit: '국토실', type: '수탁', title: '수탁 과제', owner: '나', items: [item('중간보고회', md(2)), { ...item('현장 회의', md(3)), place: '세종' }] }],
      plans: [],
      notes: [],
    });
    await sync('hq');
    expect((await latestHq('hq'))!.data.results.flatMap((t) => t.items.map((i) => i.content))).toEqual(['중간보고회', '실무자 회의']);
    const { GET, PUT } = await import('@/app/api/rollup/hq/curate/route');
    const board = await (await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`, ID.hqLead))).json();
    const decisions = Object.fromEntries(board.items.map((i: { key: string; suggested: boolean }) => [i.key, i.suggested]));
    const consult = Object.fromEntries(board.consult.map((c: { label: string; reported: string[] | null; counted: number[] | null }) => [c.label, c.reported ?? (c.counted ?? [0, 0, 0, 0]).map((n) => (n > 0 ? String(n) : '-'))]));
    expect((await PUT(nx('/api/rollup/hq/curate', ID.hqLead, put({ isoKey, decisions, consult })))).status).toBe(200);
    const { prisma } = await import('@/server/db');
    expect(await prisma.hqCuration.count({ where: { divisionId: divId.hq } })).toBe(0);
  });

  it('[RH-T125] 실형 양식 본부는 404 not_project_form', async () => {
    const { prisma } = await import('@/server/db');
    const { writeFileAtomic } = await import('@/server/storage');
    const t = await prisma.template.findFirstOrThrow({ where: { divisionId: divId.hq2 } });
    await writeFileAtomic(t.filePath, Buffer.from('UNIT'));
    await prisma.template.update({ where: { id: t.id }, data: { sha256: 't-hq2-unit' } });
    const { GET } = await import('@/app/api/rollup/hq/curate/route');
    const res = await GET(nx(`/api/rollup/hq/curate?isoKey=${isoKey}`, ID.hq2Lead));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_project_form');
  });
});
