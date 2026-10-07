// TACP-22 · WA-20 — 담당자 첨삭. 새로 허용된 것과 그대로 금지인 것을 같은 무게로 본다 (TACP §10-4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-revise-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-revise.db';
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

const ID = {
  lead: 'v-lead@test.kei.re.kr',
  head: 'v-head@test.kei.re.kr',
  owner: 'v-owner@test.kei.re.kr',
  member: 'v-member@test.kei.re.kr',
  coord: 'v-coord@test.kei.re.kr',
  otherLead: 'v-other-lead@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const body = (content: string) =>
  JSON.stringify({ achievements: [{ content, date: '10/7', emphasis: true }], plans: [{ content: '다음 주 계획' }], notes: [] });
async function revise(identity: string, id: string, content = '담당자가 다듬은 실적') {
  const { PUT } = await import('@/app/api/submissions/[id]/content/route');
  return PUT(nx(`/api/submissions/${id}/content`, identity, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: body(content) }), {
    params: Promise.resolve({ id }),
  });
}

let firstId = '';

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-revise.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const { composeMergedHwp } = await import('@/server/merge');
  const slot = await ensureCurrentSlot();

  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  const div = await prisma.division.create({ data: { slug: 'Rv_A', nameKo: '첨삭실', nameEn: 'Rv_A', isActive: true } });
  const other = await prisma.division.create({ data: { slug: 'Rv_B', nameKo: '옆실', nameEn: 'Rv_B', isActive: true } });
  await writeFileAtomic('divisions/Rv_A/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Rv_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });

  const mk = (email: string, divisionId: string, extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId, ...extra } });
  await mk(ID.lead, div.id, { divisionRole: 'lead' });
  await mk(ID.head, div.id, { divisionRole: 'head' });
  const owner = await mk(ID.owner, div.id);
  await mk(ID.member, div.id);
  await mk(ID.coord, other.id, { isCoordinator: true });
  await mk(ID.otherLead, other.id, { divisionRole: 'lead' });

  // 부서원이 낸 v1 — 늦게 낸 「원래 내용」
  const bytes = composeMergedHwp(tpl, { achievements: [['1-1', '원래 실적', '', '', '']], plans: [], notes: [] }).bytes;
  await writeFileAtomic('divisions/Rv_A/submissions/owner_v1.hwp', bytes);
  const sub = await prisma.submission.create({
    data: {
      divisionId: div.id,
      userId: owner.id,
      weekSlotId: slot.id,
      version: 1,
      isLatest: true,
      filePath: 'divisions/Rv_A/submissions/owner_v1.hwp',
      originalName: 'owner.hwp',
      byteSize: bytes.length,
      sha256: 'v1',
    },
  });
  firstId = sub.id;
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('TACP-22 담당자 첨삭', () => {
  it('[WA-T41] ★ member·본인·coordinator·다른 부서 lead → 404 (그대로 금지인 것)', async () => {
    for (const who of [ID.member, ID.owner, ID.coord, ID.otherLead]) {
      expect((await revise(who, firstId)).status, who).toBe(404);
    }
    const { prisma } = await import('@/server/db');
    expect(await prisma.submission.count()).toBe(1);
  });

  it('[WA-T40] ★ lead가 고치면 **그 사람의 새 판** — 원래 판은 남고, 고친 사람이 붙는다', async () => {
    const res = await revise(ID.lead, firstId);
    expect(res.status).toBe(200);
    const { id, version } = await res.json();
    expect(version).toBe(2);

    const { prisma } = await import('@/server/db');
    const owner = await prisma.user.findFirstOrThrow({ where: { email: ID.owner } });
    const lead = await prisma.user.findFirstOrThrow({ where: { email: ID.lead } });
    const v2 = await prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(v2).toMatchObject({ userId: owner.id, isLatest: true, origin: 'lead_edit', editedById: lead.id });
    const v1 = await prisma.submission.findUniqueOrThrow({ where: { id: firstId } });
    expect(v1.isLatest).toBe(false); // 지우지 않는다 — 판만 내려간다

    const { readStoredFile } = await import('@/server/storage');
    const { readWorklog } = await import('@/lib/hwp/reader');
    expect(readWorklog(await readStoredFile(v1.filePath)).worklog.achievements[0].content).toBe('원래 실적');
    const w = readWorklog(await readStoredFile(v2.filePath)).worklog;
    expect(w.achievements[0]).toMatchObject({ content: '담당자가 다듬은 실적', date: '10/7', emphasis: true });

    expect(await prisma.auditLog.count({ where: { action: 'submission_revise', actor: ID.lead } })).toBe(1);
  });

  it('[WA-T40b] head도 고친다 (TACP-16) · 옛 판을 고치려 하면 409', async () => {
    const { prisma } = await import('@/server/db');
    const latest = await prisma.submission.findFirstOrThrow({ where: { isLatest: true } });
    expect((await revise(ID.head, latest.id, '실장이 다듬은 실적')).status).toBe(200);
    expect((await revise(ID.lead, firstId)).status).toBe(409);
    expect(await prisma.submission.count()).toBe(3);
  });

  it('[WA-T42] 열람 응답 — lead에게만 [고치기], 판 목록에 고친 사람', async () => {
    const { prisma } = await import('@/server/db');
    const latest = await prisma.submission.findFirstOrThrow({ where: { isLatest: true } });
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const asLead = await (await GET(nx(`/api/submissions/${latest.id}/preview`, ID.lead), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(asLead.canRevise).toBe(true);
    expect(asLead.submission.editedBy).toBe('v-head');
    const asOwner = await (await GET(nx(`/api/submissions/${latest.id}/preview`, ID.owner), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(asOwner.canRevise).toBe(false);

    const versions = await import('@/app/api/submissions/[id]/versions/route');
    const v = await (await versions.GET(nx(`/api/submissions/${latest.id}/versions`, ID.owner), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(v.versions.map((x: { version: number; editedBy: string | null }) => [x.version, x.editedBy])).toEqual([
      [3, 'v-head'],
      [2, 'v-lead'],
      [1, null],
    ]);
  });
});
