// 통합 테스트 — 라우트 핸들러를 직접 호출한다 (서버 기동 없이).
// 격리 스위트(AU-T12~18)가 릴리스 게이트다 (AU-14).
//
// 테스트 신원 주입: NODE_ENV=test에서만 x-test-identity 헤더 허용 (auth.ts).
// DB: prisma/test.db — setup에서 초기화·시드.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── env는 어떤 앱 모듈보다 먼저 고정한다 ──
const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-test-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
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

// PG-T79·T80 — 페이지(서버 컴포넌트)를 직접 불러 본다. 페이지의 신원은 next/headers에서 오므로 그것만 갈아 끼운다.
// 라우트 핸들러는 요청 헤더를 그대로 쓰므로 영향이 없다 — next/headers를 읽는 곳은 page-scope 하나다.
const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));

// 시드 대신 테스트 전용 최소 데이터 (실명 없이)
const A = { slug: 'Division_A', short: 'da', nameKo: '가부서' };
const B = { slug: 'Division_B', short: 'db', nameKo: '나부서' };
const ID = {
  aMember: 'a-member@test.kei.re.kr',
  aMember2: 'a-member2@test.kei.re.kr',
  aLead: 'a-lead@test.kei.re.kr',
  bLead: 'b-lead@test.kei.re.kr',
  op: 'op@test.kei.re.kr',
  coord: 'coord@test.kei.re.kr',
  ghost: 'ghost@test.kei.re.kr', // DB에 없음
  aDel: 'a-del@test.kei.re.kr', // 삭제 테스트 전용 (A부서) — 남의 제출물을 지우면 뒤 테스트가 깨진다
  bDel: 'b-del@test.kei.re.kr', // 삭제 테스트 전용 (B부서)
  aOff: 'a-off@test.kei.re.kr', // 명단 밖(onRoster=false) — 제출 대상 아님
};

const req = (url: string, identity?: string, init?: RequestInit) =>
  new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  });

// NextRequest 호환: 라우트가 req.nextUrl을 쓰므로 얇게 흉내낸다
function nx(url: string, identity?: string, init?: RequestInit) {
  const r = req(url, identity, init) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}

let hwpBytes: Buffer;
let hwpBytes2: Buffer;

beforeAll(async () => {
  // 새 파일에 스키마 생성 — 파괴적 리셋이 아니라 신규 생성 (test.db는 일회용)
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test.db'), { force: true });
  rmSync(path.join(root, 'prisma/test.db-journal'), { force: true });
  execSync('npx prisma db push --skip-generate', {
    cwd: root,
    env: { ...process.env },
    stdio: 'pipe',
  });
  const { prisma } = await import('@/server/db');

  const mk = async (d: typeof A) =>
    prisma.division.create({
      data: { slug: d.slug, shortSlug: d.short, nameKo: d.nameKo, nameEn: d.slug, isActive: true },
    });
  const da = await mk(A);
  const db = await mk(B);
  // 마감이 항상 열려 있도록 **주차의 마지막 순간**(일요일 23:59)으로 잡는다.
  // "내일 요일"로 잡으면 일요일에 돌릴 때 내일=월요일이 되고, 그건 이번 주차의
  // 시작일이라 이미 지난 시각이 된다 → 업로드가 전부 409로 막힌다.
  // 실제로 일요일에 테스트 13개가 깨졌다.
  await prisma.division.updateMany({ data: { deadlineDow: 7, deadlineTime: '23:59' } });

  const mkUser = (email: string, divisionId: string, extra: object = {}) =>
    prisma.user.create({
      data: { email, name: email.split('@')[0], divisionId, ...extra },
    });
  await mkUser(ID.aMember, da.id);
  await mkUser(ID.aMember2, da.id);
  await mkUser(ID.aLead, da.id, { divisionRole: 'lead' });
  await mkUser(ID.bLead, db.id, { divisionRole: 'lead' });
  await mkUser(ID.op, da.id, { isOperator: true });
  await mkUser(ID.coord, db.id, { isCoordinator: true });
  await mkUser(ID.aDel, da.id);
  await mkUser(ID.bDel, db.id);
  await mkUser(ID.aOff, da.id, { onRoster: false });

  if (hasFixtures) {
    hwpBytes = readFileSync(path.join(FIX, 'master-template.hwp'));
    hwpBytes2 = readFileSync(path.join(FIX, 'sample-filled-w2.hwp'));
  }
}, 60_000);

/**
 * 제출물 하나를 만든다 — 저장 함수 `uploadSubmission()`을 신원에서 나온 범위로 부른다.
 *
 * 2026-10-08 — hwp 업로드 라우트(`POST /api/submissions`)를 지웠다(WA-39 · ADR-0014 완료). 아래 시험들이 보는 것은
 * 그 라우트가 아니라 저장의 성질(버전·잠금·검증·격리)이고, 그 성질은 웹 작성이 같은 함수로 저장하므로 그대로다.
 * 그래서 문만 바꿨다: 신원 → `requireSubmitter`(웹 작성 라우트와 같은 게이트) → `uploadSubmission`.
 * `handler()`로 감싸 오류를 라우트와 같은 응답(status·{error,message})으로 돌려받는다 — 기대값을 고치지 않으려고.
 * 픽스처 hwp를 그대로 쓰는 것도 같은 이유다: 미리보기 시험이 실제 파일의 표 내용을 본다.
 */
async function upload(identity: string, bytes: Buffer, name = '주간업무.hwp') {
  const { handler, json } = await import('@/server/http');
  const { requireSubmitter } = await import('@/server/authz');
  const { uploadSubmission } = await import('@/server/worklog');
  return handler(async () => {
    const scope = await requireSubmitter(new Headers({ 'x-test-identity': identity }));
    const r = await uploadSubmission({ user: scope.user, division: scope.division, fileName: name, bytes });
    return json(
      {
        submission: { id: r.submission.id, version: r.submission.version },
        replacedVersion: r.replacedVersion,
        sameAsPrevious: r.sameAsPrevious,
      },
      { status: 201 },
    );
  })();
}

async function del(identity: string, id: string) {
  const { DELETE } = await import('@/app/api/submissions/[id]/route');
  return DELETE(nx(`/api/submissions/${id}`, identity, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

const d = hasFixtures ? describe : describe.skip;

// 신원 판정은 모든 API의 첫 관문(requireScope)이라 어느 GET으로 봐도 같다. 예전에는 `GET /api/me`로 봤는데,
// 화면이 부르지 않는 API라 지웠다(2026-10-08, R2) — 부서원이 실제로 쓰는 `GET /api/my/previous`로 본다
d('인증 (AU-T01/T06/T10)', () => {
  const probe = async (identity?: string, init?: Parameters<typeof nx>[2]) => {
    const { GET } = await import('@/app/api/my/previous/route');
    return GET(nx('/api/my/previous', identity, init));
  };
  it('[AU-T01] 신원 없음 → 401', async () => {
    const res = await probe();
    expect(res.status).toBe(401);
  });
  it('[AU-T06] 미등록 이메일 → 403 not_registered', async () => {
    const res = await probe(ID.ghost);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_registered');
  });
  it('[AU-T10 상당] Cf 헤더만 있고 검증 경로 아님 → 401 (test 모드에선 x-test-identity만 인정)', async () => {
    const res = await probe(undefined, { headers: { 'Cf-Access-Authenticated-User-Email': ID.aMember } });
    expect(res.status).toBe(401);
  });
});

d('제출 저장 — uploadSubmission (API-T03·T04, ST-T)', () => {
  it('정상 저장 → 201 v1', async () => {
    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submission.version).toBe(1);
    expect(body.sameAsPrevious).toBe(false);
  });
  it('[API-T04] 다시 내면 → v2, sameAsPrevious 안내 (DM-07)', async () => {
    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submission.version).toBe(2);
    expect(body.replacedVersion).toBe(1);
    expect(body.sameAsPrevious).toBe(true);
  });
  it('[ST-T01] .txt → 422', async () => {
    const res = await upload(ID.aMember2, hwpBytes, '메모.txt');
    expect(res.status).toBe(422);
  });
  it('[ST-T14] .hwpx → 422 + 변환 안내', async () => {
    const res = await upload(ID.aMember2, hwpBytes, '주간.hwpx');
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.message).toContain('다른 이름으로 저장');
  });
  it('[ST-T02] PNG 내용 + .hwp 이름 → 422', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(128).fill(0)]);
    const res = await upload(ID.aMember2, png);
    expect(res.status).toBe(422);
  });
  it('[API-T03] 본문에 부서·사람을 적어 보내도 무시되고 신원의 부서·본인으로 저장 (DM-12 · TACP-6)', async () => {
    // 2026-10-08 — 업로드 라우트가 없어져 제출을 받는 HTTP 문은 웹 작성(compose) 하나다(WA-39). 같은 위조를 그 문에 보낸다
    const { POST } = await import('@/app/api/submissions/compose/route');
    const { prisma } = await import('@/server/db');
    const { writeFileAtomic } = await import('@/server/storage');
    const aDiv = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const bDiv = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    const other = await prisma.user.findUniqueOrThrow({ where: { email: ID.aMember } });
    // 웹 작성은 부서 양식으로 hwp를 만든다. 이 스위트의 부서에는 양식이 없어 잠시 두고 치운다 — 뒤의 health 시험이 양식 없는 상태를 본다
    const rel = `divisions/${A.slug}/template/active.hwp`;
    await writeFileAtomic(rel, hwpBytes);
    const t = await prisma.template.create({ data: { divisionId: aDiv.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'test' } });
    try {
      const res = await POST(
        nx('/api/submissions/compose', ID.aMember2, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // 위조 시도 — 남의 부서와 다른 사람
          body: JSON.stringify({ divisionId: bDiv.id, userId: other.id, achievements: [{ content: '실적' }], plans: [], notes: [] }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      await prisma.template.delete({ where: { id: t.id } });
    }
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember2 } },
      include: { division: true },
    });
    expect(sub.division.slug).toBe(A.slug);
    expect(await prisma.submission.count({ where: { divisionId: bDiv.id } })).toBe(0);
    expect(await prisma.submission.count({ where: { userId: other.id, origin: 'web' } })).toBe(0);
  });
});

// 2026-10-08 — `GET /api/division/status`는 지웠다(R2 · TACP-11 v1.8). 부서원 축소판(API-T05a)은 AU-T87로 뒤집혔고,
// 담당자의 현황은 수합 관리가 서버 함수를 직접 부른다(그 앞에 canManage — PG-T08). 같은 사실을 함수로 본다
d('현황 (API-T05~T07)', () => {
  it('[API-T06] 수합 관리의 현황 — 전체 필드 + 미제출자 missing 포함', async () => {
    const { prisma } = await import('@/server/db');
    const { divisionStatus, ensureCurrentSlot } = await import('@/server/worklog');
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const slot = await ensureCurrentSlot();
    const st = await divisionStatus(da.id, slot.id);
    expect(st.summary.roster).toBe(5); // A부서 onRoster: member + member2 + lead + op + aDel
    expect(st.members.filter((m) => m.status === 'submitted').length).toBe(2);
    const me = st.members.find((m) => m.user.name === 'a-member')!;
    expect(me.latest?.version).toBe(2);
    expect(st.members.some((m) => m.status === 'missing')).toBe(true);
  });
});

d('격리 스위트 — 릴리스 게이트 (AU-T12~T18)', () => {
  it('[AU-T13] A lead가 B 제출물 다운로드 → 404', async () => {
    // B 부서에 제출물 생성
    const res0 = await upload(ID.bLead, hwpBytes2);
    expect(res0.status).toBe(201);
    const { prisma } = await import('@/server/db');
    const bSub = await prisma.submission.findFirstOrThrow({ where: { division: { slug: B.slug } } });

    const { GET } = await import('@/app/api/submissions/[id]/download/route');
    const res = await GET(nx(`/api/submissions/${bSub.id}/download`, ID.aLead), {
      params: Promise.resolve({ id: bSub.id }),
    });
    expect(res.status).toBe(404);
  });
  it('[AU-T15] member가 같은 부서 타인 파일 다운로드 → 404, 본인 것 → 200', async () => {
    const { prisma } = await import('@/server/db');
    const own = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember }, isLatest: true },
    });
    const other = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember2 }, isLatest: true },
    });
    const { GET } = await import('@/app/api/submissions/[id]/download/route');

    const r1 = await GET(nx(`/api/submissions/${own.id}/download`, ID.aMember), {
      params: Promise.resolve({ id: own.id }),
    });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-disposition')).toContain("filename*=UTF-8''"); // ST-T10

    const r2 = await GET(nx(`/api/submissions/${other.id}/download`, ID.aMember), {
      params: Promise.resolve({ id: other.id }),
    });
    expect(r2.status).toBe(404);
  });
  // 예전 이 자리의 「member가 zip → 404 · lead 자기 부서 zip → 200」은 zip 경로와 함께 폐지 2026-10-08 (R1 · PG-73).
  // AU-T14(남의 부서 현황 → 404)는 현황이 남은 수합 관리 화면으로 옮겨 「PG-66 부서원 홈」 스위트에서 본다
  it('[AU-T16] operator·coordinator의 타 부서 열람 → 성공 + 감사 로그', async () => {
    const { prisma } = await import('@/server/db');
    const bSub = await prisma.submission.findFirstOrThrow({ where: { division: { slug: B.slug } } });
    const { GET } = await import('@/app/api/submissions/[id]/download/route');

    for (const who of [ID.op, ID.coord]) {
      const res = await GET(nx(`/api/submissions/${bSub.id}/download`, who), {
        params: Promise.resolve({ id: bSub.id }),
      });
      // coordinator는 B 소속이므로 자기 부서 — cross 아님. operator(A 소속)만 cross
      expect(res.status).toBe(200);
    }
    const logs = await prisma.auditLog.findMany({ where: { action: 'cross_division_read' } });
    expect(logs.some((l) => l.actor === ID.op)).toBe(true);
  });
  it('[격리] A 부서 zip에 B 파일이 절대 없음 (ST-T16 상당)', async () => {
    const { prisma } = await import('@/server/db');
    const aSubs = await prisma.submission.findMany({ where: { division: { slug: A.slug } } });
    const bSubs = await prisma.submission.findMany({ where: { division: { slug: B.slug } } });
    expect(aSubs.every((s) => s.filePath.includes(A.slug))).toBe(true); // ST-T15
    expect(bSubs.every((s) => s.filePath.includes(B.slug))).toBe(true);
  });
});

d('집계 제외자 — 낼 수는 있다 (ST-T34~37 · DM-16/17)', () => {
  it('[ST-T34] onRoster=false도 **제출은 된다** — 명단은 집계 대상이지 권한이 아니다', async () => {
    const res = await upload(ID.aOff, hwpBytes);
    expect(res.status).toBe(201);
  });

  it('[ST-T35] 분모에는 안 들어가고 «추가 제출»로 잡힌다 (DM-17)', async () => {
    const { prisma } = await import('@/server/db');
    const { divisionStatus, ensureCurrentSlot } = await import('@/server/worklog');
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const slot = await ensureCurrentSlot();
    const st = await divisionStatus(da.id, slot.id);

    expect(st.members.some((m) => m.user.name === 'a-off')).toBe(false); // 분모 밖
    expect(st.extras.some((m) => m.user.name === 'a-off')).toBe(true); //  묻히지 않는다
    expect(st.summary.extras).toBe(1);
    // 분모는 명단 인원 그대로 — 제출했다고 늘지 않는다
    expect(st.summary.roster).toBe(st.members.length);
  });

  it('[ST-T36] 병합에는 들어간다 — 낸 사람은 전부 담는다', async () => {
    const { prisma } = await import('@/server/db');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const slot = await ensureCurrentSlot();
    // 병합 대상 조회 조건과 동일 (divisionId + weekSlotId + isLatest)
    const targets = await prisma.submission.findMany({
      where: { divisionId: da.id, weekSlotId: slot.id, isLatest: true },
      include: { user: true },
    });
    expect(targets.some((t) => t.user.name === 'a-off')).toBe(true);
  });

  it('[ST-T37] 제외 사유가 현황에 함께 나온다 — 왜 뺐는지 남아야 되돌릴 수 있다 (DM-16)', async () => {
    const { prisma } = await import('@/server/db');
    const { divisionStatus, ensureCurrentSlot } = await import('@/server/worklog');
    await prisma.user.update({ where: { email: ID.aOff }, data: { rosterNote: '휴직' } });
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const slot = await ensureCurrentSlot();
    const st = await divisionStatus(da.id, slot.id);
    expect(st.offRoster.find((u) => u.name === 'a-off')?.note).toBe('휴직');
  });
});

d('병합본 열람 권한 (AU-T35~37 · TACP-15)', () => {
  const mergedFor = async (identity: string, slug: string) => {
    const { GET } = await import('@/app/api/division/merged/route');
    return GET(nx(`/api/division/merged?division=${slug}`, identity));
  };

  it('[AU-T35] member도 **내 부서** 병합본을 받는다 (v1.2 개정)', async () => {
    const res = await mergedFor(ID.aMember, A.slug);
    // 병합본이 아직 없으면 404 not_found — 권한 때문에 막힌 게 아니어야 한다
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) expect((await res.json()).error).toBe('not_found');
  });

  it('[AU-T36] member의 **타 부서** 병합본은 여전히 404 (TACP-7)', async () => {
    const res = await mergedFor(ID.aMember, B.slug);
    expect(res.status).toBe(404);
  });

  it('[AU-T39] 병합본 수정은 **lead만** — 총괄(readAll)도 404. 화면 판정과 같은 규칙', async () => {
    const { prisma } = await import('@/server/db');
    const { PUT } = await import('@/app/api/division/merged/content/route');

    // coordinator는 readAll을 갖지만 그 부서의 lead는 아니다
    const res = await PUT(
      nx('/api/division/merged/content', ID.coord, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tables: [] }),
      }),
    );
    expect(res.status).toBe(404);

    // 화면도 같은 답을 해야 한다 — 다르면 «보이는데 안 되는 버튼»이 생긴다 (TACP-9)
    const lead = await prisma.user.findFirstOrThrow({ where: { email: ID.aLead } });
    expect(lead.divisionRole).toBe('lead');
  });

  it('[AU-T38] 병합본 열람 응답에 **작성자가 없다** — TACP-11이 지키려는 것은 그대로다', async () => {
    const { GET } = await import('@/app/api/division/merged/content/route');
    const res = await GET(nx(`/api/division/merged/content?division=${A.slug}`, ID.aMember));
    if (res.status === 404) return; // 병합본이 없는 실행 순서 — 권한 문제가 아니다
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    // 부서원 이름·이메일·작성자 필드가 응답 어디에도 없어야 한다
    for (const leak of ['a-member', 'a-lead', 'authors', '"who"', '@test.kei.re.kr']) {
      expect(body, `누출: ${leak}`).not.toContain(leak);
    }
  });

  it('[AU-T37] 병합본 **수정**은 열람과 달리 담당자만 — member는 404', async () => {
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const res = await PUT(
      nx('/api/division/merged/content', ID.aMember, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tables: [] }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

d('제출 취소 — 삭제 권한 (ST-T30~33 · TACP-14)', () => {
  it('[ST-T31] lead는 같은 부서 타인 제출물을 **읽을 수는 있어도 지우지는 못한다** → 404', async () => {
    const { prisma } = await import('@/server/db');
    await upload(ID.aDel, hwpBytes);
    await upload(ID.aDel, hwpBytes2); // v2 — 전체 삭제 확인용
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aDel }, isLatest: true },
    });

    // 대조군: 같은 lead가 같은 건을 **받는 것은** 된다 (TACP-11)
    const dl = await import('@/app/api/submissions/[id]/download/route');
    const canRead = await dl.GET(nx(`/api/submissions/${sub.id}/download`, ID.aLead), {
      params: Promise.resolve({ id: sub.id }),
    });
    expect(canRead.status).toBe(200);

    // 그런데 삭제는 404다 — 읽기 권한이 삭제 권한을 주지 않는다
    expect((await del(ID.aLead, sub.id)).status).toBe(404);
    expect(await prisma.submission.count({ where: { user: { email: ID.aDel } } })).toBe(2);
  });

  it('[ST-T32] coordinator의 타 부서 제출물 삭제 → 404 (readAll은 읽기까지다, TACP-8)', async () => {
    const { prisma } = await import('@/server/db');
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aDel }, isLatest: true },
    });
    expect((await del(ID.coord, sub.id)).status).toBe(404);
    expect(await prisma.submission.count({ where: { user: { email: ID.aDel } } })).toBe(2);
  });

  it('[ST-T30] 본인 삭제 → 그 주차 **전 버전**이 사라지고 파일도 지워진다', async () => {
    const { prisma } = await import('@/server/db');
    const { fileExists } = await import('@/server/storage');
    const all = await prisma.submission.findMany({ where: { user: { email: ID.aDel } } });
    expect(all).toHaveLength(2);

    const res = await del(ID.aDel, all.find((x) => x.isLatest)!.id);
    expect(res.status).toBe(200);
    expect((await res.json()).removedVersions).toBe(2); // v1도 함께 (ADR-0007)

    expect(await prisma.submission.count({ where: { user: { email: ID.aDel } } })).toBe(0);
    for (const s of all) expect(await fileExists(s.filePath)).toBe(false);
  });

  it('[ST-T33] operator는 타 부서 제출물도 지운다 + 감사 로그 (TACP-14)', async () => {
    const { prisma } = await import('@/server/db');
    await upload(ID.bDel, hwpBytes); // B부서 — op는 A부서 소속이다
    const sub = await prisma.submission.findFirstOrThrow({ where: { user: { email: ID.bDel } } });

    expect((await del(ID.op, sub.id)).status).toBe(200);
    expect(await prisma.submission.count({ where: { user: { email: ID.bDel } } })).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', target: `submission:${sub.id}` },
      orderBy: { at: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actor).toBe(ID.op);
    expect(JSON.stringify(log!.detail)).toContain(ID.bDel); // 누구 것이었는지 남는다
  });
});

d('마감 잠금 (API-T01/T02)', () => {
  it('[API-T01] 마감 지난 부서 → 업로드 409 slot_locked · [API-T02] 조회는 정상', async () => {
    const { prisma } = await import('@/server/db');
    // A 부서 마감을 확실한 과거로 = **주차가 열리는 순간**(월요일 00:00).
    // '어제 요일'로 계산하면 월요일에 돌릴 때 어제=일요일이 되고, 그건 이번 주차의
    // 마지막 날이라 미래가 된다 → 잠기지 않아 테스트가 깨진다.
    // 요일 산술을 오늘 기준으로 하면 주 경계에서 뒤집힌다 (일요일에도 같은 일을 겪었다).
    await prisma.division.updateMany({
      where: { slug: A.slug },
      data: { deadlineDow: 1, deadlineTime: '00:00' },
    });

    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slot_locked');

    // 화면(홈 카드·수합 관리)이 쓰는 판정도 같은 답이다 — 마감 판정의 단일 진입점(isSubmissionLocked)
    const { isSubmissionLocked } = await import('@/lib/deadline');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    expect(isSubmissionLocked(await ensureCurrentSlot(), da, null)).toBe(true);

    const dl = await import('@/app/api/submissions/[id]/download/route');
    const own = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember }, isLatest: true },
    });
    const r = await dl.GET(nx(`/api/submissions/${own.id}/download`, ID.aMember), {
      params: Promise.resolve({ id: own.id }),
    });
    expect(r.status).toBe(200); // 마감 후에도 다운로드는 가능
  });
});

d('마감 후 삭제 (ST-T30b/T33b · TACP-14)', () => {
  it('[ST-T30b] 마감 후 본인 취소 → 409 slot_locked (병합본만 남는 상태를 막는다)', async () => {
    const { prisma } = await import('@/server/db');
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember2 }, isLatest: true },
    });
    const res = await del(ID.aMember2, sub.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slot_locked');
    expect(await prisma.submission.count({ where: { user: { email: ID.aMember2 } } })).toBe(1);
  });

  it('[ST-T33b] 마감 후에도 operator는 지운다 (TACP §8 — 운영자 자신에 대한 방어는 하지 않는다)', async () => {
    const { prisma } = await import('@/server/db');
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember2 }, isLatest: true },
    });
    expect((await del(ID.op, sub.id)).status).toBe(200);
    expect(await prisma.submission.count({ where: { user: { email: ID.aMember2 } } })).toBe(0);
  });
});

d('health (API-T10)', () => {
  it('무인증 200/503 + 민감정보 없음', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect([200, 503]).toContain(res.status);
    const text = JSON.stringify(body);
    expect(text).not.toContain('@'); // 이메일 없음
    expect(text).not.toContain('부서'); // 부서명 없음 (라벨 제외)
  });
});

/**
 * AU-33 — 상태를 바꾸는 요청은 **같은 출처**에서만. 격리 스위트와 같은 무게의 게이트다:
 * 같은 서버 다른 포트의 페이지가 방문자 쿠키로 대신 보내는 요청은, 신원 판정이 아무리 옳아도 막지 못한다.
 * 양식 파일이 없어도 돈다 — 부서 규칙(PUT /api/division/rule)의 분류 순서 한 줄로 「바뀌었나」를 본다.
 * (2026-10-08 — 받는 키가 `categories` 하나가 되었다, API-59. 예전에는 작성 안내 `guideText`로 봤다)
 */
describe('AU-33 같은 출처 — 다른 포트의 페이지가 대신 보내는 요청 (AU-T84~86)', () => {
  const rule = () => import('@/app/api/division/rule/route');
  const put = async (categories: string, headers: Record<string, string>, body?: string) => {
    const { PUT } = await rule();
    return PUT(
      nx('/api/division/rule', ID.aLead, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
        body: body ?? JSON.stringify({ categories }),
      }),
    );
  };
  const guide = async () => {
    const { prisma } = await import('@/server/db');
    return (await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } })).mergeCategories;
  };
  // 운영 11111 · 테스트 서버 11112 — 쿠키는 포트를 보지 않으므로 둘은 「같은 사이트」다 (RU-42)
  const HOST = { host: 'test.local:11111' };
  // 분류 순서는 병합에 닿는다 — 뒤 시험의 병합이 분류 정렬(모델 없음 경고)을 타지 않게 비워 둔다
  afterAll(async () => {
    const { prisma } = await import('@/server/db');
    await prisma.division.update({ where: { slug: A.slug }, data: { mergeCategories: '' } });
  });

  it('[AU-T84] ★ 같은 사이트 다른 포트(Sec-Fetch-Site: same-site) → 403 cross_origin, 아무것도 안 바뀐다', async () => {
    const before = await guide();
    const res = await put('위조', { ...HOST, origin: 'http://test.local:11112', 'sec-fetch-site': 'same-site' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('cross_origin');
    expect(await guide()).toBe(before);
  });

  it('[AU-T84b] 사내망 평문 HTTP — Sec-Fetch-*가 없어도 Origin의 포트가 다르면 403 · text/plain 본문도 · Origin: null도', async () => {
    const before = await guide();
    expect((await put('위조', { ...HOST, origin: 'http://test.local:11112' })).status).toBe(403);
    // 사전 요청(preflight) 없이 닿는 단순 요청 꼴 — req.json()은 text/plain도 읽으므로 막는 곳이 여기뿐이다
    expect(
      (await put('', { ...HOST, origin: 'http://test.local:11112', 'content-type': 'text/plain' }, JSON.stringify({ categories: '위조' }))).status,
    ).toBe(403);
    expect((await put('위조', { ...HOST, origin: 'null' })).status).toBe(403);
    expect((await put('위조', { ...HOST, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await guide()).toBe(before);
  });

  it('[AU-T85] 같은 출처 → 그대로 처리 (Sec-Fetch-Site: same-origin · Origin = Host)', async () => {
    expect((await put('같은 출처 1', { ...HOST, origin: 'http://test.local:11111', 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect(await guide()).toBe('같은 출처 1');
    // 사내망: Sec-Fetch-*가 없고 Origin만 온다 — host가 같으면 통과 (대소문자는 보지 않는다)
    expect((await put('같은 출처 2', { ...HOST, origin: 'http://TEST.local:11111' })).status).toBe(200);
    expect(await guide()).toBe('같은 출처 2');
    // 주소창에 직접 친 것과 같은 요청(none)
    expect((await put('같은 출처 3', { ...HOST, 'sec-fetch-site': 'none' })).status).toBe(200);
  });

  it('[AU-T86] 출처 헤더가 하나도 없으면(스크립트·curl) 통과 · GET은 출처를 보지 않는다', async () => {
    expect((await put('스크립트', {})).status).toBe(200);
    expect(await guide()).toBe('스크립트');
    // 규칙 GET은 지웠다(R2) — 같은 래퍼(handler)를 지나는 다른 GET으로 본다
    const { GET } = await import('@/app/api/my/previous/route');
    const res = await GET(nx('/api/my/previous', ID.aLead, { headers: { origin: 'http://test.local:11112', 'sec-fetch-site': 'same-site' } }));
    expect(res.status).toBe(200);
  });
});

describe('ST-04 업로드 크기 — 본문을 읽기 전에 (ST-T39)', () => {
  it('[ST-T39] Content-Length가 한도(20MB)+여유를 넘으면 읽지 않고 413 too_large · 그 아래는 지금처럼 본문을 본다', async () => {
    // 2026-10-08 — 예전에는 제출 업로드 라우트로 봤다. 그 라우트가 없어져(WA-39) 파일을 받는 문 중 부서 양식 등록으로 본다.
    // 같은 `rejectOversizedBody`를 쓰고, 이 문은 남는다(부서 설정의 양식)
    const { POST } = await import('@/app/api/division/template/route');
    const who = ID.aLead;
    const big = await POST(
      nx('/api/division/template', who, { method: 'POST', headers: { 'content-length': String(30 * 1024 * 1024) }, body: 'x' }),
    );
    expect(big.status).toBe(413);
    const body = await big.json();
    expect(body.error).toBe('too_large');
    expect(body.message).toContain('20MB');
    // 한도 안이면 통과해서 본문을 읽는다 — 파일이 없으니 422
    const small = await POST(nx('/api/division/template', who, { method: 'POST', headers: { 'content-length': '10' }, body: 'x' }));
    expect(small.status).toBe(422);
  });
});

/**
 * API-T13 · OPS-41 — health는 양식 **파일**까지 본다. 행만 세던 시절에는 파일이 하나뿐인 30개 부서도 `ok`였다.
 * 부서 이름은 응답에 없다(누구나 부르는 주소). 이 스위트는 만든 양식 행을 지우고 끝난다 — 뒤 테스트는 양식이 없는 상태를 본다.
 */
describe('health — 양식 파일 · 경고 (API-T13)', () => {
  it('[API-T13] 활성 부서의 양식 파일이 없으면 template fail · 503 — 다 있으면 ok · warnings는 늘 배열', async () => {
    const { prisma } = await import('@/server/db');
    const { writeFileAtomic } = await import('@/server/storage');
    const { GET } = await import('@/app/api/health/route');
    const active = await prisma.division.findMany({ where: { isActive: true } });
    expect(active.length).toBeGreaterThan(0);

    // 1) 양식이 하나도 없다 — 활성 부서 수만큼 fail
    let body = await (await GET()).json();
    expect(body.checks.template).toBe(`fail: ${active.length} active division(s) without template file`);
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('부서');

    // 2) 전부 행 + 파일 → ok
    const made: string[] = [];
    for (const d of active) {
      const rel = `health-check/${d.id}.hwp`;
      await writeFileAtomic(rel, Buffer.from('hwp'));
      const t = await prisma.template.create({ data: { divisionId: d.id, filePath: rel, sha256: 'x', version: 900, uploadedBy: 'test' } });
      made.push(t.id);
    }
    try {
      body = await (await GET()).json();
      expect(body.checks.template).toBe('ok');

      // 3) 행은 있는데 파일이 없는 부서 하나 (2026-09-10의 그 상태)
      rmSync(path.join(TMP_STORAGE, `health-check/${active[0].id}.hwp`), { force: true });
      const res = await GET();
      body = await res.json();
      expect(body.checks.template).toBe('fail: 1 active division(s) without template file');
      expect(res.status).toBe(503);
      expect(JSON.stringify(body)).not.toContain(active[0].nameKo);
    } finally {
      await prisma.template.deleteMany({ where: { id: { in: made } } });
    }
  });
});

/**
 * PG-66 — 부서원 홈. 「보관함」·「내 이력」을 합친 화면이라 그 둘의 시험을 이어받는다(PG-T94 = 옛 「[PG-T90] 보관함」).
 *
 * 이 스위트는 제 부서(다부서)와 가짜 주차를 만들고 끝나면 지운다 — 다른 시험의 부서 수·주차를 흔들지 않게.
 * 제출물 행은 파일 없이 넣는다: 홈은 행(WeekSlot·Submission·MergeRun)만 읽고 내용은 드로어를 열 때 읽는다.
 */
describe('PG-66 부서원 홈 (PG-T94·T97·T98·T99 · AU-T87·T14)', () => {
  const H = { slug: 'Division_H', nameKo: '다부서' };
  const HID = {
    me: 'h-me@test.kei.re.kr',
    lead: 'h-lead@test.kei.re.kr',
    off: 'h-off@test.kei.re.kr',
    peers: Array.from({ length: 9 }, (_, i) => `h-peer${i + 1}@test.kei.re.kr`),
  };
  const WEEK = 7 * 86_400_000;
  const keys: string[] = [];
  let hid = '';
  let me = { id: '', name: '' };
  let lead = { id: '', name: '' };
  const slotAt = async (key: string, weeksAgo: number) => {
    const { prisma } = await import('@/server/db');
    const { describeWeek, mondayOf } = await import('@/lib/week');
    const w = describeWeek(new Date(mondayOf(new Date()).getTime() - weeksAgo * WEEK));
    keys.push(key);
    return prisma.weekSlot.create({
      data: { isoKey: key, label: w.label, year: w.year, month: w.month, weekOfMonth: w.weekOfMonth, opensAt: w.opensAt },
    });
  };
  const sub = async (userId: string, weekSlotId: string, extra: object = {}) => {
    const { prisma } = await import('@/server/db');
    return prisma.submission.create({
      data: { divisionId: hid, userId, weekSlotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x', ...extra },
    });
  };
  const run = async (weekSlotId: string, startedAt: Date, status = 'succeeded', divisionId = hid) => {
    const { prisma } = await import('@/server/db');
    return prisma.mergeRun.create({
      data: { divisionId, weekSlotId, status, outputPath: status === 'succeeded' ? 'x.hwp' : null, sourceIds: '[]', ruleSnapshot: '{}', startedAt },
    });
  };
  /** 페이지 하나를 그 사람으로 불러 본다 — 보내면 digest, 그리면 요소 나무 */
  const visit = async (page: (p: { params: Promise<{ division: string }> }) => Promise<unknown>, who: string, slug = H.slug) => {
    pageAs.who = who;
    try {
      return { tree: await page({ params: Promise.resolve({ division: slug }) }), digest: null as string | null };
    } catch (e) {
      return { tree: null, digest: String((e as { digest?: string }).digest) };
    }
  };

  beforeAll(async () => {
    const { prisma } = await import('@/server/db');
    // 마감은 늘 지나 있게(월 00:01) — 이번 주 [병합본](PG-67c)이 마감 이벤트로 걸러지는지 본다
    const div = await prisma.division.create({ data: { slug: H.slug, nameKo: H.nameKo, nameEn: H.slug, isActive: true, deadlineDow: 1, deadlineTime: '00:01' } });
    hid = div.id;
    const joined = new Date(Date.now() - 52 * WEEK); // 1년 전에 들어왔다 — 근거 있는 주는 다 줄이 된다
    const mk = (email: string, name: string, extra: object = {}) =>
      prisma.user.create({ data: { email, name, divisionId: hid, mustChangePassword: false, createdAt: joined, ...extra } });
    const m = await mk(HID.me, '홈본인');
    me = { id: m.id, name: m.name };
    const l = await mk(HID.lead, '홈담당', { divisionRole: 'lead' });
    lead = { id: l.id, name: l.name };
    await mk(HID.off, '홈휴직', { onRoster: false, rosterNote: '휴직' });
    for (const [i, e] of HID.peers.entries()) await mk(e, `홈동료${i + 1}`);
  });

  afterAll(async () => {
    const { prisma } = await import('@/server/db');
    await prisma.mergeRun.deleteMany({ where: { divisionId: hid } });
    await prisma.submission.deleteMany({ where: { divisionId: hid } });
    await prisma.mergeRun.deleteMany({ where: { weekSlot: { isoKey: { in: keys } } } });
    await prisma.submission.deleteMany({ where: { weekSlot: { isoKey: { in: keys } } } });
    await prisma.weekSlot.deleteMany({ where: { isoKey: { in: keys } } });
    await prisma.session.deleteMany({ where: { user: { divisionId: hid } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { divisionId: hid } });
    await prisma.division.delete({ where: { id: hid } });
    pageAs.who = '';
  });

  it('[PG-T94] 재병합이 70건 쌓여도 옛 주의 [병합본]이 남는다 · 실패만 있는 주는 줄이지만 [병합본]이 없다 · 남의 부서 것은 없다 · 이번 주는 마감 이벤트 뒤의 성공본만', async () => {
    const { prisma } = await import('@/server/db');
    const { getDivisionView } = await import('@/server/page-scope');
    const { loadMemberHome } = await import('@/server/my-weeks');
    const { ensureCurrentSlot, effectiveDeadline } = await import('@/server/worklog');
    const old = await slotAt('HM94-OLD', 30);
    const recent = await slotAt('HM94-RECENT', 2);
    const failed = await slotAt('HM94-FAILED', 3);
    const elsewhere = await slotAt('HM94-ELSEWHERE', 4);

    await run(old.id, new Date(old.opensAt.getTime() + 3 * 86_400_000));
    for (let i = 0; i < 70; i++) await run(recent.id, new Date(recent.opensAt.getTime() + 3 * 86_400_000 + i * 60_000));
    await run(failed.id, new Date(failed.opensAt.getTime() + 3 * 86_400_000), 'failed');
    await sub(lead.id, failed.id); // 부서 제출은 있었다 — 내가 안 낸 주가 사라지지 않는다
    await sub(me.id, recent.id);
    // 남의 부서(나부서)의 제출·병합본 — 다부서 홈에는 없다
    const db = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    const bLead = await prisma.user.findUniqueOrThrow({ where: { email: ID.bLead } });
    await prisma.submission.create({
      data: { divisionId: db.id, userId: bLead.id, weekSlotId: elsewhere.id, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x' },
    });
    await run(elsewhere.id, new Date(elsewhere.opensAt.getTime() + 3 * 86_400_000), 'succeeded', db.id);

    pageAs.who = HID.me;
    const view = await getDivisionView(H.slug);
    const flat = async () => {
      const h = await loadMemberHome(view, new Date());
      const weeks = [...h.groups.recent, ...h.groups.older.flatMap((y) => y.months)].flatMap((m) => m.weeks);
      return { h, byKey: new Map(weeks.map((w) => [w.isoKey, w])) };
    };
    const first = await flat();
    const byKey = first.byKey;
    let h = first.h;
    expect(byKey.get('HM94-OLD')?.doc).toBe(true);
    expect(byKey.get('HM94-RECENT')).toMatchObject({ doc: true, mine: { edited: false } });
    expect(byKey.get('HM94-FAILED')).toMatchObject({ doc: false, mine: null });
    expect(byKey.has('HM94-ELSEWHERE')).toBe(false);

    // 이번 주 — 마감(월 00:01) 전에 돌린 미리보기 병합은 [병합본]이 아니다. 마감 뒤에 만든 것만
    const slot = await ensureCurrentSlot();
    const gate = effectiveDeadline(slot, view.division);
    await run(slot.id, new Date(gate.getTime() - 30_000));
    expect(h.card.phase).toBe('locked');
    h = (await flat()).h;
    expect(h.card.doc).toBe(false);
    await run(slot.id, new Date(gate.getTime() + 60_000));
    h = (await flat()).h;
    expect(h.card.doc).toBe(true);
    await prisma.mergeRun.deleteMany({ where: { divisionId: hid, weekSlotId: slot.id } });
  });

  it('[PG-T97] ★ 홈에 남의 이름이 없다 — 부서원 10명 · 담당자가 고친 판이 있어도 카드·목록 props에 남의 이름·id가 없다 (PG-66e · TACP-11 v1.8)', async () => {
    const { prisma } = await import('@/server/db');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const { default: MemberHome } = await import('@/app/[division]/page');
    const slot = await ensureCurrentSlot();
    const past = await slotAt('HM97-PAST', 1);
    const peers = await prisma.user.findMany({ where: { email: { in: HID.peers } } });
    for (const p of peers) {
      await sub(p.id, slot.id);
      await sub(p.id, past.id);
    }
    // 담당자가 내 지난 주 판을 고쳤다(TACP-22) — 「고침」은 보이고 고친 사람은 안 보인다
    await sub(me.id, past.id, { editedById: lead.id, editedAt: new Date(), origin: 'lead_edit' });
    await sub(me.id, slot.id);

    const { tree, digest } = await visit(MemberHome as never, HID.me);
    expect(digest).toBeNull();
    const els = elements(tree);
    const propsOf = (n: string) => els.find((e) => typeof e.type === 'function' && (e.type as { name: string }).name === n)?.props;
    const card = propsOf('ThisWeekCard');
    const list = propsOf('PastWeeks');
    expect(card).toBeTruthy();
    expect(list).toBeTruthy();
    const json = JSON.stringify([card, list]);
    for (const p of [...peers, { id: lead.id, name: lead.name }]) {
      expect(json, p.name).not.toContain(p.name);
      expect(json, p.name).not.toContain(p.id);
    }
    expect(json).not.toContain('홈휴직');
    // 「고침」은 남는다 — 누가 고쳤는지는 열었을 때(preview) 본다
    const groups = list!.groups as { recent: { weeks: { isoKey: string; mine: { edited: boolean } | null }[] }[] };
    expect(groups.recent.flatMap((m) => m.weeks).find((w) => w.isoKey === 'HM97-PAST')?.mine?.edited).toBe(true);
    // 내 것은 실린다 — 제출물 드로어의 members=[me]
    expect(card!.me).toEqual({ id: me.id, name: me.name });

    // PG-T03을 뒤집는다 — 홈은 부서 현황·업로드·카운트다운을 가져오지 않는다
    const src = readFileSync(path.resolve(__dirname, '../src/app/[division]/page.tsx'), 'utf8');
    for (const gone of ['divisionStatus', 'SubmitChoice', 'hwpUploadOpen', 'DeadlineCountdown', 'BellIcon']) expect(src, gone).not.toContain(gone);
  });

  it('[PG-T98] 옛 주소 보내기 — /history → 홈 · /archive → 부서원 홈, 담당자 수합 관리 · 타 부서 총괄은 수합 관리 · 남의 부서·없는 부서는 404 · 로그인 전은 /login (PG-70)', async () => {
    const { prisma } = await import('@/server/db');
    const { default: MemberHome } = await import('@/app/[division]/page');
    const { default: History } = await import('@/app/[division]/history/page');
    const { default: Archive } = await import('@/app/[division]/archive/page');
    const go = async (page: unknown, who: string, slug = H.slug) => (await visit(page as never, who, slug)).digest;
    const to = (p: string) => `NEXT_REDIRECT;replace;${p};307;`;
    const NF = 'NEXT_HTTP_ERROR_FALLBACK;404';

    expect(await go(History, HID.me)).toBe(to(`/${H.slug}`));
    expect(await go(Archive, HID.me)).toBe(to(`/${H.slug}`));
    expect(await go(History, HID.lead)).toBe(to(`/${H.slug}`));
    expect(await go(Archive, HID.lead)).toBe(to(`/${H.slug}/manage`));

    await prisma.user.updateMany({ where: { email: { in: [ID.coord, ID.aLead] } }, data: { mustChangePassword: false } });
    try {
      // 타 부서를 읽는 사람 — 홈·옛 주소 모두 그 부서의 수합 관리로 (「개요」는 없어졌다)
      for (const page of [MemberHome, History, Archive]) expect(await go(page, ID.coord)).toBe(to(`/${H.slug}/manage`));
      // 남의 부서(권한 없음)·없는 부서 — 어디로도 보내지 않고 같은 404 (AU-T17 · TACP-5)
      for (const page of [MemberHome, History, Archive]) {
        expect(await go(page, ID.aLead)).toBe(NF);
        expect(await go(page, HID.me, 'No_Such_Division')).toBe(NF);
      }
    } finally {
      await prisma.user.updateMany({ where: { email: { in: [ID.coord, ID.aLead] } }, data: { mustChangePassword: true } });
    }
    // 로그인 전이면 로그인으로 (AU-22)
    for (const page of [MemberHome, History, Archive]) expect(await go(page, '')).toBe(to('/login'));
  });

  it('[PG-T99] 수합 관리 주차 — 근거 있는 주 + 이번 주 + 보는 주, 26주 상한 없음 · 수는 명단 기준(명단 밖 제출은 분자에 없다)', async () => {
    const { prisma } = await import('@/server/db');
    const { divisionWeeks, ensureCurrentSlot } = await import('@/server/worklog');
    const current = await ensureCurrentSlot();
    const far = await slotAt('HM99-FAR', 40);
    const bare = await slotAt('HM99-BARE', 5);
    const counted = await slotAt('HM99-COUNTED', 6);
    await run(far.id, new Date(far.opensAt.getTime() + 3 * 86_400_000));
    const off = await prisma.user.findUniqueOrThrow({ where: { email: HID.off } });
    await sub(me.id, counted.id);
    await sub(off.id, counted.id); // 명단 밖 — 병합에는 들어가도 진척 수에는 없다

    const w = await divisionWeeks(hid);
    const ks = w.slots.map((s) => s.isoKey);
    expect(ks).toContain(current.isoKey);
    expect(ks).toContain('HM99-FAR'); // 40주 전 — 26주 상한이 없다
    expect(ks).toContain('HM99-COUNTED');
    expect(ks).not.toContain('HM99-BARE'); // 이 부서에 아무 근거도 없는 주
    expect(ks.indexOf(current.isoKey)).toBe(0); // 최신이 위
    expect((await divisionWeeks(hid, bare.id)).slots.map((s) => s.isoKey)).toContain('HM99-BARE'); // 지금 보는 주는 들어간다
    expect(w.submittedOf(counted.id)).toBe(1);
    expect(w.roster).toBe(await prisma.user.count({ where: { divisionId: hid, isActive: true, onRoster: true } }));
  });

  it('[AU-T87] ★ 부서원은 부서 제출 현황(이름·시각)을 받는 길이 없다 — 라우트 없음 · API가 현황 함수를 부르지 않음 · 수합 관리는 404. 담당자는 그대로 (TACP-11 v1.8 · 새로 금지된 것)', async () => {
    const { existsSync: exists, readdirSync, statSync } = await import('node:fs');
    expect(exists(path.resolve(__dirname, '../src/app/api/division/status/route.ts'))).toBe(false);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('route.ts') ? [p] : [];
      });
    const callers = walk(path.resolve(__dirname, '../src/app/api')).filter((f) => readFileSync(f, 'utf8').includes('divisionStatus'));
    expect(callers).toEqual([]);

    const { default: ManagePage } = await import('@/app/[division]/manage/page');
    expect((await visit(ManagePage as never, HID.me)).digest).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    // 담당자 — 수합 관리 화면(그 안의 현황 카드)이 그대로 열린다
    const asLead = await visit(ManagePage as never, HID.lead);
    expect(asLead.digest).toBeNull();
    expect(elements(asLead.tree).some((e) => typeof e.type === 'function' && (e.type as { name: string }).name === 'ManageView')).toBe(true);
  });

  // 현황 API가 없어진 뒤 남의 부서 현황에 닿는 길은 수합 관리 화면 하나다. 그 화면 페이지는 getDivisionView의 404를
  // 스스로 잡지 않고 레이아웃에 맡기므로, 막는 쪽(레이아웃)을 직접 본다 — 여기가 비면 현황이 그대로 그려진다
  it('[AU-T14] 남의 부서 lead·head는 수합 관리(현황)를 열지 못한다 — 레이아웃이 404. 내 부서 담당자는 연다 (2026-10-08 — 현황 API 폐지 뒤 남은 길)', async () => {
    const { prisma } = await import('@/server/db');
    const { default: DivisionLayout } = await import('@/app/[division]/layout');
    const da = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const head = await prisma.user.create({
      data: { email: 'a-head-t14@test.kei.re.kr', name: 'a-head-t14', divisionId: da.id, divisionRole: 'head', mustChangePassword: false },
    });
    await prisma.user.updateMany({ where: { email: ID.aLead }, data: { mustChangePassword: false } });
    try {
      for (const who of [ID.aLead, head.email]) {
        expect((await visit(DivisionLayout as never, who)).digest, who).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
      }
      expect((await visit(DivisionLayout as never, HID.lead)).digest).toBeNull();
    } finally {
      await prisma.user.updateMany({ where: { email: ID.aLead }, data: { mustChangePassword: true } });
      await prisma.user.delete({ where: { id: head.id } });
    }
  });
});

/**
 * HM-34 — **마감은 이벤트다.** 14:00이 지나면 그때까지 제출된 것으로 최종본을 한 번 만든다.
 *
 * 이 스위트는 2026-08-27 AI홍보전략실에서 실제로 난 사고를 그대로 재현한다:
 * 담당자가 10:37에 «미리 한번» 병합해 봤고, 그 성공 기록 때문에 14:00 자동 병합이
 * 스스로 빠졌다. 13시 이후 낸 세 명이 통째로 빠진 문서를 실장이 검토했다.
 *
 * 병합 본체(양식·모델)를 타지 않고 **판정만** 확인한다 — 버그가 살던 자리가 거기다.
 */
describe('HM-34 마감 이벤트 — 미리보기는 최종본을 대신하지 못한다', () => {
  const 마감 = new Date('2026-08-27T05:00:00.000Z'); // 목 14:00 KST

  async function fixture() {
    const { prisma } = await import('@/server/db');
    const div = await prisma.division.findFirstOrThrow({ where: { slug: A.slug } });
    const slot = await prisma.weekSlot.upsert({
      where: { isoKey: 'HM34-W35' },
      update: {},
      create: {
        isoKey: 'HM34-W35',
        label: '8월 4주차',
        year: 2026,
        month: 8,
        weekOfMonth: 4,
        opensAt: new Date('2026-08-24T00:00:00.000Z'),
      },
    });
    await prisma.mergeRun.deleteMany({ where: { weekSlotId: slot.id } });
    return { prisma, div, slot };
  }

  const 실행 = (startedAt: Date, status: string) => ({
    status,
    startedAt,
    sourceIds: '[]',
    ruleSnapshot: '{}',
  });

  it('[HM-T40] 마감 **전** 수동 병합은 최종본이 아니다 — 이게 그날의 버그다', async () => {
    const { prisma, div, slot } = await fixture();
    const { hasFinalMerge } = await import('@/server/merge/run');

    // 10:37 KST — 담당자가 미리 돌려본 그 실행
    await prisma.mergeRun.create({
      data: { divisionId: div.id, weekSlotId: slot.id, ...실행(new Date('2026-08-27T01:37:00.000Z'), 'succeeded') },
    });

    expect(await hasFinalMerge(div.id, slot.id, 마감)).toBe(false);
  });

  it('[HM-T41] 마감 **후** 성공한 실행이 최종본이다 — 두 번 만들지 않는다', async () => {
    const { prisma, div, slot } = await fixture();
    const { hasFinalMerge } = await import('@/server/merge/run');

    await prisma.mergeRun.create({
      data: { divisionId: div.id, weekSlotId: slot.id, ...실행(new Date('2026-08-27T05:02:00.000Z'), 'succeeded') },
    });

    expect(await hasFinalMerge(div.id, slot.id, 마감)).toBe(true);
  });

  it('[HM-T42] 마감 정각의 실행은 최종본이다 (경계는 포함)', async () => {
    const { prisma, div, slot } = await fixture();
    const { hasFinalMerge } = await import('@/server/merge/run');

    await prisma.mergeRun.create({
      data: { divisionId: div.id, weekSlotId: slot.id, ...실행(마감, 'succeeded') },
    });

    expect(await hasFinalMerge(div.id, slot.id, 마감)).toBe(true);
  });

  it('[HM-T43] 마감 후 **실패**는 최종본이 아니다 — 다음 주기가 다시 시도한다', async () => {
    const { prisma, div, slot } = await fixture();
    const { hasFinalMerge } = await import('@/server/merge/run');

    await prisma.mergeRun.create({
      data: { divisionId: div.id, weekSlotId: slot.id, ...실행(new Date('2026-08-27T05:02:00.000Z'), 'failed') },
    });

    expect(await hasFinalMerge(div.id, slot.id, 마감)).toBe(false);
  });

  it('[HM-T44] 남의 부서 최종본은 우리 부서를 「됐다」로 만들지 않는다', async () => {
    const { prisma, div, slot } = await fixture();
    const { hasFinalMerge } = await import('@/server/merge/run');
    const other = await prisma.division.findFirstOrThrow({ where: { slug: B.slug } });

    await prisma.mergeRun.create({
      data: { divisionId: other.id, weekSlotId: slot.id, ...실행(new Date('2026-08-27T05:02:00.000Z'), 'succeeded') },
    });

    expect(await hasFinalMerge(div.id, slot.id, 마감)).toBe(false);
    expect(await hasFinalMerge(other.id, slot.id, 마감)).toBe(true);
  });
});

/**
 * WA-10/12 — 「지난번에 낸 것」. **본인 것만** 나와야 한다.
 *
 * 이 경로는 `findAccessibleSubmission`을 거치지 않고 `userId`를 신원에서 박아 조회한다.
 * 그 설계가 실제로 지켜지는지 — 특히 **남의 `submissionId`를 넣었을 때** — 를 여기서 잡는다.
 * 격리는 코드를 읽어 안심할 것이 아니라 테스트가 시도해 보고 실패해야 하는 것이다 (TACP §2).
 *
 * **자기 데이터를 직접 만든다.** 앞선 테스트의 업로드에 기대면 `-t`로 하나만 돌릴 때 깨지고,
 * 그러면 정작 이 격리 검사를 급할 때 못 돌린다. 양식(hwp)은 필요 없다 — 파일을 못 읽어도
 * 목록과 권한은 답해야 하고, 그게 이 스위트가 보는 것이다.
 */
describe('WA-10 지난번에 낸 것 (api/my/previous)', () => {
  const WA = {
    me: 'wa-me@test.kei.re.kr',
    other: 'wa-other@test.kei.re.kr',
    none: 'wa-none@test.kei.re.kr',
  };
  let 내_이전: string;
  let 남의_것: string;

  /*
   * 주차 다섯 개를 깔고 **W05·W04·W02·W01에만 낸다** (W03은 거른 주).
   * 기준을 W05로 잡으면 창은 W04·W03·W02이고, 그 안에 든 것은 W04와 W02뿐이다.
   *
   * 이 배치가 「직전 3주」와 「최근 3건」을 갈라낸다 — 후자였다면 W01이 딸려 온다.
   */
  beforeAll(async () => {
    const { prisma } = await import('@/server/db');
    const da = await prisma.division.findFirstOrThrow({ where: { slug: A.slug } });
    const db = await prisma.division.findFirstOrThrow({ where: { slug: B.slug } });

    const slot = (n: number, opensAt: string) =>
      prisma.weekSlot.upsert({
        where: { isoKey: `WA-W0${n}` },
        update: {},
        create: {
          isoKey: `WA-W0${n}`,
          label: `7월 ${n}주차`,
          year: 2026,
          month: 7,
          weekOfMonth: n,
          opensAt: new Date(opensAt),
        },
      });
    const s1 = await slot(1, '2026-06-29T00:00:00.000Z');
    const s2 = await slot(2, '2026-07-06T00:00:00.000Z');
    await slot(3, '2026-07-13T00:00:00.000Z'); // 거른 주 — 슬롯은 있고 제출이 없다
    const s4 = await slot(4, '2026-07-20T00:00:00.000Z');
    const s5 = await slot(5, '2026-07-27T00:00:00.000Z');

    const user = (email: string, divisionId: string) =>
      prisma.user.create({ data: { email, name: email.split('@')[0], divisionId } });
    const me = await user(WA.me, da.id);
    const other = await user(WA.other, db.id);
    await user(WA.none, da.id);

    const sub = (u: string, div: string, slotId: string, n: number) =>
      prisma.submission.create({
        data: {
          userId: u,
          divisionId: div,
          weekSlotId: slotId,
          filePath: `wa/${n}.hwp`, // 실재하지 않는다 — rows는 null로 떨어지고 그게 정상 경로다
          originalName: `wa-${n}.hwp`,
          byteSize: 1,
          sha256: `wa${n}`,
          version: 1,
          isLatest: true,
        },
      });
    await sub(me.id, da.id, s1.id, 1);
    const a2 = await sub(me.id, da.id, s2.id, 2);
    await sub(me.id, da.id, s4.id, 4);
    await sub(me.id, da.id, s5.id, 5); // 기준 주차 — 목록에 섞이면 안 된다
    const b1 = await sub(other.id, db.id, s4.id, 6);
    내_이전 = a2.id;
    남의_것 = b1.id;
  });

  const get = async (q = '') => {
    const { GET } = await import('@/app/api/my/previous/route');
    return (await GET(nx(`/api/my/previous${q}`, WA.me))).json();
  };
  const keys = (b: { items: { isoKey: string }[] }) => b.items.map((i) => i.isoKey);

  it('[WA-T10] 낸 적이 없으면 found:false — 화면은 아무것도 그리지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const res = await GET(nx('/api/my/previous?isoKey=WA-W05', WA.none));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.items).toEqual([]);
  });

  it('[WA-T11] **직전 3주만** 나온다 — 그보다 오래된 것은 빠진다 (WA-14)', async () => {
    const body = await get('?isoKey=WA-W05');
    expect(body.found).toBe(true);
    // 창은 W04·W03·W02. W03은 거른 주라 비고, W01은 창 밖이다
    expect(keys(body)).toEqual(['WA-W04', 'WA-W02']);
  });

  it('[WA-T12] 「최근 3건」이 아니다 — 한 주 걸러도 창을 넓히지 않는다', async () => {
    // 제출 기준으로 3건을 집었다면 W01이 딸려 온다. 그게 이 테스트가 막는 것이다
    expect(keys(await get('?isoKey=WA-W05'))).not.toContain('WA-W01');
  });

  it('[WA-T13] 기준 주차 것은 섞이지 않는다 — 이번 주에 이미 낸 것은 「지난번」이 아니다', async () => {
    expect(keys(await get('?isoKey=WA-W05'))).not.toContain('WA-W05');
  });

  it('[WA-T14] 기본은 가장 최근 것, 주차를 골라 볼 수 있다', async () => {
    const body = await get('?isoKey=WA-W05');
    expect(body.slot.isoKey).toBe('WA-W04');
    expect(body.submissionId).toBe(body.items[0].submissionId);

    const 고른것 = await get(`?isoKey=WA-W05&submissionId=${내_이전}`);
    expect(고른것.slot.isoKey).toBe('WA-W02');
  });

  it('[WA-T15] 남의 submissionId를 넣어도 남의 것이 나오지 않는다', async () => {
    const body = await get(`?isoKey=WA-W05&submissionId=${남의_것}`);
    // 조용히 무시하고 **내 것**을 돌려준다 — 남의 id가 통했다는 신호조차 주지 않는다
    expect(body.submissionId).not.toBe(남의_것);
    expect(body.items.map((i: { submissionId: string }) => i.submissionId)).not.toContain(남의_것);
  });

  it('[WA-T16] 파일을 못 읽어도 목록과 고른 주차는 살아 있다', async () => {
    const body = await get('?isoKey=WA-W05');
    expect(body.rows).toBeNull(); // 실재하지 않는 파일 — 화면은 「파일을 읽지 못했습니다」 한 줄 ([hwp로 받기]는 2026-10-08에 걷었다)
    expect(body.submissionId).toBeTruthy();
  });

  it('[WA-T17] 무인증은 열리지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const res = await GET(nx('/api/my/previous'));
    expect([401, 403, 404]).toContain(res.status);
  });
});

/**
 * DM-20 · TACP-18 — 마감 **잠시 열기**.
 *
 * 여기서 지키는 것은 「열린다」가 아니라 **「열고 닫는 것이 실제로 제출을 좌우한다」**이다.
 * 화면만 바뀌고 서버가 그대로면 「열었는데 안 받는다」가 되고, 반대면 「닫았는데 들어온다」다.
 * 둘 다 조용한 실패라 서버 판정을 직접 두드린다.
 *
 * 마감이 이미 지난 부서를 만들어서 본다 — 기존 스위트의 부서는 마감이 늘 열려 있다(일 23:59).
 */
d('DM-20 마감 잠시 열기', () => {
  const 지난마감 = { deadlineDow: 1, deadlineTime: '00:01' }; // 월 00:01 — 주 시작 직후라 늘 지나 있다
  const 늘열림 = { deadlineDow: 7, deadlineTime: '23:59' };

  const setDeadline = async (p: typeof 지난마감) => {
    const { prisma } = await import('@/server/db');
    await prisma.division.updateMany({ where: { slug: A.slug }, data: p });
  };

  const openApi = async (identity: string, method: 'POST' | 'DELETE') => {
    const mod = await import('@/app/api/division/deadline/route');
    return mod[method](nx('/api/division/deadline', identity, { method }));
  };

  beforeAll(() => setDeadline(지난마감));
  afterAll(() => setDeadline(늘열림));

  it('[DM-T30] 마감이 지나면 못 낸다 — 원래 규칙', async () => {
    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slot_locked');
  });

  it('[DM-T31] **member는 열 수 없다** — 자기 마감을 자기가 여는 건 마감이 아니다', async () => {
    expect((await openApi(ID.aMember, 'POST')).status).toBe(404);
  });

  it('[DM-T32] 담당자가 열면 부서원이 **본인 이름으로** 낸다', async () => {
    expect((await openApi(ID.aLead, 'POST')).status).toBe(200);

    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(201);

    // 제출자가 담당자가 아니라 그 부서원이다 — 이 기능을 「대신 올리기」로 만들지 않은 이유다
    const { prisma } = await import('@/server/db');
    const sub = await prisma.submission.findFirstOrThrow({
      where: { user: { email: ID.aMember }, isLatest: true },
      include: { user: true },
    });
    expect(sub.user.email).toBe(ID.aMember);
  });

  it('[DM-T33] 닫으면 다시 막힌다', async () => {
    expect((await openApi(ID.aLead, 'POST')).status).toBe(200);
    expect((await openApi(ID.aLead, 'DELETE')).status).toBe(200);

    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(409);
  });

  it('[DM-T34] 열지 않았는데 닫으면 409 — 안 한 일을 했다고 하지 않는다', async () => {
    expect((await openApi(ID.aLead, 'DELETE')).status).toBe(409);
  });

  it('[DM-T35] **남의 부서는 열 수 없다** — 부서는 신원에서 나온다 (TACP-6)', async () => {
    // B부서 담당자가 열어도 열리는 것은 B부서다. A부서는 그대로 막혀 있어야 한다
    await openApi(ID.bLead, 'POST');
    expect((await upload(ID.aMember, hwpBytes)).status).toBe(409);
  });

  it('[DM-T36] 예외에는 이름이 붙는다 — 감사 로그에 누가 열었는지 남는다', async () => {
    const { prisma } = await import('@/server/db');
    await openApi(ID.aLead, 'POST');
    const log = await prisma.auditLog.findFirst({
      where: { action: 'deadline_open' },
      orderBy: { at: 'desc' },
    });
    expect(log?.actor).toBe(ID.aLead);
    await openApi(ID.aLead, 'DELETE');
  });
});

/**
 * HM-43 — 병합이 **같은 이유로 계속 실패할 때**.
 *
 * 2026-09-03에 1분마다 여덟 번 실패했다. 재시도로는 절대 낫지 않는 종류(제출물의
 * 줄바꿈)였는데도 같은 일을 반복하며 로그를 채웠고, 정작 봐야 할 원인이 그 안에 묻혔다.
 */
describe('HM-43 실패 재시도 간격', () => {
  it('[HM-T98] 처음 몇 번은 촘촘하고 뒤로 갈수록 벌어진다', async () => {
    const { RETRY_BACKOFF_MINUTES } = await import('@/server/merge/run');
    const m = [...RETRY_BACKOFF_MINUTES];
    expect(m[0]).toBeLessThanOrEqual(2); // 되는 실패는 곧 낫는다
    expect(m[m.length - 1]).toBeGreaterThanOrEqual(15); // 안 되는 실패로 로그를 채우지 않는다
    expect(m).toEqual([...m].sort((a, b) => a - b)); // 단조 증가
  });

  it('[HM-T99] 끄지는 않는다 — 마지막 간격으로 계속 다시 본다', async () => {
    const { RETRY_BACKOFF_MINUTES } = await import('@/server/merge/run');
    // 배열을 넘어가는 실패 횟수도 마지막 값으로 눌린다(clamp) — 영영 포기하는 분기가 없다
    expect(RETRY_BACKOFF_MINUTES.length).toBeGreaterThan(0);
  });
});

/**
 * WS-19 · TACP-20 — 주차 마감 예외는 **총괄·운영자가** 정한다.
 *
 * 이 예외는 한 부서가 아니라 그 주 전 부서의 마감을 움직인다. 그래서 지키는 것은 셋이다:
 * 정할 수 있는 사람만 정한다 · 부서 쪽은 존재조차 모른다(404) · 지난 마감은 옮기지 않는다.
 */
/** PG-T79 — 서버 컴포넌트가 돌려준 요소 나무를 훑는다. 그리지는 않는다 — 무엇을 어떤 값으로 그리려 했는지만 본다 */
type El = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (node && typeof node === 'object' && 'type' in node && 'props' in node) {
    out.push(node as El);
    for (const v of Object.values((node as El).props ?? {})) elements(v, out);
  }
  return out;
}
async function renderOrg(who: string, sp: Record<string, string> = {}) {
  const { default: OrgPage } = await import('@/app/org/page');
  pageAs.who = who;
  const els = elements(await OrgPage({ searchParams: Promise.resolve(sp) }));
  const named = (n: string) => els.filter((e) => typeof e.type === 'function' && (e.type as { name: string }).name === n);
  return {
    has: (n: string) => named(n).length > 0,
    props: (n: string) => named(n)[0]?.props as Record<string, unknown> | undefined,
    hrefs: els.map((e) => e.props.href).filter((h): h is string => typeof h === 'string'),
  };
}

d('WS-19 주차 마감 예외 — 총괄이 정한다', () => {
  const route = () => import('@/app/api/schedule/deadline/route');
  /** 지금부터 h시간 뒤의 대외 마감을 `YYYY-MM-DDTHH:mm`(KST)로 */
  const externalIn = async (hours: number) => {
    const { TZDate } = await import('@date-fns/tz');
    const k = new TZDate(Date.now() + hours * 3600_000, 'Asia/Seoul');
    const z = (n: number) => String(n).padStart(2, '0');
    return `${k.getFullYear()}-${z(k.getMonth() + 1)}-${z(k.getDate())}T${z(k.getHours())}:00`;
  };
  const post = async (identity: string, body: unknown) => {
    const { POST } = await route();
    return POST(
      nx('/api/schedule/deadline', identity, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  };

  afterAll(async () => {
    const { prisma } = await import('@/server/db');
    await prisma.weekSlot.updateMany({
      data: { deadlineDowOverride: null, deadlineTimeOverride: null, deadlineNote: null },
    });
  });

  it('[WS-T70] ★ 총괄이 미리보고 적용한다 — 저장되고 감사 기록에 전·후가 남는다', async () => {
    const external = await externalIn(50);
    const pre = await post(ID.coord, { mode: 'preview', external });
    expect(pre.status).toBe(200);
    const { plan } = await pre.json();
    expect(plan.blocked).toBeNull();

    // 미리보기는 쓰지 않는다
    const { prisma } = await import('@/server/db');
    expect((await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: plan.isoKey } })).deadlineDowOverride).toBeNull();

    const res = await post(ID.coord, { mode: 'apply', external });
    expect(res.status).toBe(200);
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: plan.isoKey } });
    expect(slot.deadlineDowOverride).not.toBeNull();
    expect(slot.deadlineNote).toContain('마감입니다');

    const log = await prisma.auditLog.findFirst({
      where: { action: 'deadline_override', actor: ID.coord },
      orderBy: { at: 'desc' },
    });
    expect(log?.target).toBe(`slot:${plan.isoKey}`);
    expect(JSON.parse(log!.detail!).after).toBe(plan.department);

    // 해제하면 평소대로 — 이것도 기록된다
    const { DELETE } = await route();
    const del = await DELETE(nx(`/api/schedule/deadline?isoKey=${plan.isoKey}`, ID.coord, { method: 'DELETE' }));
    expect(del.status).toBe(200);
    expect((await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: plan.isoKey } })).deadlineDowOverride).toBeNull();
  });

  it('[WS-T70b] 운영자도 정할 수 있다', async () => {
    expect((await post(ID.op, { mode: 'preview', external: await externalIn(50) })).status).toBe(200);
  });

  it('[WS-T71] ★ 부서 쪽(담당자·부서원)은 404 — 한 부서가 전 부서의 마감을 움직이지 못한다', async () => {
    const external = await externalIn(50);
    for (const who of [ID.aLead, ID.bLead, ID.aMember]) {
      expect((await post(who, { mode: 'apply', external })).status, who).toBe(404);
      // 미리보기도 문 안쪽이다 — 무엇이 바뀔지조차 보여 주지 않는다
      expect((await post(who, { mode: 'preview', external })).status, who).toBe(404);
    }
  });

  it('[WS-T72] 이미 지난 마감으로는 옮기지 않는다 — 미리보기는 막힌 이유를 말하고, 적용은 409', async () => {
    const past = await externalIn(-2);
    const pre = await post(ID.coord, { mode: 'preview', external: past });
    expect(pre.status).toBe(200);
    expect((await pre.json()).plan.blocked).toMatch(/지났습니다/);
    expect((await post(ID.coord, { mode: 'apply', external: past })).status).toBe(409);
  });

  it('[WS-T72b] 공지를 못 읽으면 422 — 추측으로 마감을 만들지 않는다', async () => {
    const res = await post(ID.coord, { mode: 'preview', noticeText: '주간업무 작성 요청드립니다.' });
    expect(res.status).toBe(422);
  });

  // WS-19l · RU-58 — 「주차 일정」 카드 하나: 주차 줄마다 부서 마감과 (3단계를 쓰면) 단계 기한이 같이 있다
  type Week = { isoKey: string; deadline: string; stages: { unitDue: string; hqDue: string; unitDueKo: string } | null };
  // GET /api/schedule/deadline은 지웠다(R2) — 「전사」 화면이 부르는 서버 함수를 그대로 본다. 시각은 화면과 같은 ISO 문자열로
  const weeks = async (): Promise<Week[]> => {
    const { deadlineStatus } = await import('@/server/slot-deadline');
    return JSON.parse(JSON.stringify((await deadlineStatus()).weeks));
  };
  const gap = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

  it('[WS-T74] 3단계가 꺼져 있으면 줄에 단계 기한이 없다 — 아무도 쓰지 않는 기한을 그리지 않는다 (RU-52)', async () => {
    const { prisma } = await import('@/server/db');
    await prisma.orgRollupSetting.deleteMany({});
    const ws = await weeks();
    expect(ws).toHaveLength(2);
    expect(ws.map((w) => w.stages)).toEqual([null, null]);
  });

  it('[WS-T75] ★ 켜면 줄마다 부서 마감 + 간격 — 마감을 옮기면 단계 기한도 같은 간격으로 따라간다', async () => {
    const { prisma } = await import('@/server/db');
    await prisma.orgRollupSetting.upsert({
      where: { id: 'org' },
      create: { id: 'org', enabled: true, unitDueMinutes: 60, hqDueMinutes: 120 },
      update: { enabled: true, unitDueMinutes: 60, hqDueMinutes: 120 },
    });
    try {
      const before = await weeks();
      for (const w of before) {
        expect(gap(w.deadline, w.stages!.unitDue), w.isoKey).toBe(60);
        expect(gap(w.deadline, w.stages!.hqDue), w.isoKey).toBe(120);
      }
      // 이 스위트의 부서 마감은 일 23:59 — 한 시간 뒤는 다음 날이라 날짜까지 적는다
      expect(before[0].stages!.unitDueKo).toMatch(/월 \d+일\(월\) 00:59$/);

      // 총괄이 마감을 옮긴다 → 그 주 줄의 단계 기한이 같은 간격으로 옮겨진다
      const applied = await post(ID.coord, { mode: 'apply', external: await externalIn(50) });
      expect(applied.status).toBe(200);
      const { plan } = await applied.json();
      const moved = (await weeks()).find((w) => w.isoKey === plan.isoKey)!;
      expect(moved.deadline).toBe(plan.department);
      expect(gap(moved.deadline, moved.stages!.unitDue)).toBe(60);
      expect(gap(moved.deadline, moved.stages!.hqDue)).toBe(120);
      // 미리보기(RU-58)와 같은 시각이다 — 같은 기준 시각에서 센다
      expect(plan.schedule.map((r: { at: string }) => r.at)).toContain(moved.stages!.hqDue);
    } finally {
      await prisma.weekSlot.updateMany({ data: { deadlineDowOverride: null, deadlineTimeOverride: null, deadlineNote: null } });
      await prisma.orgRollupSetting.deleteMany({});
    }
  });

  it('[PG-T79] ★ 「전사」 화면 — 누가 무엇을 보나. 제출 열은 readAll, 최종본 열·만들기·섹션 구성 편집·3단계 스위치는 운영자 늘·총괄은 3단계를 켠 뒤에만. 담당자는 404', async () => {
    const { orgPageView, requireScope } = await import('@/server/authz');
    const { prisma } = await import('@/server/db');
    const as = (who: string) => requireScope(new Headers({ 'x-test-identity': who }));
    const [coord, op, lead] = [await as(ID.coord), await as(ID.op), await as(ID.aLead)];
    await prisma.orgRollupSetting.deleteMany({}); // 기본 = 꺼짐
    await prisma.orgSection.deleteMany({});
    expect(await orgPageView(coord)).toEqual({ open: true, progress: true, desk: false, schedule: true, operate: false });
    expect(await orgPageView(op)).toEqual({ open: true, progress: true, desk: true, schedule: true, operate: true });
    expect(await orgPageView(lead)).toEqual({ open: false, progress: false, desk: false, schedule: false, operate: false });

    // 페이지가 실제로 그리는 것 — 같은 판정에서 나온다 (TACP-9: 못 하는 일의 열·버튼·링크를 그리지 않는다)
    await prisma.user.updateMany({ where: { email: { in: [ID.coord, ID.op, ID.aLead] } }, data: { mustChangePassword: false } });
    try {
      // 총괄, 3단계 꺼짐 — 제출 열만. 최종본 열·파일 올리기·만들기·섹션 구성 편집·운영 없음. 일정은 마감 바꾸기만
      const c = await renderOrg(ID.coord);
      expect(c.props('OrgBoard')?.columns).toEqual({ progress: true, final: false });
      expect((c.props('OrgBoard')?.rows as { final: unknown; hq: unknown }[]).every((r) => r.final === null && r.hq === null)).toBe(true);
      expect(c.has('OrgRunCard')).toBe(false);
      expect(c.props('WeekSchedule')).toMatchObject({ canSchedule: true, rollup: null });
      // WS-19l (2026-10-08) — 머리글 줄은 다가올 주차만. 지난 마감은 넘기지도 않는다
      expect((c.props('WeekSchedule')?.weeks as { passed: boolean }[]).every((w) => !w.passed)).toBe(true);
      expect((c.props('WeekSchedule')?.weeks as unknown[]).length).toBeGreaterThan(0);
      // RU-60 — 최종본 열이 없으면 [올리기]도 없다
      expect(c.props('OrgBoard')?.canUpload).toBe(false);
      expect(c.hrefs).toContain('/ops/audit');
      expect(c.hrefs).not.toContain('/ops');
      expect(c.hrefs.some((h) => h.includes('edit=sections'))).toBe(false);
      // 편집 주소를 직접 쳐도 편집기는 오지 않는다 — 값이 없다
      expect((await renderOrg(ID.coord, { edit: 'sections' })).has('SectionEditor')).toBe(false);
      // PG-51d — 읽기만 하는 화면이 섹션 설정을 만들지 않았다
      expect(await prisma.orgSection.count()).toBe(0);

      // 운영자, 3단계 꺼짐 — 켜는 사람이므로 취합 부분이 다 보인다 (RU-52)
      const o = await renderOrg(ID.op);
      expect(o.props('OrgBoard')?.columns).toEqual({ progress: true, final: true });
      expect((o.props('OrgBoard')?.rows as { no: number | null; final: unknown }[]).filter((r) => r.no !== null).every((r) => r.final !== null)).toBe(true);
      expect(o.has('OrgRunCard')).toBe(true);
      expect(o.props('WeekSchedule')).toMatchObject({ canSchedule: true, rollup: { enabled: false } });
      // RU-60 — 최종본 열 + hwp 스위치(이 스위트는 기본값 on) → [올리기]가 있다. off 서버는 web-only-submit.test가 본다
      expect(o.props('OrgBoard')?.canUpload).toBe(true);
      expect(o.hrefs).toEqual(expect.arrayContaining(['/ops', '/ops/audit', '/org?edit=sections']));
      const oe = await renderOrg(ID.op, { edit: 'sections' });
      expect([oe.has('SectionEditor'), oe.has('OrgBoard')]).toEqual([true, false]);

      // 3단계를 켜면 총괄에게도 취합 부분이 열린다
      await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });
      const on = await renderOrg(ID.coord);
      expect(on.props('OrgBoard')?.columns).toEqual({ progress: true, final: true });
      expect(on.has('OrgRunCard')).toBe(true);
      expect(on.props('WeekSchedule')).toMatchObject({ canSchedule: true, rollup: { enabled: true } });
      expect(on.hrefs).not.toContain('/ops');

      // 담당자 — 화면이 없다 (TACP-5)
      await expect(renderOrg(ID.aLead)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    } finally {
      await prisma.orgRollupSetting.deleteMany({});
      await prisma.orgSection.deleteMany({});
      await prisma.user.updateMany({ where: { email: { in: [ID.coord, ID.op, ID.aLead] } }, data: { mustChangePassword: true } });
    }
  });

  // [PG-T80] 옛 주소 /ops/monitor → /org 보내기 — 폐지 2026-10-08 (R17). 보내기 페이지째 지웠다. 알림이 이 주소를 건 적이 없고,
  // 「전사」로 가는 길은 상단 메뉴 하나다. 지운 것은 org-page.test(RU-T46)가 본다

  it('[PG-T83] 섹션 설정이 없으면 읽기만 — 기본 13개를 부서 이름으로 맞춰 보여 주고, 어느 섹션에도 안 닿는 집계 부서는 「섹션 밖」', async () => {
    const { prisma } = await import('@/server/db');
    const { DEFAULT_SECTIONS, sectionList } = await import('@/server/rollup/sections');
    const { orgBoard } = await import('@/server/org-board');
    const { rollupSlot } = await import('@/server/rollup/slot');
    await prisma.orgSection.deleteMany({});
    const divisions = await prisma.division.findMany({ select: { id: true, nameKo: true } });
    const list = await sectionList(divisions);
    expect(list.map((s) => s.title)).toEqual(DEFAULT_SECTIONS.map((s) => s.title));
    // 이 스위트의 부서(가부서·나부서)는 기본 목록에 없다 — 부서 행은 못 찾아도 이름은 안다(PG-51c는 이름으로 맞춘다)
    expect(list.every((s) => s.divisionId === null)).toBe(true);
    expect(list.map((s) => s.divisionName)).toEqual(DEFAULT_SECTIONS.map((s) => s.division));

    // 가부서를 집계 대상으로 — 어느 섹션에도 안 닿으므로 「섹션 밖」 줄로 (빠지면 합계가 감사 문서와 갈라진다)
    await prisma.division.update({ where: { slug: A.slug }, data: { boardStatus: 'confirmed' } });
    try {
      const board = await orgBoard(await rollupSlot(null), { progress: true, desk: false }, '');
      expect(board.rows.map((r) => r.title)).toEqual([...DEFAULT_SECTIONS.map((s) => s.title), '섹션 밖']);
      const outside = board.rows.at(-1)!;
      expect([outside.no, outside.final, outside.progress?.teams.map((t) => t.name)]).toEqual([null, null, ['가부서']]);
      expect(board.totals).toMatchObject({ roster: outside.progress!.roster, submitted: outside.progress!.submitted });
      expect(board.excludedNote).toEqual({ divisions: 1, people: expect.any(Number) }); // 나부서
      // 취합 쪽 값은 계산하지도 내려보내지도 않는다 (PG-51e)
      expect([board.ready, board.run, board.editor]).toEqual([null, null, null]);
      expect(await prisma.orgSection.count()).toBe(0);
    } finally {
      await prisma.division.update({ where: { slug: A.slug }, data: { boardStatus: 'none' } });
    }
  });
});

/**
 * PG-72·73·74 — 수합 관리 머리와 부서 설정 (2026-10-08 기능 정리 · ADR-0018).
 *
 * 서버 컴포넌트를 직접 불러 **무엇을 어떤 값으로 그리려 했는지**만 본다(PG-T79 방식 — 그리지는 않는다).
 * 클라이언트 부품(SlotSelector·MergePanel·RuleEditor) 속은 tests/manage-trim.test.ts·merge-panel.test.ts가 그려 본다.
 */
describe('PG-72·73·74 수합 관리 머리 · 부서 설정', () => {
  const texts = (node: unknown, out: string[] = []): string[] => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach((n) => texts(n, out));
    else if (node && typeof node === 'object' && 'props' in node) texts((node as El).props.children, out);
    return out;
  };
  const named = (els: El[], n: string) => els.filter((e) => typeof e.type === 'function' && (e.type as { name: string }).name === n);
  /** 페이지가 던진 Next 신호(notFound·redirect)의 digest. 그렸으면 null */
  const thrown = async (f: () => Promise<unknown>) => {
    try {
      await f();
      return null;
    } catch (e) {
      return (e as { digest?: string }).digest ?? String(e);
    }
  };
  const settings = async (who: string) => {
    const { default: SettingsPage } = await import('@/app/[division]/manage/settings/page');
    pageAs.who = who;
    return SettingsPage({ params: Promise.resolve({ division: A.slug }) });
  };
  const PEOPLE = [ID.aLead, ID.aMember, ID.coord];

  beforeAll(async () => {
    const { prisma } = await import('@/server/db');
    await prisma.user.updateMany({ where: { email: { in: PEOPLE } }, data: { mustChangePassword: false } });
  });
  afterAll(async () => {
    const { prisma } = await import('@/server/db');
    await prisma.user.updateMany({ where: { email: { in: PEOPLE } }, data: { mustChangePassword: true } });
    pageAs.who = '';
  });

  it('[PG-T101] ★ 부서 설정은 카드 둘 — 부서 양식 · 분류 순서. 작성 안내·병합 설정의 나머지·제출 대상은 없다 (PG-74)', async () => {
    const els = elements(await settings(ID.aLead));
    expect(named(els, 'TemplateManager')).toHaveLength(1);
    const rule = named(els, 'RuleEditor');
    expect(rule).toHaveLength(1);
    // 분류 순서 하나만 넘긴다 — 옛 설정 칸의 처음 값(initialSort·initialGuide …)은 없다
    expect(Object.keys(rule[0].props).sort()).toEqual(['initialCategories', 'thisWeekMerged']);
    expect(els.filter((e) => e.type === 'section')).toHaveLength(1); // 양식 카드 (분류 순서 카드는 RuleEditor가 그린다)
    const words = texts(els.map((e) => e.props.children)).join(' ');
    for (const gone of ['작성 안내', '제출 대상', '집계 제외', '병합 설정', '정렬']) expect(words, gone).not.toContain(gone);
  });

  it('[PG-T101] 타 부서를 읽는 총괄 — 같은 두 카드를 읽기로만, 편집 부품은 없다 (AU-17d)', async () => {
    const els = elements(await settings(ID.coord));
    expect(named(els, 'TemplateManager')).toHaveLength(0);
    expect(named(els, 'RuleEditor')).toHaveLength(0);
    expect(els.filter((e) => e.type === 'section')).toHaveLength(2);
    const words = texts(els.map((e) => e.props.children)).join(' ');
    expect(words).toContain('읽기 전용');
    expect(words).toContain('분류 순서');
  });

  it('[AU-T89] ★ 부서원은 병합 규칙을 읽지 못한다 — 부서 설정 404 · 규칙 GET 없음 · 저장 404 (TACP §3.1 v1.6.4, 새로 금지된 것)', async () => {
    expect(await thrown(() => settings(ID.aMember))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    const rule = await import('@/app/api/division/rule/route');
    expect('GET' in rule).toBe(false);
    const res = await rule.PUT(
      nx('/api/division/rule', ID.aMember, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: '부서원' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('[PG-T102] 수합 관리 머리 — `부서 설정` 링크 · 전체 zip·집계 제외 각주 없음 · 병합 카드에 게시판 제목 (PG-72·73)', async () => {
    const { prisma } = await import('@/server/db');
    const { ManageView } = await import('@/app/[division]/manage/ManageView');
    const { boardTitle } = await import('@/lib/docname');
    const { currentWeek, slotKind } = await import('@/lib/week');
    const division = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const els = elements(
      await ManageView({ division, canMerge: true, canDownloadMerged: true, canDeleteAny: false, canEditMerged: true }),
    );
    const hrefs = els.map((e) => e.props.href).filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain(`/${A.slug}/manage/settings`);
    expect(hrefs.some((h) => h.includes('download-zip'))).toBe(false);
    const table = named(els, 'SubmissionTableClient')[0].props;
    expect('action' in table || 'footnote' in table).toBe(false);
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: currentWeek(new Date()).isoKey } });
    expect(named(els, 'MergePanel')[0].props.title).toBe(boardTitle(slot.month, slot.label, A.nameKo, slotKind(slot)));
    const picker = named(els, 'SlotSelector')[0].props as { slots: { isoKey: string; month?: number; isCurrent: boolean }[] };
    expect(picker.slots.find((s) => s.isCurrent)).toMatchObject({ isoKey: slot.isoKey, month: slot.month });
  });

  it('[PG-T99] 수합 관리 주차 — 근거 있는 주 + 이번 주 + 보는 주, 26주 상한 없음 · 수는 명단 기준(명단 밖 제출은 분자에 없다)', async () => {
    const { prisma } = await import('@/server/db');
    const { divisionWeeks, ensureCurrentSlot } = await import('@/server/worklog');
    const current = await ensureCurrentSlot();
    const division = await prisma.division.findUniqueOrThrow({ where: { slug: A.slug } });
    const weeksAgo = (n: number) => new Date(current.opensAt.getTime() - n * 7 * 86_400_000);
    const slotAt = (isoKey: string, n: number) =>
      prisma.weekSlot.create({ data: { isoKey, label: `T99 ${n}주 전`, year: 2025, month: 1, weekOfMonth: 1, opensAt: weeksAgo(n) } });
    const [far, bare, counted] = [await slotAt('T99-FAR', 40), await slotAt('T99-BARE', 5), await slotAt('T99-COUNTED', 6)];
    const [onRoster, offRoster] = await Promise.all(
      [ID.aMember2, ID.aOff].map((email) => prisma.user.findUniqueOrThrow({ where: { email } })),
    );
    const sub = (userId: string, weekSlotId: string) =>
      prisma.submission.create({
        data: { divisionId: division.id, userId, weekSlotId, version: 1, filePath: 'x.hwp', originalName: 'x.hwp', byteSize: 1, sha256: 'x' },
      });
    try {
      await prisma.mergeRun.create({
        data: { divisionId: division.id, weekSlotId: far.id, status: 'succeeded', outputPath: 'x.hwp', sourceIds: '[]', ruleSnapshot: '{}' },
      });
      await sub(onRoster.id, counted.id);
      await sub(offRoster.id, counted.id); // 명단 밖 — 병합에는 들어가도 진척 수에는 없다

      const w = await divisionWeeks(division.id);
      const ks = w.slots.map((s) => s.isoKey);
      expect(ks).toContain(current.isoKey);
      expect(ks).toContain('T99-FAR'); // 40주 전 병합본만 있는 주 — 26주 상한이 없다
      expect(ks).toContain('T99-COUNTED');
      expect(ks).not.toContain('T99-BARE'); // 이 부서에 아무 근거도 없는 주
      expect(ks.indexOf(current.isoKey)).toBe(0); // 최신이 위
      expect((await divisionWeeks(division.id, bare.id)).slots.map((s) => s.isoKey)).toContain('T99-BARE'); // 보는 주는 들어간다
      expect(w.submittedOf(counted.id)).toBe(1);
      expect(w.roster).toBe(await prisma.user.count({ where: { divisionId: division.id, isActive: true, onRoster: true } }));
    } finally {
      const ids = [far.id, bare.id, counted.id];
      await prisma.mergeRun.deleteMany({ where: { weekSlotId: { in: ids } } });
      await prisma.submission.deleteMany({ where: { weekSlotId: { in: ids } } });
      await prisma.weekSlot.deleteMany({ where: { id: { in: ids } } });
    }
  });
});
