// ST-19a·b (2026-10-10) — 부서 양식은 받기 전에 모양(5칸 표 셋)을 보고 시험 작성·시험 병합을 한다.
//
// 2026-10-10 점검에서 실측: 표가 둘인 양식(3번 특이사항 표를 지운 꼴)이 「관례상 정상」 경고와 함께 201로 등록됐고, 그날부터 그 부서 전원의
// 웹 작성이 500(「3번째 표가 없습니다」), 병합은 3번 줄을 경고 한 줄로 버렸다.
//   ST-T40  표 둘 양식 → 422 + 짧은 이유, 기존 양식 그대로 · 5칸 표 셋이면 201
//   ST-T41  이미 들어가 있던 표 둘 양식으로 웹 작성 → 500이 아니라 409 `template_broken` + 이유
//   ST-T42  모양이 맞아도 시험 작성·시험 병합이 실패하면 422 — 받기 전에 실제로 해 본다
//
// 표 둘 양식은 로컬 픽스처(master-template.hwp — 공개 저장소에 없다)에서 **실행 중에** 3번 표가 든 문단을 들어내 만든다.
// 저장소에는 아무 문서 내용도 들어가지 않는다. 픽스처가 없는 체크아웃에서는 건너뛴다(다른 hwp 시험과 같다).
// DB: prisma/test-template-check.db — 이 파일 전용.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures/master-template.hwp');
const STORAGE = mkdtempSync(path.join(tmpdir(), 'tincase-tplcheck-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-template-check.db';
process.env.STORAGE_ROOT = STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;

const hasFixtures = (() => {
  try {
    readFileSync(FIX);
    return true;
  } catch {
    return false;
  }
})();
const d = hasFixtures ? describe : describe.skip;

const LEAD = 'tpl-lead@example.invalid';
let good: Buffer;
let twoTables: Buffer;

/** 3번 표가 든 최상위 문단을 들어낸다 — 사람이 한글에서 3번 표를 지운 것과 같은 모양(읽기는 「관례상 정상」이라 받는다) */
async function withoutThirdTable(tpl: Buffer): Promise<Buffer> {
  const { openHwp } = await import('@/lib/hwp/ole');
  const { parseRecords, serializeRecords } = await import('@/lib/hwp/record');
  const { topParagraphs, ownControls, packHwp } = await import('@/lib/hwp/writer');
  const recs = parseRecords(openHwp(tpl).sections[0]);
  const withTable = topParagraphs(recs).filter((b) => ownControls(recs, b).includes('tbl '));
  const third = withTable[2];
  return packHwp(tpl, [serializeRecords([...recs.slice(0, third.start), ...recs.slice(third.end)])]);
}

function upload(bytes: Buffer, who = LEAD) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)]), '부서양식.hwp');
  const r = new Request('http://t.local/api/division/template', { method: 'POST', headers: { 'x-test-identity': who }, body: fd }) as Request & { nextUrl: URL };
  r.nextUrl = new URL('http://t.local/api/division/template');
  return r as never;
}

beforeAll(async () => {
  if (!hasFixtures) return;
  rmSync(path.join(ROOT, 'prisma/test-template-check.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const div = await prisma.division.create({ data: { slug: 'Tpl_Div', shortSlug: 'td', nameKo: '양식시험실', nameEn: 'Tpl Div', isActive: true } });
  await prisma.user.create({ data: { email: LEAD, name: '양식담당', divisionId: div.id, divisionRole: 'lead', mustChangePassword: false } });
  good = readFileSync(FIX);
  twoTables = await withoutThirdTable(good);
}, 120_000);

afterAll(async () => {
  if (!hasFixtures) return;
  const { prisma } = await import('@/server/db');
  await prisma.$disconnect();
  rmSync(path.join(ROOT, 'prisma/test-template-check.db'), { force: true });
  rmSync(STORAGE, { recursive: true, force: true });
});

d('[ST-T40] ★ 표 둘 양식은 받지 않는다 — 5칸 표 셋이면 받는다 (ST-19a)', () => {
  it('만든 표 둘 양식은 읽기가 「관례상 정상」이라 받던 바로 그 모양이다(전제)', async () => {
    const { readWorklog, validateHwpUpload } = await import('@/lib/hwp/reader');
    expect(readWorklog(twoTables).tables).toHaveLength(2);
    expect(() => validateHwpUpload(twoTables)).not.toThrow(); // 예전 검사는 여기서 끝났다
  });

  it('표 둘 → 422 invalid_template · 짧은 이유 · 양식 행이 생기지 않는다 / 셋 → 201 · 그 뒤 표 둘 → 422, 기존 양식 그대로', async () => {
    const { POST } = await import('@/app/api/division/template/route');
    const { prisma } = await import('@/server/db');
    const bad = await POST(upload(twoTables));
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_template');
    expect(body.message).toContain('표 셋');
    expect(body.message).toContain('2개');
    expect(body.message).toContain('기존 양식은 그대로');
    expect(await prisma.template.count()).toBe(0);

    const ok = await POST(upload(good));
    expect(ok.status).toBe(201);
    const again = await POST(upload(twoTables));
    expect(again.status).toBe(422);
    const active = await prisma.template.findMany({ where: { isActive: true } });
    expect(active.map((t) => t.version)).toEqual([1]); // 표 둘 양식이 v2가 되지 않았다
  });
});

d('[ST-T41] 이미 들어가 있던 표 둘 양식 — 웹 작성은 500이 아니라 409 template_broken과 이유', () => {
  it('buildWorklogHwp가 채우기 전에 모양을 본다', async () => {
    const { buildWorklogHwp } = await import('@/server/worklog-doc');
    let err: unknown;
    try {
      buildWorklogHwp(twoTables, { achievements: [{ content: '실적' }], notes: [{ content: '특이사항' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 409, code: 'template_broken' });
    expect((err as Error).message).toContain('담당자에게 알려 주세요');
    // 맞는 양식은 그대로 된다
    expect(buildWorklogHwp(good, { achievements: [{ content: '실적' }], notes: [{ content: '특이사항' }] }).rows).toEqual({ achievements: 1, plans: 0, notes: 1 });
  });
});

d('[ST-T42] 모양이 맞아도 시험 작성·시험 병합에서 실패하면 받지 않는다 (ST-19b)', () => {
  it('통과하는 양식 — 시험 작성(실적 12줄 · 두 줄 칸 · 공유)과 시험 병합(부서명 · 다시 읽기)을 지난다', async () => {
    const { assertUsableTemplate } = await import('@/server/template-check');
    expect(() => assertUsableTemplate(good, '양식시험실')).not.toThrow();
  });

  it('시험 작성이 실패하면 422 — 받는 쪽에서 실제로 채워 본다', async () => {
    vi.resetModules();
    vi.doMock('@/server/worklog-doc', async (orig) => ({
      ...(await orig<typeof import('@/server/worklog-doc')>()),
      buildWorklogHwp: () => {
        throw new Error('3번째 표가 없습니다');
      },
    }));
    try {
      const { assertUsableTemplate } = await import('@/server/template-check');
      expect(() => assertUsableTemplate(good, '양식시험실')).toThrow(/시험 작성·병합/);
    } finally {
      vi.doUnmock('@/server/worklog-doc');
      vi.resetModules();
    }
  });

  it('시험 병합을 다시 읽어 줄이 어긋나면 422 — 병합의 자체 점검(HM-22)과 같은 판정', async () => {
    vi.resetModules();
    vi.doMock('@/server/merge', async (orig) => ({
      ...(await orig<typeof import('@/server/merge')>()),
      verifyMerged: () => '3번 표에서 행이 사라졌습니다 (6 → 0)',
    }));
    try {
      const { assertUsableTemplate } = await import('@/server/template-check');
      let err: unknown;
      try {
        assertUsableTemplate(good, '양식시험실');
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ status: 422, code: 'invalid_template' });
    } finally {
      vi.doUnmock('@/server/merge');
      vi.resetModules();
    }
  });
});
