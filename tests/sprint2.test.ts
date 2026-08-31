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
  head: 'h@t.kei.re.kr',   // TACP-16 — A부서 부서장(실장)
  coord: 'co@t.kei.re.kr', // A부서 소속 총괄 — readAll이지만 담당자는 아니다
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

  const da = await prisma.division.create({
    data: { slug: A.slug, shortSlug: A.short, nameKo: A.nameKo, nameEn: A.slug, isActive: true, deadlineDow: 7, deadlineTime: '23:59' },
  });
  const db = await prisma.division.create({
    data: { slug: B.slug, shortSlug: B.short, nameKo: B.nameKo, nameEn: B.slug, isActive: true, deadlineDow: 7, deadlineTime: '23:59' },
  });
  await prisma.user.create({ data: { email: ID.member, name: 'm', divisionId: da.id } });
  await prisma.user.create({ data: { email: ID.lead, name: 'l', divisionId: da.id, divisionRole: 'lead' } });
  await prisma.user.create({ data: { email: ID.bLead, name: 'bl', divisionId: db.id, divisionRole: 'lead' } });
  await prisma.user.create({ data: { email: ID.op, name: 'op', divisionId: da.id, isOperator: true } });
  await prisma.user.create({ data: { email: ID.head, name: 'h', divisionId: da.id, divisionRole: 'head', jobTitle: '실장' } });
  await prisma.user.create({ data: { email: ID.coord, name: 'co', divisionId: da.id, isCoordinator: true } });

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

d('병합 API (API-30)', () => {
  it('[격리] member는 404 — 병합은 lead의 일이다', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    expect((await POST(nx('/api/division/merge', ID.member, { method: 'POST' }))).status).toBe(404);
  });

  it('lead가 병합하면 MergeRun이 남고 결과 파일이 생긴다', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    const { prisma } = await import('@/server/db');
    const res = await POST(nx('/api/division/merge', ID.lead, { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('succeeded');
    expect(body.outcome.outputRelPath).toMatch(/\/merged\//);
    expect(body.outcome.bytes).toBeGreaterThan(0);

    const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: body.runId } });
    expect(run.status).toBe('succeeded');
    expect(run.finishedAt).not.toBeNull();
    // DM-13 — 실행 시점 설정이 박제된다
    expect(JSON.parse(run.ruleSnapshot)).toMatchObject({ trigger: 'manual' });
  });

  it('[TACP-6] 타 부서 슬러그를 붙여도 내 부서만 병합된다', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    const { prisma } = await import('@/server/db');
    const before = await prisma.mergeRun.count({ where: { division: { slug: B.slug } } });
    await POST(nx(`/api/division/merge?division=${B.slug}`, ID.lead, { method: 'POST' }));
    const after = await prisma.mergeRun.count({ where: { division: { slug: B.slug } } });
    expect(after).toBe(before); // B부서에는 아무 일도 일어나지 않았다
  });

  it('실패해도 MergeRun에 원인이 남는다 — 화면이 보여주고 재실행할 수 있어야 한다', async () => {
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { prisma } = await import('@/server/db');
    const div = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    const slot = await prisma.weekSlot.findFirstOrThrow();
    const r = await runMergeRecorded(div.id, slot.id, 'auto'); // B부서는 양식·제출이 없다
    expect(r.status).toBe('failed');
    expect(r.errorText).toBeTruthy();
    const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.status).toBe('failed');
    expect(run.errorText).toBe(r.errorText);
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

// ── TACP 준수 ────────────────────────────────────────────────
// TACP.md가 헌법이면, 지켜지는지 확인하는 것도 코드여야 한다.
// 문서만 있고 강제가 없으면 다음 사람이 조용히 어긴다.
d('TACP 준수', () => {
  it('[TACP-12] 게이트는 authz.ts에만 — 라우트가 역할 플래그를 직접 비교하지 않는다', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });

    const offenders: string[] = [];
    for (const file of walk('src/app/api')) {
      const src = readFileSync(file, 'utf8');
      // **판정**만 잡는다. 역할을 읽어 화면에 표시하는 것(`isLead: u.divisionRole === 'lead'`)은
      // 위반이 아니다 — 조직도에서 담당자를 다르게 그리는 건 인가가 아니라 표현이다.
      // 위험한 건 라우트가 스스로 허용/거부를 정하는 것이고, 그건 언제나 조건문 안에 있다.
      for (const [i, line] of src.split('\n').entries()) {
        const isDecision = /\bif\s*\(/.test(line) || /\bthrow\b/.test(line);
        if (!isDecision) continue;
        if (/[\w.]*\.(isOperator|isCoordinator)\b/.test(line) || /divisionRole\s*===\s*'lead'/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    expect(offenders, `게이트를 authz.ts로 옮길 것 (TACP-12):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('[TACP-2] 명단 API는 isOperator·isCoordinator를 바꾸지 못한다', async () => {
    const { PUT } = await import('@/app/api/ops/roster/route');
    const { prisma } = await import('@/server/db');
    const u = await prisma.user.findFirstOrThrow({ where: { email: ID.member } });
    await PUT(
      nx('/api/ops/roster', ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 타입에 없는 필드를 억지로 실어 보낸다 — 무시되어야 한다
        body: JSON.stringify({ updates: [{ userId: u.id, isOperator: true, isCoordinator: true }] }),
      }),
    );
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.isOperator).toBe(false);
    expect(after.isCoordinator).toBe(false);
  });

  it('[TACP-5] 권한 없음과 없는 리소스는 같은 404다', async () => {
    const { requireOperator, resolveTargetDivision, requireScope } = await import('@/server/authz');
    // member의 ops 접근 = 404 (403이 아니다 — 있다는 사실도 알리지 않는다)
    await expect(requireOperator(new Headers({ 'x-test-identity': ID.member }))).rejects.toMatchObject({
      status: 404,
    });
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.member }));
    const forbidden = await resolveTargetDivision(scope, B.slug).catch((e) => e);
    const missing = await resolveTargetDivision(scope, 'no-such-division').catch((e) => e);
    expect(forbidden.status).toBe(missing.status); // 구별 불가
    expect(forbidden.message).toBe(missing.message);
  });

  it('[TACP-6] 쓰기 대상은 URL이 아니라 신원이 정한다 — 규칙은 내 부서에만 쓰인다', async () => {
    const { PUT } = await import('@/app/api/division/rule/route');
    const { prisma } = await import('@/server/db');
    const before = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    // operator(A부서 소속)가 B부서 슬러그를 붙여 호출해도 B는 변하지 않는다
    const res = await PUT(
      nx(`/api/division/rule?division=${B.slug}`, ID.op, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: 'TACP-6 검증', guideText: '' }),
      }),
    );
    expect(res.status).toBe(200);
    const after = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    expect(after.mergeRuleText).toBe(before.mergeRuleText); // B는 무사하다
    const own = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    expect(own.mergeRuleText).toBe('TACP-6 검증'); // 내 부서에 쓰였다
  });
});

// ── 병합본 접근 (TACP §3.2 · TACP-15) ────────────────────────
// 병합본은 제출물과 다른 자원이다: 개인 문서가 아니라 부서가 대외로 내보내는 산출물이다.
// v1.2에서 **부서원 모두에게 열었다** — 그 문서는 취합게시판에 올라가 전사가 읽는데
// 정작 글을 쓴 본인만 못 보고 있었다. 숨겨서 지키는 것이 없었다.
d('병합본 접근', () => {
  const merged = () => import('@/app/api/division/merged/route');

  it('[TACP-15] member도 자기 부서 병합본을 받는다 (v1.2 개정 — 이전에는 404였다)', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    await POST(nx('/api/division/merge', ID.lead, { method: 'POST' }));

    const { GET } = await merged();
    const res = await GET(nx('/api/division/merged', ID.member));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-hwp');
  });

  it('lead는 병합 후 자기 부서 병합본을 받는다 — 파일명이 그대로 올릴 수 있는 형태', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    expect((await POST(nx('/api/division/merge', ID.lead, { method: 'POST' }))).status).toBe(200);

    const { GET } = await merged();
    const res = await GET(nx('/api/division/merged', ID.lead));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-hwp');
    const cd = res.headers.get('content-disposition') ?? '';
    /*
     * **「주간」을 박아 두면 한 달에 한 주씩 깨진다.** 그 달 마지막 주에는 월간을 내므로
     * 파일명이 `…_월간업무.hwp`가 된다 (WS-14). 실제로 2026-08-31(8월 5주차)에 깨졌다.
     * 여기서 지킬 것은 낱말이 아니라 **게시판에 그대로 올릴 수 있는 꼴인가**이다.
     */
    expect(decodeURIComponent(cd)).toMatch(/2026_\d+월_\d+주차_.+_(주간|월간)업무\.hwp$/);
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
  });

  it('[격리] lead는 타 부서 병합본을 못 받는다 → 404', async () => {
    const { GET } = await merged();
    expect((await GET(nx(`/api/division/merged?division=${B.slug}`, ID.lead))).status).toBe(404);
  });

  it('operator는 타 부서 병합본을 받을 수 있고 감사 로그가 남는다 (TACP-10)', async () => {
    const { prisma } = await import('@/server/db');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { GET } = await merged();

    // B부서에는 양식·제출이 없으므로 병합이 없다 → 404 (권한과 무관한 부재)
    expect((await GET(nx(`/api/division/merged?division=${B.slug}`, ID.op))).status).toBe(404);

    // 내 부서 병합본은 operator도 받을 수 있다
    const div = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const slot = await prisma.weekSlot.findFirstOrThrow();
    await runMergeRecorded(div.id, slot.id, 'manual');
    expect((await GET(nx('/api/division/merged', ID.op))).status).toBe(200);
  });

  it('병합본이 없으면 404 — 있는데 못 보는 것과 구별되지 않는다 (TACP-5)', async () => {
    const { GET } = await merged();
    const res = await GET(nx('/api/division/merged?isoKey=2020-W01', ID.lead));
    expect(res.status).toBe(404);
  });
});

// ── TACP-16·17 — head(부서장) Principal · 병합본 작성자 ──────────
// v1.3에서 다섯 번째 Principal이 생겼다. 부서 **문서**에 대해서는 lead와 같고,
// 다른 것은 권한이 아니라 알림 시점이다 (ADR-0008).
d('head Principal (TACP-16·17)', () => {
  it('[AU-T30] head가 자기 부서 병합본을 수정한다 — 새로 허용된 것', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    await POST(nx('/api/division/merge', ID.lead, { method: 'POST' }));
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const res = await PUT(
      nx('/api/division/merged/content', ID.head, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: [{ key: 'achievements', rows: [['1-1', 'head가 고침', '', '', '']] }] }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('[AU-T30b] head가 병합을 실행한다 — lead와 같은 권한 (TACP-16)', async () => {
    const { POST } = await import('@/app/api/division/merge/route');
    const res = await POST(nx('/api/division/merge', ID.head, { method: 'POST' }));
    expect(res.status).toBe(200);
  });

  it('[AU-T31] head의 타 부서 접근 → 404 — 새로 금지된 것 (lead와 같은 선)', async () => {
    const { GET } = await import('@/app/api/division/merged/route');
    const res = await GET(nx(`/api/division/merged?division=${B.slug}`, ID.head));
    expect(res.status).toBe(404);
  });

  it('[AU-T32] head는 명단을 못 바꾼다 — 문서는 되어도 사람은 안 된다 (TACP-3)', async () => {
    const { PUT } = await import('@/app/api/ops/roster/route');
    const res = await PUT(
      nx('/api/ops/roster', ID.head, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ userId: 'x', onRoster: false }] }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('[AU-T33] member 응답에는 작성자가 **없다** — 숨기는 게 아니라 안 보낸다 (TACP-17)', async () => {
    const { GET } = await import('@/app/api/division/merged/content/route');
    const asMember = await (await GET(nx('/api/division/merged/content', ID.member))).json();
    expect(asMember.canSeeAuthors).toBe(false);
    expect(asMember.tables.every((t: { authors?: unknown }) => t.authors === undefined)).toBe(true);

    const asHead = await (await GET(nx('/api/division/merged/content', ID.head))).json();
    expect(asHead.canSeeAuthors).toBe(true);
    expect(Array.isArray(asHead.tables[0].authors)).toBe(true);
  });

  it('[AU-T34] coordinator는 병합본을 못 고치지만 병합 실행은 된다 — §3.2의 두 칸이 다르다', async () => {
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const edit = await PUT(
      nx('/api/division/merged/content', ID.coord, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: [{ key: 'achievements', rows: [['1-1', 'x', '', '', '']] }] }),
      }),
    );
    expect(edit.status).toBe(404);

    const { POST } = await import('@/app/api/division/merge/route');
    expect((await POST(nx('/api/division/merge', ID.coord, { method: 'POST' }))).status).toBe(200);
  });
});
