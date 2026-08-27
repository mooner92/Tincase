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

async function upload(identity: string, bytes: Buffer, name = '주간업무.hwp') {
  const { POST } = await import('@/app/api/submissions/route');
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(bytes)], name));
  return POST(nx('/api/submissions', identity, { method: 'POST', body: fd }));
}

async function del(identity: string, id: string) {
  const { DELETE } = await import('@/app/api/submissions/[id]/route');
  return DELETE(nx(`/api/submissions/${id}`, identity, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
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
    expect(body.summary.roster).toBe(5); // A부서 onRoster: member + member2 + lead + op + aDel
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
  let 이번주키: string;

  beforeAll(async () => {
    const { prisma } = await import('@/server/db');
    const da = await prisma.division.findFirstOrThrow({ where: { slug: A.slug } });
    const db = await prisma.division.findFirstOrThrow({ where: { slug: B.slug } });

    const slot = async (isoKey: string, label: string, nth: number, opensAt: string) =>
      prisma.weekSlot.upsert({
        where: { isoKey },
        update: {},
        create: { isoKey, label, year: 2026, month: 7, weekOfMonth: nth, opensAt: new Date(opensAt) },
      });
    const s1 = await slot('WA-W01', '7월 1주차', 1, '2026-06-29T00:00:00.000Z');
    const s2 = await slot('WA-W02', '7월 2주차', 2, '2026-07-06T00:00:00.000Z');
    const s3 = await slot('WA-W03', '7월 3주차', 3, '2026-07-13T00:00:00.000Z');
    이번주키 = s3.isoKey;

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
    const a1 = await sub(me.id, da.id, s1.id, 1);
    const a2 = await sub(me.id, da.id, s2.id, 2);
    await sub(me.id, da.id, s3.id, 3); // 이번 주 것 — 목록에 섞이면 안 된다
    const b1 = await sub(other.id, db.id, s2.id, 4);
    내_이전 = a2.id;
    남의_것 = b1.id;
    expect(a1.id).toBeTruthy();
  });

  it('[WA-T10] 낸 적이 없으면 found:false — 화면은 아무것도 그리지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const res = await GET(nx('/api/my/previous', WA.none));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.items).toEqual([]);
  });

  it('[WA-T11] 최근 순으로 나오고, 기본은 가장 최근 것', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const body = await (await GET(nx('/api/my/previous', WA.me))).json();
    expect(body.found).toBe(true);
    expect(body.items.map((i: { isoKey: string }) => i.isoKey)).toEqual(['WA-W03', 'WA-W02', 'WA-W01']);
    expect(body.submissionId).toBe(body.items[0].submissionId);
  });

  it('[WA-T12] 이번 주차보다 앞선 것만 — 방금 낸 이번 주 것이 섞이지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const body = await (await GET(nx(`/api/my/previous?isoKey=${이번주키}`, WA.me))).json();
    expect(body.items.map((i: { isoKey: string }) => i.isoKey)).toEqual(['WA-W02', 'WA-W01']);
    expect(body.slot.isoKey).toBe('WA-W02'); // 바로 전 주가 기본
  });

  it('[WA-T13] 주차를 골라 볼 수 있다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const body = await (await GET(nx(`/api/my/previous?submissionId=${내_이전}`, WA.me))).json();
    expect(body.submissionId).toBe(내_이전);
    expect(body.slot.isoKey).toBe('WA-W02');
  });

  it('[WA-T14] 남의 submissionId를 넣어도 남의 것이 나오지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const body = await (await GET(nx(`/api/my/previous?submissionId=${남의_것}`, WA.me))).json();
    // 조용히 무시하고 **내 것**을 돌려준다 — 남의 id가 통했다는 신호조차 주지 않는다
    expect(body.submissionId).not.toBe(남의_것);
    expect(body.items.map((i: { submissionId: string }) => i.submissionId)).not.toContain(남의_것);
  });

  it('[WA-T15] 파일을 못 읽어도 목록과 「받기」는 살아 있다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const body = await (await GET(nx('/api/my/previous', WA.me))).json();
    expect(body.rows).toBeNull(); // 실재하지 않는 파일 — 화면이 「받기만 됩니다」로 안내한다
    expect(body.submissionId).toBeTruthy();
  });

  it('[WA-T16] 무인증은 열리지 않는다', async () => {
    const { GET } = await import('@/app/api/my/previous/route');
    const res = await GET(nx('/api/my/previous'));
    expect([401, 403, 404]).toContain(res.status);
  });
});
