// WS-14·15 — **이번 주가 월간**(그 달 마지막 주)일 때 화면이 받는 값 · 문서 이름 · 쪽지가 「월간」을 말하나 (WS-T78 · 2026-10-10 출시 전 점검).
//
// 브라우저 e2e(OPS-50)는 진짜 시계로 돈다 — 「이번 주」가 월간인 날에만 이 길을 탄다. 전환 주(W42 — 10/13 화)는 주간이고, 10월의 월간 주는
// 10/26 주(W44 · 10/31이 들고 11/1로 넘어가는 주)다. 운영에서 처음 맞는 월간이 그 주라(3단계를 켤 수도 있는 주 — LAUNCH-v2 §7) 그 전에 본다.
// 그래서 시계(Date만 — 타이머는 진짜)를 그 주로 옮기고 서버 함수·라우트를 그대로 부른다. 그리는 부품은 주간과 같다 — 받는 값만 다르다.
//
// 지난 주차의 월간(9월 4주차)은 e2e가 이미 연다(「9월 연구운영회의 월간업무」 — OPS-50e). 여기는 **이번 주**다.
// 메신저는 흉내 낸다(적기만 하고 보내지 않는다). 사람·부서 이름은 지어낸 것이다. 양식 픽스처(fixtures/, 저장소 밖)가 있어야 돈다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-monthly-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-monthly.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures');
const d = existsSync(path.join(FIX, 'master-template.hwp')) ? describe : describe.skip;

// 페이지의 신원은 next/headers에서 온다 — 그것만 갈아 끼운다(integration.test.ts와 같은 방식)
const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));

const msgr = vi.hoisted(() => ({ outbox: [] as { to: string; subject: string; contents: string; kind?: string }[] }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => ({ enabled: true, reason: '', allow: '전원' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string; kind?: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, subject: input.subject, contents: input.contents, kind: input.kind });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

/** 10월 월간 주(W44) — 월 10/26 · 마감 목 10/29 14:00 */
const KST = (s: string) => new Date(`${s}+09:00`);
const T = {
  wed: KST('2026-10-28T10:30:00'),
  day1: KST('2026-10-28T11:46:00'), // 전날 11:45 창 (NT-41)
  hour1: KST('2026-10-29T13:01:00'), // 1시간 전 (NT-10)
  merge: KST('2026-10-29T14:01:00'), // 마감 +1분 — 최종본 (HM-34)
  review: KST('2026-10-29T14:11:00'), // +10분 — 부서장 검토 요청 (NT-40)
  submit: KST('2026-10-29T14:31:00'), // +30분 — 담당 안내 (NT-47 ②)
};
const DEADLINE = KST('2026-10-29T14:00:00');
const DIV = { slug: 'Monthly_A', nameKo: '월간실' };
const ID = { lead: 'm-lead@test.local', head: 'm-head@test.local', a: 'm-a@test.local', b: 'm-b@test.local', late: 'm-late@test.local', op: 'm-op@test.local' };
const NO = { lead: 'M101', head: 'M102', a: 'M103', b: 'M104', late: 'M105' };

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
/** 서버 컴포넌트가 돌려준 요소 나무 — 그리지 않고 무엇을 어떤 값으로 그리려 했는지만 본다(PG-T79와 같다) */
type El = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && 'type' in node && 'props' in node) {
    out.push(node as El);
    for (const v of Object.values((node as El).props ?? {})) elements(v, out);
  }
  return out;
}
const sent = (no: string, kindPrefix: string) => msgr.outbox.filter((m) => m.to === no && (m.kind ?? '').startsWith(kindPrefix));

beforeAll(async () => {
  // 시계만 옮긴다 — setTimeout 등은 진짜라 Prisma·파일 쓰기가 그대로 돈다
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T.wed);
  rmSync(path.join(ROOT, 'prisma/test-monthly.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const div = await prisma.division.create({ data: { slug: DIV.slug, nameKo: DIV.nameKo, nameEn: DIV.slug, isActive: true, notifyEnabled: true } });
  const mk = (email: string, no: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: div.id, employeeNo: no, ...extra } });
  await mk(ID.lead, NO.lead, { divisionRole: 'lead', jobTitle: '담당' });
  await mk(ID.head, NO.head, { divisionRole: 'head', jobTitle: '실장', onRoster: false, rosterNote: '부서장' });
  await mk(ID.a, NO.a);
  await mk(ID.b, NO.b);
  await mk(ID.late, NO.late); // 끝까지 안 낸다 — 마감 전 쪽지를 받을 사람
  // 감사 문서를 받을 운영자 — 명단 밖 · 사번 없음(쪽지 판정에 끼지 않는다)
  await prisma.user.create({ data: { email: ID.op, name: '운영', divisionId: div.id, isOperator: true, onRoster: false } });
  if (existsSync(path.join(FIX, 'master-template.hwp'))) {
    const { writeFileAtomic } = await import('@/server/storage');
    const rel = `divisions/${DIV.slug}/template/active.hwp`;
    await writeFileAtomic(rel, readFileSync(path.join(FIX, 'master-template.hwp')));
    await prisma.template.create({ data: { divisionId: div.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'seed' } });
  }
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  const { settleLater } = await import('@/server/after');
  await settleLater();
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('[WS-T78] 이번 주가 월간(10/26 주 — W44)일 때', () => {
  it('주차 — 「10월 4주차」 · 월간(slotKind) · 라벨은 그대로(WS-15)', async () => {
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const { slotKind } = await import('@/lib/week');
    const slot = await ensureCurrentSlot(T.wed);
    expect([slot.isoKey, slot.label, slot.month, slotKind(slot)]).toEqual(['2026-W44', '10월 4주차', 10, 'monthly']);
  });

  it('홈 — 이번 주 카드 머리에 「월간」 칩 (서버가 넘기는 값으로 그린다)', async () => {
    const { getDivisionView } = await import('@/server/page-scope');
    const { loadMemberHome } = await import('@/server/my-weeks');
    const { ThisWeekCard } = await import('@/components/ThisWeekCard');
    pageAs.who = ID.a;
    const home = await loadMemberHome(await getDivisionView(DIV.slug), T.wed);
    expect(home.card.week).toMatchObject({ isoKey: '2026-W44', label: '10월 4주차', month: 10, monthly: true });
    const html = renderToStaticMarkup(createElement(ThisWeekCard, { ...home.card, layout: 'alone' }));
    expect(html).toMatch(/<h1[^>]*>10월 4주차<span class="chip chip-ok">월간<\/span><\/h1>/);
    pageAs.who = '';
  });

  it('부서원이 낸다(웹 작성) — 월간 주도 같은 길 · 같은 마감', async () => {
    const { POST } = await import('@/app/api/submissions/compose/route');
    for (const [who, text] of [
      [ID.a, '10월 월간 실적 정리'],
      [ID.b, '연구 보고서 10월 진행 정리'],
    ] as const) {
      const res = await POST(
        nx('/api/submissions/compose', who, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ achievements: [{ content: text, date: '10/27' }], plans: [{ content: '11월 계획' }], notes: [] }),
        }),
      );
      expect(res.status, who).toBe(200);
    }
  });

  it('마감 전 쪽지 — 전날·1시간 전은 「월간」과 「한 달치」 줄 · 10분 전은 주차만(원래 문구)', async () => {
    const { runDueReminders } = await import('@/server/notify/deadline-reminder');
    msgr.outbox.length = 0;
    vi.setSystemTime(T.day1);
    expect((await runDueReminders(T.day1)).map((o) => o.kind)).toEqual(['deadline_1d']);
    const [d1] = sent(NO.late, 'deadline_1d');
    expect(d1.subject).toBe('[Tincase] 10월 4주차 월간 업무일지 마감이 내일이에요');
    expect(d1.contents).toContain('10월 29일(목) 14:00까지');
    expect(d1.contents).toContain('이번 주는 한 달치를 정리하는 월간이에요.');
    // 낸 사람에게는 가지 않는다
    expect(sent(NO.a, 'deadline_').length + sent(NO.b, 'deadline_').length).toBe(0);

    vi.setSystemTime(T.hour1);
    expect((await runDueReminders(T.hour1)).map((o) => o.kind)).toEqual(['deadline_1h']);
    const [h1] = sent(NO.late, 'deadline_1h');
    expect(h1.subject).toBe('[Tincase] 10월 4주차 월간 업무일지 마감 1시간 전이에요');
    expect(h1.contents).toContain('이번 주는 한 달치를 정리하는 월간이에요.');
  });

  it('병합본 — 받기 파일 이름 「…_월간업무.hwp」 · 드로어 제목 = 게시판 제목 「10월 연구운영회의 월간업무(부서)」(주차 번호 없음)', async () => {
    const prisma = await db();
    const { runMergeRecorded } = await import('@/server/merge/run');
    vi.setSystemTime(T.merge);
    const div = await prisma.division.findUniqueOrThrow({ where: { slug: DIV.slug } });
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: '2026-W44' } });
    const run = await runMergeRecorded(div.id, slot.id, 'auto');
    expect(run.status).toBe('succeeded');

    const { GET: download } = await import('@/app/api/division/merged/route');
    const res = await download(nx('/api/division/merged?isoKey=2026-W44', ID.lead));
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('content-disposition') ?? '')).toContain(`2026_10월_4주차_${DIV.nameKo}_월간업무.hwp`);

    const { GET: content } = await import('@/app/api/division/merged/content/route');
    const c = await content(nx(`/api/division/merged/content?division=${DIV.slug}&isoKey=2026-W44`, ID.lead));
    expect(c.status).toBe(200);
    const body = (await c.json()) as { title: string; slot: { kind: string } };
    expect(body.title).toBe(`10월 연구운영회의 월간업무(${DIV.nameKo})`);
    expect(body.slot.kind).toBe('monthly');
  });

  it('수합 관리 — 머리 「10월 월간」 칩 · 병합 카드의 게시판 제목([제목 복사])도 월간', async () => {
    const prisma = await db();
    const { ManageView } = await import('@/app/[division]/manage/ManageView');
    const division = await prisma.division.findUniqueOrThrow({ where: { slug: DIV.slug } });
    const els = elements(await ManageView({ division, canMerge: true, canDownloadMerged: true, canDeleteAny: false, canEditMerged: true }));
    const chips = els.filter((e) => e.type === 'span' && e.props.className === 'chip chip-ok').map((e) => renderToStaticMarkup(e as never));
    expect(chips).toContain('<span class="chip chip-ok">10월 월간</span>');
    const panel = els.find((e) => typeof e.type === 'function' && (e.type as { name: string }).name === 'MergePanel');
    expect(panel?.props.title).toBe(`10월 연구운영회의 월간업무(${DIV.nameKo})`);
  });

  it('병합 뒤 쪽지 — 검토 요청(부서장) · 승인 완료(담당) · 담당 안내(+30분)가 「10월 4주차 월간」', async () => {
    const prisma = await db();
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    msgr.outbox.length = 0;
    vi.setSystemTime(T.review);
    await runDueMergeNotices(T.review);
    const [review] = sent(NO.head, 'merge_review');
    expect(review?.subject).toBe('[Tincase] 10월 4주차 월간 병합본 검토 부탁드려요');
    expect(review.contents).toContain('10월 4주차 월간 업무일지 병합본이 준비됐어요');

    // 부서장의 [고칠 것 없음 · 승인] — 담당에게 「승인 완료」 (NT-46). 화면과 같은 라우트로
    const run = await prisma.mergeRun.findFirstOrThrow({ where: { status: 'succeeded', weekSlot: { isoKey: '2026-W44' } }, orderBy: { startedAt: 'desc' } });
    const { sha256 } = await import('@/server/storage');
    const { readStoredFile } = await import('@/server/storage');
    const { POST: approve } = await import('@/app/api/division/merged/approve/route');
    const ok = await approve(
      nx('/api/division/merged/approve', ID.head, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isoKey: '2026-W44', runId: run.id, sha256: sha256(await readStoredFile(run.outputPath!)) }),
      }),
    );
    expect(ok.status).toBe(200);
    const [approved] = sent(NO.lead, 'merge_approved');
    expect(approved?.subject).toMatch(/^\[Tincase\] 10월 4주차 월간 병합본 — .+님 승인 완료$/);
    expect(approved.contents).toContain('10월 4주차 월간 병합본 검토를 마쳤어요');

    vi.setSystemTime(T.submit);
    await runDueMergeNotices(T.submit);
    const [done] = sent(NO.lead, 'merge_done');
    expect(done?.subject).toBe('[Tincase] 10월 4주차 월간 병합본 제출해주세요');
    expect(done.contents).toContain('10월 4주차 월간 병합본이 준비됐어요');
  });

  it('감사 문서(OPS-30) — 월간 주는 「월간 업무일지 제출 현황」, 주간 주는 그대로 · 라벨(「10월 4주차」)은 그대로 (WS-15 kindLabel)', async () => {
    const { GET } = await import('@/app/api/ops/report/route');
    const header = (csv: string) => csv.replace(/^\uFEFF/, '').split('\n').find((l) => l.startsWith('# 한국환경연구원'));
    const html = await (await GET(nx('/api/ops/report?isoKey=2026-W44', ID.op))).text();
    expect(html).toContain('<title>월간 업무일지 제출 현황 — 10월 4주차</title>');
    expect(html).toContain('<h1>월간 업무일지 제출 현황</h1>');
    expect(header(await (await GET(nx('/api/ops/report?isoKey=2026-W44&format=csv', ID.op))).text())).toBe('# 한국환경연구원 월간 업무일지 제출 현황');
    // 견줄 주간 주 — 다음 주가 아니라 그 앞 주(10/19 주 · W43)
    const { ensureCurrentSlot } = await import('@/server/worklog');
    expect((await ensureCurrentSlot(KST('2026-10-21T10:00:00'))).isoKey).toBe('2026-W43');
    const weekly = await (await GET(nx('/api/ops/report?isoKey=2026-W43', ID.op))).text();
    expect(weekly).toContain('<title>주간 업무일지 제출 현황 — 10월 3주차</title>');
    expect(header(await (await GET(nx('/api/ops/report?isoKey=2026-W43&format=csv', ID.op))).text())).toBe('# 한국환경연구원 주간 업무일지 제출 현황');
  });

  it('병합 점검 — 머리 줄이 「10월 4주차 월간」', async () => {
    const prisma = await db();
    const { mergeBatchReport, batchMessage } = await import('@/server/notify/merge-batch');
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: '2026-W44' } });
    const divisions = await prisma.division.findMany({ where: { isActive: true } });
    const report = await mergeBatchReport(slot, DEADLINE, divisions, T.review);
    const m = batchMessage({ name: '운영', employeeNo: 'M900' }, slot, report, 'first', T.review);
    expect(m.contents.split('\n')[0]).toBe('[M900]운영님 10월 4주차 월간 마감 병합 점검 (14:11)');
  });
});
