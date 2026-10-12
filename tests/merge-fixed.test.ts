// HM-51 — 병합은 고정값으로 돈다 (2026-10-08 · ADR-0018). 옛 설정이 DB 열에 남아 있어도 엔진은 읽지 않는다.
//
// 가장 중요한 것은 **지금 운영 중인 부서의 병합본이 바뀌지 않는 것**이다 — 실제 부서는 모두 기본값이었다.
// 그래서 옛 설정(일자 순·날짜 없는 줄 앞·묶기 끔·3번 표 유지·지침)을 박아 둔 부서도 기본값 문서와 **바이트까지 같아야** 한다.
// (이 틀은 지운 HM-48 시험 `merge-sort.test.ts`의 것을 이어받았다 — 기대 순서로 조립한 문서와 바이트 비교)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-fixed-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-fixed.db';
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
  lead: 'f-lead@test.kei.re.kr',
  member: 'f-member@test.kei.re.kr',
};
const DIV_NAME = '고정실';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}

type Cell = [content: string, date: string];
/*
 * 두 사람의 제출 — 날짜가 섞여 있어 일자 순이면 순서가 달라지고, 「보도자료 배포」는 둘이 같이 적어
 * 묶기를 끄면 줄이 하나 늘어난다. 옛 설정이 조금이라도 먹으면 바이트가 달라지게 골랐다.
 */
const FIRST: Record<'achievements' | 'plans' | 'notes', Cell[]> = {
  achievements: [
    ['정기간행물 발간', '9/30(수)'],
    ['홈페이지 운영', '상시'],
    ['포럼 개최', '9/24 14:00'],
    ['보도자료 배포', ''],
  ],
  plans: [
    ['정례 회의', '10/2(금)'],
    ['월간 보고 작성', '계속'],
  ],
  notes: [],
};
const SECOND: typeof FIRST = {
  achievements: [
    ['위원회 참석', '9/24 10:00'],
    ['보도자료 배포', '9/22'],
  ],
  plans: [['워크숍 개최', '9/30, 10/1']],
  notes: [],
};

/** 표 하나의 기대 행 — 채번은 조립이 다시 매기는 그대로 (ABS-5) */
const table = (prefix: number, cells: Cell[]) => cells.map(([c, dt], i) => [`${prefix}-${i + 1}`, c, dt, '', '']);

/** 고정값의 병합 — 제출자 순, 각자 적은 순서. 묶인 줄은 첫 자리에 한 번, 일자는 둘째 사람 것(HM-40). 빈 3번 표는 비운다 */
const FIXED_ORDER = {
  achievements: table(1, [
    ['정기간행물 발간', '9/30(수)'],
    ['홈페이지 운영', '상시'],
    ['포럼 개최', '9/24 14:00'],
    ['보도자료 배포', '9/22'],
    ['위원회 참석', '9/24 10:00'],
  ]),
  plans: table(2, [
    ['정례 회의', '10/2(금)'],
    ['월간 보고 작성', '계속'],
    ['워크숍 개최', '9/30, 10/1'],
  ]),
  notes: [],
};

let tpl: Buffer;
let divId = '';
let slotId = '';

async function composed(): Promise<Buffer> {
  const { composeMergedHwp } = await import('@/server/merge');
  return composeMergedHwp(tpl, FIXED_ORDER, undefined, DIV_NAME).bytes;
}

async function mergeNow() {
  const { runMergeRecorded } = await import('@/server/merge/run');
  const { readStoredFile } = await import('@/server/storage');
  const { prisma } = await import('@/server/db');
  const r = await runMergeRecorded(divId, slotId, 'manual');
  expect(r.errorText).toBeNull();
  const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: r.runId } });
  return { bytes: await readStoredFile(r.outcome!.outputRelPath), snapshot: JSON.parse(run.ruleSnapshot), outcome: r.outcome! };
}

beforeAll(async () => {
  if (!hasFixtures) return;
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-fixed.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { composeMergedHwp } = await import('@/server/merge');

  tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  // 기본값으로 만든다 — 분류 순서를 적지 않은 부서 (지금 운영 중인 거의 모든 부서)
  const div = await prisma.division.create({ data: { slug: 'Fixed_A', nameKo: DIV_NAME, nameEn: 'Fixed_A', isActive: true } });
  divId = div.id;
  await writeFileAtomic('divisions/Fixed_A/template/active.hwp', tpl);
  await prisma.template.create({
    data: { divisionId: div.id, filePath: 'divisions/Fixed_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' },
  });
  // 연도 넘김이 없는 9월 주로 고정한다 — 테스트가 언제 돌든 같은 결과
  const slot = await prisma.weekSlot.create({
    data: { isoKey: '2026-W40', label: '9월 5주차', year: 2026, month: 9, weekOfMonth: 5, opensAt: new Date('2026-09-27T15:00:00Z') },
  });
  slotId = slot.id;

  const people: [string, number, typeof FIRST, object][] = [
    [ID.lead, 1, FIRST, { divisionRole: 'lead' }],
    [ID.member, 2, SECOND, {}],
  ];
  for (const [email, sortOrder, rows, extra] of people) {
    const user = await prisma.user.create({ data: { email, name: email.split('@')[0], divisionId: div.id, sortOrder, ...extra } });
    const bytes = composeMergedHwp(tpl, {
      achievements: table(1, rows.achievements),
      plans: table(2, rows.plans),
      notes: table(3, rows.notes),
    }).bytes;
    const rel = `divisions/Fixed_A/submissions/${sortOrder}.hwp`;
    await writeFileAtomic(rel, bytes);
    await prisma.submission.create({
      data: {
        divisionId: div.id,
        userId: user.id,
        weekSlotId: slot.id,
        version: 1,
        filePath: rel,
        originalName: `${sortOrder}.hwp`,
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
  }
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

d('HM-51 고정값 병합 — 옛 설정 열은 읽지 않는다', () => {
  it('[HM-T147] ★ 기본값 부서 — 제출자 순 · 묶기 켬 · 빈 3번 표 비움, 스냅샷은 분류 순서뿐', async () => {
    const { bytes, snapshot } = await mergeNow();
    expect(bytes.equals(await composed())).toBe(true);
    // DM-13 — 부서가 고르는 것이 분류 순서 하나라 그것만 박제한다. 옛 키(sort·dedupe·guidance …)는 없다
    expect(snapshot).toEqual({ trigger: 'manual', categories: '' });
  });

  it('[HM-T147] ★ 옛 설정(일자 순·날짜 없는 줄 앞·묶기 끔·3번 표 유지·지침·공유 낱말 끔)이 DB에 남아도 같은 문서', async () => {
    const { prisma } = await import('@/server/db');
    await prisma.division.update({
      where: { id: divId },
      data: {
        mergeSort: 'date',
        mergeUndated: 'first',
        mergeDedupe: false,
        mergeDropNotes: false,
        mergeRuleText: '도서관 업무는 맨 뒤로',
        emphasisWords: '',
      },
    });
    const { bytes, outcome } = await mergeNow();
    expect(bytes.equals(await composed())).toBe(true);
    // 묶기가 늘 켜져 있다 — 「보도자료 배포」 두 줄이 한 줄로
    expect(outcome.rowCounts).toEqual({ achievements: 5, plans: 3, notes: 0 });
  });

  it('[HM-T147] 저장 API도 옛 키를 읽지 않는다 — 열은 그대로, 분류 순서만 바뀐다 (API-59)', async () => {
    const { PUT } = await import('@/app/api/division/rule/route');
    const { prisma } = await import('@/server/db');
    const before = await prisma.division.findUniqueOrThrow({ where: { id: divId } });
    const res = await PUT(
      nx('/api/division/rule', ID.lead, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: '', sort: 'input', dedupe: true, ruleText: '', guideText: '바뀌면 안 됨', emptyWords: '바뀌면 안 됨' }),
      }),
    );
    expect(res.status).toBe(200);
    const after = await prisma.division.findUniqueOrThrow({ where: { id: divId } });
    for (const col of ['mergeSort', 'mergeUndated', 'mergeDedupe', 'mergeDropNotes', 'mergeRuleText', 'guideText', 'emptyWords', 'emphasisWords'] as const) {
      expect(after[col], col).toEqual(before[col]);
    }
  });
});
