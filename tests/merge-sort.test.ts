// HM-48 — 일자 순 정렬, 병합 끝에서 끝까지.
//
// 가장 중요한 것은 **고르지 않은 부서가 아무것도 모르게 지나가는 것**이다(HM-T125).
// 일자 순을 고른 부서는 표 셋(실적·계획·특이) 모두 일자 순이 되고, 날짜 없는 줄은 고른 쪽에 모인다.
// 비교는 바이트로 한다 — 같은 행을 같은 순서로 조립한 문서와 똑같아야 한다 (채번 ABS-5 포함).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-sort-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-sort.db';
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
  lead: 's-lead@test.kei.re.kr',
  member: 's-member@test.kei.re.kr',
};
const DIV_NAME = '정렬실';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const putRule = async (identity: string, body: object) => {
  const { PUT } = await import('@/app/api/division/rule/route');
  return PUT(
    nx('/api/division/rule', identity, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

type Cell = [content: string, date: string];
/*
 * 두 사람의 제출 — 실제 보고서 꼴(요일·시각·기한·기간·상시·「-」)을 섞었다.
 * 「보도자료 배포」는 둘이 같이 적었고 일자는 둘째 사람만 적었다 — 묶인 줄의 일자는
 * 묶음 전체에서 모은 것(HM-40)이고, 일자 순은 그 일자로 놓아야 한다.
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
  notes: [['시스템 점검 예정', '10/5']],
};
const SECOND: typeof FIRST = {
  achievements: [
    ['위원회 참석', '9/24 10:00'],
    ['보도자료 배포', '9/22'],
    ['설문 분석', '~9/25'],
    ['데이터 집계', '-'],
  ],
  plans: [
    ['워크숍 개최', '9/30, 10/1'],
    ['예산 검토', ''],
  ],
  notes: [['정전 안내', '10/1']],
};

/** 표 하나의 기대 행 — 채번은 조립이 다시 매기는 그대로 (ABS-5) */
const table = (prefix: number, cells: Cell[]) => cells.map(([c, dt], i) => [`${prefix}-${i + 1}`, c, dt, '', '']);

/** 지금까지의 병합 — 제출자 순, 각자 적은 순서. 묶인 줄은 첫 자리에 한 번, 일자는 둘째 사람 것 */
const INPUT_ORDER = {
  achievements: table(1, [
    ['정기간행물 발간', '9/30(수)'],
    ['홈페이지 운영', '상시'],
    ['포럼 개최', '9/24 14:00'],
    ['보도자료 배포', '9/22'],
    ['위원회 참석', '9/24 10:00'],
    ['설문 분석', '~9/25'],
    ['데이터 집계', '-'],
  ]),
  plans: table(2, [
    ['정례 회의', '10/2(금)'],
    ['월간 보고 작성', '계속'],
    ['워크숍 개최', '9/30, 10/1'],
    ['예산 검토', ''],
  ]),
  notes: table(3, [
    ['시스템 점검 예정', '10/5'],
    ['정전 안내', '10/1'],
  ]),
};
const DATE_UNDATED_LAST = {
  achievements: table(1, [
    ['보도자료 배포', '9/22'],
    ['위원회 참석', '9/24 10:00'],
    ['포럼 개최', '9/24 14:00'],
    ['설문 분석', '~9/25'],
    ['정기간행물 발간', '9/30(수)'],
    ['홈페이지 운영', '상시'],
    ['데이터 집계', '-'],
  ]),
  plans: table(2, [
    ['워크숍 개최', '9/30, 10/1'],
    ['정례 회의', '10/2(금)'],
    ['월간 보고 작성', '계속'],
    ['예산 검토', ''],
  ]),
  notes: table(3, [
    ['정전 안내', '10/1'],
    ['시스템 점검 예정', '10/5'],
  ]),
};
const DATE_UNDATED_FIRST = {
  achievements: table(1, [
    ['홈페이지 운영', '상시'],
    ['데이터 집계', '-'],
    ['보도자료 배포', '9/22'],
    ['위원회 참석', '9/24 10:00'],
    ['포럼 개최', '9/24 14:00'],
    ['설문 분석', '~9/25'],
    ['정기간행물 발간', '9/30(수)'],
  ]),
  plans: table(2, [
    ['월간 보고 작성', '계속'],
    ['예산 검토', ''],
    ['워크숍 개최', '9/30, 10/1'],
    ['정례 회의', '10/2(금)'],
  ]),
  notes: DATE_UNDATED_LAST.notes,
};

let tpl: Buffer;
let divId = '';
let slotId = '';

/** 기대 순서대로 조립한 문서 — 병합 결과가 이것과 바이트까지 같아야 한다 */
async function composed(rows: typeof INPUT_ORDER): Promise<Buffer> {
  const { composeMergedHwp } = await import('@/server/merge');
  return composeMergedHwp(tpl, rows, undefined, DIV_NAME).bytes;
}

async function mergeNow() {
  const { runMergeRecorded } = await import('@/server/merge/run');
  const { readStoredFile } = await import('@/server/storage');
  const { prisma } = await import('@/server/db');
  const r = await runMergeRecorded(divId, slotId, 'manual');
  expect(r.errorText).toBeNull();
  const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: r.runId } });
  return { bytes: await readStoredFile(r.outcome!.outputRelPath), snapshot: JSON.parse(run.ruleSnapshot) };
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-sort.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const { prisma } = await import('@/server/db');
  const { writeFileAtomic } = await import('@/server/storage');
  const { composeMergedHwp } = await import('@/server/merge');

  tpl = readFileSync(path.join(FIX, 'master-template.hwp'));
  // 기본값으로 만든다 — 정렬 설정을 한 번도 건드리지 않은 부서 (지금 운영 중인 모든 부서)
  const div = await prisma.division.create({ data: { slug: 'Sort_A', nameKo: DIV_NAME, nameEn: 'Sort_A', isActive: true } });
  divId = div.id;
  await writeFileAtomic('divisions/Sort_A/template/active.hwp', tpl);
  await prisma.template.create({
    data: { divisionId: div.id, filePath: 'divisions/Sort_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' },
  });

  // 연도 넘김이 없는 9월 주로 고정한다 — 테스트가 언제 돌든 같은 결과 (HM-48 연도 넘김은 단위 테스트가 본다)
  const slot = await prisma.weekSlot.create({
    data: {
      isoKey: '2026-W40',
      label: '9월 5주차',
      year: 2026,
      month: 9,
      weekOfMonth: 5,
      opensAt: new Date('2026-09-27T15:00:00Z'),
    },
  });
  slotId = slot.id;

  const people: [string, number, typeof FIRST, object][] = [
    [ID.lead, 1, FIRST, { divisionRole: 'lead' }],
    [ID.member, 2, SECOND, {}],
  ];
  for (const [email, sortOrder, rows, extra] of people) {
    const user = await prisma.user.create({
      data: { email, name: email.split('@')[0], divisionId: div.id, sortOrder, ...extra },
    });
    const bytes = composeMergedHwp(tpl, {
      achievements: table(1, rows.achievements),
      plans: table(2, rows.plans),
      notes: table(3, rows.notes),
    }).bytes;
    const rel = `divisions/Sort_A/submissions/${sortOrder}.hwp`;
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

d('HM-48 일자 순 정렬 — 병합 끝에서 끝까지', () => {
  it('[HM-T125] ★ 고르지 않은 부서는 지금까지와 바이트까지 같다 (기본값 input)', async () => {
    const { bytes, snapshot } = await mergeNow();
    expect(bytes.equals(await composed(INPUT_ORDER))).toBe(true);
    // DM-13 — 기본값도 박제된다. 「그때는 제출자 순이었다」가 남아야 한다
    expect(snapshot).toMatchObject({ sort: 'input', undated: 'last' });
  });

  it('[HM-T131] 일자 순 — 표 셋 모두, 날짜 없는 줄은 뒤, 묶인 줄은 묶음의 일자로', async () => {
    const res = await putRule(ID.lead, { sort: 'date' });
    expect(res.status).toBe(200);
    // 규칙 GET은 지웠다(R2) — 엔진이 읽는 해석(`toPlan`)으로 본다
    const { prisma } = await import('@/server/db');
    const { toPlan } = await import('@/server/merge/rules');
    const lead = await prisma.user.findUniqueOrThrow({ where: { email: ID.lead }, include: { division: true } });
    expect(toPlan(lead.division)).toMatchObject({ sort: 'date', undated: 'last' });

    const { bytes, snapshot } = await mergeNow();
    const { readWorklog } = await import('@/lib/hwp/reader');
    const back = readWorklog(bytes).worklog;
    expect(back.achievements.map((r) => r.content)).toEqual(DATE_UNDATED_LAST.achievements.map((r) => r[1]));
    expect(bytes.equals(await composed(DATE_UNDATED_LAST))).toBe(true);
    expect(snapshot).toMatchObject({ sort: 'date', undated: 'last' });
  });

  it('[HM-T132] 날짜 없는 줄을 앞에 — 나머지 순서는 그대로', async () => {
    expect((await putRule(ID.lead, { undated: 'first' })).status).toBe(200);
    const { bytes, snapshot } = await mergeNow();
    expect(bytes.equals(await composed(DATE_UNDATED_FIRST))).toBe(true);
    expect(snapshot).toMatchObject({ sort: 'date', undated: 'first' });
  });

  it('[HM-T133] 목록에 없는 값은 422 · 저장된 값은 그대로 · 바꾼 값은 감사 로그에 · member는 404', async () => {
    const { prisma } = await import('@/server/db');
    for (const body of [{ sort: 'alpha' }, { sort: 1 }, { undated: 'middle' }, { sort: 'date', undated: null }]) {
      expect((await putRule(ID.lead, body)).status, JSON.stringify(body)).toBe(422);
    }
    const div = await prisma.division.findUniqueOrThrow({ where: { id: divId } });
    expect([div.mergeSort, div.mergeUndated]).toEqual(['date', 'first']);

    const logs = await prisma.auditLog.findMany({ where: { action: 'rule_update', divisionId: divId }, orderBy: { at: 'asc' } });
    expect(logs.map((l) => JSON.parse(l.detail ?? '{}'))).toEqual([
      { fields: ['mergeSort'], sort: 'date' },
      { fields: ['mergeUndated'], undated: 'first' },
    ]);

    // 고르는 화면이 담당자에게만 보이는 것과 같은 게이트 — 부서원은 설정이 있는지도 모른다
    expect((await putRule(ID.member, { sort: 'input' })).status).toBe(404);
  });

  it('[HM-T134] 제출자 순으로 되돌리면 처음과 바이트까지 같다 — 고른 것을 되돌릴 수 있다', async () => {
    expect((await putRule(ID.lead, { sort: 'input' })).status).toBe(200);
    const { bytes } = await mergeNow();
    expect(bytes.equals(await composed(INPUT_ORDER))).toBe(true);
  });
});
