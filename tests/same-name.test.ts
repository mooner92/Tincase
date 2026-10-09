// ST-02a · ST-34 (2026-10-10) — 같은 부서의 **동명이인**이 같은 주에 내도 서로의 파일을 덮거나 지우지 않는다.
//
// 2026-10-10 점검에서 실측: 제출 파일 경로가 「이름_v{판}.hwp」뿐이라 두 사람이 같은 경로를 썼다. 뒤에 낸 사람이 앞사람 파일을 덮었고
// (앞사람의 행은 sha가 맞지 않는 남의 글을 가리켰다), 병합에는 뒤사람 것만 두 번 들어갔으며, 한 사람이 취소하면 다른 사람 파일이 지워졌다.
//   ST-T43  새 경로에는 사람 꼬리(id 끝 8자)가 붙는다 — 두 파일이 따로 · 각자의 글 · 병합에 둘 다 · 한 사람이 취소하면 그 사람 파일만
//   ST-T44  꼬리 전 경로를 두 행이 함께 가리키던 옛 상태 — 한 사람이 취소해도 남은 행이 가리키는 파일은 지우지 않는다
//
// 사람은 지어낸 이름이다. 양식은 로컬 픽스처(master-template.hwp — 공개 저장소에 없다) — 없으면 건너뛴다.
// DB: prisma/test-same-name.db — 이 파일 전용.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures/master-template.hwp');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-samename-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-same-name.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const hasFixtures = existsSync(FIX);
const d = hasFixtures ? describe : describe.skip;

const KIM1 = 'same-1@example.invalid';
const KIM2 = 'same-2@example.invalid';
const NAME = '김예시'; // 둘 다 같은 이름
let divisionId = '';

function nx(url: string, identity: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'x-test-identity': identity },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
async function compose(who: string, content: string) {
  const { POST } = await import('@/app/api/submissions/compose/route');
  return POST(nx('/api/submissions/compose', who, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ achievements: [{ content }] }) }));
}
async function cancel(who: string, id: string) {
  const { DELETE } = await import('@/app/api/submissions/[id]/route');
  return DELETE(nx(`/api/submissions/${id}`, who, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  if (!hasFixtures) return;
  rmSync(path.join(ROOT, 'prisma/test-same-name.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic, sha256 } = await import('@/server/storage');
  // 마감이 늘 열려 있게 주의 끝(일요일 23:59) — web-only-submit.test.ts와 같은 이유
  const div = await prisma.division.create({
    data: { slug: 'Same_Div', nameKo: '동명시험실', nameEn: 'Same Div', isActive: true, deadlineDow: 7, deadlineTime: '23:59' },
  });
  divisionId = div.id;
  const tpl = readFileSync(FIX);
  await writeFileAtomic('divisions/Same_Div/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Same_Div/template/active.hwp', sha256: sha256(tpl), version: 1, uploadedBy: 'seed' } });
  await prisma.user.create({ data: { email: KIM1, name: NAME, divisionId: div.id, mustChangePassword: false } });
  await prisma.user.create({ data: { email: KIM2, name: NAME, divisionId: div.id, mustChangePassword: false } });
}, 120_000);

afterAll(async () => {
  if (!hasFixtures) return;
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-same-name.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

d('[ST-T43] ★ 동명이인 — 쓰기 · 병합 · 취소가 서로 닿지 않는다 (ST-02a · ST-34)', () => {
  it('두 사람이 같은 주에 낸다 → 경로가 다르고(사람 꼬리) 파일마다 제 글 · sha가 행과 맞는다', async () => {
    expect((await compose(KIM1, '첫째 예시의 일')).status).toBe(200);
    expect((await compose(KIM2, '둘째 예시의 일')).status).toBe(200);
    const { prisma } = await import('@/server/db');
    const { readStoredFile, sha256, ownerTag } = await import('@/server/storage');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const subs = await prisma.submission.findMany({ include: { user: true }, orderBy: { uploadedAt: 'asc' } });
    expect(subs).toHaveLength(2);
    expect(new Set(subs.map((s) => s.filePath)).size).toBe(2); // 예전: 둘 다 「김예시_v1.hwp」
    for (const s of subs) {
      expect(path.basename(s.filePath)).toBe(`${NAME}_${ownerTag(s.userId)}_v1.hwp`);
      const bytes = await readStoredFile(s.filePath);
      expect(sha256(bytes)).toBe(s.sha256); // 행이 가리키는 파일이 그 행의 파일이다(덮이지 않았다)
      const want = s.user.email === KIM1 ? '첫째 예시의 일' : '둘째 예시의 일';
      expect(readWorklog(bytes).worklog.achievements.map((r) => r.content)).toEqual([want]);
    }
  });

  it('병합에 둘 다 들어간다 — 한 사람 것이 두 번 들어가지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { runMerge } = await import('@/server/merge');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const slot = await prisma.weekSlot.findFirstOrThrow();
    const out = await runMerge(divisionId, slot.id);
    expect(readWorklog(out.output).worklog.achievements.map((r) => r.content).sort()).toEqual(['둘째 예시의 일', '첫째 예시의 일']);
  });

  it('첫째가 취소하면 첫째 파일만 지워진다 — 둘째 파일·행은 그대로', async () => {
    const { prisma } = await import('@/server/db');
    const { fileExists } = await import('@/server/storage');
    const mine = await prisma.submission.findFirstOrThrow({ where: { user: { email: KIM1 } } });
    const other = await prisma.submission.findFirstOrThrow({ where: { user: { email: KIM2 } } });
    expect((await cancel(KIM1, mine.id)).status).toBe(200);
    expect(await fileExists(mine.filePath)).toBe(false);
    expect(await fileExists(other.filePath)).toBe(true);
    expect(await prisma.submission.count({ where: { id: other.id } })).toBe(1);
  });
});

d('[ST-T44] 꼬리 전 경로를 두 행이 함께 가리키던 옛 상태 — 취소가 남의 파일을 지우지 않는다 (ST-34)', () => {
  it('옛 행은 저장된 경로 그대로 · 한 사람이 취소해도 남은 행이 가리키는 파일은 남긴다', async () => {
    const { prisma } = await import('@/server/db');
    const { writeFileAtomic, fileExists, sha256 } = await import('@/server/storage');
    const slot = await prisma.weekSlot.findFirstOrThrow();
    // 꼬리 전 이름 — 둘이 같은 경로를 가리킨다(뒤에 낸 사람이 덮은 상태)
    const legacy = `divisions/Same_Div/submissions/2026/옛주차/${NAME}_v9.hwp`;
    const bytes = readFileSync(FIX);
    await writeFileAtomic(legacy, bytes);
    const [u1, u2] = await Promise.all([KIM1, KIM2].map((email) => prisma.user.findUniqueOrThrow({ where: { email } })));
    const mk = (userId: string) =>
      prisma.submission.create({
        data: { divisionId, userId, weekSlotId: slot.id, version: 9, isLatest: true, filePath: legacy, originalName: 'x.hwp', byteSize: bytes.length, sha256: sha256(bytes) },
      });
    await prisma.submission.deleteMany({ where: { userId: u2.id, weekSlotId: slot.id } }); // 이 주에 남은 둘째 행을 옛 행으로 바꿔 둔다
    const a = await mk(u1.id);
    await mk(u2.id);
    expect((await cancel(KIM1, a.id)).status).toBe(200);
    expect(await fileExists(legacy)).toBe(true); // 둘째의 행이 아직 가리킨다
    // 둘째도 취소하면 이제 아무도 가리키지 않으므로 지운다
    const b = await prisma.submission.findFirstOrThrow({ where: { userId: u2.id, filePath: legacy } });
    expect((await cancel(KIM2, b.id)).status).toBe(200);
    expect(await fileExists(legacy)).toBe(false);
  });
});
