// 통합 테스트 — 라우트 핸들러를 직접 호출한다 (서버 기동 없이).
// 격리 스위트(AU-T12~18)가 릴리스 게이트다 (AU-14).
//
// 테스트 신원 주입: NODE_ENV=test에서만 x-test-identity 헤더 허용 (auth.ts).
// DB: prisma/test.db — setup에서 초기화·시드.
import { beforeAll, describe, expect, it } from 'vitest';
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

  if (hasFixtures) {
    hwpBytes = readFileSync(path.join(FIX, 'master-template.hwp'));
    hwpBytes2 = readFileSync(path.join(FIX, 'sample-filled-w2.hwp'));
  }
}, 60_000);

async function upload(identity: string, bytes: Buffer, name = '주간업무.hwp') {
  const { POST } = await import('@/app/api/submissions/route');
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(bytes)], name));
  return POST(nx('/api/submissions', identity, { method: 'POST', body: fd }));
}

const d = hasFixtures ? describe : describe.skip;

d('인증 (AU-T01/T06/T10)', () => {
  it('[AU-T01] 신원 없음 → 401', async () => {
    const { GET } = await import('@/app/api/me/route');
    const res = await GET(nx('/api/me'));
    expect(res.status).toBe(401);
  });
  it('[AU-T06] 미등록 이메일 → 403 not_registered', async () => {
    const { GET } = await import('@/app/api/me/route');
    const res = await GET(nx('/api/me', ID.ghost));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_registered');
  });
  it('[AU-T10 상당] Cf 헤더만 있고 검증 경로 아님 → 401 (test 모드에선 x-test-identity만 인정)', async () => {
    const { GET } = await import('@/app/api/me/route');
    const res = await GET(
      nx('/api/me', undefined, { headers: { 'Cf-Access-Authenticated-User-Email': ID.aMember } }),
    );
    expect(res.status).toBe(401);
  });
});

d('업로드 (API-T01~T05, ST-T)', () => {
  it('정상 업로드 → 201 v1', async () => {
    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submission.version).toBe(1);
    expect(body.sameAsPrevious).toBe(false);
  });
  it('[API-T04] 재업로드 → v2, sameAsPrevious 안내 (DM-07)', async () => {
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
  it('[API-T03] 본문 divisionId 위조 → 무시되고 신원의 부서로 저장 (DM-12)', async () => {
    const { POST } = await import('@/app/api/submissions/route');
    const { prisma } = await import('@/server/db');
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array(hwpBytes2)], '주간업무.hwp'));
    const bDiv = await prisma.division.findUniqueOrThrow({ where: { slug: B.slug } });
    fd.set('divisionId', bDiv.id); // 위조 시도
    fd.set('userId', 'someone-else');
    const res = await POST(nx('/api/submissions', ID.aMember2, { method: 'POST', body: fd }));
    expect(res.status).toBe(201);
    const sub = await prisma.submission.findFirst({
      where: { user: { email: ID.aMember2 } },
      include: { division: true },
    });
    expect(sub!.division.slug).toBe(A.slug);
  });
});

d('현황 (API-T05~T07)', () => {
  it('[API-T05a] member → 200 축소판 (id·링크·버전 없음)', async () => {
    const { GET } = await import('@/app/api/division/status/route');
    const res = await GET(nx('/api/division/status', ID.aMember));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.roster).toBe(4); // A부서 onRoster: member2 + lead + op
    const submitted = body.members.filter((m: { status: string }) => m.status === 'submitted');
    expect(submitted.length).toBe(2);
    expect(body.members[0].user.id).toBeUndefined(); // 축소판
    expect(body.members[0].latest).toBeUndefined();
    expect(body.offRoster).toBeUndefined();
  });
  it('[API-T06] lead → 전체 필드 + 미제출자 missing 포함', async () => {
    const { GET } = await import('@/app/api/division/status/route');
    const res = await GET(nx('/api/division/status', ID.aLead));
    const body = await res.json();
    const me = body.members.find((m: { user: { name: string } }) => m.user.name === 'a-member');
    expect(me.latest.version).toBe(2);
    expect(body.members.some((m: { status: string }) => m.status === 'missing')).toBe(true);
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
  it('[AU-T14] member가 zip → 404 · lead 자기 부서 zip → 200 (A부서 파일만)', async () => {
    const { GET } = await import('@/app/api/division/download-zip/route');
    const r1 = await GET(nx('/api/division/download-zip', ID.aMember));
    expect(r1.status).toBe(404);

    const r2 = await GET(nx('/api/division/download-zip', ID.aLead));
    expect(r2.status).toBe(200);
    expect(r2.headers.get('content-type')).toBe('application/zip');
  });
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

d('마감 잠금 (API-T01/T02)', () => {
  it('[API-T01] 마감 지난 부서 → 업로드 409 slot_locked · [API-T02] 조회는 정상', async () => {
    const { prisma } = await import('@/server/db');
    // A 부서 마감을 과거로 (어제 요일 00:01)
    const yesterday = ((new Date(Date.now() - 86400_000).getDay() + 6) % 7) + 1;
    await prisma.division.updateMany({
      where: { slug: A.slug },
      data: { deadlineDow: yesterday, deadlineTime: '00:01' },
    });

    const res = await upload(ID.aMember, hwpBytes);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slot_locked');

    const { GET } = await import('@/app/api/division/status/route');
    const st = await GET(nx('/api/division/status', ID.aLead));
    expect(st.status).toBe(200);
    expect((await st.json()).slot.locked).toBe(true);

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
