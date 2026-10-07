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
const put = (identity: string, isoKey: string, ach: string[], plans: string[]) =>
  nx('/api/division/merged/content', identity, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      isoKey,
      tables: [
        { key: 'achievements', rows: ach.map((c) => ['', c, '', '', '']) },
        { key: 'plans', rows: plans.map((c) => ['', c, '', '', '']) },
        { key: 'notes', rows: [] },
      ],
    }),
  });
const approve = (identity: string, isoKey: string) =>
  nx('/api/division/merged/approve', identity, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isoKey }),
  });

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
    const res = await PUT(put(ID.head, isoKey, ['보도자료 배포(2건)', '웹진 발송'], ['포럼 참석']));
    expect(res.status).toBe(200);
    expect((await res.json()).approved.summary).toBe('실적 1줄 고침');

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
    const res = await PUT(put(ID.lead, isoKey, ['보도자료 배포(2건)', '웹진 발송', '홈페이지 점검'], ['포럼 참석']));
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
    expect((await POST(approve(ID.lead, isoKey))).status).toBe(404);
    expect((await POST(approve(ID.member, isoKey))).status).toBe(404);
    // 다른 부서의 head — 대상은 신원의 부서다(TACP-6). 그 부서엔 병합본이 없어 409, 검토실엔 아무 일도 없다
    expect((await POST(approve(ID.otherHead, isoKey))).status).toBe(409);
    const { prisma } = await import('@/server/db');
    expect(await prisma.mergeReview.count({ where: { divisionId: divId } })).toBe(1);

    const ok = await POST(approve(ID.head, isoKey));
    expect(ok.status).toBe(200);
    expect((await ok.json()).review).toMatchObject({ kind: 'approve', changedAfter: false });
    // 같은 판을 또 누르면 새 기록·새 알림을 만들지 않는다
    expect((await (await POST(approve(ID.head, isoKey))).json()).unchanged).toBe(true);
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
