// HM-56d · HM-T168 — 같은 입력이면 병합본이 **바이트까지** 같다. 그래서 승인을 파일 sha에 묶을 수 있다(HM-56a).
//
// 2026-10-08 검토의 「먼저 확인할 것」: 엔진 출력에 시각 같은 값이 들어간다면 같은 입력으로 다시 병합해도 sha가 달라져, 승인을 내용에 묶는 일이
// 정규화한 열쇠(contentKey) 없이는 되지 않는다. 그래서 진짜 엔진(양식 픽스처 · 제출 둘)으로 두 번 병합해 본다 — 모델은 끈다(vitest.config, HM-24).
// 양식 픽스처는 공개 저장소에 없다(fixtures/README.md) — 없으면 건너뛴다. 다른 자리의 양식은 DEMO_TEMPLATE=<경로>로 알려 줄 수 있다(읽기만 한다).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-csha-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-csha.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const TEMPLATE = (() => {
  for (const p of [path.resolve(__dirname, '../fixtures/master-template.hwp'), process.env.DEMO_TEMPLATE ?? '']) {
    if (!p) continue;
    try {
      return readFileSync(p);
    } catch {
      // 다음 후보
    }
  }
  return null;
})();
const d = TEMPLATE ? describe : describe.skip;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let divId = '';
let slotId = '';

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-csha.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  if (!TEMPLATE) return;
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { composeMergedHwp } = await import('@/server/merge');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const div = await prisma.division.create({ data: { slug: 'Csha_A', nameKo: '같은판실', nameEn: 'Csha_A', isActive: true } });
  divId = div.id;
  slotId = (await ensureCurrentSlot()).id;
  await writeFileAtomic('divisions/Csha_A/template/active.hwp', TEMPLATE);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Csha_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });
  const rows = [
    { achievements: [['1-1', '보도자료 배포', '', '', ''], ['1-2', '포럼 개최', '10.14', '서울', '']], plans: [['2-1', '정례 회의', '', '', '']], notes: [] },
    { achievements: [['1-1', '보도자료 배포', '', '', '']], plans: [['2-1', '워크숍', '', '', '']], notes: [['3-1', '정전 안내', '', '', '']] },
  ];
  for (const [i, r] of rows.entries()) {
    const user = await prisma.user.create({ data: { email: `csha${i}@test.local`, name: `사람${i}`, divisionId: div.id, sortOrder: i } });
    const bytes = composeMergedHwp(TEMPLATE, r).bytes;
    const rel = `divisions/Csha_A/submissions/${i}.hwp`;
    await writeFileAtomic(rel, bytes);
    await prisma.submission.create({
      data: { divisionId: div.id, userId: user.id, weekSlotId: slotId, version: 1, filePath: rel, originalName: `${i}.hwp`, byteSize: bytes.length, sha256: sha(bytes) },
    });
  }
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('HM-56d 같은 입력이면 병합본이 바이트까지 같다', () => {
  it('[HM-T168] ★ 같은 입력으로 두 번 병합 → 파일 sha가 같다 · 실행마다 `outputSha` = 그 파일의 sha · 실행 번호는 다르다', async () => {
    const { prisma } = await import('@/server/db');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { readStoredFile } = await import('@/server/storage');
    const first = await runMergeRecorded(divId, slotId, 'manual');
    expect(first.status).toBe('succeeded');
    const a = await prisma.mergeRun.findUniqueOrThrow({ where: { id: first.runId } });
    const bytesA = await readStoredFile(a.outputPath!);
    // 시각이 흘러도(초가 바뀌어도) 같아야 한다 — 출력에 시각이 들어가면 여기서 갈린다
    await new Promise((r) => setTimeout(r, 1100));
    const second = await runMergeRecorded(divId, slotId, 'manual');
    expect(second.status).toBe('succeeded');
    const b = await prisma.mergeRun.findUniqueOrThrow({ where: { id: second.runId } });
    const bytesB = await readStoredFile(b.outputPath!);
    expect(b.id).not.toBe(a.id);
    expect(sha(bytesB)).toBe(sha(bytesA));
    expect(a.outputSha).toBe(sha(bytesA));
    expect(b.outputSha).toBe(sha(bytesB));
  });
});
