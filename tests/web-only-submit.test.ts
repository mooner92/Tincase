// WA-39 · ADR-0014(완료 2026-10-08) — hwp를 올려 제출하는 길은 **없다**. 없어진 것과 그대로인 것을 같은 무게로 본다.
//
// 예전 이 파일은 「스위치가 꺼진 서버」를 봤다(WA-30~34). 이제 부서원 제출에는 스위치가 없다 — 라우트도 화면도
// 코드째 지웠다. 그래도 이 파일은 스위치를 `off`로 두고 뜬다: 스위치가 아직 닫는 것이 하나 남아서다 —
// 「전사」 게시판 hwp [올리기](RU-60a). 그 [올리기]가 걷히는 다음 웨이브에서 스위치와 그 시험을 함께 지운다.
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
  owner: 'w-owner@test.kei.re.kr', // 업로드 길이 있던 시절에 hwp를 올려 둔 사람
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

const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
  );

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

  // 부서 양식은 그대로 있다. 웹 작성이 이 양식으로 hwp를 만든다
  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  await writeFileAtomic('divisions/Wo_A/template/active.hwp', tpl);
  await prisma.template.create({
    data: { divisionId: div.id, filePath: 'divisions/Wo_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' },
  });

  // 업로드 길이 있던 시절에 올라와 있던 제출물 — 제출은 사실의 기록이라 지우지 않는다(ADR-0007)
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

describe('WA-39 hwp를 올려 제출하는 길은 없다', () => {
  it('[WA-T53] ★ 업로드 라우트가 없다 · 제출 쪽 라우트는 파일(multipart)을 읽지 않는다 · 저장 함수를 부르는 문은 웹 작성 하나', () => {
    // `POST /api/submissions` — 파일째 지웠다. 이 주소에는 라우트가 없으니 Next가 404를 낸다
    for (const ext of ['ts', 'tsx', 'js']) {
      expect(existsSync(path.join(ROOT, `src/app/api/submissions/route.${ext}`)), `route.${ext}`).toBe(false);
    }
    // 하위 라우트(웹 작성·열기·받기·고치기)는 JSON만 받는다 — 파일을 들고 오는 문이 다른 이름으로 되살아나지 않게
    const subRoutes = walk('src/app/api/submissions');
    expect(subRoutes).toContain(path.join('src/app/api/submissions/compose/route.ts'));
    for (const f of subRoutes) expect(src(f), f).not.toContain('formData(');
    // 제출물을 만드는 저장 함수에 닿는 화면·라우트는 웹 작성 하나다 (스크립트·도메인은 src/app 밖)
    const callers = walk('src/app').filter((f) => /\buploadSubmission\b/.test(src(f)));
    expect(callers).toEqual([path.join('src/app/api/submissions/compose/route.ts')]);
  });

  it('[WA-T53b] 부서원 화면·안내에도 업로드 길이 없다 — 부품 파일도, 스위치를 읽는 곳도 없다', () => {
    for (const f of ['SubmitChoice', 'UploadDropzone']) {
      expect(existsSync(path.join(ROOT, `src/components/${f}.tsx`)), f).toBe(false);
    }
    const page = src('src/app/[division]/page.tsx');
    for (const gone of ['SubmitChoice', 'UploadDropzone', 'hwpUploadOpen', 'submit-mode']) expect(page, gone).not.toContain(gone);
    // 안내(PG-57)는 원래 웹 작성 단계만이었다. 「아직 올리는 길도 열려 있다」 한 줄은 가리킬 곳이 없어져 걷었다
    const guide = src('src/app/guide/page.tsx');
    for (const gone of ['hwpUploadOpen', 'submit-mode', '파일 올리기']) expect(guide, gone).not.toContain(gone);
    expect(src('src/lib/guide/deck.ts')).not.toMatch(/파일 올리기|드롭존|양식 다운로드/);
  });

  d('웹 작성 문에 파일을 보내도', () => {
    it('[WA-T53c] ★ 422 · 파일도 DB 행도 감사 기록도 남지 않는다 (예전 업로드처럼 보내 본다)', async () => {
      const { prisma } = await import('@/server/db');
      const before = { files: storedFiles(), subs: await prisma.submission.count(), audits: await prisma.auditLog.count() };

      const { POST } = await import('@/app/api/submissions/compose/route');
      const fd = new FormData();
      fd.set('file', new File([new Uint8Array(readFileSync(path.join(FIX, 'master-template.hwp')))], '주간업무.hwp'));
      const res = await POST(nx('/api/submissions/compose', ID.member, { method: 'POST', body: fd }));
      expect(res.status).toBe(422);

      expect(storedFiles()).toEqual(before.files);
      expect(await prisma.submission.count()).toBe(before.subs);
      expect(await prisma.auditLog.count()).toBe(before.audits);
    });
  });
});

d('WA-39 없앤 것은 「hwp를 올려 내는 길」 하나 — 나머지는 그대로', () => {
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

  it('[WA-T32b] 예전에 올린 제출물은 본인이 그대로 받는다', async () => {
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

// ── 여기부터는 스위치가 아직 닫는 하나 — 「전사」 게시판 hwp [올리기](RU-60a). 다음 웨이브에서 함께 지운다 ──

describe('RU-60a 「전사」 게시판 hwp 올리기 — 스위치가 닫힌 서버', () => {
  it('[WA-T31d] 운영자도 410 · 아무것도 남기지 않는다 / 취합 밖의 사람은 예전처럼 404', async () => {
    const { prisma } = await import('@/server/db');
    const op = 'w-op@test.kei.re.kr';
    const div = await prisma.division.findUniqueOrThrow({ where: { slug: 'Wo_A' } });
    await prisma.user.upsert({ where: { email: op }, create: { email: op, name: 'w-op', divisionId: div.id, isOperator: true }, update: {} });
    const { POST } = await import('@/app/api/rollup/org/sections/upload/route');
    const send = (who: string) => {
      const fd = new FormData();
      fd.set('file', new File([new Uint8Array(Buffer.from('이건 hwp가 아니다'))], '섹션.hwp'));
      fd.set('sectionId', 'nope');
      return POST(nx('/api/rollup/org/sections/upload', who, { method: 'POST', body: fd }));
    };
    const before = { files: storedFiles(), rows: await prisma.orgSectionUpload.count() };

    const res = await send(op);
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('upload_closed');
    expect((await send(ID.member)).status).toBe(404);

    expect({ files: storedFiles(), rows: await prisma.orgSectionUpload.count() }).toEqual(before);
  });
});

// 판정이 갈라지지 않게 — 스위치를 읽는 곳이 하나이고, 그 판정을 부르는 곳이 「전사」뿐인지를 코드로 본다
describe('RU-60a 스위치는 한 곳에서 읽고, 부르는 곳은 「전사」 둘뿐', () => {
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

  it('[WA-T33] ★ SUBMIT_HWP_UPLOAD를 읽는 곳은 env.ts(정의)와 submit-mode.ts뿐 · submit-mode를 부르는 곳은 「전사」 화면과 그 올리기 라우트뿐', () => {
    const readers = walk('src').filter((f) => /SUBMIT_HWP_UPLOAD/.test(src(f)));
    expect(readers.sort()).toEqual(['src/server/env.ts', 'src/server/submit-mode.ts']);
    // 이 목록이 비면 submit-mode.ts와 env 값을 지운다(ADR-0014 마지막 줄). 새로 늘리지 않는다 — 제출 쪽이 다시 부르면 여기서 걸린다
    const importers = walk('src').filter((f) => /from ['"](@\/server\/|\.\/)submit-mode['"]/.test(src(f)));
    expect(importers.sort()).toEqual(['src/app/api/rollup/org/sections/upload/route.ts', 'src/app/org/page.tsx']);
    // 웹 작성 라우트에는 걸지 않는다 — 제출을 막는 스위치가 아니다
    expect(src('src/app/api/submissions/compose/route.ts')).not.toContain('assertHwpUploadOpen');
  });

  it('[WA-T33d] RU-60 — 「전사」의 게시판 hwp 올리기는 스위치를 본다: 취합의 문 다음, 파일 읽기 전', () => {
    const route = src('src/app/api/rollup/org/sections/upload/route.ts');
    const post = route.slice(route.indexOf('export const POST'), route.indexOf('export const DELETE'));
    const door = post.indexOf('requireOrgRollup(');
    const gate = post.indexOf('assertHwpUploadOpen()');
    expect(door).toBeGreaterThan(-1);
    // 밖의 사람에게는 여전히 404(존재 은닉) — 스위치는 문 안쪽에서 본다
    expect(gate).toBeGreaterThan(door);
    expect(gate).toBeLessThan(post.indexOf('req.formData()'));
    // 취소(DELETE)는 걸지 않는다 — 이미 올라온 것을 치우는 일이다
    expect(route.slice(route.indexOf('export const DELETE'))).not.toContain('assertHwpUploadOpen');
    // 화면도 같은 판정으로 [올리기]를 그린다
    expect(src('src/app/org/page.tsx')).toContain('const uploadOpen = hwpUploadOpen();');
  });
});

// 맨 끝에 둔다 — 모듈을 새로 읽으므로 앞의 테스트와 섞이지 않게
describe('RU-60a 기본값', () => {
  it('[WA-T30b] 환경변수가 없으면 on — 「전사」 [올리기]의 지금 동작 그대로', async () => {
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
