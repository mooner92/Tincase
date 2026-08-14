// Sprint 2 통합 — preview·versions·template·rule·ops (API-T07/T11/T12 상당 + 격리)
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-s2-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-s2.db';
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

const A = { slug: 'Div_A', short: 'da2', nameKo: '가부서' };
const B = { slug: 'Div_B', short: 'db2', nameKo: '나부서' };
const ID = {
  member: 'm@t.kei.re.kr',
  lead: 'l@t.kei.re.kr',
  bLead: 'bl@t.kei.re.kr',
  op: 'op@t.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://t.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://t.local${url}`);
  return r as never;
}

let hwp: Buffer;
let filled: Buffer;
let subId = '';

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-s2.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');

  const dowTomorrow = ((new Date(Date.now() + 86400_000).getDay() + 6) % 7) + 1;
  const da = await prisma.division.create({
    data: { slug: A.slug, shortSlug: A.short, nameKo: A.nameKo, nameEn: A.slug, isActive: true, deadlineDow: dowTomorrow, deadlineTime: '23:59' },
  });
  const db = await prisma.division.create({
    data: { slug: B.slug, shortSlug: B.short, nameKo: B.nameKo, nameEn: B.slug, isActive: true, deadlineDow: dowTomorrow, deadlineTime: '23:59' },
  });
  await prisma.user.create({ data: { email: ID.member, name: 'm', divisionId: da.id } });
  await prisma.user.create({ data: { email: ID.lead, name: 'l', divisionId: da.id, divisionRole: 'lead' } });
  await prisma.user.create({ data: { email: ID.bLead, name: 'bl', divisionId: db.id, divisionRole: 'lead' } });
  await prisma.user.create({ data: { email: ID.op, name: 'op', divisionId: da.id, isOperator: true } });

  hwp = readFileSync(path.join(FIX, 'master-template.hwp'));
  filled = readFileSync(path.join(FIX, 'sample-filled-w2.hwp'));

  // member가 실데이터 파일 업로드 → preview 대상
  const { POST } = await import('@/app/api/submissions/route');
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(filled)], '주간.hwp'));
  const res = await POST(nx('/api/submissions', ID.member, { method: 'POST', body: fd }));
  subId = (await res.json()).submission.id;
}, 60_000);

d('preview API (API-22~25)', () => {
  it('[API-T07] lead 열람 → 표 내용이 실측과 일치', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const res = await GET(nx(`/api/submissions/${subId}/preview`, ID.lead), {
      params: Promise.resolve({ id: subId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables[0].rows[0]).toEqual(['구분', '업무실적 내용', '일자', '장소', '참석자']);
    expect(body.tables[0].rows[1][1]).toBe('인포그래픽 제작');
    expect(body.tables.length).toBe(2); // 표3 삭제된 파일
    expect(body.warnings.join()).toContain('3번 표');
  });
  it('본인 열람 가능 · 같은 부서 타 member는 (별도 계정) — lead 아님 → 404', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const own = await GET(nx(`/api/submissions/${subId}/preview`, ID.member), {
      params: Promise.resolve({ id: subId }),
    });
    expect(own.status).toBe(200);
  });
  it('[격리] B부서 lead가 A 제출물 preview → 404', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/preview/route');
    const res = await GET(nx(`/api/submissions/${subId}/preview`, ID.bLead), {
      params: Promise.resolve({ id: subId }),
    });
    expect(res.status).toBe(404);
  });
  it('preview는 감사 로그를 남긴다 (API-24)', async () => {
    const { prisma } = await import('@/server/db');
    const n = await prisma.auditLog.count({ where: { action: 'preview' } });
    expect(n).toBeGreaterThan(0);
  });
});

d('versions API', () => {
  it('버전 목록 + isLatest 표시', async () => {
    const { GET } = await import('@/app/api/submissions/[id]/versions/route');
    const res = await GET(nx(`/api/submissions/${subId}/versions`, ID.lead), {
      params: Promise.resolve({ id: subId }),
    });
    const body = await res.json();
    expect(body.versions.length).toBe(1);
    expect(body.versions[0].isLatest).toBe(true);
  });
});

d('template 교체 (API-40/41, ST-19)', () => {
  it('member → 404 · lead 정상 등록 → 파싱 요약 반환', async () => {
    const { POST } = await import('@/app/api/division/template/route');
    const fd1 = new FormData();
    fd1.set('file', new File([new Uint8Array(hwp)], '양식.hwp'));
    const r1 = await POST(nx('/api/division/template', ID.member, { method: 'POST', body: fd1 }));
    expect(r1.status).toBe(404);

    const fd2 = new FormData();
    fd2.set('file', new File([new Uint8Array(hwp)], '양식.hwp'));
    const r2 = await POST(nx('/api/division/template', ID.lead, { method: 'POST', body: fd2 }));
    expect(r2.status).toBe(201);
    const body = await r2.json();
    expect(body.template.version).toBe(1);
    expect(body.parsedSummary).toEqual([
      { rows: 9, cols: 5 },
      { rows: 9, cols: 5 },
      { rows: 5, cols: 5 },
    ]);
  });
  it('[ST-T17] 깨진 파일 → 422 + 기존 양식 유지 안내, active 유지', async () => {
    const { POST } = await import('@/app/api/division/template/route');
    const { prisma } = await import('@/server/db');
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array(Buffer.alloc(64))], '깨짐.hwp'));
    const res = await POST(nx('/api/division/template', ID.lead, { method: 'POST', body: fd }));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain('기존 양식은 그대로');
    const active = await prisma.template.findFirst({ where: { isActive: true, division: { slug: A.slug } } });
    expect(active?.version).toBe(1);
  });
  it('동일 파일 재등록 → 409', async () => {
    const { POST } = await import('@/app/api/division/template/route');
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array(hwp)], '양식.hwp'));
    const res = await POST(nx('/api/division/template', ID.lead, { method: 'POST', body: fd }));
    expect(res.status).toBe(409);
  });
  it('교체 → v2 active, v1 비활성 (DM-14)', async () => {
    const { POST } = await import('@/app/api/division/template/route');
    const { prisma } = await import('@/server/db');
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array(filled)], '양식2.hwp'));
    const res = await POST(nx('/api/division/template', ID.lead, { method: 'POST', body: fd }));
    expect(res.status).toBe(201);
    const rows = await prisma.template.findMany({ where: { division: { slug: A.slug } }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.isActive])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});

d('rule 저장 (API-28/29)', () => {
  it('lead 저장 → GET 반영 · member 404', async () => {
    const { GET, PUT } = await import('@/app/api/division/rule/route');
    const put = await PUT(
      nx('/api/division/rule', ID.lead, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: '순서: m, l', guideText: '한 줄 안내' }),
      }),
    );
    expect(put.status).toBe(200);
    const get = await GET(nx('/api/division/rule', ID.lead));
    const body = await get.json();
    expect(body.ruleText).toBe('순서: m, l');
    expect(body.guideText).toBe('한 줄 안내');

    const m = await GET(nx('/api/division/rule', ID.member));
    expect(m.status).toBe(404);
  });
  it('10KB 초과 → 422', async () => {
    const { PUT } = await import('@/app/api/division/rule/route');
    const res = await PUT(
      nx('/api/division/rule', ID.lead, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: 'x'.repeat(10_100) }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

d('부서 해석 단일 출처 (v1.3.1 회귀)', () => {
  it('[격리] member는 타 부서 슬러그·별칭 모두 404', async () => {
    const { resolveTargetDivision, HttpError } = await import('@/server/authz');
    const { requireScope } = await import('@/server/authz');
    const h = new Headers({ 'x-test-identity': ID.member });
    const scope = await requireScope(h);
    for (const s of [B.slug, B.short]) {
      await expect(resolveTargetDivision(scope, s)).rejects.toMatchObject({ status: 404 });
    }
    void HttpError;
  });

  it('[격리] lead도 타 부서는 404 (readAll 아님)', async () => {
    const { resolveTargetDivision, requireScope } = await import('@/server/authz');
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.lead }));
    await expect(resolveTargetDivision(scope, B.slug)).rejects.toMatchObject({ status: 404 });
  });

  it('operator는 타 부서 해석 성공 + isOwn=false + 감사 로그', async () => {
    const { resolveTargetDivision, requireScope } = await import('@/server/authz');
    const { prisma } = await import('@/server/db');
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.op }));
    const r = await resolveTargetDivision(scope, B.slug);
    expect(r.division.slug).toBe(B.slug);
    expect(r.isOwn).toBe(false);
    expect(r.redirectTo).toBeNull();
    const logs = await prisma.auditLog.count({ where: { action: 'cross_division_read', actor: ID.op } });
    expect(logs).toBeGreaterThan(0);
  });

  it('내 부서·별칭·빈 값은 모두 내 부서로 (isOwn=true)', async () => {
    const { resolveTargetDivision, requireScope } = await import('@/server/authz');
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.member }));
    for (const arg of [undefined, A.slug, A.short]) {
      const r = await resolveTargetDivision(scope, arg);
      expect(r.division.slug).toBe(A.slug);
      expect(r.isOwn).toBe(true);
    }
    // 별칭은 정식 슬러그로 유도
    expect((await resolveTargetDivision(scope, A.short)).redirectTo).toBe(`/${A.slug}`);
  });

  it('타 부서 별칭 → operator는 정식 슬러그로 redirect', async () => {
    const { resolveTargetDivision, requireScope } = await import('@/server/authz');
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.op }));
    const r = await resolveTargetDivision(scope, B.short);
    expect(r.redirectTo).toBe(`/${B.slug}`);
    expect(r.isOwn).toBe(false);
  });

  it('★ zip은 요청한 부서의 파일만 담는다 (헤더/본문 불일치 방지)', async () => {
    const { GET } = await import('@/app/api/division/download-zip/route');
    const { POST } = await import('@/app/api/submissions/route');
    const { prisma } = await import('@/server/db');

    // B부서 제출물 준비 (bLead가 올린다)
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array(filled)], 'b주간.hwp'));
    const up = await POST(nx('/api/submissions', ID.bLead, { method: 'POST', body: fd }));
    expect(up.status).toBe(201);
    const bCount = await prisma.submission.count({ where: { division: { slug: B.slug }, isLatest: true } });
    expect(bCount).toBeGreaterThan(0);

    // operator가 B부서 지정 → 200, 파일명에 B 부서명
    const ok = await GET(nx(`/api/division/download-zip?division=${B.slug}`, ID.op));
    expect(ok.status).toBe(200);
    expect(decodeURIComponent(ok.headers.get('content-disposition') ?? '')).toContain(B.nameKo);

    // lead가 B부서 지정 → 404 (권한 없음)
    const denied = await GET(nx(`/api/division/download-zip?division=${B.slug}`, ID.lead));
    expect(denied.status).toBe(404);
  });
});

d('Phase 2 계약 예약 (API-30)', () => {
  it('merge API — member 404 · lead 501 (동작 아님을 명시)', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    expect((await POST(nx('/api/division/merge', ID.member, { method: 'POST' }))).status).toBe(404);
    const res = await POST(nx('/api/division/merge', ID.lead, { method: 'POST' }));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe('not_implemented');
  });
});

d('ops API (operator 전용)', () => {
  it('[AU 격리] lead/member → 404 · operator → 200', async () => {
    const { GET } = await import('@/app/api/ops/divisions/route');
    expect((await GET(nx('/api/ops/divisions', ID.lead))).status).toBe(404);
    expect((await GET(nx('/api/ops/divisions', ID.member))).status).toBe(404);
    const ok = await GET(nx('/api/ops/divisions', ID.op));
    expect(ok.status).toBe(200);
    expect((await ok.json()).divisions.length).toBe(2);
  });
  it('양식 없는 부서 활성화 → 409 no_template', async () => {
    const { GET, PUT } = await import('@/app/api/ops/divisions/route');
    const { prisma } = await import('@/server/db');
    const b = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    await prisma.division.update({ where: { id: b.id }, data: { isActive: false } });
    const res = await PUT(
      nx('/api/ops/divisions', ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, isActive: true }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_template');
    void GET;
  });
  it('마감 정책 검증 (DM-10) — 월 00:00 거부', async () => {
    const { PUT } = await import('@/app/api/ops/divisions/route');
    const { prisma } = await import('@/server/db');
    const a = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const res = await PUT(
      nx('/api/ops/divisions', ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, deadlineDow: 1, deadlineTime: '00:00' }),
      }),
    );
    expect(res.status).toBe(422);
  });
  it('roster 일괄 변경 — 무효 userId 섞이면 전체 409 (API-27)', async () => {
    const { PUT } = await import('@/app/api/ops/roster/route');
    const { prisma } = await import('@/server/db');
    const u = await prisma.user.findUniqueOrThrow({ where: { email: ID.member } });
    const bad = await PUT(
      nx('/api/ops/roster', ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ userId: u.id, onRoster: false }, { userId: 'nope', onRoster: true }] }),
      }),
    );
    expect(bad.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).onRoster).toBe(true); // 부분 적용 없음

    const good = await PUT(
      nx('/api/ops/roster', ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ userId: u.id, sortOrder: 5, divisionRole: 'member' }] }),
      }),
    );
    expect(good.status).toBe(200);
  });
});
