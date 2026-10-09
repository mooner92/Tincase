// WA-T54 · LAUNCH-v2 — 전환이 화요일(10/13)로 밀렸다. **월요일(10/12)에는 v1이 돈다** — 이미 켜진 파일럿 부서(AI홍보전략실)의 부서원은
// 그날 W42를 hwp로 올려 낼 수 있다(v1에는 업로드 길이 있다). 화요일 아침 v2로 바꾸면 그 제출물이 v2에서 어떻게 보이나:
//   ① 홈 이번 주 카드가 「제출 완료」(낸 시각 · 판)이다 — 다시 내라고 하지 않는다
//   ② [열기]는 작성 화면을 **그 hwp의 내용으로 채운다**(WA-35) — 처음부터 다시 쓰지 않는다
//   ③ 고쳐 [제출]하면 v2(웹 작성)가 되고, 월요일의 v1(업로드)은 지워지지 않고 남는다
// 올린 파일은 한글에서 만든 실제 제출물 꼴(fixtures/sample-filled-w2.hwp — 저장소 밖)이다 — 웹 작성 길이 만든 hwp가 아니다.
// 저장은 v1 업로드 라우트가 부르던 저장 함수 그대로(`uploadSubmission`, origin 'upload') — 업로드 라우트는 v2에서 지웠지만(WA-39) 기록의 꼴은 같다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-monday-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-monday-upload.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures');
const hasFixtures = existsSync(path.join(FIX, 'master-template.hwp')) && existsSync(path.join(FIX, 'sample-filled-w2.hwp'));
const d = hasFixtures ? describe : describe.skip;

const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));

const DIV = { slug: 'Monday_A', nameKo: '월요일실' };
const ID = { member: 'mon-member@test.local', lead: 'mon-lead@test.local' };
let mondayId = '';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://t.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://t.local${url}`);
  return r as never;
}
async function db() {
  return (await import('@/server/db')).prisma;
}

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-monday-upload.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  // 마감이 늘 열려 있게 주차의 마지막 순간(일요일 23:59) — integration.test.ts와 같은 이유
  const div = await prisma.division.create({
    data: { slug: DIV.slug, nameKo: DIV.nameKo, nameEn: DIV.slug, isActive: true, deadlineDow: 7, deadlineTime: '23:59' },
  });
  const member = await prisma.user.create({ data: { email: ID.member, name: '월요부원', divisionId: div.id } });
  await prisma.user.create({ data: { email: ID.lead, name: '월요담당', divisionId: div.id, divisionRole: 'lead' } });
  if (!hasFixtures) return;

  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot, uploadSubmission } = await import('@/server/worklog');
  const rel = `divisions/${DIV.slug}/template/active.hwp`;
  await writeFileAtomic(rel, readFileSync(path.join(FIX, 'master-template.hwp')));
  await prisma.template.create({ data: { divisionId: div.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'seed' } });

  // 「월요일 09:10」 — 이번 주 월요일. 지금이 그보다 이르면(월요일 새벽에 돌리면) 지금 1분 전으로
  const slot = await ensureCurrentSlot();
  const at = new Date(Math.min(slot.opensAt.getTime() + (9 * 60 + 10) * 60_000, Date.now() - 60_000));
  const r = await uploadSubmission(
    { user: member, division: div, fileName: '주간업무_월요부원.hwp', bytes: readFileSync(path.join(FIX, 'sample-filled-w2.hwp')), origin: 'upload' },
    at,
  );
  mondayId = r.submission.id;
}, 60_000);

afterAll(async () => {
  const { settleLater } = await import('@/server/after');
  await settleLater();
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('[WA-T54] 월요일에 v1으로 올린 hwp를 화요일의 v2가 이어받는다 (LAUNCH-v2 「월요일」)', () => {
  it('① 홈 — 이번 주 카드 「제출 완료」 · 낸 시각 · v1 · 주 버튼은 [열기] (다시 내라고 하지 않는다)', async () => {
    const prisma = await db();
    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: mondayId } });
    expect([sub.origin, sub.version, sub.isLatest]).toEqual(['upload', 1, true]);

    const { getDivisionView } = await import('@/server/page-scope');
    const { loadMemberHome } = await import('@/server/my-weeks');
    const { ThisWeekCard } = await import('@/components/ThisWeekCard');
    pageAs.who = ID.member;
    const home = await loadMemberHome(await getDivisionView(DIV.slug), new Date());
    pageAs.who = '';
    expect(home.card.mine).toMatchObject({ id: mondayId, version: 1, edited: false });
    expect(home.card.canCompose).toBe(true);
    const html = renderToStaticMarkup(createElement(ThisWeekCard, { ...home.card, layout: 'alone' }));
    expect(html).toContain('제출 완료');
    expect(html).toContain(`${home.card.mine!.at} 제출`);
    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual(['열기', '제출 취소']);
  });

  it('② [열기] — 카드가 부르는 열람 응답에 그 hwp의 표가 그대로 · 작성 화면이 그것으로 채워진다(빈 표가 아니다)', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const res = await GET(nx(`/api/submissions/${mondayId}/preview`, ID.member), { params: Promise.resolve({ id: mondayId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rowsByTable: Record<'achievements' | 'plans' | 'notes', { content: string }[]> };

    // 기대값은 파일을 직접 읽어 만든다 — 한글에서 만든 표가 웹 작성 표로 옮겨지는가
    const { readWorklog } = await import('@/lib/hwp/reader');
    const file = readWorklog(readFileSync(path.join(FIX, 'sample-filled-w2.hwp'))).worklog;
    expect(file.achievements.length).toBeGreaterThan(0);
    for (const k of ['achievements', 'plans', 'notes'] as const) {
      expect(body.rowsByTable[k].map((r) => r.content), k).toEqual(file[k].map((r) => r.content));
    }

    // ThisWeekCard.openMain이 하는 일 그대로: 열람 응답의 rowsByTable → composerStart(임시본 없음)
    const { composerStart } = await import('@/lib/composer');
    const blank = () => ({ content: '' });
    const start = composerStart(null, body.rowsByTable, blank);
    expect(start.from).toBe('submission');
    expect(start.data.achievements.slice(0, -1).map((r) => r.content)).toEqual(file.achievements.map((r) => r.content));
    expect(start.data.achievements.at(-1)).toEqual(blank()); // 이어 적을 빈 줄
  });

  it('③ 고쳐 [제출] — v2(웹 작성) · 월요일의 v1(업로드)은 남는다(지우지 않는다 — ADR-0007)', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const prev = (await (await GET(nx(`/api/submissions/${mondayId}/preview`, ID.member), { params: Promise.resolve({ id: mondayId }) })).json()) as {
      rowsByTable: Record<'achievements' | 'plans' | 'notes', { content: string; date?: string }[]>;
    };
    const achievements = prev.rowsByTable.achievements.map((r, i) => (i === 0 ? { ...r, content: `${r.content} (화요일에 고침)` } : r));
    const { POST } = await import('@/app/api/submissions/compose/route');
    const res = await POST(
      nx('/api/submissions/compose', ID.member, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ achievements, plans: prev.rowsByTable.plans, notes: prev.rowsByTable.notes }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);

    const prisma = await db();
    const rows = await prisma.submission.findMany({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: ID.member } })).id }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.origin, r.isLatest])).toEqual([
      [1, 'upload', false],
      [2, 'web', true],
    ]);
    // 담당자는 수합 관리에서 v2를 본다 — 월요일 것도 「제출」로 세어졌다(현황은 최신 판 기준)
    const { divisionStatus } = await import('@/server/worklog');
    const div = await prisma.division.findUniqueOrThrow({ where: { slug: DIV.slug } });
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { id: rows[1].weekSlotId } });
    const st = await divisionStatus(div.id, slot.id);
    const row = st.members.find((m) => m.user.name === '월요부원');
    expect([row?.status, row?.latest?.version, row?.versionCount]).toEqual(['submitted', 2, 2]);
  });
});
