// RU-70~84 · HM-47 · TACP-23 — **승인이 곧 제출** (ADR-0015). 사람의 결정 둘(실·팀장 승인 · 본부장 승인) 말고는 Tincase가 한다.
//
// 이 시험은 한 주의 흐름을 이야기 순서로 따라간다: 실장 승인 → (그 요청 안에서) 사본 → 본부본이 저절로 → 본부장 승인 → 전사본.
// 그 사이에 엇갈림(동시 승인·병합과의 경쟁·늦게 온 단위·마감 예외)을 끼워 넣고, 위로 간 것이 언제나 **승인한 바이트**인지 본다.
//
// 픽스처 hwp(내부 문서)가 없어도 돈다(CI). hwp를 실제로 조립하는 엔진(orgdoc·병합·읽기)은 **흉내**로 바꾼다 — 여기서 보는 것은
// 문서의 꼴이 아니라 「무엇이 언제 누구 이름으로 위로 가나」다. 꼴은 tests/rollup.test.ts·docmerge.test.ts(픽스처)가 본다.
// 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-auto-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-auto.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_URL = ''; // RU-41 — 테스트 서버처럼 메신저가 꺼져 있다 (RU-T130)
delete process.env.DEV_IDENTITY;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// 화면(서버 컴포넌트)을 그려 볼 때 누가 보는가 — integration.test.ts와 같은 방법
const pageAs = vi.hoisted(() => ({ who: '' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(pageAs.who ? { 'x-test-identity': pageAs.who } : {}) }));

// ── 엔진 흉내 ─────────────────────────────────────────────
// 병합본·본부본·전사본을 JSON 글자로 — 무엇이 들어갔는지 읽을 수 있게. 조립 결과에는 섹션 제목과 원본 글자만 넣는다
// (쪽 나누기·양식은 넣지 않는다 — 「다시 만들어졌는데 바이트가 같다」를 만들 수 있게, RU-T104)
const hooks: {
  beforeWrite?: (rel: string) => Promise<void> | void;
  /** 병합 엔진이 바이트를 만든 뒤(모델 호출이 끝난 순간) — 끼어들기 시험(RU-T141) */
  duringMerge?: (divisionId: string) => Promise<void> | void;
  nextMerge: Map<string, string>;
} = { nextMerge: new Map() };

vi.mock('@/server/storage', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/server/storage')>();
  return {
    ...orig,
    writeFileAtomic: async (rel: string, data: Buffer) => {
      await hooks.beforeWrite?.(rel);
      return orig.writeFileAtomic(rel, data);
    },
  };
});

vi.mock('@/server/merge', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/server/merge')>();
  return {
    ...orig,
    composeMergedHwp: (_tpl: Buffer, rows: Record<string, string[][]>) => ({ bytes: Buffer.from(JSON.stringify(rows)), tableCount: 3, warnings: [] }),
    runMerge: async (divisionId: string, weekSlotId: string) => {
      const { prisma } = await import('@/server/db');
      const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId } });
      const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { id: weekSlotId } });
      const rel = orig.mergedRelPath(division.slug, slot.year, slot.label);
      const text = hooks.nextMerge.get(divisionId) ?? `${division.nameKo} 병합`;
      // 엔진은 쓰지 않는다 — 바이트를 돌려주면 runMergeRecorded가 잠금 안에서 쓰고 기록한다 (2026-10-08 결정 c)
      await hooks.duringMerge?.(divisionId);
      return {
        outputRelPath: rel,
        output: Buffer.from(JSON.stringify({ achievements: [['1-1', text, '', '', '']], plans: [], notes: [] })),
        bytes: 1,
        rowCounts: { achievements: 1, plans: 0, notes: 0 },
        mergedGroups: [],
        warnings: [],
        model: { used: false, reason: null, elapsedMs: 0, name: '' },
        categories: null,
        sourceIds: [],
        missing: [],
        rowAuthors: { achievements: [], plans: [], notes: [] },
        flagged: [],
      };
    },
  };
});

vi.mock('@/lib/hwp/reader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/hwp/reader')>();
  const row = (r: string[]) => ({ no: r[0] ?? '', content: r[1] ?? '', date: r[2] ?? '', place: r[3] ?? '', attendee: r[4] ?? '', emphasis: false });
  return {
    ...orig,
    readWorklog: (buf: Buffer) => {
      let j: Record<string, string[][]> = {};
      try {
        j = JSON.parse(buf.toString('utf8'));
      } catch {
        j = {};
      }
      return {
        worklog: { achievements: (j.achievements ?? []).map(row), plans: (j.plans ?? []).map(row), notes: (j.notes ?? []).map(row) },
        tables: [],
        warnings: [],
      };
    },
  };
});

vi.mock('@/lib/hwp/orgdoc', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/hwp/orgdoc')>();
  return {
    ...orig,
    composeOrgDocument: (tpl: Buffer, sections: { title: string; source: Buffer | null }[]) => {
      if (tpl.toString('utf8') === 'BROKEN') throw new Error('양식 첫 문단이 제목 문단이 아닙니다');
      return {
        bytes: Buffer.from(JSON.stringify(sections.map((s) => [s.title, s.source ? s.source.toString('utf8') : null]))),
        outcomes: sections.map((s) => ({ title: s.title, status: s.source ? 'copied' : 'missing', dropped: [], fixed: [], warnings: [] })),
        warnings: [],
      };
    },
  };
});

// ── 조직 ─────────────────────────────────────────────────
// 본부가: 실하나(부서장 있음) · 실둘(부서장 없음) — 본부장 있음, 본부 자체는 안 넣음
// 본부나: 자체(부서장 없음) + 실셋(부서장 있음) — 본부장 없음 (RU-T107)
// 단독단: 본부 밖 — 바로 총괄로 (RU-07). 총괄·운영자도 여기 소속
const DIV = {
  hq: { slug: 'AUTO_HQ', nameKo: '본부가', parentKo: '한국환경연구원', self: false },
  u1: { slug: 'AUTO_U1', nameKo: '실하나', parentKo: '본부가', self: true },
  u2: { slug: 'AUTO_U2', nameKo: '실둘', parentKo: '본부가', self: true },
  hq2: { slug: 'AUTO_HQ2', nameKo: '본부나', parentKo: '한국환경연구원', self: true },
  u3: { slug: 'AUTO_U3', nameKo: '실셋', parentKo: '본부나', self: true },
  solo: { slug: 'AUTO_SOLO', nameKo: '단독단', parentKo: '한국환경연구원', self: true },
} as const;
type Key = keyof typeof DIV;
const ID = {
  hqHead: 'a-hq-head@test.local',
  hqLead: 'a-hq-lead@test.local',
  hqMember: 'a-hq-member@test.local',
  u1Head: 'a-u1-head@test.local',
  u1Lead: 'a-u1-lead@test.local',
  u1Member: 'a-u1-member@test.local',
  u2Lead: 'a-u2-lead@test.local',
  hq2Lead: 'a-hq2-lead@test.local',
  u3Head: 'a-u3-head@test.local',
  u3Lead: 'a-u3-lead@test.local',
  soloHead: 'a-solo-head@test.local',
  soloLead: 'a-solo-lead@test.local',
  coord: 'a-coord@test.local',
  op: 'a-op@test.local',
};
const divId = {} as Record<Key, string>;
const userId = {} as Record<keyof typeof ID, string>;
let isoKey = '';

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const db = async () => (await import('@/server/db')).prisma;
const slot = async () => (await db()).weekSlot.findUniqueOrThrow({ where: { isoKey } });
const settle = async () => (await import('@/server/after')).settleLater();
const opts = { cause: 'test', causedBy: null };

/** 실·팀 병합본을 만든 것처럼 — 엔진과 같은 자리(주차마다 하나, 다시 병합하면 덮인다)에 쓰고 MergeRun. 병합 뒤 훅은 부르지 않는다 */
async function merged(key: Key, text: string, o: { preview?: boolean } = {}) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const { mergedRelPath } = await import('@/server/merge');
  const s = await slot();
  const rel = mergedRelPath(DIV[key].slug, s.year, s.label);
  await writeFileAtomic(rel, Buffer.from(JSON.stringify({ achievements: [['1-1', text, '', '', '']], plans: [], notes: [] })));
  // 마감은 그 주 월 00:00 — 미리보기는 그보다 앞에 시작한 실행이다(HM-34)
  const startedAt = o.preview ? new Date(s.opensAt.getTime() - 3600_000) : new Date();
  return prisma.mergeRun.create({
    data: { divisionId: divId[key], weekSlotId: s.id, status: 'succeeded', outputPath: rel, sourceIds: '[]', ruleSnapshot: '{}', startedAt, finishedAt: startedAt },
  });
}

/** 화면이 본 판 — 가장 최근 성공 실행 + 파일 sha (HM-47) */
async function viewed(key: Key) {
  const prisma = await db();
  const { readStoredFile } = await import('@/server/storage');
  const run = await prisma.mergeRun.findFirstOrThrow({
    where: { divisionId: divId[key], weekSlotId: (await slot()).id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  return { runId: run.id, sha256: sha(await readStoredFile(run.outputPath!)) };
}

async function approve(who: string, key: Key, v?: { runId: string; sha256: string }) {
  const { POST } = await import('@/app/api/division/merged/approve/route');
  return POST(nx('/api/division/merged/approve', who, jsonInit('POST', { isoKey, ...(v ?? (await viewed(key))) })));
}

async function save(who: string, key: Key, text: string, v?: { runId: string; sha256: string }) {
  const { PUT } = await import('@/app/api/division/merged/content/route');
  return PUT(
    nx(
      '/api/division/merged/content',
      who,
      jsonInit('PUT', {
        isoKey,
        ...(v ?? (await viewed(key))),
        tables: [
          { key: 'achievements', rows: [['', text, '', '', '']] },
          { key: 'plans', rows: [] },
          { key: 'notes', rows: [] },
        ],
      }),
    ),
  );
}

async function mergeNow(who: string, body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/division/merge/route');
  return POST(nx('/api/division/merge', who, jsonInit('POST', { isoKey, ...body })));
}

async function escape(who: string, level: 'unit' | 'hq') {
  const { POST } = await import('@/app/api/rollup/report/route');
  return POST(nx('/api/rollup/report', who, jsonInit('POST', { level, isoKey, withoutApproval: true })));
}

/** 지금 본부본 — 본부장이 화면에서 보는 판 */
async function hqViewed(key: 'hq' | 'hq2') {
  const { latestHqRun } = await import('@/server/rollup/handoff');
  const { readStoredFile } = await import('@/server/storage');
  const run = await latestHqRun(divId[key], (await slot()).id);
  if (!run) return null;
  return { runId: run.id, sha256: sha(await readStoredFile(run.outputPath!)) };
}

async function hqApprove(who: string, v?: { runId: string; sha256: string } | null) {
  const { POST } = await import('@/app/api/rollup/hq/approve/route');
  return POST(nx('/api/rollup/hq/approve', who, jsonInit('POST', { isoKey, ...(v ?? (await hqViewed('hq'))) })));
}

async function current(key: Key, level: 'unit' | 'hq' = 'unit') {
  const { currentReport } = await import('@/server/rollup/report');
  return currentReport(divId[key], (await slot()).id, level);
}

async function stored(rel: string) {
  return (await import('@/server/storage')).readStoredFile(rel);
}

async function hqRuns(key: 'hq' | 'hq2') {
  return (await db()).rollupRun.findMany({ where: { level: 'hq', divisionId: divId[key], weekSlotId: (await slot()).id }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
}

async function orgRuns() {
  return (await db()).rollupRun.findMany({ where: { level: 'org', weekSlotId: (await slot()).id }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
}

async function unitState(key: Key) {
  const prisma = await db();
  const { unitHandoffView } = await import('@/server/rollup/state');
  const d = await prisma.division.findUniqueOrThrow({ where: { id: divId[key] } });
  return (await unitHandoffView(d, await slot(), { trail: true, canEscape: true }))!;
}

/**
 * RU-77 (2026-10-08 결정 a) — 기한을 「지금」 둘레로: 실·팀 → 본부 = 지금 - 60분, 본부 → 총괄 = 지금. 그 주의 기준 시각(마감 예외 반영)에서 센다.
 * 비상구는 「본부 → 총괄」 + 24시간에 닫히므로, 마감을 그 주 월 00:00에 두고 기한을 +60·+120분에 두면 목요일에 돌린 시험에서는 창이 이미 닫혀 있다.
 * 시험이 무슨 요일·시각에 돌든 비상구 창(열림 ~ 닫힘) 안에 있게 한다
 */
async function dueNow(offsetMinutes = 0) {
  const { weekAnchor } = await import('@/server/slot-deadline');
  const m = Math.floor((Date.now() - (await weekAnchor(await slot())).getTime()) / 60_000) + offsetMinutes;
  await (await db()).orgRollupSetting.update({ where: { id: 'org' }, data: { unitDueMinutes: m - 60, hqDueMinutes: m } });
}

async function node(key: 'hq' | 'hq2') {
  const { hqNodeOf, loadTree } = await import('@/server/rollup/tree');
  return hqNodeOf(await loadTree(), divId[key])!;
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-auto.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  isoKey = (await ensureCurrentSlot()).isoKey;
  for (const [key, d] of Object.entries(DIV) as [Key, (typeof DIV)[Key]][]) {
    const row = await prisma.division.create({
      // 마감 = 그 주 월 00:00 — 시험이 언제 돌든 「마감 뒤」다(최종본 HM-34). 미리보기는 그보다 앞에 시작한 실행으로 만든다
      data: { slug: d.slug, nameKo: d.nameKo, nameEn: d.slug, isActive: true, parentKo: d.parentKo, rollupSelf: d.self, deadlineDow: 1, deadlineTime: '00:00' },
    });
    divId[key] = row.id;
    const rel = `divisions/${d.slug}/template/active.hwp`;
    await writeFileAtomic(rel, Buffer.from(`양식:${d.slug}`));
    await prisma.template.create({ data: { divisionId: row.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'seed' } });
  }
  const mk = async (k: keyof typeof ID, key: Key, extra: object = {}) => {
    const u = await prisma.user.create({ data: { email: ID[k], name: k, divisionId: divId[key], ...extra } });
    userId[k] = u.id;
  };
  await mk('hqHead', 'hq', { divisionRole: 'head', jobTitle: '본부장' });
  await mk('hqLead', 'hq', { divisionRole: 'lead' });
  await mk('hqMember', 'hq');
  await mk('u1Head', 'u1', { divisionRole: 'head', jobTitle: '실장' });
  await mk('u1Lead', 'u1', { divisionRole: 'lead' });
  await mk('u1Member', 'u1');
  await mk('u2Lead', 'u2', { divisionRole: 'lead' });
  await mk('hq2Lead', 'hq2', { divisionRole: 'lead' });
  await mk('u3Head', 'u3', { divisionRole: 'head', jobTitle: '실장' });
  await mk('u3Lead', 'u3', { divisionRole: 'lead' });
  await mk('soloHead', 'solo', { divisionRole: 'head', jobTitle: '단장' });
  await mk('soloLead', 'solo', { divisionRole: 'lead' });
  await mk('coord', 'solo', { isCoordinator: true });
  await mk('op', 'solo', { isOperator: true });
  await prisma.orgSection.createMany({
    data: [
      { sortOrder: 10, title: '본부가(실하나)', divisionId: divId.u1 },
      { sortOrder: 20, title: '본부가(실둘)', divisionId: divId.u2 },
      { sortOrder: 30, title: '본부나', divisionId: divId.hq2 },
      { sortOrder: 40, title: '본부나(실셋)', divisionId: divId.u3 },
      { sortOrder: 50, title: '단독단', divisionId: divId.solo },
    ],
  });
  // RU-52 — 3단계를 켠 상태에서 (꺼짐은 RU-T98이 따로)
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true, unitDueMinutes: 60, hqDueMinutes: 120 } });
  await dueNow(); // 비상구 창 안에서 시작한다 (결정 a — 창은 「본부 → 총괄」 + 24시간에 닫힌다)
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

describe('RU-70~73 · HM-47 실·팀 — 부서장 승인이 곧 위로 가는 제출', () => {
  it('[RU-T90] ★ 부서장 [승인] → 같은 요청 안에 사본: sha = 승인 sha = 불변 사본 sha · 결정한 사람 이름 · 감사 auto', async () => {
    const prisma = await db();
    await merged('u1', '실하나 첫 판');
    const v = await viewed('u1');
    const res = await approve(ID.u1Head, 'u1', v);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handedOff?.target).toBe('본부가'); // HM-T145 — 화면이 「본부가에 올라갔어요」라고 말한다
    // 요청 뒤(after)를 기다리기 **전에** 사본이 이미 있다 — 넘김은 승인과 한 트랜잭션이다
    const sub = (await current('u1'))!;
    const review = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.u1 }, orderBy: { createdAt: 'desc' } });
    expect([sub.basis, sub.reviewId, sub.submittedBy, sub.cause]).toEqual(['approved', review.id, userId.u1Head, 'approval']);
    expect(sub.sha256).toBe(v.sha256);
    expect(review.sha256).toBe(v.sha256);
    expect(sha(await stored(review.filePath!))).toBe(v.sha256); // 불변 사본 (HM-T143)
    expect(sub.filePath).toBe(review.filePath);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'report_submit', target: `report:${sub.id}` } });
    expect(log.actor).toBe(ID.u1Head);
    expect(JSON.parse(log.detail!)).toMatchObject({ auto: true, reviewId: review.id, basis: 'approved' });
    await settle();
  });

  it('[RU-T100] 사본이 오면 본부본이 저절로 — system · 입력 열쇠 · 일으킨 사건 · 안 낸 단위는 문서에서 빠지고 현황에 「미제출」', async () => {
    const prisma = await db();
    const runs = await hqRuns('hq');
    expect(runs).toHaveLength(1);
    const sub = (await current('u1'))!;
    expect(runs[0]).toMatchObject({ status: 'succeeded', createdBy: 'system', cause: `unit_handoff:${sub.id}` });
    expect(runs[0].inputKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(runs[0].inputIds)).toEqual([sub.id]);
    expect(JSON.parse((await stored(runs[0].outputPath!)).toString())).toEqual([['본부가(실하나)', JSON.stringify({ achievements: [['1-1', '실하나 첫 판', '', '', '']], plans: [], notes: [] })]]);
    // 기록 — 조립은 system 이름에 일으킨 사람을 붙인다. 실장의 이름으로 본부 문서를 「만들었다」고 적지 않는다 (TACP-23 · RU-T120)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rollup', target: `rollup:${runs[0].id}` } });
    expect(log.actor).toBe('system');
    expect(JSON.parse(log.detail!)).toMatchObject({ causedBy: ID.u1Head, cause: `unit_handoff:${sub.id}` });
    const { hqBoard } = await import('@/server/rollup/run');
    const { chipOf } = await import('@/server/rollup/view');
    const board = await hqBoard(await node('hq'), await slot());
    expect(board.units.map((u) => [u.division.nameKo, chipOf(u).kind])).toEqual([
      ['실하나', 'sent'],
      ['실둘', 'waiting'],
    ]);
    expect(chipOf(board.units[0]).by).toBe('u1Head 실장 승인');
    expect(board.state).toBe('Q1');
    // 본부장 승인 전에는 총괄에 아무것도 가지 않는다 — 실하나 섹션은 「본부장 승인 대기」
    expect(await orgRuns()).toHaveLength(0);
  });

  it('[RU-T91] 부서장 고쳐 저장 → 저장한 바이트가 사본. 그 뒤 병합본 파일이 덮여도 사본 바이트는 그대로', async () => {
    const res = await save(ID.u1Head, 'u1', '실하나 실장이 고친 판');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handedOff?.target).toBe('본부가');
    const sub = (await current('u1'))!;
    expect(sub.sha256).toBe(body.sha256);
    const bytes = await stored(sub.filePath);
    await merged('u1', '실하나 다시 병합(덮음)');
    expect(await stored(sub.filePath)).toEqual(bytes);
    expect((await current('u1'))!.id).toBe(sub.id); // 병합은 승인이 아니다 — 위로 가지 않는다
    expect((await unitState('u1')).state).toBe('U3'); // 승인 뒤 바뀜
    await settle();
  });

  it('[RU-T92] 다시 승인하면 새 행이 대신한다(옛 행은 이력) · 같은 판·같은 근거면 새 행 없음', async () => {
    const prisma = await db();
    const before = await prisma.reportSubmission.count({ where: { divisionId: divId.u1 } });
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u1 } })).toBe(before + 1);
    const again = await (await approve(ID.u1Head, 'u1')).json();
    expect([again.unchanged, again.handedOff]).toEqual([true, null]); // HM-T145
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u1 } })).toBe(before + 1);
    expect((await unitState('u1')).state).toBe('U2');
    await settle();
  });

  it('[RU-T93 · HM-T144] ★ 같은 판을 본 [승인]과 고쳐 저장이 동시에 → 줄을 선다. 지금 사본 = 가장 최근 승인, 승인 하나에 사본 하나', async () => {
    const prisma = await db();
    await merged('u1', '실하나 동시 판');
    const v = await viewed('u1');
    const [a, b] = await Promise.all([approve(ID.u1Head, 'u1', v), save(ID.u1Head, 'u1', '실하나 동시 저장', v)]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]));
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
    const latest = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.u1 }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const sub = (await current('u1'))!;
    expect(sub.reviewId).toBe(latest.id);
    expect(sub.sha256).toBe((await viewed('u1')).sha256); // 승인의 sha가 그 순간 파일과 다른 경우가 없다
    const subs = await prisma.reportSubmission.findMany({ where: { divisionId: divId.u1, reviewId: { not: null } } });
    expect(new Set(subs.map((s) => s.reviewId)).size).toBe(subs.length);
    // 같은 판 [승인] 둘이 동시에 → 승인도 사본도 하나
    await merged('u1', '실하나 두 번 누름');
    const w = await viewed('u1');
    const rs = await Promise.all([approve(ID.u1Head, 'u1', w), approve(ID.u1Head, 'u1', w)]);
    const js = await Promise.all(rs.map((r) => r.json()));
    expect(js.map((j) => j.unchanged).sort()).toEqual([false, true]);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId.u1, mergeRunId: w.runId } })).toBe(1);
    await settle();
  });

  it('[RU-T94] ★ 승인이 본 판을 확인한 뒤 병합이 새 파일을 쓴다 → 사본은 승인한 바이트, 화면은 「승인 뒤 바뀜」', async () => {
    const { mergedRelPath } = await import('@/server/merge');
    const { writeFileAtomic } = await import('@/server/storage');
    const s = await slot();
    await merged('u1', '실하나 승인할 판');
    const v = await viewed('u1');
    // 불변 사본을 쓰기 바로 전에 병합이 같은 자리에 새 파일을 쓴다 (스케줄러 병합과 승인이 엇갈림)
    hooks.beforeWrite = async (rel) => {
      if (!rel.includes(`${path.sep}reports${path.sep}`)) return;
      hooks.beforeWrite = undefined;
      await writeFileAtomic(mergedRelPath(DIV.u1.slug, s.year, s.label), Buffer.from('{"achievements":[["1-1","끼어든 병합","","",""]]}'));
    };
    const res = await approve(ID.u1Head, 'u1', v);
    hooks.beforeWrite = undefined;
    expect(res.status).toBe(200);
    const sub = (await current('u1'))!;
    expect(sub.sha256).toBe(v.sha256);
    expect(sha(await stored(sub.filePath))).toBe(v.sha256);
    expect((await viewed('u1')).sha256).not.toBe(v.sha256);
    expect((await unitState('u1')).state).toBe('U3');
    await settle();
  });

  it('[RU-T95 · RU-T102] 마감 전 미리보기를 승인해도 올라간다 → 최종본이 판을 바꾸면 U3 → 다시 승인하면 최종본이 올라감 · 본부 단계 없는 단위는 바로 총괄', async () => {
    const prisma = await db();
    await merged('solo', '단독단 미리보기', { preview: true });
    expect((await unitState('solo')).state).toBe('U0');
    const res = await (await approve(ID.soloHead, 'solo')).json();
    expect(res.handedOff?.target).toBe('총괄');
    expect((await unitState('solo')).state).toBe('U2');
    await settle();
    expect(await prisma.rollupRun.count({ where: { divisionId: divId.solo } })).toBe(0); // 본부본 없음 (RU-07)
    const org = await orgRuns();
    expect(org.length).toBeGreaterThan(0);
    expect((await stored(org.at(-1)!.outputPath!)).toString()).toContain('단독단 미리보기');
    // 마감 뒤 최종본 ([지금 병합]) — 판이 바뀐다
    hooks.nextMerge.set(divId.solo, '단독단 최종본');
    expect((await mergeNow(ID.soloLead)).status).toBe(200);
    await settle();
    expect((await unitState('solo')).state).toBe('U3');
    expect(JSON.parse((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()).find((s: string[]) => s[0] === '단독단')[1]).toContain('단독단 미리보기');
    expect((await approve(ID.soloHead, 'solo')).status).toBe(200);
    await settle();
    expect((await unitState('solo')).state).toBe('U2');
    expect((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()).toContain('단독단 최종본');
  });

  it('[RU-T96] HM-49 — 고쳐 저장(= 승인)한 최종본을 [다시 병합](덮기) → 사본은 그대로, U3', async () => {
    await merged('u3', '실셋 병합');
    expect((await save(ID.u3Head, 'u3', '실셋 실장 고침')).status).toBe(200);
    const sub = (await current('u3'))!;
    const res = await mergeNow(ID.u3Lead);
    expect(res.status).toBe(409); // 사람이 고친 병합본 — 묻기 전에는 덮지 않는다 (API-55)
    expect((await mergeNow(ID.u3Lead, { overwriteEdits: true })).status).toBe(200);
    await settle();
    expect((await current('u3'))!.id).toBe(sub.id);
    expect(sha(await stored(sub.filePath))).toBe(sub.sha256);
    expect((await unitState('u3')).state).toBe('U3');
  });

  it('[RU-T97] ★ 부서장 없는 단위 — 미리보기는 안 올라감 · 마감 뒤 병합 → system 사본(no_head) · 담당자 고쳐 저장 → 다시 올라감 · 같은 바이트면 새 행 없음', async () => {
    const prisma = await db();
    const { syncUnit } = await import('@/server/rollup/handoff');
    await merged('u2', '실둘 미리보기', { preview: true });
    expect(await syncUnit(divId.u2, await slot(), opts)).toBeNull();
    expect((await unitState('u2')).state).toBe('Hf'); // 마감이 지났는데 최종본이 없다 — 미리보기는 올라가지 않는다
    hooks.nextMerge.set(divId.u2, '실둘 최종본');
    const m = await mergeNow(ID.u2Lead);
    expect(m.status).toBe(200);
    const runId = (await m.json()).runId;
    const sub = (await current('u2'))!;
    expect([sub.basis, sub.submittedBy, sub.cause, sub.reviewId]).toEqual(['no_head', 'system', `merge_final:${runId}`, null]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'report_submit', target: `report:${sub.id}` } });
    expect([log.actor, JSON.parse(log.detail!).causedBy]).toEqual(['system', ID.u2Lead]);
    expect((await unitState('u2')).state).toBe('H1');
    // 담당자가 고쳐 저장 — 부서장이 없으면 담당자의 저장이 그 단위의 마지막 판단이다 (§12 Q8)
    expect((await save(ID.u2Lead, 'u2', '실둘 담당자 고침')).status).toBe(200);
    const edited = (await current('u2'))!;
    expect(edited.id).not.toBe(sub.id);
    expect([edited.basis, edited.cause]).toEqual(['no_head', `edit:${runId}`]);
    // 같은 바이트로 다시 병합 두 번 — 두 번째는 새 행이 없다 (RU-02)
    expect((await mergeNow(ID.u2Lead, { overwriteEdits: true })).status).toBe(200);
    const n = await prisma.reportSubmission.count({ where: { divisionId: divId.u2 } });
    expect((await mergeNow(ID.u2Lead)).status).toBe(200);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u2 } })).toBe(n);
    // 부서장 계정이 생기면 그 뒤로는 승인이 있어야 바뀐다 — 비활성 계정은 「없음」
    const head = await prisma.user.create({ data: { email: 'a-u2-head@test.local', name: 'u2Head', divisionId: divId.u2, divisionRole: 'head', isActive: false } });
    hooks.nextMerge.set(divId.u2, '실둘 비활성 부서장 때');
    expect((await mergeNow(ID.u2Lead)).status).toBe(200);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u2 } })).toBe(n + 1);
    await prisma.user.update({ where: { id: head.id }, data: { isActive: true } });
    hooks.nextMerge.set(divId.u2, '실둘 부서장 생긴 뒤');
    expect((await mergeNow(ID.u2Lead)).status).toBe(200);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u2 } })).toBe(n + 1);
    expect((await unitState('u2')).state).toBe('U3');
    await prisma.user.update({ where: { id: head.id }, data: { isActive: false } }); // 뒤 시험을 위해 다시 「부서장 없음」
    hooks.nextMerge.set(divId.u2, '실둘 최종');
    expect((await mergeNow(ID.u2Lead)).status).toBe(200);
    await settle();
  });

  it('[RU-T98 · HM-T143] 3단계 꺼짐 — 승인은 불변 사본만 · 켜는 순간 이번 주 승인이 그 사본으로(system + 켠 사람) · 지난 주는 안 만든다', async () => {
    const prisma = await db();
    const { ensureCurrentSlot } = await import('@/server/worklog');
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    // 지난 주 승인 — 켜도 올라가지 않는다
    const prev = await ensureCurrentSlot(new Date((await slot()).opensAt.getTime() - 3 * 86400_000));
    const prevReview = await prisma.mergeReview.create({
      data: { divisionId: divId.u3, weekSlotId: prev.id, mergeRunId: 'x', reviewerId: userId.u3Head, kind: 'approve', sha256: 'y', filePath: 'divisions/x.hwp' },
    });
    await merged('u3', '실셋 꺼진 동안');
    const before = await prisma.reportSubmission.count({ where: { divisionId: divId.u3 } });
    const res = await (await approve(ID.u3Head, 'u3')).json();
    expect(res.handedOff).toBeNull();
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u3 } })).toBe(before);
    const review = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.u3 }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(review.filePath).toBeTruthy(); // 불변 사본은 늘 남긴다 — 켜는 순간 그 승인이 올라가야 한다
    await settle();
    // 켠다 (총괄 — 「주차 일정」 카드)
    const { PUT } = await import('@/app/api/rollup/org/settings/route');
    expect((await PUT(nx('/api/rollup/org/settings', ID.op, jsonInit('PUT', { enabled: true })))).status).toBe(200);
    await settle();
    const sub = (await current('u3'))!;
    expect([sub.reviewId, sub.submittedBy, sub.cause, sub.basis]).toEqual([review.id, 'system', 'rollup_enabled', 'approved']);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'report_submit', target: `report:${sub.id}` } });
    expect([log.actor, JSON.parse(log.detail!).causedBy, JSON.parse(log.detail!).approvedBy]).toEqual(['system', ID.op, userId.u3Head]);
    expect(await prisma.reportSubmission.count({ where: { reviewId: prevReview.id } })).toBe(0);
  });

  it('[HM-T143] 불변 사본 쓰기가 실패하면 승인째 실패(500) — 승인 행도 사본도 남지 않는다', async () => {
    const prisma = await db();
    await merged('u1', '실하나 디스크 가득');
    const reviews = await prisma.mergeReview.count({ where: { divisionId: divId.u1 } });
    const subs = await prisma.reportSubmission.count({ where: { divisionId: divId.u1 } });
    hooks.beforeWrite = (rel) => {
      if (rel.includes(`${path.sep}reports${path.sep}`)) throw new Error('ENOSPC');
    };
    try {
      expect((await approve(ID.u1Head, 'u1')).status).toBe(500);
    } finally {
      hooks.beforeWrite = undefined;
    }
    expect(await prisma.mergeReview.count({ where: { divisionId: divId.u1 } })).toBe(reviews);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.u1 } })).toBe(subs);
    // 다시 누르면 된다
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200);
    await settle();
  });

  it('[RU-T124 · HM-T146] 부서장 있는 단위에서 담당자의 수정 저장은 위로 가지 않는다 — 사본은 승인한 판, 「승인 뒤 바뀜」', async () => {
    const before = (await current('u1'))!;
    expect((await save(ID.u1Lead, 'u1', '실하나 담당자가 승인 뒤 고침')).status).toBe(200);
    await settle();
    expect((await current('u1'))!.id).toBe(before.id);
    expect((await unitState('u1')).state).toBe('U3');
    // 다시 승인해야 올라간다
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200);
    expect((await unitState('u1')).state).toBe('U2');
    await settle();
  });
});

describe('RU-71~76 본부 — 저절로 이어 붙고, 본부장 승인이 곧 총괄로', () => {
  it('[RU-T101] ★ 같은 상태로 다시 맞추기 → 실행 없음 · 몰려도 한 번에 하나(밀린 것은 한 번만 더) · 마지막 실행 = 지금 사본들', async () => {
    const { syncHq } = await import('@/server/rollup/auto');
    const n = (await hqRuns('hq')).length;
    await syncHq(await node('hq'), await slot(), opts);
    expect(await hqRuns('hq')).toHaveLength(n);
    // 입력을 바꾸고(실하나 새 승인 — 요청 뒤 맞추기를 기다리지 않은 채) 다섯 번 몰아서
    await merged('u1', '실하나 몰림');
    const { syncUnit } = await import('@/server/rollup/handoff');
    const { freeze, commitUnitApproval, withUnitLock } = await import('@/server/rollup/handoff');
    const { requireScope } = await import('@/server/authz');
    const s = await slot();
    const scope = await requireScope(new Headers({ 'x-test-identity': ID.u1Head }));
    const v = await viewed('u1');
    await withUnitLock(divId.u1, s.id, async () => {
      const frozen = await freeze(DIV.u1.slug, s, 'unit', await stored((await (await db()).mergeRun.findUniqueOrThrow({ where: { id: v.runId } })).outputPath!));
      await commitUnitApproval({ scope, run: { id: v.runId, divisionId: divId.u1, weekSlotId: s.id }, slot: s, kind: 'approve', changes: [], frozen });
    });
    expect(await syncUnit(divId.u1, s, opts)).toBeNull(); // 이미 넘어갔다 — 따라잡을 것이 없다
    await Promise.all(Array.from({ length: 5 }, () => syncHq({ node: { id: divId.hq } as never, hasHqStep: true }, s, opts)));
    const runs = await hqRuns('hq');
    expect(runs.length - n).toBeGreaterThanOrEqual(1);
    expect(runs.length - n).toBeLessThanOrEqual(2);
    expect(JSON.parse(runs.at(-1)!.inputIds)).toEqual([(await current('u1'))!.id, (await current('u2'))!.id]);
  });

  it('[RU-T103 · RU-T119] ★ 본부장 승인(본 판) → 본부 사본 sha = 실행 파일 sha, 결정한 사람 · 본 판이 아니면 409·사본 없음 · 같은 판 두 번 → 하나', async () => {
    const prisma = await db();
    const v = (await hqViewed('hq'))!;
    // 본 판이 아니다 — 화면을 연 뒤 다시 이어 붙은 경우
    const stale = await hqApprove(ID.hqHead, { runId: v.runId, sha256: 'f'.repeat(64) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).message).toContain('본부본이 바뀌었어요');
    expect(await current('hq', 'hq')).toBeNull();
    // 본부 담당자·산하 실장·총괄 → 404 (requireHqReviewer)
    for (const who of [ID.hqLead, ID.u1Head, ID.coord, ID.hqMember]) expect((await hqApprove(who, v)).status, who).toBe(404);
    const ok = await hqApprove(ID.hqHead, v);
    expect(ok.status).toBe(200);
    expect((await ok.json()).handedOff?.target).toBe('총괄');
    const sub = (await current('hq', 'hq'))!;
    const review = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.hq, kind: 'hq_approve' }, orderBy: { createdAt: 'desc' } });
    expect([sub.sha256, sub.submittedBy, sub.basis, sub.reviewId, sub.sourceRunId]).toEqual([v.sha256, userId.hqHead, 'approved', review.id, v.runId]);
    expect(sha(await stored(sub.filePath))).toBe(v.sha256);
    expect((await (await hqApprove(ID.hqHead, v)).json()).unchanged).toBe(true);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId.hq, kind: 'hq_approve' } })).toBe(1);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.hq, level: 'hq' } })).toBe(1);
    // RU-T102 — 본부본 승인은 본부 자체 병합본 승인이 아니다 (UNIT_REVIEW)
    const { latestReview } = await import('@/server/merge/review');
    expect(await latestReview(divId.hq, (await slot()).id)).toBeNull();
    await settle();
    // 전사본 — 본부가 승인해 보낸 판의 실·팀 사본으로
    const org = JSON.parse((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()) as [string, string | null][];
    expect(org.map((s) => s[0])).toEqual(['본부가(실하나)', '본부가(실둘)', '본부나', '본부나(실셋)', '단독단']);
    expect(org[0][1]).toContain('실하나 몰림');
  });

  it('[RU-T104 · RU-T109] ★ 승인 뒤 늦게 온 단위로 다시 이어 붙어 sha가 다름 → 승인 풀림, 총괄에는 승인한 판 그대로(Q3), 전사본에도 새 판이 새지 않는다', async () => {
    const { hqBoard } = await import('@/server/rollup/run');
    const approvedHq = (await current('hq', 'hq'))!;
    const orgBefore = (await orgRuns()).at(-1)!;
    // 실둘(부서장 없음)이 고쳐 다시 올라온다
    expect((await save(ID.u2Lead, 'u2', '실둘 늦게 고침')).status).toBe(200);
    await settle();
    const board = await hqBoard(await node('hq'), await slot());
    expect(board.approval?.changedAfter).toBe(true);
    expect(board.state).toBe('Q3');
    expect((await current('hq', 'hq'))!.id).toBe(approvedHq.id);
    const org = JSON.parse((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()) as [string, string | null][];
    expect(org.find((s) => s[0] === '본부가(실둘)')![1]).not.toContain('실둘 늦게 고침');
    expect((await orgRuns()).at(-1)!.id).toBe(orgBefore.id); // 섹션 출처(승인한 본부본)가 그대로라 전사본도 그대로
    // 「전사」 표는 그 섹션을 「본부장 재승인 대기」로
    const { resolveSections } = await import('@/server/rollup/sections');
    const src = (await resolveSections(await slot())).find((s) => s.section.title === '본부가(실둘)')!;
    expect([src.kind, src.flag]).toEqual(['tincase', 'reapprove']);
  });

  it('[RU-T104 · RU-T105] 같은 바이트로 다시 만들어지면 승인 유지 · 순서가 바뀌면 다시 이어 붙고 승인이 풀린다 · 섹션 제목만 바뀌면 본부본은 그대로', async () => {
    const { hqBoard } = await import('@/server/rollup/run');
    expect((await hqApprove(ID.hqHead)).status).toBe(200);
    await settle();
    const n = (await hqRuns('hq')).length;
    // 쪽 나누기 — 열쇠는 바뀌지만(다시 만든다) 이 흉내에서는 바이트가 같다 → 승인 그대로
    const order = await import('@/app/api/rollup/hq/order/route');
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u1, divId.u2], pageBreak: false })))).status).toBe(200);
    await settle();
    expect(await hqRuns('hq')).toHaveLength(n + 1);
    let board = await hqBoard(await node('hq'), await slot());
    expect([board.state, board.approval?.changedAfter]).toEqual(['Q2', false]);
    // 섹션 제목만 — 본부본은 다시 만들지 않는다(승인을 풀지 않는다), 전사본은 새 제목으로
    const prisma = await db();
    const sections = await prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' } });
    const sec = await import('@/app/api/rollup/org/sections/route');
    const list = sections.map((s) => ({ id: s.id, title: s.title === '단독단' ? '단독단(새 제목)' : s.title, divisionId: s.divisionId, isActive: s.isActive }));
    expect((await sec.PUT(nx('/api/rollup/org/sections', ID.coord, jsonInit('PUT', { sections: list })))).status).toBe(200);
    await settle();
    expect(await hqRuns('hq')).toHaveLength(n + 1);
    expect((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()).toContain('단독단(새 제목)');
    // 순서 — 다시 이어 붙고 바이트가 달라 승인이 풀린다
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u2, divId.u1] })))).status).toBe(200);
    await settle();
    board = await hqBoard(await node('hq'), await slot());
    expect(board.current!.units.map((u) => u.name)).toEqual(['본부가(실둘)', '본부가(실하나)']);
    expect([board.state, board.approval?.changedAfter]).toEqual(['Q3', true]);
  });

  it('[RU-T106] 조립 실패(양식) → failed + 이유 · 같은 열쇠는 다시 몰아치지 않음 · [다시 시도]는 다시 만든다 · 양식을 고치면 성공', async () => {
    const prisma = await db();
    const { writeFileAtomic } = await import('@/server/storage');
    const { syncHq } = await import('@/server/rollup/auto');
    await prisma.template.updateMany({ where: { divisionId: divId.hq }, data: { isActive: false } });
    await writeFileAtomic('divisions/AUTO_HQ/template/broken.hwp', Buffer.from('BROKEN'));
    await prisma.template.create({ data: { divisionId: divId.hq, filePath: 'divisions/AUTO_HQ/template/broken.hwp', sha256: 'broken', version: 2, uploadedBy: 'seed' } });
    await syncHq(await node('hq'), await slot(), { cause: 'template', causedBy: null });
    const failed = (await hqRuns('hq')).at(-1)!;
    expect([failed.status, failed.errorText]).toEqual(['failed', '양식 첫 문단이 제목 문단이 아닙니다']);
    const n = (await hqRuns('hq')).length;
    await syncHq(await node('hq'), await slot(), { cause: 'read_repair', causedBy: null });
    expect(await hqRuns('hq')).toHaveLength(n); // 1분 안에는 같은 실패를 되풀이하지 않는다
    // [다시 시도] — 본부 담당자. 아직 깨져 있으니 500, 그래도 한 번 더 만들었다
    const hq = await import('@/app/api/rollup/hq/route');
    const retry = await hq.POST(nx('/api/rollup/hq', ID.hqLead, jsonInit('POST', { isoKey, inputIds: ['x'], nodeId: divId.hq2 })));
    expect(retry.status).toBe(500);
    expect(await hqRuns('hq')).toHaveLength(n + 1);
    expect((await hqRuns('hq2')).every((r) => r.cause !== 'retry')).toBe(true); // RU-T121 — 요청이 입력·본부를 고르지 못한다
    // 양식을 고친다 → 열쇠가 바뀌어 바로 성공
    await prisma.template.updateMany({ where: { divisionId: divId.hq }, data: { isActive: false } });
    await writeFileAtomic('divisions/AUTO_HQ/template/v3.hwp', Buffer.from('양식:고침'));
    await prisma.template.create({ data: { divisionId: divId.hq, filePath: 'divisions/AUTO_HQ/template/v3.hwp', sha256: 'good', version: 3, uploadedBy: 'seed' } });
    await syncHq(await node('hq'), await slot(), { cause: 'template', causedBy: null });
    expect((await hqRuns('hq')).at(-1)!.status).toBe('succeeded');
    // [다시 시도]가 성공 상태에서는 아무것도 하지 않는다
    const m = (await hqRuns('hq')).length;
    expect((await hq.POST(nx('/api/rollup/hq', ID.hqHead, jsonInit('POST', { isoKey })))).status).toBe(200);
    expect(await hqRuns('hq')).toHaveLength(m);
  });

  it('[RU-T107] 본부장 없는 본부 — 다시 만들어질 때마다 본부 사본 no_head(system)', async () => {
    const prisma = await db();
    const subs = await prisma.reportSubmission.findMany({ where: { divisionId: divId.hq2, level: 'hq' }, orderBy: { submittedAt: 'asc' } });
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.basis === 'no_head' && s.submittedBy === 'system')).toBe(true);
    const run = (await hqRuns('hq2')).filter((r) => r.status === 'succeeded').at(-1)!;
    expect(subs.at(-1)!.sourceRunId).toBe(run.id);
    // 본부나 자체(부서장 없음)도 올라오면 다시 만들어지고 다시 넘어간다
    hooks.nextMerge.set(divId.hq2, '본부나 자체');
    expect((await mergeNow(ID.hq2Lead)).status).toBe(200);
    await settle();
    const after = await prisma.reportSubmission.findMany({ where: { divisionId: divId.hq2, level: 'hq' } });
    expect(after.length).toBe(subs.length + 1);
  });
});

describe('RU-72·83 전사 · 읽기 수리 · 죽은 조립', () => {
  it('[RU-T108] 전사본: 섹션 출처가 바뀔 때마다 다시 · 열쇠가 같으면 안 만듦 · system · 섹션 목록이 없으면 만들지 않는다', async () => {
    const prisma = await db();
    const { syncOrg } = await import('@/server/rollup/auto');
    const runs = await orgRuns();
    expect(runs.every((r) => r.createdBy === 'system' && r.status === 'succeeded')).toBe(true);
    const n = runs.length;
    await syncOrg(await slot(), opts);
    expect(await orgRuns()).toHaveLength(n);
    // 섹션 목록이 없으면 — 총괄의 설정을 만들지 않는다(이 시험 부서들은 기본 13개 이름에 없어 들어갈 것도 없다)
    const saved = await prisma.orgSection.findMany();
    await prisma.orgSection.deleteMany({});
    try {
      await syncOrg(await slot(), opts);
      expect(await prisma.orgSection.count()).toBe(0);
    } finally {
      await prisma.orgSection.createMany({ data: saved });
    }
  });

  it('[RU-T110] ★ 읽기 수리 — 열쇠가 낡은 채 /hq를 열면 그리기 전에 맞춘다 · 맞으면 실행 없음 · 남의 본부를 readAll이 열어도 조립은 system', async () => {
    const { syncUnit } = await import('@/server/rollup/handoff');
    await merged('u2', '실둘 요청 밖에서 올라옴');
    expect(await syncUnit(divId.u2, await slot(), opts)).not.toBeNull(); // 사본은 올라갔는데 조립은 아직(요청 뒤 일이 죽은 경우)
    const n = (await hqRuns('hq')).length;
    const hq = await import('@/app/api/rollup/hq/route');
    const res = await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}&node=${DIV.hq.slug}`, ID.coord));
    expect(res.status).toBe(200);
    const board = (await res.json()).board;
    expect(await hqRuns('hq')).toHaveLength(n + 1);
    expect(board.current.id).toBe((await hqRuns('hq')).at(-1)!.id);
    expect((await hqRuns('hq')).at(-1)!.createdBy).toBe('system');
    await hq.GET(nx(`/api/rollup/hq?isoKey=${isoKey}`, ID.hqLead));
    expect(await hqRuns('hq')).toHaveLength(n + 1);
  });

  it('[RU-T112] 10분 넘게 running인 조립 → 실패로 보고 다시 만든다', async () => {
    const prisma = await db();
    const { syncUnit, } = await import('@/server/rollup/handoff');
    const { syncHq } = await import('@/server/rollup/auto');
    const { hqInputs, hqInputKey } = await import('@/server/rollup/run');
    await merged('u2', '실둘 죽은 조립');
    await syncUnit(divId.u2, await slot(), opts);
    const nd = await node('hq');
    const key = await hqInputKey(nd, await hqInputs(nd, await slot()));
    const dead = await prisma.rollupRun.create({
      data: { level: 'hq', divisionId: divId.hq, weekSlotId: (await slot()).id, status: 'running', inputIds: '[]', createdBy: 'system', inputKey: key, startedAt: new Date(Date.now() - 11 * 60_000) },
    });
    await syncHq(nd, await slot(), opts);
    expect((await prisma.rollupRun.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('failed');
    const last = (await hqRuns('hq')).at(-1)!;
    expect([last.status, last.inputKey]).toEqual(['succeeded', key]);
  });

  it('[RU-T111] 전사본 [다시 시도] — 총괄 200 · 실·팀 담당자·실장·본부 담당자 404 · 실패를 고치면 성공', async () => {
    const prisma = await db();
    const { writeFileAtomic } = await import('@/server/storage');
    const org = await import('@/app/api/rollup/org/route');
    for (const who of [ID.u1Lead, ID.u1Head, ID.hqLead]) expect((await org.POST(nx('/api/rollup/org', who, jsonInit('POST', { isoKey })))).status, who).toBe(404);
    // 총괄 부서(단독단) 양식이 깨진다 → 섹션이 바뀌면 실패
    await prisma.template.updateMany({ where: { divisionId: divId.solo }, data: { isActive: false } });
    await writeFileAtomic('divisions/AUTO_SOLO/template/broken.hwp', Buffer.from('BROKEN'));
    await prisma.template.create({ data: { divisionId: divId.solo, filePath: 'divisions/AUTO_SOLO/template/broken.hwp', sha256: 'b', version: 2, uploadedBy: 'seed' } });
    const { syncOrg } = await import('@/server/rollup/auto');
    await syncOrg(await slot(), { cause: 'template', causedBy: null });
    expect((await orgRuns()).at(-1)!.status).toBe('failed');
    const { orgRunState } = await import('@/server/rollup/orgrun');
    const state = await orgRunState(await slot());
    expect(state.failed?.errorText).toContain('제목 문단');
    expect(state.current?.status).toBe('succeeded'); // 받을 판(그 전 것)은 그대로
    expect((await org.POST(nx('/api/rollup/org', ID.coord, jsonInit('POST', { isoKey })))).status).toBe(500);
    await prisma.template.updateMany({ where: { divisionId: divId.solo }, data: { isActive: false } });
    await writeFileAtomic('divisions/AUTO_SOLO/template/v3.hwp', Buffer.from('양식:총괄'));
    await prisma.template.create({ data: { divisionId: divId.solo, filePath: 'divisions/AUTO_SOLO/template/v3.hwp', sha256: 'g', version: 3, uploadedBy: 'seed' } });
    expect((await org.POST(nx('/api/rollup/org', ID.coord, jsonInit('POST', { isoKey })))).status).toBe(200);
    expect((await orgRuns()).at(-1)!.status).toBe('succeeded');
  });
});

describe('RU-77 비상구 — 승인 없이 올리기', () => {
  it('[RU-T113] ★ 실·팀: 기한 15분 전보다 이르면 too_early · 미리보기면 not_final · U1·U3에서 → unapproved(lead) · 이미 올라갔으면 already_sent · 뒤에 승인하면 대신 · 창은 마감 예외를 따라', async () => {
    const prisma = await db();
    const { hqBoard } = await import('@/server/rollup/run');
    await merged('u1', '실하나 실장 출장');
    expect((await unitState('u1')).state).toBe('U3');
    // 기한을 멀리 — 창이 아직 안 열렸다
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { unitDueMinutes: 14 * 24 * 60, hqDueMinutes: 15 * 24 * 60 } });
    let r = await escape(ID.u1Lead, 'unit');
    expect([r.status, (await r.json()).error]).toEqual([409, 'too_early']);
    expect((await unitState('u1')).escape?.open).toBe(false);
    // 게이트 — head·member·총괄은 404 (head는 승인하면 된다)
    for (const who of [ID.u1Head, ID.u1Member, ID.coord]) expect((await escape(who, 'unit')).status, who).toBe(404);
    await dueNow();
    expect((await unitState('u1')).escape?.open).toBe(true);
    r = await escape(ID.u1Lead, 'unit');
    expect(r.status).toBe(200);
    expect((await r.json()).basis).toBe('unapproved');
    const sub = (await current('u1'))!;
    expect([sub.basis, sub.submittedBy, sub.cause, sub.sha256]).toEqual(['unapproved', userId.u1Lead, 'escape', (await viewed('u1')).sha256]);
    expect((await unitState('u1')).state).toBe('U4');
    r = await escape(ID.u1Lead, 'unit');
    expect([r.status, (await r.json()).error]).toEqual([409, 'already_sent']);
    await settle();
    // 본부 화면 — 주황 「부서장 승인 없이」
    const { chipOf } = await import('@/server/rollup/view');
    const board = await hqBoard(await node('hq'), await slot());
    expect(chipOf(board.units.find((u) => u.division.nameKo === '실하나')!).kind).toBe('unapproved');
    // 부서장이 나중에 그대로 승인 → 같은 바이트라도 근거가 바뀌므로 새 행 (DM-18b)
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200);
    const approved = (await current('u1'))!;
    expect([approved.basis, approved.sha256]).toEqual(['approved', sub.sha256]);
    expect(approved.id).not.toBe(sub.id);
    await settle();
    // 마감 예외로 기준 시각이 뒤로 가면 창도 같이 간다 (WS-19)
    await merged('u1', '실하나 예외 주');
    await prisma.weekSlot.update({ where: { isoKey }, data: { deadlineDowOverride: 7, deadlineTimeOverride: '23:00' } });
    try {
      r = await escape(ID.u1Lead, 'unit');
      expect([r.status, (await r.json()).error]).toEqual([409, 'too_early']);
      // 기한은 지났는데(창 안) 지금 판이 마감 전 미리보기면 not_final — 기준 시각이 옮겨졌으니 그 둘레로 다시 잡는다
      await dueNow();
      r = await escape(ID.u1Lead, 'unit');
      expect([r.status, (await r.json()).error]).toEqual([409, 'not_final']);
    } finally {
      await prisma.weekSlot.update({ where: { isoKey }, data: { deadlineDowOverride: null, deadlineTimeOverride: null } });
      await dueNow();
    }
    // 부서장 없는 단위에는 비상구가 없다 — 저절로 올라간다
    r = await escape(ID.u2Lead, 'unit');
    expect([r.status, (await r.json()).error]).toEqual([409, 'no_head']);
  });

  it('[RU-T114] 본부: 「본부 → 총괄」 기한 기준 · 승인 안 된 지금 본부본만 · 주황 · 뒤에 본부장이 승인하면 대신', async () => {
    const prisma = await db();
    const { hqBoard } = await import('@/server/rollup/run');
    await settle();
    let board = await hqBoard(await node('hq'), await slot());
    expect(['Q1', 'Q3']).toContain(board.state);
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { hqDueMinutes: 15 * 24 * 60 } });
    let r = await escape(ID.hqLead, 'hq');
    expect([r.status, (await r.json()).error]).toEqual([409, 'too_early']);
    await dueNow();
    for (const who of [ID.hqHead, ID.hqMember, ID.u1Lead, ID.coord]) expect((await escape(who, 'hq')).status, who).toBe(404);
    expect((await escape(ID.hq2Lead, 'hq')).status).toBe(409); // 본부장 없는 본부 — 저절로 간다 (no_head)
    r = await escape(ID.hqLead, 'hq');
    expect(r.status).toBe(200);
    const sub = (await current('hq', 'hq'))!;
    expect([sub.basis, sub.submittedBy]).toEqual(['unapproved', userId.hqLead]);
    board = await hqBoard(await node('hq'), await slot());
    expect(board.state).toBe('Q4');
    expect((await escape(ID.hqLead, 'hq')).status).toBe(409);
    await settle();
    const { resolveSections } = await import('@/server/rollup/sections');
    expect((await resolveSections(await slot())).find((s) => s.section.title === '본부가(실하나)')!.flag).toBe('unapproved');
    expect((await hqApprove(ID.hqHead)).status).toBe(200);
    expect((await current('hq', 'hq'))!.basis).toBe('approved');
    expect((await hqBoard(await node('hq'), await slot())).state).toBe('Q2');
    await settle();
  });
});

describe('RU-72 스케줄러 없이 끝까지 · RU-T130 메신저 꺼짐', () => {
  it('[RU-T99] ★ [지금 병합] → 부서장 승인 → (요청 뒤) 본부본 → 본부장 승인 → 전사본 — 스케줄러를 부르지 않는다', async () => {
    const auto = await import('@/server/rollup/auto');
    const merge = await import('@/server/merge/run');
    const spySync = vi.spyOn(auto, 'runDueRollupSync');
    const spyMerge = vi.spyOn(merge, 'runDueMerges');
    hooks.nextMerge.set(divId.u1, '실하나 끝까지 간 판');
    expect((await mergeNow(ID.u1Lead)).status).toBe(200);
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200);
    await settle();
    const { hqBoard } = await import('@/server/rollup/run');
    let board = await hqBoard(await node('hq'), await slot());
    expect(board.current!.units.some((u) => u.name === '본부가(실하나)')).toBe(true);
    expect(board.state).toBe('Q3');
    expect((await hqApprove(ID.hqHead)).status).toBe(200);
    await settle();
    board = await hqBoard(await node('hq'), await slot());
    expect(board.state).toBe('Q2');
    const org = JSON.parse((await stored((await orgRuns()).at(-1)!.outputPath!)).toString()) as [string, string | null][];
    expect(org.find((s) => s[0] === '본부가(실하나)')![1]).toContain('실하나 끝까지 간 판');
    expect(spySync).not.toHaveBeenCalled();
    expect(spyMerge).not.toHaveBeenCalled();
    spySync.mockRestore();
    spyMerge.mockRestore();
  });

  it('[RU-80 · RU-T122] 「위로」 상태의 행방 — 본부 도착 → 본부장 승인 → 총괄 도착 (시각만) · member는 행방을 받지 않는다', async () => {
    const report = await import('@/app/api/rollup/report/route');
    const lead = (await (await report.GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Lead))).json()).state;
    expect(lead.state).toBe('U2');
    expect(lead.target).toBe('본부가');
    expect(lead.trail.hqArrivedKst).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
    expect(lead.trail.hqApprovedKst).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
    expect(lead.trail.orgArrivedKst).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
    expect(JSON.stringify(lead)).not.toContain('실둘'); // 다른 단위의 이름·본부본 내용은 없다
    const member = (await (await report.GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Member))).json()).state;
    expect(member.trail).toBeNull();
    expect(member.escape).toBeNull();
  });

  it('[RU-T130] 메신저가 꺼진 동안 흐름은 끝까지 갔고, 알림 기록은 하나도 없다', async () => {
    expect(await (await db()).notifyLog.count()).toBe(0);
  });
});

describe('RU-80·82·83 화면 — 버튼이 아니라 상태 (그린 결과의 부품과 값)', () => {
  type El = { type: unknown; props: Record<string, unknown> };
  const elements = (node: unknown, out: El[] = []): El[] => {
    if (Array.isArray(node)) node.forEach((n) => elements(n, out));
    else if (node && typeof node === 'object' && 'type' in node && 'props' in node) {
      out.push(node as El);
      for (const v of Object.values((node as El).props ?? {})) elements(v, out);
    }
    return out;
  };
  const named = (els: El[], n: string) => els.filter((e) => typeof e.type === 'function' && (e.type as { name: string }).name === n);
  const props = (els: El[], n: string) => named(els, n)[0]?.props as Record<string, never> | undefined;

  beforeAll(async () => {
    await (await db()).user.updateMany({ data: { mustChangePassword: false } });
  });

  it('[RU-T115] 수합 관리 — 「위로」 카드는 상태(U2 · 받는 곳 · 행방), 부서장의 [승인] 옆은 「승인하면 바로 본부가에」 · [제출] 카드는 없다', async () => {
    const { ManageView } = await import('@/app/[division]/manage/ManageView');
    const d = await (await db()).division.findUniqueOrThrow({ where: { id: divId.u1 } });
    const base = { division: d, canMerge: true, canDownloadMerged: true, canDeleteAny: false, canEditMerged: true, canApprove: true };
    const els = elements(await ManageView({ ...base, handoff: { escape: false } }));
    const view = props(els, 'HandoffCard')!.view as unknown as { state: string; target: string; trail: unknown; escape: unknown };
    expect([view.state, view.target, view.escape]).toEqual(['U2', '본부가', null]);
    expect(view.trail).not.toBeNull();
    expect(props(els, 'MergePanel')!.handoffTo).toBe('본부가');
    expect(named(els, 'ReportSubmitCard')).toHaveLength(0);
    // 내 부서의 lead·head가 아니면(총괄이 읽기로 연 화면) 카드가 없다 (TACP-9)
    expect(named(elements(await ManageView({ ...base, handoff: null })), 'HandoffCard')).toHaveLength(0);
  });

  it('[RU-T116] /hq — 본부본 카드는 상태 · 본부장에게 [승인](본 판 runId·sha) · 담당자에게는 승인 없음 · 읽기로 연 총괄에게는 [다시 시도]도 없음', async () => {
    const { default: HqPage } = await import('@/app/hq/page');
    const v = (await hqViewed('hq'))!;
    pageAs.who = ID.hqHead;
    let els = elements(await HqPage({ searchParams: Promise.resolve({}) }));
    const run = props(els, 'RunCard')!;
    expect([(run.current as unknown as { id: string }).id, run.failed, run.canRetry]).toEqual([v.runId, null, true]);
    let approval = props(els, 'HqApprovalCard')!;
    expect([approval.canApprove, approval.viewed, approval.state]).toEqual([true, v, 'Q2']);
    pageAs.who = ID.hqLead;
    els = elements(await HqPage({ searchParams: Promise.resolve({}) }));
    approval = props(els, 'HqApprovalCard')!;
    expect(approval.canApprove).toBe(false);
    expect(approval.escape).not.toBeNull(); // 비상구는 본부 lead에게만 (창이 열렸을 때만 화면이 그린다)
    pageAs.who = ID.coord;
    els = elements(await HqPage({ searchParams: Promise.resolve({ node: DIV.hq.slug }) }));
    expect([props(els, 'RunCard')!.canRetry, props(els, 'HqApprovalCard')!.canApprove, props(els, 'HqApprovalCard')!.escape]).toEqual([false, false, null]);
    pageAs.who = '';
  });

  it('[RU-T117] /org — 전사본은 늘 준비돼 있다: 가장 최근 성공한 판 · 실패 없음 · 받은 적 없으면 「받은 뒤 바뀜」 없음', async () => {
    const { default: OrgPage } = await import('@/app/org/page');
    pageAs.who = ID.coord;
    const els = elements(await OrgPage({ searchParams: Promise.resolve({}) }));
    const card = props(els, 'OrgRunCard')!;
    const last = (await orgRuns()).filter((r) => r.status === 'succeeded').at(-1)!;
    expect([(card.run as unknown as { id: string }).id, card.failed, card.changedSinceDownload]).toEqual([last.id, null, null]);
    pageAs.who = '';
  });
});

describe('RU-84 · RU-T115~117 — 화면에서 뺀 버튼', () => {
  const ROOT = path.resolve(__dirname, '..');
  const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
  /** 주석을 뺀 코드 — 「예전에는 [이어 붙이기]였다」 같은 설명은 남아도 된다 */
  const code = (f: string) =>
    read(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('[RU-T115] 수합 관리: [제출]·[다시 제출]·[제출 취소]·[보낸 것 받기]가 없다 — 「위로」 카드의 버튼은 비상구 링크뿐', () => {
    expect(readdirSync(path.join(ROOT, 'src/components'))).not.toContain('ReportSubmitCard.tsx');
    const view = code('src/app/[division]/manage/ManageView.tsx');
    expect(view).toContain('<HandoffCard');
    const card = code('src/components/HandoffCard.tsx');
    for (const w of ['다시 제출', '제출 취소', '보낸 것 받기', '에 제출']) expect(card, w).not.toContain(w);
    expect(card.match(/<button/g)).toHaveLength(3); // 비상구 링크 · 확인 · 아니오
    expect(card).toContain('부서장 승인 없이 올리기');
  });

  it('[RU-T116] /hq: [이어 붙이기]·[총괄에 제출]이 없다 · [다시 시도]는 실패일 때만 · 승인은 본 판(runId·sha)을 싣는다', () => {
    const desk = code('src/components/RollupDesk.tsx');
    expect(desk).not.toMatch(/이어 붙이기<|'이어 붙이기'|다시 이어 붙이기/);
    expect(desk).toContain('{failed && canRetry && (');
    const page = code('src/app/hq/page.tsx');
    expect(page).not.toContain('ReportSubmitCard');
    const approval = code('src/components/HqApprovalCard.tsx');
    expect(approval).not.toContain('총괄에 제출');
    expect(approval).toContain("post('/api/rollup/hq/approve', { isoKey, ...viewed }");
  });

  it('[RU-T117] /org: [전사 취합본 만들기]·[다시 만들기]가 없다 · [다시 시도]는 실패일 때만 · 「받은 뒤 바뀜」은 받은 사람에게만', () => {
    const card = code('src/components/OrgRunCard.tsx');
    expect(card).not.toMatch(/전사 취합본 만들기|다시 만들기/);
    expect(card).toContain('{failed && (');
    expect(code('src/server/org-board.ts')).toContain('changedSinceDownload(slot, viewer.email');
  });
});

// ── 검증(2026-10-08) — 엇갈림을 더 세게 ─────────────────────────────
// 위 이야기가 지나간 뒤의 상태(실하나 U2 · 본부가 승인됨)에서 시작한다. 사람의 「명시적 결정」이 언제나 마지막 말이어야 하고,
// 화면·표시가 기다리라고 하는 사람이 실제로 할 일이 있어야 한다.
describe('검증 — 비상구 뒤 되돌림 · 같은 바이트 · 동시 승인 · 스케줄러 경쟁', () => {
  it('[RU-T131] 비상구로 다른 판이 올라간 뒤, 앞서 승인했던 판으로 되돌려 부서장이 다시 승인 → 그 판이 다시 올라간다(「이미 승인한 판」으로 무시하지 않는다)', async () => {
    await merged('u1', '실하나 되돌림 원본');
    expect((await save(ID.u1Head, 'u1', '실하나 실장 판 X')).status).toBe(200);
    const x = (await current('u1'))!;
    expect(x.basis).toBe('approved');
    expect((await save(ID.u1Lead, 'u1', '실하나 담당자 판 Y')).status).toBe(200);
    expect((await escape(ID.u1Lead, 'unit')).status).toBe(200);
    expect((await current('u1'))!.basis).toBe('unapproved');
    // 담당자가 실장 판으로 되돌린다 — 바이트까지 같다
    expect((await save(ID.u1Lead, 'u1', '실하나 실장 판 X')).status).toBe(200);
    expect((await viewed('u1')).sha256).toBe(x.sha256);
    // 위에는 아직 승인 없이 올린 Y가 있다 — 부서장이 지금 보는 X를 승인하면 X가 올라가야 한다
    const res = await approve(ID.u1Head, 'u1');
    expect(res.status).toBe(200);
    expect((await res.json()).handedOff?.target).toBe('본부가');
    const now = (await current('u1'))!;
    expect([now.sha256, now.basis]).toEqual([x.sha256, 'approved']);
    expect((await unitState('u1')).state).toBe('U2');
    // 비상구도 「이미 올라가 있다」고 거짓말하지 않는다 — 이제는 정말 올라가 있다
    const again = await escape(ID.u1Lead, 'unit');
    expect([again.status, (await again.json()).error]).toEqual([409, 'already_sent']);
    await settle();
  });

  it('[RU-T132] 다시 병합해 같은 바이트가 나온 새 실행을 승인 → 새 사본은 없지만 응답(그리고 NT-46′)은 「올라가 있음」', async () => {
    const prisma = await db();
    await merged('solo', '단독단 같은 바이트');
    expect((await approve(ID.soloHead, 'solo')).status).toBe(200);
    await settle();
    const before = await prisma.reportSubmission.count({ where: { divisionId: divId.solo } });
    await merged('solo', '단독단 같은 바이트'); // 새 실행, 같은 바이트
    const body = await (await approve(ID.soloHead, 'solo')).json();
    expect(body.unchanged).toBe(false); // 새 실행에 대한 승인은 남는다
    expect(body.handedOff?.target).toBe('총괄'); // 승인한 판은 위에 있다 — 담당자에게 「게시판에 올리세요」라고 하지 않는다
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.solo } })).toBe(before); // RU-02 — 같은 판·같은 근거면 새 행 없음
    await settle();
  });

  it('[RU-T133] 비상구 사본을 부서장이 같은 바이트로 승인 → 본부본이 같은 바이트로 다시 만들어져 본부장 승인 유지 → 「전사」 칩은 「본부장 재승인 대기」가 아니다', async () => {
    const { hqBoard } = await import('@/server/rollup/run');
    const { resolveSections } = await import('@/server/rollup/sections');
    if ((await hqBoard(await node('hq'), await slot())).state !== 'Q2') expect((await hqApprove(ID.hqHead)).status).toBe(200);
    await settle();
    await merged('u1', '실하나 비상구 판 Z');
    expect((await escape(ID.u1Lead, 'unit')).status).toBe(200);
    await settle();
    expect((await hqApprove(ID.hqHead)).status).toBe(200); // 본부장은 비상구 사본이 든 판을 승인했다
    await settle();
    expect((await approve(ID.u1Head, 'u1')).status).toBe(200); // 부서장이 같은 판을 뒤늦게 승인 — 새 사본(근거만 바뀜)
    await settle();
    const board = await hqBoard(await node('hq'), await slot());
    expect([board.state, board.approval?.changedAfter]).toEqual(['Q2', false]); // 본부장이 할 일은 없다
    const src = (await resolveSections(await slot())).find((s) => s.section.title === '본부가(실하나)')!;
    expect([src.kind, src.flag]).toEqual(['tincase', undefined]);
  });

  it('[RU-T134] 본부: 비상구로 다른 판이 총괄에 간 뒤 본부본이 승인했던 바이트로 돌아옴 → 본부장 승인이 그 판을 다시 총괄로', async () => {
    const { hqBoard } = await import('@/server/rollup/run');
    // 실둘(부서장 없음)의 판을 T로 두고 본부장 승인
    expect((await save(ID.u2Lead, 'u2', '실둘 T')).status).toBe(200);
    await settle();
    expect((await hqApprove(ID.hqHead)).status).toBe(200);
    await settle();
    const h1 = (await current('hq', 'hq'))!;
    // 실둘이 T2로 → 본부본이 바뀌고 본부 담당자가 비상구로 총괄에
    expect((await save(ID.u2Lead, 'u2', '실둘 T2')).status).toBe(200);
    await settle();
    expect((await escape(ID.hqLead, 'hq')).status).toBe(200);
    expect((await current('hq', 'hq'))!.basis).toBe('unapproved');
    // 실둘이 T로 되돌린다 → 본부본이 승인했던 바이트로
    expect((await save(ID.u2Lead, 'u2', '실둘 T')).status).toBe(200);
    await settle();
    expect((await hqViewed('hq'))!.sha256).toBe(h1.sha256);
    const board = await hqBoard(await node('hq'), await slot());
    expect(board.state).toBe('Q3'); // 총괄에는 승인 없이 간 T2
    const res = await hqApprove(ID.hqHead);
    expect(res.status).toBe(200);
    const now = (await current('hq', 'hq'))!;
    expect([now.sha256, now.basis]).toEqual([h1.sha256, 'approved']);
    expect((await hqBoard(await node('hq'), await slot())).state).toBe('Q2');
    await settle();
  });

  it('[RU-T135] 같은 본부본을 본부장 둘이 동시에 승인 → 승인 하나 · 본부 사본 하나', async () => {
    const prisma = await db();
    // 실둘이 바뀌어 승인이 풀린 상태에서
    expect((await save(ID.u2Lead, 'u2', '실둘 동시 승인 전')).status).toBe(200);
    await settle();
    const v = (await hqViewed('hq'))!;
    const reviews = await prisma.mergeReview.count({ where: { divisionId: divId.hq, kind: 'hq_approve' } });
    const subs = await prisma.reportSubmission.count({ where: { divisionId: divId.hq, level: 'hq' } });
    const rs = await Promise.all([hqApprove(ID.hqHead, v), hqApprove(ID.hqHead, v)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect((await Promise.all(rs.map((r) => r.json()))).map((j) => j.unchanged).sort()).toEqual([false, true]);
    expect(await prisma.mergeReview.count({ where: { divisionId: divId.hq, kind: 'hq_approve' } })).toBe(reviews + 1);
    expect(await prisma.reportSubmission.count({ where: { divisionId: divId.hq, level: 'hq' } })).toBe(subs + 1);
    await settle();
  });

  it('[RU-T136] 본부장 승인과 다시 이어 붙이기가 엇갈림 → 승인은 언제나 본 판(sha)에만, 본 판이 아니면 409', async () => {
    const prisma = await db();
    const { syncHq } = await import('@/server/rollup/auto');
    const v = (await hqViewed('hq'))!;
    // 본 뒤에 실둘이 바뀐다 — 사본은 들어왔고, 이어 붙이기와 승인이 동시에
    await merged('u2', '실둘 엇갈림');
    const { syncUnit } = await import('@/server/rollup/handoff');
    expect(await syncUnit(divId.u2, await slot(), opts)).not.toBeNull();
    const [, res] = await Promise.all([syncHq(await node('hq'), await slot(), opts), hqApprove(ID.hqHead, v)]);
    expect([200, 409]).toContain(res.status);
    const last = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.hq, kind: 'hq_approve' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (res.status === 200 && !(await res.json()).unchanged) expect(last.sha256).toBe(v.sha256); // 승인했다면 본 판
    const sub = (await current('hq', 'hq'))!;
    expect(sha(await stored(sub.filePath))).toBe(sub.sha256); // 총괄에 간 것은 언제나 기록한 sha 그대로
    await settle();
  });

  it('[RU-T137] 스케줄러의 맞추기(syncAll)와 부서장 승인이 동시에 → 승인 하나에 사본 하나, 지금 사본 = 가장 최근 승인', async () => {
    const prisma = await db();
    const { syncAll } = await import('@/server/rollup/auto');
    await merged('u1', '실하나 스케줄러와 경쟁');
    const v = await viewed('u1');
    const [res] = await Promise.all([approve(ID.u1Head, 'u1', v), syncAll(await slot(), { cause: 'scheduler', causedBy: null }), syncAll(await slot(), { cause: 'scheduler', causedBy: null })]);
    expect(res.status).toBe(200);
    await settle();
    const latest = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.u1, kind: { not: 'hq_approve' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const sub = (await current('u1'))!;
    expect([sub.reviewId, sub.sha256]).toEqual([latest.id, v.sha256]);
    const withReview = await prisma.reportSubmission.findMany({ where: { reviewId: { not: null } }, select: { reviewId: true } });
    expect(new Set(withReview.map((s) => s.reviewId)).size).toBe(withReview.length);
  });

  it('[RU-T138] rollupSelf 본부의 본부장 — 자기 병합본 승인(실·팀 단계)과 본부본 승인이 같은 부서 id로 살아도 서로를 「이미 승인」으로 세지 않는다', async () => {
    const prisma = await db();
    const { hqBoard } = await import('@/server/rollup/run');
    const { latestReview } = await import('@/server/merge/review');
    const order = await import('@/app/api/rollup/hq/order/route');
    expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u1, divId.u2, divId.hq], self: true })))).status).toBe(200);
    await settle();
    try {
      await merged('hq', '본부가 자체 문서');
      const res = await (await approve(ID.hqHead, 'hq')).json();
      expect(res.handedOff?.target).toBe('본부가'); // 본부 자신의 문서도 그 본부 단계로 (RU-08)
      const own = (await current('hq', 'unit'))!;
      const unitReview = await prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.hq, kind: { not: 'hq_approve' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      expect([own.basis, own.reviewId]).toEqual(['approved', unitReview.id]);
      await settle();
      let board = await hqBoard(await node('hq'), await slot());
      expect(board.current!.units.map((u) => u.divisionId)).toContain(divId.hq);
      expect(['Q1', 'Q3']).toContain(board.state); // 본부본이 바뀌었다 — 본부장 승인을 기다린다
      expect((await hqApprove(ID.hqHead)).status).toBe(200);
      await settle();
      board = await hqBoard(await node('hq'), await slot());
      expect(board.state).toBe('Q2');
      // 자기 병합본을 같은 판으로 다시 승인 → 「이미 승인」(hq_approve가 끼어들지 않는다), 본부 사본은 그대로
      const hqSub = (await current('hq', 'hq'))!;
      expect((await (await approve(ID.hqHead, 'hq')).json()).unchanged).toBe(true);
      expect(await prisma.mergeReview.count({ where: { divisionId: divId.hq, kind: { not: 'hq_approve' } } })).toBe(1);
      expect([(await latestReview(divId.hq, (await slot()).id))?.kind, (await latestReview(divId.hq, (await slot()).id))?.changedAfter]).toEqual(['approve', false]);
      expect((await current('hq', 'hq'))!.id).toBe(hqSub.id);
      // 본부본을 같은 판으로 다시 승인 → 「이미 승인」 (자기 병합본 승인이 끼어들지 않는다)
      expect((await (await hqApprove(ID.hqHead)).json()).unchanged).toBe(true);
    } finally {
      expect((await order.PUT(nx('/api/rollup/hq/order', ID.hqLead, jsonInit('PUT', { order: [divId.u1, divId.u2], self: false })))).status).toBe(200);
      await settle();
    }
  });
});

// ── 운영자 결정 a~d (2026-10-08) — 「더 쉽게, 빠르게, 정확하게」, 비상구는 최소로 ─────────────────────────
// 위 이야기가 지나간 뒤의 상태에서 시작한다. 시험마다 필요한 상태를 먼저 만들고, 바꾼 설정(양식·사람)은 되돌린다.
describe('운영자 결정 a~d — 비상구 창 · 운영자 수정 · 병합 기록의 잠금 · 실패 상태의 승인', () => {
  type El = { type: unknown; props: Record<string, unknown> };
  const elements = (n: unknown, out: El[] = []): El[] => {
    if (Array.isArray(n)) n.forEach((x) => elements(x, out));
    else if (n && typeof n === 'object' && 'type' in n && 'props' in n) {
      out.push(n as El);
      for (const v of Object.values((n as El).props ?? {})) elements(v, out);
    }
    return out;
  };
  const props = (els: El[], name: string) =>
    els.find((e) => typeof e.type === 'function' && (e.type as { name: string }).name === name)?.props as Record<string, never> | undefined;

  it('[RU-T139] ★ (결정 a) 「본부 → 총괄」 기한 + 24시간이 지나면 비상구가 닫힌다 — 실·팀·본부 409 too_late · 링크 없음 · 지난 주차도 · 창 안이면 그대로', async () => {
    const { hqBoard } = await import('@/server/rollup/run');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const report = await import('@/app/api/rollup/report/route');
    // 실하나: 승인 안 된 지금 판(U1·U3) · 본부가: 실둘이 바뀌어 승인 안 된 본부본 — 창 안이면 둘 다 비상구를 쓸 수 있는 상태
    await merged('u1', '실하나 창 시험');
    expect(['U1', 'U3']).toContain((await unitState('u1')).state);
    expect((await save(ID.u2Lead, 'u2', '실둘 창 시험')).status).toBe(200);
    await settle();
    expect(['Q1', 'Q3']).toContain((await hqBoard(await node('hq'), await slot())).state);
    await dueNow(-25 * 60); // 「본부 → 총괄」 기한이 25시간 전 — 창은 1시간 전에 닫혔다
    try {
      let r = await escape(ID.u1Lead, 'unit');
      expect([r.status, (await r.json()).error]).toEqual([409, 'too_late']);
      r = await escape(ID.hqLead, 'hq');
      expect([r.status, (await r.json()).error]).toEqual([409, 'too_late']);
      // 화면 — 「위로」 카드도 /hq도 링크를 그리지 않는다 (열리기 전의 `open: false`와 달리 아예 없다)
      expect((await unitState('u1')).escape).toBeNull();
      expect((await (await report.GET(nx(`/api/rollup/report?level=unit&isoKey=${isoKey}`, ID.u1Lead))).json()).state.escape).toBeNull();
      pageAs.who = ID.hqLead;
      const { default: HqPage } = await import('@/app/hq/page');
      expect(props(elements(await HqPage({ searchParams: Promise.resolve({}) })), 'HqApprovalCard')!.escape).toBeNull();
    } finally {
      pageAs.who = '';
      await dueNow();
    }
    // 지난 주차 — 그 주의 「본부 → 총괄」 기한은 일주일 전이다
    const prev = await ensureCurrentSlot(new Date((await slot()).opensAt.getTime() - 3 * 86400_000));
    const old = await report.POST(nx('/api/rollup/report', ID.u1Lead, jsonInit('POST', { level: 'unit', isoKey: prev.isoKey, withoutApproval: true })));
    expect([old.status, (await old.json()).error]).toEqual([409, 'too_late']);
    // 창 안이면 그대로 — 실·팀·본부 모두 200
    expect((await escape(ID.u1Lead, 'unit')).status).toBe(200);
    expect((await escape(ID.hqLead, 'hq')).status).toBe(200);
    await settle();
  });

  it('[RU-T139] (경계 — 검증) 닫히는 시각 그 순간까지는 열려 있고 1ms 뒤에 닫힌다 · 열리는 시각도 · API·「위로」 카드·읽기 수리가 같은 끝 · 지난 주차도', async () => {
    const prisma = await db();
    const { requireScope } = await import('@/server/authz');
    const { escapeUnit, escapeHq, escapeOpensAt, escapeClosesAt, unitDue, unitTarget } = await import('@/server/rollup/handoff');
    const { liveUntil, stageTimes } = await import('@/server/rollup/schedule');
    const { isLiveSlot } = await import('@/server/rollup/auto');
    const { unitHandoffView } = await import('@/server/rollup/state');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const at = (d: Date, ms: number) => new Date(d.getTime() + ms);
    // 창 판정을 지났는지만 본다 — 창 밖이면 too_early/too_late, 창 안이면 그 뒤의 업무 규칙(already_sent·no_merge…)이나 성공
    const outcome = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? String(e);
      }
    };
    const inside = (c: string) => c !== 'too_early' && c !== 'too_late';
    const s = await slot();
    const t = await stageTimes(s);
    const closes = escapeClosesAt(t);
    // 셋이 같은 끝이다 — 따로 적히면 「화면은 옛 주를 맞추는데 비상구는 닫혔다」가 조용히 생긴다
    expect(closes.getTime()).toBe(liveUntil(t).getTime());
    expect(closes.getTime()).toBe(t.hqDue.getTime() + 24 * 3600_000);
    const unitScope = await requireScope(new Headers({ 'x-test-identity': ID.u1Lead }));
    const hqScope = await requireScope(new Headers({ 'x-test-identity': ID.hqLead }));
    const opens = escapeOpensAt(unitDue(t, (await unitTarget(divId.u1))!));

    // API — 닫히는 시각 그 순간은 창 안, 1ms 뒤는 too_late. 열리는 시각 1ms 전은 too_early, 그 순간은 창 안
    expect(await outcome(escapeUnit(unitScope, s, at(closes, 1)))).toBe('too_late');
    expect(inside(await outcome(escapeUnit(unitScope, s, closes)))).toBe(true);
    expect(await outcome(escapeUnit(unitScope, s, at(opens, -1)))).toBe('too_early');
    expect(inside(await outcome(escapeUnit(unitScope, s, opens)))).toBe(true);
    expect(await outcome(escapeHq(hqScope, await node('hq'), s, at(closes, 1)))).toBe('too_late');
    expect(await outcome(escapeHq(hqScope, await node('hq'), s, at(escapeOpensAt(t.hqDue), -1)))).toBe('too_early');
    expect(inside(await outcome(escapeHq(hqScope, await node('hq'), s, closes)))).toBe(true);
    await settle();

    // 「위로」 카드 — 지금 판이 승인 안 된 상태(U3)에서 같은 경계
    await merged('u1', '실하나 경계 시험');
    const d = await prisma.division.findUniqueOrThrow({ where: { id: divId.u1 } });
    const view = async (now: Date) => (await unitHandoffView(d, s, { trail: false, canEscape: true, now }))!;
    expect((await view(closes)).state).toBe('U3');
    expect((await view(closes)).escape).toEqual({ open: true, opensAtKst: expect.any(String) });
    expect((await view(at(closes, 1))).escape).toBeNull();
    expect((await view(at(opens, -1))).escape?.open).toBe(false);
    expect((await view(opens)).escape?.open).toBe(true);

    // 지난 주차 — 비상구는 그 주의 같은 끝에서 닫힌다. 읽기 수리(isLiveSlot)는 그 주가 「이번 주」인 동안은 끝이 지나도 계속 맞춘다 —
    // 결정 a의 의도된 차이다(이미 내린 결정의 결과를 맞추는 일과, 결정 없이 올리는 길은 다르다). 그 주가 지나고 끝도 지나면 둘 다 닫혀 있다
    const prev = await ensureCurrentSlot(new Date(s.opensAt.getTime() - 3 * 86400_000));
    const prevCloses = liveUntil(await stageTimes(prev));
    expect(inside(await outcome(escapeUnit(unitScope, prev, prevCloses)))).toBe(true);
    expect(await outcome(escapeUnit(unitScope, prev, at(prevCloses, 1)))).toBe('too_late');
    expect(await isLiveSlot(prev)).toBe(false);
  });

  it('[RU-T140] ★ (결정 b) 부서장 없는 단위 — 운영자의 수정 저장은 위로 가지 않는다(H2) · 스케줄러도 · lead의 저장·다시 병합은 올라간다 · lead가 그대로 받아들인 저장도', async () => {
    const prisma = await db();
    const { syncAll } = await import('@/server/rollup/auto');
    const { lastEditor, editsOf } = await import('@/server/merge/edits');
    const OP = 'a-u2-op@test.local';
    // 그 부서의 lead·head가 아닌 운영자 — §3.2 「수정 — write(자기 부서)」로 병합본을 고칠 수 있다
    const op = await prisma.user.create({ data: { email: OP, name: 'u2Op', divisionId: divId.u2, isOperator: true, mustChangePassword: false } });
    const lastOf = async () => lastEditor((await prisma.mergeRun.findUniqueOrThrow({ where: { id: (await viewed('u2')).runId } })).reviewJson);
    try {
      hooks.nextMerge.set(divId.u2, '실둘 결정b 병합');
      expect((await mergeNow(ID.u2Lead, { overwriteEdits: true })).status).toBe(200);
      await settle();
      const fromMerge = (await current('u2'))!;
      expect([fromMerge.basis, (await unitState('u2')).state]).toEqual(['no_head', 'H1']);

      // 운영자가 고친다 — 그 단위의 결론이 아니다: 사본 그대로, 화면은 H2, 기록에 역할
      expect((await save(OP, 'u2', '실둘 운영자 고침')).status).toBe(200);
      await settle();
      expect((await current('u2'))!.id).toBe(fromMerge.id);
      expect((await unitState('u2')).state).toBe('H2');
      expect((await lastOf())?.role).toBe('operator');
      // 스케줄러의 맞추기도 올리지 않는다 — 판정이 요청이 아니라 상태(고친 기록)에 있다
      await syncAll(await slot(), { cause: 'scheduler', causedBy: null });
      expect((await current('u2'))!.id).toBe(fromMerge.id);

      // 그 단위 lead가 그 위에 고쳐 저장 → 올라간다
      expect((await save(ID.u2Lead, 'u2', '실둘 담당자 확인')).status).toBe(200);
      const byLead = (await current('u2'))!;
      expect([byLead.basis, byLead.sha256]).toEqual(['no_head', (await viewed('u2')).sha256]);
      expect((await unitState('u2')).state).toBe('H1');

      // 운영자가 또 고친 뒤 [다시 병합] → 병합 결과가 올라간다
      expect((await save(OP, 'u2', '실둘 운영자 또 고침')).status).toBe(200);
      expect((await current('u2'))!.id).toBe(byLead.id);
      hooks.nextMerge.set(divId.u2, '실둘 결정b 다시 병합');
      expect((await mergeNow(ID.u2Lead, { overwriteEdits: true })).status).toBe(200);
      const remerged = (await current('u2'))!;
      expect(remerged.id).not.toBe(byLead.id);
      expect((await stored(remerged.filePath)).toString()).toContain('실둘 결정b 다시 병합');

      // 운영자가 고친 판을 lead가 바꾼 것 없이 그대로 저장 → 받아들인 것이다: 올라가고, 기록은 lead · places 0
      expect((await save(OP, 'u2', '실둘 운영자 판')).status).toBe(200);
      const opSha = (await viewed('u2')).sha256;
      expect((await current('u2'))!.id).toBe(remerged.id);
      expect((await save(ID.u2Lead, 'u2', '실둘 운영자 판')).status).toBe(200);
      const adopted = (await current('u2'))!;
      expect([adopted.sha256, adopted.basis]).toEqual([opSha, 'no_head']);
      const last = await lastOf();
      expect([last?.role, last?.places]).toEqual(['lead', 0]);
      // HM-49 — places 0 줄은 「고친 곳」에 세지 않는다(아무것도 안 바꾼 저장으로 [다시 병합]이 멈추지 않게)
      const edits = editsOf(await prisma.mergeRun.findUniqueOrThrow({ where: { id: (await viewed('u2')).runId } }))!;
      expect(edits.saves).toBe(1);
      await settle();
    } finally {
      await prisma.user.update({ where: { id: op.id }, data: { isActive: false } });
    }
  });

  it('[RU-T141] ★ (결정 c) 수정 저장이 병합본을 쓰려는 순간 병합이 끝난다 → 병합의 쓰기·기록은 저장 뒤로 줄을 선다 · 모델이 도는 동안에는 줄을 잡지 않는다', async () => {
    const prisma = await db();
    const { mergedRelPath } = await import('@/server/merge');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { editsOf } = await import('@/server/merge/edits');
    const s = await slot();
    const rel = mergedRelPath(DIV.u1.slug, s.year, s.label);
    const before = await merged('u1', '실하나 끼어들기 전');
    const v = await viewed('u1');
    hooks.nextMerge.set(divId.u1, '실하나 끼어든 병합');
    const box: { merge?: ReturnType<typeof runMergeRecorded> } = {};
    hooks.beforeWrite = async (p) => {
      if (p !== rel || box.merge) return;
      // 저장이 본 판을 확인하고 병합본을 쓰려는 순간 — 병합이 끝나 쓰고 기록하려 한다.
      // 잠금이 없으면 이 기다림 사이에 병합이 쓰고 성공을 기록하고, 곧이어 저장이 그 파일을 덮는다 — 새 실행이 담당자가 고친 바이트를 가리킨다
      box.merge = runMergeRecorded(divId.u1, s.id, 'manual', ID.u1Lead);
      await new Promise((r) => setTimeout(r, 200));
    };
    let res: Response;
    try {
      res = await save(ID.u1Lead, 'u1', '실하나 담당자가 고친 판', v);
    } finally {
      hooks.beforeWrite = undefined;
    }
    expect(res.status).toBe(200);
    const m = await box.merge!;
    expect(m.status).toBe('succeeded');
    const latest = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: divId.u1, weekSlotId: s.id, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    expect(latest.id).toBe(m.runId);
    // 가장 최근 실행이 가리키는 파일 = 그 병합의 바이트, 고친 기록은 옛 실행에 (새 실행은 병합 결과 그대로)
    expect((await stored(rel)).toString()).toContain('실하나 끼어든 병합');
    expect(editsOf(await prisma.mergeRun.findUniqueOrThrow({ where: { id: before.id } }))?.saves).toBe(1);
    expect(editsOf(latest)).toBeNull();
    await settle();

    // 모델이 도는 동안(엔진이 바이트를 만드는 중)에는 줄을 잡지 않는다 — 같은 부서의 저장이 병합을 기다리지 않고 끝난다
    const w = await viewed('u1');
    const during: { status?: number } = {};
    hooks.duringMerge = async (d) => {
      if (d !== divId.u1 || during.status !== undefined) return;
      during.status = (await save(ID.u1Lead, 'u1', '실하나 모델이 도는 동안 고침', w)).status;
    };
    try {
      expect((await runMergeRecorded(divId.u1, s.id, 'manual', ID.u1Lead)).status).toBe('succeeded');
    } finally {
      hooks.duringMerge = undefined;
    }
    expect(during.status).toBe(200);
    await settle();
  });

  it('[RU-T141] (엇갈림 — 검증) 병합이 줄 안에서 쓰고 기록하는 사이에 온 담당자 저장·부서장 승인은 그 뒤로 줄을 서고, 옛 판을 본 것이라 409 — 병합 결과를 덮지도, 옛 판을 승인하지도 않는다', async () => {
    const prisma = await db();
    const { mergedRelPath } = await import('@/server/merge');
    const { runMergeRecorded } = await import('@/server/merge/run');
    const { editsOf } = await import('@/server/merge/edits');
    const s = await slot();
    const rel = mergedRelPath(DIV.u1.slug, s.year, s.label);
    await merged('u1', '실하나 엇갈림 전');
    const v = await viewed('u1');
    const reviews = () => prisma.mergeReview.count({ where: { divisionId: divId.u1, weekSlotId: s.id } });
    const reviewsBefore = await reviews();
    hooks.nextMerge.set(divId.u1, '실하나 줄 안에서 쓴 병합');
    let engineDone = false;
    const box: { save?: Promise<Response>; approve?: Promise<Response> } = {};
    hooks.duringMerge = (d) => {
      if (d === divId.u1) engineDone = true;
    };
    hooks.beforeWrite = async (p) => {
      if (!engineDone || p !== rel || box.save) return;
      // 병합이 줄을 쥐고 병합본을 쓰려는 순간 — 그 전 판(v)을 본 담당자의 저장과 부서장의 승인이 도착한다.
      // 잠금이 없던 때는 이 틈에 저장이 병합본을 덮고(새 실행 = 담당자 바이트), 승인이 옛 실행·새 바이트를 엇갈려 보았다
      box.save = save(ID.u1Lead, 'u1', '실하나 옛 판을 보고 고침', v);
      box.approve = approve(ID.u1Head, 'u1', v);
      await new Promise((r) => setTimeout(r, 200));
    };
    let m: Awaited<ReturnType<typeof runMergeRecorded>>;
    try {
      m = await runMergeRecorded(divId.u1, s.id, 'manual', ID.u1Lead);
    } finally {
      hooks.beforeWrite = undefined;
      hooks.duringMerge = undefined;
    }
    expect(m.status).toBe('succeeded');
    expect(box.save && box.approve).toBeTruthy();
    const [rs, ra] = await Promise.all([box.save!, box.approve!]);
    expect([rs.status, (await rs.json()).error]).toEqual([409, 'merged_changed']);
    expect([ra.status, (await ra.json()).error]).toEqual([409, 'merged_changed']);
    const latest = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: divId.u1, weekSlotId: s.id, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    expect(latest.id).toBe(m.runId);
    expect((await stored(rel)).toString()).toContain('실하나 줄 안에서 쓴 병합');
    expect(editsOf(latest)).toBeNull();
    expect(await reviews()).toBe(reviewsBefore);
    await settle();
  });

  it('[RU-T142] ★ (결정 d) 본부본 다시 만들기가 실패해도(Qf) 본부장은 마지막 본부본(본 판)을 승인한다 — 화면에 [승인] · 본부 사본 = 그 실행 · 승인 뒤에는 없다', async () => {
    const prisma = await db();
    const { writeFileAtomic } = await import('@/server/storage');
    const { hqBoard } = await import('@/server/rollup/run');
    const { hqApprovable } = await import('@/lib/hq-state');
    // 승인 전인 본부본 — 실둘이 바뀌어 다시 이어 붙는다
    expect((await save(ID.u2Lead, 'u2', '실둘 실패 전 마지막 판')).status).toBe(200);
    await settle();
    let board = await hqBoard(await node('hq'), await slot());
    expect(['Q1', 'Q3', 'Q4']).toContain(board.state);
    const good = (await hqViewed('hq'))!;
    // 양식이 깨진 뒤 실둘이 또 바뀐다 → 다시 이어 붙이기 실패(Qf). 마지막 본부본은 그대로 good
    const tpl = await prisma.template.findFirstOrThrow({ where: { divisionId: divId.hq, isActive: true } });
    await prisma.template.updateMany({ where: { divisionId: divId.hq }, data: { isActive: false } });
    await writeFileAtomic('divisions/AUTO_HQ/template/broken-d.hwp', Buffer.from('BROKEN'));
    const broken = await prisma.template.create({ data: { divisionId: divId.hq, filePath: 'divisions/AUTO_HQ/template/broken-d.hwp', sha256: 'broken-d', version: 9, uploadedBy: 'seed' } });
    try {
      expect((await save(ID.u2Lead, 'u2', '실둘 실패할 판')).status).toBe(200);
      await settle();
      board = await hqBoard(await node('hq'), await slot());
      expect([board.state, board.current?.id]).toEqual(['Qf', good.runId]);
      expect(hqApprovable(board)).toBe(true);
      // 화면 — 본부장에게 [승인]이 그대로 있고, 실어 보낼 판은 마지막 본부본
      pageAs.who = ID.hqHead;
      const { default: HqPage } = await import('@/app/hq/page');
      const card = props(elements(await HqPage({ searchParams: Promise.resolve({}) })), 'HqApprovalCard')!;
      expect([card.state, card.canApprove, card.viewed]).toEqual(['Qf', true, good]);
      expect(hqApprovable({ state: card.state, lastGood: card.lastGood })).toBe(true);
      pageAs.who = '';
      // 본 판이 아니면 409 그대로 (RU-55)
      expect((await hqApprove(ID.hqHead, { runId: good.runId, sha256: 'f'.repeat(64) })).status).toBe(409);
      const res = await hqApprove(ID.hqHead, good);
      expect(res.status).toBe(200);
      expect((await res.json()).handedOff?.target).toBe('총괄');
      const sub = (await current('hq', 'hq'))!;
      expect([sub.sourceRunId, sub.sha256, sub.basis, sub.submittedBy]).toEqual([good.runId, good.sha256, 'approved', userId.hqHead]);
      // 실패는 실패대로 보이고(Qf), 마지막 본부본은 이제 승인돼 총괄에 있다 — [승인]은 없다
      board = await hqBoard(await node('hq'), await slot());
      expect([board.state, board.lastGood, hqApprovable(board)]).toEqual(['Qf', 'Q2', false]);
      await settle();
    } finally {
      pageAs.who = '';
      await prisma.template.update({ where: { id: broken.id }, data: { isActive: false } });
      await prisma.template.update({ where: { id: tpl.id }, data: { isActive: true } });
      const { syncHq } = await import('@/server/rollup/auto');
      await syncHq(await node('hq'), await slot(), { cause: 'template', causedBy: null });
      await settle();
    }
  });
});
