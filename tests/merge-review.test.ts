// HM-47 · NT-46·47 — 부서장의 **승인**. 판정은 계정의 역할로 한다 (TACP-16).
//
// 같은 [수정 저장]이라도 부서장(head)이 하면 승인이고, 담당자(lead)가 하면 그냥 수정이다.
// [고칠 것 없음 · 승인]은 head에게만 있다. 열린 것과 닫힌 것을 같은 무게로 본다 (TACP §10-4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-review-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-review.db';
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
  head: 'r-head@test.kei.re.kr',
  lead: 'r-lead@test.kei.re.kr',
  member: 'r-member@test.kei.re.kr',
  otherHead: 'r-other-head@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
/** HM-47 — 화면이 GET으로 받은 **판** (runId + sha256). 저장·승인 때 그대로 돌려보낸다 */
type Viewed = { runId?: string; sha256?: string };
async function view(identity: string, iso: string): Promise<Viewed> {
  const { GET } = await import('@/app/api/division/merged/content/route');
  const j = await (await GET(nx(`/api/division/merged/content?isoKey=${iso}`, identity))).json();
  return { runId: j.runId, sha256: j.sha256 };
}
const putReq = (identity: string, isoKey: string, ach: string[], plans: string[], v: Viewed) =>
  nx('/api/division/merged/content', identity, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      isoKey,
      ...v,
      tables: [
        { key: 'achievements', rows: ach.map((c) => ['', c, '', '', '']) },
        { key: 'plans', rows: plans.map((c) => ['', c, '', '', '']) },
        { key: 'notes', rows: [] },
      ],
    }),
  });
/** 지금 판을 열어 본 뒤 저장한다 — 화면의 실제 동선 */
const put = async (identity: string, isoKey: string, ach: string[], plans: string[]) =>
  putReq(identity, isoKey, ach, plans, await view(identity, isoKey));
const approveReq = (identity: string, isoKey: string, v: Viewed) =>
  nx('/api/division/merged/approve', identity, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isoKey, ...v }),
  });
const approve = async (identity: string, isoKey: string) => approveReq(identity, isoKey, await view(identity, isoKey));

let isoKey = '';
let divId = '';

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-review.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  const { composeMergedHwp } = await import('@/server/merge');
  const slot = await ensureCurrentSlot();
  isoKey = slot.isoKey;

  const tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  const div = await prisma.division.create({ data: { slug: 'Rev_A', nameKo: '검토실', nameEn: 'Rev_A', isActive: true } });
  const other = await prisma.division.create({ data: { slug: 'Rev_B', nameKo: '다른실', nameEn: 'Rev_B', isActive: true } });
  divId = div.id;
  await writeFileAtomic('divisions/Rev_A/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Rev_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });

  const bytes = composeMergedHwp(
    tpl,
    { achievements: [['1-1', '보도자료 배포(1건)', '', '', ''], ['1-2', '웹진 발송', '', '', '']], plans: [['2-1', '포럼 참석', '', '', '']], notes: [] },
    undefined,
    '검토실',
  ).bytes;
  await writeFileAtomic('divisions/Rev_A/merged/m.hwp', bytes);
  await prisma.mergeRun.create({
    data: { divisionId: div.id, weekSlotId: slot.id, status: 'succeeded', outputPath: 'divisions/Rev_A/merged/m.hwp', sourceIds: '[]', ruleSnapshot: '{}', finishedAt: new Date() },
  });

  const mk = (email: string, divisionId: string, extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId, ...extra } });
  await mk(ID.head, div.id, { divisionRole: 'head', jobTitle: '실장' });
  await mk(ID.lead, div.id, { divisionRole: 'lead' });
  await mk(ID.member, div.id);
  await mk(ID.otherHead, other.id, { divisionRole: 'head' });
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('HM-47 부서장 승인', () => {
  it('[HM-T110] ★ head가 고쳐 저장하면 승인으로 기록된다 — 무엇을 바꿨는지와 함께', async () => {
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const res = await PUT(await put(ID.head, isoKey, ['보도자료 배포(2건)', '웹진 발송'], ['포럼 참석']));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approved.summary).toBe('실적 1줄 고침');
    // 알림이 꺼진 환경(메신저 미설정) — 「알렸습니다」라고 말할 근거가 없다
    expect(body.approved.notified).toBe(0);

    const { prisma } = await import('@/server/db');
    const reviews = await prisma.mergeReview.findMany({ where: { divisionId: divId } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].kind).toBe('edit');
    expect(JSON.parse(reviews[0].changes)).toEqual([
      { bucket: 'achievements', op: 'edit', before: '보도자료 배포(1건)', after: '보도자료 배포(2건)' },
    ]);
  });

  it('[HM-T110b] lead의 저장은 승인이 **아니다** — 그리고 승인한 판이 바뀌었다고 보인다', async () => {
    const { PUT, GET } = await import('@/app/api/division/merged/content/route');
    const res = await PUT(await put(ID.lead, isoKey, ['보도자료 배포(2건)', '웹진 발송', '홈페이지 점검'], ['포럼 참석']));
    expect(res.status).toBe(200);
    expect((await res.json()).approved).toBeNull();
    const { prisma } = await import('@/server/db');
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(1);

    const view = await (await GET(nx(`/api/division/merged/content?isoKey=${isoKey}`, ID.lead))).json();
    expect(view.review).toMatchObject({ by: 'r-head 실장', kind: 'edit', changedAfter: true });
    expect(view.canApprove).toBe(false); // 담당자에게는 [승인]이 없다
  });

  it('[HM-T111] ★ [고칠 것 없음 · 승인]은 head만 — lead·member 404, 다른 부서 head는 자기 부서만', async () => {
    const { POST } = await import('@/app/api/division/merged/approve/route');
    const v = await view(ID.head, isoKey);
    expect((await POST(approveReq(ID.lead, isoKey, v))).status).toBe(404);
    expect((await POST(approveReq(ID.member, isoKey, v))).status).toBe(404);
    // 다른 부서의 head — 대상은 신원의 부서다(TACP-6). 그 부서엔 병합본이 없어 409, 검토실엔 아무 일도 없다
    expect((await POST(approveReq(ID.otherHead, isoKey, v))).status).toBe(409);
    const { prisma } = await import('@/server/db');
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(1);

    const ok = await POST(await approve(ID.head, isoKey));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.review).toMatchObject({ kind: 'approve', changedAfter: false });
    expect(okBody.notified).toBe(0); // 메신저 미설정 — 보낸 사람이 없다
    // 같은 판을 또 누르면 새 기록·새 알림을 만들지 않는다
    expect((await (await POST(await approve(ID.head, isoKey))).json()).unchanged).toBe(true);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(2);
  });

  it('[HM-T112] NT-46 문구 — 누가·언제·무엇을, 그리고 할 일 한 줄', async () => {
    const { approvalMessage } = await import('@/server/merge/review');
    const at = new Date('2026-10-07T05:12:00Z'); // 14:12 KST
    const slot = { label: '10월 1주차', year: 2026, month: 10, weekOfMonth: 1, opensAt: new Date('2026-10-04T15:00:00Z') } as never;
    const m = approvalMessage({ name: '담당', employeeNo: '1234' }, '홍길동 실장', slot, at, [
      { bucket: 'achievements', op: 'edit', before: '보도자료 배포(1건)', after: '보도자료 배포(2건)' },
      { bucket: 'plans', op: 'remove', before: '포럼 참석' },
    ]);
    expect(m.subject).toContain('홍길동 실장님 승인 완료');
    expect(m.contents).toContain('14:12에');
    expect(m.contents).toContain('바뀐 곳: 실적 1줄 고침 · 계획 1줄 뺌');
    expect(m.contents).toContain('· 실적 「보도자료 배포(1건)」 → 「보도자료 배포(2건)」');
    const none = approvalMessage({ name: '담당', employeeNo: '1234' }, '홍길동 실장', slot, at, []);
    expect(none.contents).toContain('고친 곳 없이 승인했어요');
  });
});

describe('NT-40·47 마감 뒤 알림 고르기 — 회귀', () => {
  it('[HM-T113] ★ 성공 + 이미 승인이면 아무것도 안 보낸다 — 담당자에게 「병합본이 없어요」가 가면 안 된다', async () => {
    const { pickJobs } = await import('@/server/notify/merge-notices');
    const approved = { by: '실장', at: new Date(), summary: '', changedAfter: false };
    expect(pickJobs(true, false, { ok: true, approval: approved })).toEqual([]);
    expect(pickJobs(true, false, { ok: true, approval: null })).toEqual([{ kind: 'merge_review', role: 'head' }]);
    // 승인 뒤 바뀌었으면 다시 검토를 부탁한다
    expect(pickJobs(true, false, { ok: true, approval: { ...approved, changedAfter: true } })).toEqual([{ kind: 'merge_review', role: 'head' }]);
    expect(pickJobs(true, false, { ok: false, approval: null })).toEqual([{ kind: 'merge_missing', role: 'lead' }]);
    expect(pickJobs(false, true, { ok: true, approval: approved })).toEqual([{ kind: 'merge_done', role: 'lead' }]);
  });

  it('[HM-T114] 승인 뒤 담당자가 같은 실행의 파일을 고치면 알림도 「승인 뒤 바뀜」으로 본다', async () => {
    const { prisma } = await import('@/server/db');
    const { approvalOf } = await import('@/server/merge/review');
    const run = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: divId } });
    // HM-T111 끝에서 head가 지금 판을 승인했다 → 바뀌지 않음
    expect((await approvalOf(run))?.changedAfter).toBe(false);
    const { PUT } = await import('@/app/api/division/merged/content/route');
    await PUT(await put(ID.lead, isoKey, ['담당자가 또 고침'], ['포럼 참석']));
    expect((await approvalOf(run))?.changedAfter).toBe(true);
  });
});

d('HM-47 승인은 **본 판**에만 — 회귀 (2026-10-07 리뷰)', () => {
  it('[HM-T116] ★ 연 뒤에 담당자가 고쳤으면 부서장의 [승인]·[수정 저장]은 409 — 보지 않은 판에 승인이 붙지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const { POST } = await import('@/app/api/division/merged/approve/route');
    const seen = await view(ID.head, isoKey); // 부서장이 화면을 열었다
    expect(seen.runId).toBeTruthy();
    expect(seen.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 그 사이 담당자가 고쳐 저장했다
    expect((await PUT(await put(ID.lead, isoKey, ['담당자가 몰래 고침'], ['포럼 참석']))).status).toBe(200);
    const before = await prisma.mergeReview.count({ where: { divisionId: divId } });

    const stale = await POST(approveReq(ID.head, isoKey, seen));
    expect(stale.status).toBe(409);
    expect((await stale.json()).message).toBe('병합본이 바뀌었어요 — 다시 열어 확인해 주세요');
    expect((await PUT(putReq(ID.head, isoKey, ['부서장 옛 화면'], ['포럼 참석'], seen))).status).toBe(409);
    // 판을 안 보내는 옛 화면도 같다 — 무엇을 봤는지 모르면 승인하지 않는다
    expect((await POST(approveReq(ID.head, isoKey, {}))).status).toBe(409);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(before);

    // 다시 열면 된다
    expect((await POST(await approve(ID.head, isoKey))).status).toBe(200);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(before + 1);
  });

  it('[HM-T117] 부서장이 아무것도 안 바꾸고 다시 저장하면 승인·알림을 또 만들지 않는다', async () => {
    const { prisma } = await import('@/server/db');
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const rows: [string[], string[]] = [['부서장이 다듬음'], ['포럼 참석']];
    const first = await (await PUT(await put(ID.head, isoKey, ...rows))).json();
    expect(first.approved.unchanged).toBeUndefined();
    const count = await prisma.mergeReview.count({ where: { divisionId: divId } });

    const again = await PUT(await put(ID.head, isoKey, ...rows));
    expect(again.status).toBe(200);
    expect((await again.json()).approved).toMatchObject({ unchanged: true, notified: 0 });
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(count);
  });

  it('[HM-T118] ★ 한 칸의 줄바꿈은 저장해도 남는다 · 너무 긴 칸은 자르지 않고 422', async () => {
    const { PUT, GET } = await import('@/app/api/division/merged/content/route');
    const res = await PUT(await put(ID.lead, isoKey, ['첫 줄\n둘째 줄'], ['포럼 참석']));
    expect(res.status).toBe(200);
    const after = await (await GET(nx(`/api/division/merged/content?isoKey=${isoKey}`, ID.lead))).json();
    expect(after.tables[0].rows[1][1]).toBe('첫 줄\n둘째 줄');

    const long = await PUT(await put(ID.lead, isoKey, ['가'.repeat(501)], ['포럼 참석']));
    expect(long.status).toBe(422);
    expect((await long.json()).message).toContain('501자');
    // 거절했으니 문서는 그대로다
    const still = await (await GET(nx(`/api/division/merged/content?isoKey=${isoKey}`, ID.lead))).json();
    expect(still.tables[0].rows[1][1]).toBe('첫 줄\n둘째 줄');
  });
});
