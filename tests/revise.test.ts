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

  it('[WA-T42] 열람 응답 — lead에게만 [고치기], 판마다 고친 사람이 남는다', async () => {
    const { prisma } = await import('@/server/db');
    const latest = await prisma.submission.findFirstOrThrow({ where: { isLatest: true } });
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const asLead = await (await GET(nx(`/api/submissions/${latest.id}/preview`, ID.lead), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(asLead.canRevise).toBe(true);
    expect(asLead.submission.editedBy).toBe('v-head');
    const asOwner = await (await GET(nx(`/api/submissions/${latest.id}/preview`, ID.owner), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(asOwner.canRevise).toBe(false);

    // 판 목록 API(`/versions`)는 드로어의 버전 고르기와 함께 지웠다(R9 · PG-73) — 판마다의 기록은 DB가 그대로 들고 있다
    const all = await prisma.submission.findMany({
      where: { userId: latest.userId, weekSlotId: latest.weekSlotId },
      orderBy: { version: 'desc' },
      select: { version: true, editedById: true },
    });
    const names = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    expect(all.map((x) => [x.version, x.editedById ? names.get(x.editedById) : null])).toEqual([
      [3, 'v-head'],
      [2, 'v-lead'],
      [1, null],
    ]);
  });

  it('[WA-T43] ★ lead·head가 **자기** 제출물을 첨삭하면 404 — 마감을 비켜 가는 길이 된다 · [고치기]도 없다', async () => {
    const { prisma } = await import('@/server/db');
    const { readStoredFile } = await import('@/server/storage');
    const lead = await prisma.user.findFirstOrThrow({ where: { email: ID.lead } });
    const v1 = await prisma.submission.findUniqueOrThrow({ where: { id: firstId } });
    const own = await prisma.submission.create({
      data: { ...v1, id: undefined, userId: lead.id, version: 1, isLatest: true, sha256: 'own', editedById: null, editedAt: null },
    });
    expect((await readStoredFile(own.filePath)).length).toBeGreaterThan(0);
    expect((await revise(ID.lead, own.id)).status).toBe(404);
    expect(await prisma.submission.count({ where: { userId: lead.id } })).toBe(1);

    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const asSelf = await (await GET(nx(`/api/submissions/${own.id}/preview`, ID.lead), { params: Promise.resolve({ id: own.id }) })).json();
    expect(asSelf.canRevise).toBe(false);
    // 부서장에게는 남의 것이다 — 고칠 수 있다
    expect((await revise(ID.head, own.id, '실장이 담당자 것을 다듬음')).status).toBe(200);
  });

  it('[WA-T44] ★ head는 부서원 제출물을 **연다** (§3.1 남의 제출물 내용 head=read) — [고치기]도 있다', async () => {
    const { prisma } = await import('@/server/db');
    const owner = await prisma.user.findFirstOrThrow({ where: { email: ID.owner } });
    const latest = await prisma.submission.findFirstOrThrow({ where: { userId: owner.id, isLatest: true } });
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const res = await GET(nx(`/api/submissions/${latest.id}/preview`, ID.head), { params: Promise.resolve({ id: latest.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).canRevise).toBe(true);
    // 같은 부서 member는 여전히 404 (ST-15)
    expect((await GET(nx(`/api/submissions/${latest.id}/preview`, ID.member), { params: Promise.resolve({ id: latest.id }) })).status).toBe(404);
  });

  it('[WA-T45] 고친 판의 제출 시각은 **그 사람이 낸 시각** 그대로 — 고친 시각은 editedAt으로 따로', async () => {
    const { prisma } = await import('@/server/db');
    const owner = await prisma.user.findFirstOrThrow({ where: { email: ID.owner } });
    const all = await prisma.submission.findMany({ where: { userId: owner.id }, orderBy: { version: 'asc' } });
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const v of all.slice(1)) {
      expect(v.uploadedAt.getTime()).toBe(all[0].uploadedAt.getTime());
      expect(v.editedAt).not.toBeNull();
    }
    expect(all[0].editedAt).toBeNull();

    const latest = all[all.length - 1];
    // 드로어 머리의 「○○ 고침 · 시각」은 preview가 준다 — 판 목록 API는 지웠다(R9)
    const { toKstIso } = await import('@/lib/week');
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const p = await (await GET(nx(`/api/submissions/${latest.id}/preview`, ID.owner), { params: Promise.resolve({ id: latest.id }) })).json();
    expect(p.submission.editedAt).toMatch(/T\d{2}:\d{2}/);
    expect(p.submission.editedAt).toBe(toKstIso(latest.editedAt!));
  });

  it('[WA-T46] 한 칸의 줄바꿈은 고쳐 저장해도 남는다 · 500자를 넘으면 자르지 않고 422', async () => {
    const { prisma } = await import('@/server/db');
    const owner = await prisma.user.findFirstOrThrow({ where: { email: ID.owner } });
    const latest = await prisma.submission.findFirstOrThrow({ where: { userId: owner.id, isLatest: true } });
    const res = await revise(ID.lead, latest.id, '첫 줄\n둘째 줄');
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const saved = await prisma.submission.findUniqueOrThrow({ where: { id } });
    const { readStoredFile } = await import('@/server/storage');
    const { readWorklog } = await import('@/lib/hwp/reader');
    expect(readWorklog(await readStoredFile(saved.filePath)).worklog.achievements[0].content).toBe('첫 줄\n둘째 줄');

    const long = await revise(ID.lead, id, '가'.repeat(501));
    expect(long.status).toBe(422);
    expect((await long.json()).message).toContain('501자');
    expect(await prisma.submission.count({ where: { userId: owner.id } })).toBe(saved.version);
  });

  it('[WA-T47] ★ 파일을 못 쓰면 새 판도 없다 — 그 사람의 최신 판이 「파일 없는 판」이 되지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { writeFileAtomic, resolveInRoot } = await import('@/server/storage');
    const { composeMergedHwp } = await import('@/server/merge');
    const { ensureCurrentSlot, reviseSubmission } = await import('@/server/worklog');
    const { writeFileSync, rmSync: rm, readdirSync } = await import('node:fs');
    const slot = await ensureCurrentSlot();
    const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
    const div = await prisma.division.create({ data: { slug: 'Rv_C', nameKo: '막힌실', nameEn: 'Rv_C', isActive: true } });
    await writeFileAtomic('divisions/Rv_C/template/active.hwp', tpl);
    await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Rv_C/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });
    const leadC = await prisma.user.create({ data: { email: 'v-lead-c@test.kei.re.kr', name: 'v-lead-c', divisionId: div.id, divisionRole: 'lead' } });
    const memberC = await prisma.user.create({ data: { email: 'v-member-c@test.kei.re.kr', name: 'v-member-c', divisionId: div.id } });
    const bytes = composeMergedHwp(tpl, { achievements: [['1-1', '원래', '', '', '']], plans: [], notes: [] }).bytes;
    await writeFileAtomic('divisions/Rv_C/orig/member_v1.hwp', bytes);
    const v1 = await prisma.submission.create({
      data: { divisionId: div.id, userId: memberC.id, weekSlotId: slot.id, version: 1, isLatest: true, filePath: 'divisions/Rv_C/orig/member_v1.hwp', originalName: 'm.hwp', byteSize: bytes.length, sha256: 'c1' },
    });

    // 제출물 폴더 자리에 파일을 둬서 쓰기를 막는다
    writeFileSync(resolveInRoot('divisions/Rv_C/submissions'), 'block');
    const blocked = await revise('v-lead-c@test.kei.re.kr', v1.id);
    expect(blocked.status).toBe(500);
    expect(await prisma.submission.count({ where: { userId: memberC.id } })).toBe(1);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: v1.id } })).isLatest).toBe(true);

    rm(resolveInRoot('divisions/Rv_C/submissions'));
    const ok = await revise('v-lead-c@test.kei.re.kr', v1.id);
    expect(ok.status).toBe(200);

    // 게이트 뒤에 그 사이 새 판이 생겼다(옛 판 객체로 부름) → 409, 먼저 쓴 파일도 남기지 않는다
    const dir = path.dirname(resolveInRoot((await prisma.submission.findFirstOrThrow({ where: { userId: memberC.id, isLatest: true } })).filePath));
    const files = readdirSync(dir).length;
    const stale = await prisma.submission.findUniqueOrThrow({ where: { id: v1.id }, include: { user: true, weekSlot: true, division: true } });
    const editor = { id: leadC.id, email: leadC.email, name: leadC.name };
    await expect(reviseSubmission({ editor, target: stale, bytes, fileName: 'x.hwp' })).rejects.toMatchObject({ status: 409 });
    expect(readdirSync(dir).length).toBe(files);
    // 그 사람의 판이 하나도 없으면(지워졌으면) 새로 만들지 않는다 — 고칠 「낸 것」이 없다 (TACP-18)
    const ghost = { ...stale, userId: leadC.id, user: leadC };
    await expect(reviseSubmission({ editor, target: ghost, bytes, fileName: 'x.hwp' })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.submission.count({ where: { userId: leadC.id } })).toBe(0);
  });
});
