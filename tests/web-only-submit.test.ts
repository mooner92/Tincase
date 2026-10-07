// WA-30~34 · ADR-0014 — hwp 업로드가 **닫힌** 서버. 닫힌 것과 그대로인 것을 같은 무게로 본다.
//
// 이 파일은 스위치를 `off`로 두고 뜬다(테스트 서버와 같은 상태). `on`(기본값)의 동작은
// 기존 업로드 테스트(integration.test.ts)가 그대로 지킨다 — 거기는 스위치를 건드리지 않는다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── env는 어떤 앱 모듈보다 먼저 고정한다 ──
const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-webonly-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-web-only.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
process.env.SUBMIT_HWP_UPLOAD = 'off';
delete process.env.DEV_IDENTITY;

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures');
const hasFixtures = existsSync(path.join(FIX, 'master-template.hwp'));
const d = hasFixtures ? describe : describe.skip;

const ID = {
  member: 'w-member@test.kei.re.kr',
  owner: 'w-owner@test.kei.re.kr', // 스위치를 끄기 전에 hwp를 올려 둔 사람
  lead: 'w-lead@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}

/** 저장소에 있는 파일 전부 — 「아무것도 남기지 않았다」를 눈이 아니라 목록으로 본다 */
function storedFiles(dir = TMP_STORAGE): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? storedFiles(p) : [path.relative(TMP_STORAGE, p)];
  });
}

async function upload(identity: string | undefined, bytes: Buffer, name = '주간업무.hwp') {
  const { POST } = await import('@/app/api/submissions/route');
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(bytes)], name));
  return POST(nx('/api/submissions', identity, { method: 'POST', body: fd }));
}

let uploadedId = '';

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-web-only.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');

  // 마감이 항상 열려 있도록 주차의 마지막 순간(일요일 23:59) — integration.test.ts와 같은 이유
  const div = await prisma.division.create({
    data: { slug: 'Wo_A', nameKo: '웹작성실', nameEn: 'Wo_A', isActive: true, deadlineDow: 7, deadlineTime: '23:59' },
  });
  const mk = (email: string, extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: div.id, ...extra } });
  await mk(ID.member);
  const owner = await mk(ID.owner);
  await mk(ID.lead, { divisionRole: 'lead' });

  if (!hasFixtures) return;
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const { composeMergedHwp } = await import('@/server/merge');

  // WA-33 — 부서 양식은 그대로 있다. 웹 작성이 이 양식으로 hwp를 만든다
  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  await writeFileAtomic('divisions/Wo_A/template/active.hwp', tpl);
  await prisma.template.create({
    data: { divisionId: div.id, filePath: 'divisions/Wo_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' },
  });

  // 스위치를 끄기 전에 올라와 있던 업로드 제출물
  const slot = await ensureCurrentSlot();
  const bytes = composeMergedHwp(tpl, { achievements: [['1-1', '올려 둔 실적', '', '', '']], plans: [], notes: [] }).bytes;
  await writeFileAtomic('divisions/Wo_A/submissions/owner_v1.hwp', bytes);
  const sub = await prisma.submission.create({
    data: {
      divisionId: div.id,
      userId: owner.id,
      weekSlotId: slot.id,
      version: 1,
      isLatest: true,
      filePath: 'divisions/Wo_A/submissions/owner_v1.hwp',
      originalName: 'owner.hwp',
      byteSize: bytes.length,
      sha256: 'v1',
      origin: 'upload',
    },
  });
  uploadedId = sub.id;
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('WA-30 스위치 해석', () => {
  it('[WA-T30] on은 열고 off만 닫는다 · 닫힌 문은 410 upload_closed', async () => {
    const { hwpUploadOpen, assertHwpUploadOpen } = await import('@/server/submit-mode');
    expect(hwpUploadOpen('on')).toBe(true);
    expect(hwpUploadOpen('off')).toBe(false);
    expect(hwpUploadOpen()).toBe(false); // 이 파일은 off로 떴다
    expect(() => assertHwpUploadOpen('on')).not.toThrow();
    try {
      assertHwpUploadOpen('off');
      expect.unreachable('닫힌 문이 열려 있다');
    } catch (e) {
      const err = e as { status: number; code: string; message: string };
      expect(err.status).toBe(410);
      expect(err.code).toBe('upload_closed');
      expect(err.message).toContain('웹에서 작성');
    }
  });
});

describe('WA-31 업로드가 닫힌 서버', () => {
  it('[WA-T31] ★ 업로드 → 410 · 파일도 DB 행도 감사 기록도 남지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const before = { files: storedFiles(), subs: await prisma.submission.count(), audits: await prisma.auditLog.count() };

    // 검증까지 갔다면 422(hwp 아님)가 났을 바이트다 — 410이면 파일을 보기 전에 돌려보낸 것이다
    const res = await upload(ID.member, Buffer.from('이건 hwp가 아니다'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('upload_closed');
    expect(body.message).toBe('HWP 업로드는 닫혔습니다 — 웹에서 작성해 주세요.');

    expect(storedFiles()).toEqual(before.files);
    expect(await prisma.submission.count()).toBe(before.subs);
    expect(await prisma.auditLog.count()).toBe(before.audits);
  });

  it('[WA-T31b] 신원 확인이 먼저다 — 로그인하지 않은 요청은 410이 아니라 401', async () => {
    const res = await upload(undefined, Buffer.from('x'));
    expect(res.status).toBe(401);
  });
});

d('WA-33 닫는 것은 업로드 하나 — 나머지는 그대로', () => {
  it('[WA-T32] ★ 웹 작성은 제출된다 (origin=web, 파일이 저장소에 있다)', async () => {
    const { POST } = await import('@/app/api/submissions/compose/route');
    const res = await POST(
      nx('/api/submissions/compose', ID.member, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ achievements: [{ content: '웹에서 적은 실적', date: '10/7' }], plans: [{ content: '다음 주 계획' }], notes: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(1);

    const { prisma } = await import('@/server/db');
    const member = await prisma.user.findFirstOrThrow({ where: { email: ID.member } });
    const sub = await prisma.submission.findFirstOrThrow({ where: { userId: member.id, isLatest: true } });
    expect(sub.origin).toBe('web');
    expect(existsSync(path.join(TMP_STORAGE, sub.filePath))).toBe(true);
  });

  it('[WA-T32b] 스위치 전에 올린 제출물은 본인이 그대로 받는다', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/download/route');
    const res = await GET(nx(`/api/submissions/${uploadedId}/download`, ID.owner), {
      params: Promise.resolve({ id: uploadedId }),
    });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('[WA-T32c] 담당자 첨삭(TACP-22)은 업로드로 들어온 제출물에도 된다 — 새 판 v2', async () => {
    const { PUT } = await import('@/app/api/submissions/[id]/content/route');
    const res = await PUT(
      nx(`/api/submissions/${uploadedId}/content`, ID.lead, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ achievements: [{ content: '담당자가 다듬은 실적' }], plans: [], notes: [] }),
      }),
      { params: Promise.resolve({ id: uploadedId }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);
  });
});

// 판정이 갈라지지 않게 — 스위치를 읽는 곳이 하나이고, 화면이 그 판정으로 그려지는지를 코드로 본다
describe('WA-30·32 스위치는 한 곳에서 읽고, 화면은 그 판정으로 그린다', () => {
  const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );

  it('[WA-T33] ★ SUBMIT_HWP_UPLOAD를 읽는 곳은 env.ts(정의)와 submit-mode.ts뿐', () => {
    const readers = walk('src').filter((f) => /SUBMIT_HWP_UPLOAD/.test(src(f)));
    expect(readers.sort()).toEqual(['src/server/env.ts', 'src/server/submit-mode.ts']);
  });

  it('[WA-T33b] 업로드 라우트는 파일을 읽기 전에 문을 본다', () => {
    const route = src('src/app/api/submissions/route.ts');
    const gate = route.indexOf('assertHwpUploadOpen()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(route.indexOf('req.formData()'));
    // 웹 작성 라우트에는 걸지 않는다 (WA-34)
    expect(src('src/app/api/submissions/compose/route.ts')).not.toContain('assertHwpUploadOpen');
  });

  it('[WA-T33c] 부서원 화면·안내는 hwpUploadOpen()으로 그린다 (PG-11)', () => {
    const page = src('src/app/[division]/page.tsx');
    expect(page).toContain('hwpUploadOpen()');
    expect(page).toMatch(/<SubmitChoice[^>]*uploadOpen=\{uploadOpen\}/);
    // 「양식 받기」 카드는 스위치 안쪽에 있다
    const guard = page.indexOf('{uploadOpen && (');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(page.indexOf('>양식 받기<'));

    // 탭과 드롭존은 열린 서버에서만
    const choice = src('src/components/SubmitChoice.tsx');
    expect(choice.indexOf('{uploadOpen && (')).toBeLessThan(choice.indexOf('파일 올리기'));
    expect(choice).toMatch(/uploadOpen && mode === 'upload' \? \(\s*<UploadDropzone/);

    // 안내(PG-57)는 웹 작성만 보여 준다 — 업로드 단계가 없다. 업로드가 아직 열린 서버에서만 그 길이 있다는 한 줄
    const guide = src('src/app/guide/page.tsx');
    expect(guide).toContain('hwpUploadOpen()');
    expect(guide).toMatch(/\{uploadOpen && \(\s*<p className="callout/);
    expect(src('src/lib/guide/deck.ts')).not.toMatch(/파일 올리기|드롭존|양식 다운로드/);
  });
});

// 맨 끝에 둔다 — 모듈을 새로 읽으므로 앞의 테스트와 섞이지 않게
describe('WA-30 기본값', () => {
  it('[WA-T30b] 환경변수가 없으면 on — 운영은 지금 동작 그대로', async () => {
    vi.stubEnv('SUBMIT_HWP_UPLOAD', undefined);
    vi.resetModules();
    try {
      const { env } = await import('@/server/env');
      const { hwpUploadOpen } = await import('@/server/submit-mode');
      expect(env.SUBMIT_HWP_UPLOAD).toBe('on');
      expect(hwpUploadOpen()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
