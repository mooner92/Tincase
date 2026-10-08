// PG-84 · API-60 · DM-25 — 첫 로그인 **화면 둘러보기**. 권하기 규칙·장·단계·기록 라우트·「실제 동작 없음」을 네트워크 없이 고정한다.
//
// 사용자(2026-10-08): 「처음이시죠? 30초 둘러보기 [시작] [괜찮아요]」 — 방해하지 않게, 한 번만, 새 역할만 다시.
// 이 셋은 눈으로 확인하기 어렵다(한 번 고르면 다시는 안 뜨니 두 번째를 볼 일이 없다). 그래서 규칙을 순수 함수로 떼어 여기서 본다.
// 실제 화면 위의 동작(카드·덮개·inert·도크)은 `node scripts/guide-check.cjs --tour`(PG-T153)가 가짜 앱에서 본다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LABEL_MAX, SAY_MAX, stackedChapters, type GuideCap } from '@/lib/guide/deck';
import {
  chaptersAt,
  labelFromText,
  nextOutcome,
  pickSteps,
  TOUR,
  tourChapters,
  tourOffer,
  tourPath,
  TOUR_VERSION,
} from '@/lib/guide/tour';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-tour-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-tour.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
delete process.env.DEV_IDENTITY;

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('[PG-T148] 둘러보기 장 = 체험하기 장 (같은 쌓기)', () => {
  const cases: GuideCap[][] = [
    ['all'],
    ['all', 'manager'],
    ['all', 'manager', 'head', 'report'],
    ['all', 'manager', 'hq'],
    ['all', 'org', 'orgDesk', 'schedule'],
    ['all', 'manager', 'head', 'report', 'hq', 'org', 'orgDesk', 'schedule'],
  ];
  it('부서원(누구나) → + 부서담당자 → + 실·팀장 → + 본부 · 총괄 — 이야기 순서', () => {
    for (const caps of cases) expect(tourChapters(caps), caps.join(',')).toEqual(stackedChapters(caps));
    expect(tourChapters(['all'])).toEqual(['member']);
    expect(tourChapters(['all', 'manager'])).toEqual(['member', 'lead']);
    expect(tourChapters(['all', 'manager', 'head'])).toEqual(['member', 'lead', 'head']);
    expect(tourChapters(['all', 'org'])).toEqual(['member', 'org']);
    expect(TOUR.map((c) => c.id)).toEqual(['member', 'lead', 'head', 'hq', 'org']);
  });

  it('장의 페이지 — 내 부서 홈·수합 관리·본부 취합·전사 · 지금 페이지의 장', () => {
    expect(tourPath('member', 'Div_A')).toBe('/Div_A');
    expect(tourPath('lead', 'Div_A')).toBe('/Div_A/manage');
    expect(tourPath('head', 'Div_A')).toBe('/Div_A/manage');
    expect(tourPath('hq', 'Div_A')).toBe('/hq');
    expect(tourPath('org', 'Div_A')).toBe('/org');
    expect(chaptersAt('/Div_A/manage', 'Div_A', ['member', 'lead', 'head'])).toEqual(['lead', 'head']);
    expect(chaptersAt('/Div_A', 'Div_A', ['member', 'lead'])).toEqual(['member']);
    expect(chaptersAt('/guide', 'Div_A', ['member', 'lead'])).toEqual([]);
  });
});

describe('[PG-T149] 권하기 — 한 번만, 새 역할만 다시', () => {
  it('기록이 없으면 가진 장 전부를 「처음」으로 — 전에 낸 적이 있으면 「화면이 바뀌었어요」', () => {
    expect(tourOffer(['member', 'lead'], [])).toEqual({ chapters: ['member', 'lead'], kind: 'first', title: '처음이시죠?' });
    expect(tourOffer(['member'], [], { submittedBefore: true })?.title).toBe('화면이 바뀌었어요');
  });

  it('다 기록됐으면 없다 — 「괜찮아요」(dismissed)도 기록이다', () => {
    expect(tourOffer(['member'], [{ chapter: 'member', outcome: 'dismissed' }])).toBeNull();
    expect(tourOffer(['member', 'lead'], [{ chapter: 'member', outcome: 'done' }, { chapter: 'lead', outcome: 'skipped' }])).toBeNull();
    expect(tourOffer(['member'], [{ chapter: 'member', outcome: 'started' }])).toBeNull();
  });

  it('담당자가 된 부서원 — 부서원 기록만 있으면 부서담당자 장 하나를 「새 역할」로', () => {
    const o = tourOffer(['member', 'lead'], [{ chapter: 'member', outcome: 'dismissed' }]);
    expect(o).toEqual({ chapters: ['lead'], kind: 'new-role', title: '[수합 관리]가 생겼어요' });
    // 둘 이상 새로 생기면 이야기 순서의 첫 장 문구
    expect(tourOffer(['member', 'lead', 'head'], [{ chapter: 'member', outcome: 'done' }])?.title).toBe('[수합 관리]가 생겼어요');
    expect(tourOffer(['member', 'org'], [{ chapter: 'member', outcome: 'done' }])?.title).toBe('[전사]가 생겼어요');
  });

  it('역할이 빠진 장의 기록은 상관없다 · 판이 낡은 기록은 다시 권한다', () => {
    expect(tourOffer(['member'], [{ chapter: 'member', outcome: 'done' }, { chapter: 'lead', outcome: 'done' }])).toBeNull();
    expect(tourOffer(['member'], [{ chapter: 'member', outcome: 'done', version: TOUR_VERSION - 1 }])?.kind).toBe('first');
  });

  it('기록 덮어쓰기 — done은 끝, 나머지는 마지막 것', () => {
    expect(nextOutcome('done', 'skipped')).toBe('done');
    expect(nextOutcome('done', 'dismissed')).toBe('done');
    expect(nextOutcome('dismissed', 'done')).toBe('done');
    expect(nextOutcome('started', 'skipped')).toBe('skipped');
    expect(nextOutcome(null, 'started')).toBe('started');
  });
});

describe('[PG-T150] 둘러보기 표 — 장마다 3~5단계 · 「이름: 한 문장」 · 앵커는 지금 화면에 있다', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
    });
  const anchors = new Set<string>();
  for (const file of walk(path.join(ROOT, 'src'))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('data-guide')) continue;
      for (const m of line.matchAll(/["']([a-z0-9-]+)["']/g)) anchors.add(m[1]);
    }
  }

  it('장마다 3~5단계, 이름 13자 · 문장 30자 · 해요체 · 생각 하나', () => {
    for (const c of TOUR) {
      expect(c.steps.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.steps.length, c.id).toBeLessThanOrEqual(5);
      for (const s of c.steps) {
        const id = `${c.id}/${s.anchor}`;
        expect([...s.label].length, id).toBeLessThanOrEqual(LABEL_MAX);
        expect([...s.say].length, id).toBeLessThanOrEqual(SAY_MAX);
        expect(s.say, id).toMatch(/요$/);
        expect(s.say, id).not.toMatch(/—|\[|\]|습니다/);
      }
    }
  });

  it('앵커가 src/**/*.tsx에 있다 — 둘러보기는 새 앵커를 만들지 않는다(그려진 것만 짚는다)', () => {
    const wanted = TOUR.flatMap((c) => c.steps.map((s) => s.anchor));
    expect(wanted.filter((a) => !anchors.has(a))).toEqual([]);
  });

  it('작성 드로어 안(붙여넣기·공유·제출)은 넣지 않는다 — 드로어를 여는 것도 「실제 동작」이다', () => {
    const wanted = TOUR.flatMap((c) => c.steps.map((s) => s.anchor));
    for (const a of ['compose-first', 'compose-share', 'compose-submit', 'merged-cell', 'merged-save']) expect(wanted).not.toContain(a);
  });

  it('없는 앵커는 조용히 건너뛴다 · 앵커 글자를 머리로 쓸 때는 첫 줄 13자까지', () => {
    const steps = TOUR.find((c) => c.id === 'lead')!.steps;
    expect(pickSteps(steps, (a) => a !== 'merge-ready').map((s) => s.anchor)).toEqual(['status-card', 'copy-missing', 'merged-open', 'report-unit-submit']);
    expect(labelFromText('미제출 4명 이름 복사', '이름 복사')).toBe('미제출 4명 이름 복사');
    expect(labelFromText('10월 2주차\n미제출\n마감 10월 15일', '이번 주')).toBe('10월 2주차');
    expect(labelFromText('', '작성하기')).toBe('작성하기');
    expect(labelFromText('아주 길어서 열세 글자를 넘는 단추 이름', '대신')).toBe('대신');
  });
});

describe('[PG-T152] 실제 동작은 일어나지 않는다 — 소스로 지키는 것', () => {
  const tour = read('src/components/Tour.tsx');

  it('둘러보기 파일은 화면을 누르지 않는다 — .click(·dispatchEvent( 없음, 요청은 /api/me/tour 하나', () => {
    expect(tour).not.toMatch(/\.click\(/);
    expect(tour).not.toMatch(/dispatchEvent\(/);
    const apis = [...tour.matchAll(/['"`](\/api\/[^'"`?]+)/g)].map((m) => m[1]);
    expect([...new Set(apis)]).toEqual(['/api/me/tour']);
    expect(tour).not.toMatch(/method:\s*'(PUT|DELETE|PATCH)'/);
  });

  it('덮개는 나머지 body 자식에 inert를 걸고 끝나면 되돌린다 · 스크롤을 잠갔다 푼다', () => {
    expect(tour).toMatch(/\.inert = true/);
    expect(tour).toMatch(/\.inert = was/);
    expect(tour).toMatch(/html\.style\.overflow = 'hidden'/);
    expect(tour).toMatch(/html\.style\.overflow = before/);
    expect(tour).toMatch(/role="dialog"/);
    expect(tour).toMatch(/aria-modal="true"/);
  });

  it('구멍은 누를 수 없다 — 덮개를 누르면 고리만 다시 퍼진다(hint), 손은 그리지 않는다', () => {
    const overlay = tour.slice(tour.indexOf('function TourOverlay'));
    expect(overlay).toMatch(/onClick=\{\(\) => setHint\(\(h\) => h \+ 1\)\}/);
    expect(overlay).not.toMatch(/coach-hit|<Hand|coach-hand/);
    expect(overlay).toMatch(/pointer-events-none absolute/);
  });

  it('카드는 초점을 가져가지 않고 드로어(aria-modal)가 있는 동안 숨는다', () => {
    const offer = tour.slice(tour.indexOf('function TourOffer'), tour.indexOf('interface Placed'));
    expect(offer).not.toMatch(/autoFocus|\.focus\(/);
    expect(offer).toMatch(/aria-modal="true"/);
    expect(offer).toMatch(/role="region"/);
  });

  it('머리를 그리는 여섯 곳이 모두 tour를 넘긴다 — 한 곳이라도 빠지면 그 화면에서 카드·메뉴가 없다', () => {
    const sites = [
      'src/app/[division]/layout.tsx',
      'src/app/guide/page.tsx',
      'src/app/hq/page.tsx',
      'src/app/org/page.tsx',
      'src/app/ops/page.tsx',
      'src/app/ops/audit/page.tsx',
    ];
    for (const f of sites) {
      const src = read(f);
      expect(src, f).toMatch(/<AppHeader/);
      expect(src, f).toMatch(/tour=\{/);
      expect(src, f).toMatch(/getTour\(/);
    }
    // 발표 화면에는 머리가 없다 — 카드가 뜨지 않는다
    expect(read('src/app/guide/present/page.tsx')).not.toMatch(/<AppHeader|getTour\(/);
  });

  it('[TACP-12] 권할지는 authz.ts의 판정 — 컴포넌트·라우트가 역할 플래그를 보지 않는다', () => {
    expect(read('src/server/authz.ts')).toMatch(/export function tourEligible\(/);
    for (const f of ['src/server/tour.ts', 'src/app/api/me/tour/route.ts', 'src/components/Tour.tsx']) {
      expect(read(f), f).not.toMatch(/\.isOperator\b|\.isCoordinator\b|divisionRole\s*===|\.isHead\b|\.isLead\b/);
    }
  });
});

// ── 기록 라우트 (API-60) — 새 Resource의 격리 시험 (TACP v1.12 노트 · §7 PG-T151) ──
const ID = {
  member: 'tour-m@test.kei.re.kr',
  lead: 'tour-l@test.kei.re.kr',
  other: 'tour-o@test.kei.re.kr',
  op: 'tour-op@test.kei.re.kr',
};

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
async function post(identity: string | undefined, body: unknown) {
  const { POST } = await import('@/app/api/me/tour/route');
  return POST(nx('/api/me/tour', identity, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

beforeAll(async () => {
  rmSync(path.join(ROOT, 'prisma/test-tour.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const a = await prisma.division.create({ data: { slug: 'Tour_A', nameKo: '둘러보기실', nameEn: 'Tour_A', isActive: true } });
  await prisma.user.create({ data: { email: ID.member, name: 'm', divisionId: a.id } });
  await prisma.user.create({ data: { email: ID.lead, name: 'l', divisionId: a.id, divisionRole: 'lead' } });
  await prisma.user.create({ data: { email: ID.other, name: 'o', divisionId: a.id } });
  await prisma.user.create({ data: { email: ID.op, name: 'op', divisionId: a.id, isOperator: true } });
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('[PG-T151] POST /api/me/tour — 내 줄만', () => {
  it('로그인 없음 401 · 모르는 장·결과·빈 목록 422', async () => {
    expect((await post(undefined, { chapters: ['member'], outcome: 'done' })).status).toBe(401);
    expect((await post(ID.member, { chapters: ['ops'], outcome: 'done' })).status).toBe(422);
    expect((await post(ID.member, { chapters: ['member'], outcome: 'seen' })).status).toBe(422);
    expect((await post(ID.member, { chapters: [], outcome: 'done' })).status).toBe(422);
    expect((await post(ID.member, { chapters: ['member', 'lead', 'head', 'hq', 'org', 'member'], outcome: 'done' })).status).toBe(422);
  });

  it('★ 본문에 남의 userId를 실어도 세션의 사람 줄만 생긴다 · 가지지 않은 장은 조용히 뺀다', async () => {
    const { prisma } = await import('@/server/db');
    const other = await prisma.user.findUniqueOrThrow({ where: { email: ID.other } });
    const res = await post(ID.member, { chapters: ['member', 'lead'], outcome: 'dismissed', userId: other.id });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.seen).toEqual([{ chapter: 'member', outcome: 'dismissed' }]); // 부서원에게 부서담당자 장은 없다
    expect(await prisma.guideTourSeen.count({ where: { userId: other.id } })).toBe(0);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ID.member } });
    expect(await prisma.guideTourSeen.count({ where: { userId: me.id } })).toBe(1);
  });

  it('done은 끝 — 뒤의 skipped로 바뀌지 않는다 · 두 번 보내도 한 줄', async () => {
    const { prisma } = await import('@/server/db');
    const lead = await prisma.user.findUniqueOrThrow({ where: { email: ID.lead } });
    await post(ID.lead, { chapters: ['member', 'lead'], outcome: 'started' });
    await post(ID.lead, { chapters: ['member'], outcome: 'done' });
    await post(ID.lead, { chapters: ['member', 'lead'], outcome: 'skipped' });
    await post(ID.lead, { chapters: ['member', 'lead'], outcome: 'skipped' });
    const rows = await prisma.guideTourSeen.findMany({ where: { userId: lead.id }, orderBy: { chapter: 'asc' } });
    expect(rows.map((r) => `${r.chapter}:${r.outcome}`)).toEqual(['lead:skipped', 'member:done']);
    expect(rows.every((r) => r.version === TOUR_VERSION)).toBe(true);
  });

  it('제안 — 기록이 생기면 권하지 않고, 운영자·남의 부서 열람에게는 처음부터 권하지 않는다(장 목록은 준다)', async () => {
    const { requireScope } = await import('@/server/authz');
    const { getTour } = await import('@/server/tour');
    const scopeOf = (id: string) => requireScope(new Headers({ 'x-test-identity': id }));
    // 부서원은 「괜찮아요」를 골랐다 — 다시 권하지 않는다
    expect((await getTour(await scopeOf(ID.member), false)).offer).toBeNull();
    // 아직 고르지 않은 사람 — 처음
    const other = await getTour(await scopeOf(ID.other), false);
    expect(other.offer).toEqual({ chapters: ['member'], kind: 'first', title: '처음이시죠?' });
    expect(other.slug).toBe('Tour_A');
    // 남의 부서를 보는 중 · 운영자 — 카드 없음, 메뉴용 장은 있다
    expect((await getTour(await scopeOf(ID.other), true)).offer).toBeNull();
    const op = await getTour(await scopeOf(ID.op), false);
    expect(op.offer).toBeNull();
    expect(op.chapters.length).toBeGreaterThan(0);
  });
});
