// LE-01~34 · TACP-18 v1.17 — 늦게 낸 사람 (ADR-0023). 두 길을 본다:
//   ① 대신 쓰기 — 담당자가 **낸 적 없는** 부서원의 표를 그 사람의 v1로 채운다 (LE-01~13)
//   ② 맨 뒤에 붙이기 — 병합이 끝난 뒤 늦게 낸 사람을 **다시 병합하지 않고** 병합본 끝에 붙인다 (LE-20~34)
// 조립은 진짜(`composeMergedHwp`·`readWorklog`)를 쓴다 — 「기존 행이 글자까지 그대로」는 흉내로는 볼 수 없다.
// 사람·부서 이름은 지어낸 것이다. 양식 픽스처(내부 문서)가 없으면 건너뛴다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-late-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
// 절대 경로 — 워크트리가 node_modules를 공유하면 상대 경로는 클라이언트가 만든 쪽(다른 워크트리)의 prisma/로 풀린다
const TEST_DB = path.resolve(__dirname, '../prisma/test-late-entry.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'aidt-kei';
process.env.MESSENGER_LINK_BASE = 'http://tincase.test';
delete process.env.DEV_IDENTITY;
vi.setConfig({ testTimeout: 30_000 });

const msgr = vi.hoisted(() => ({ on: true, outbox: [] as { to: string; subject: string; contents: string; kind?: string }[] }));
vi.mock('@/server/messenger', () => ({
  messengerStatus: () => (msgr.on ? { enabled: true, reason: '', allow: '전원' } : { enabled: false, reason: 'MESSENGER_URL 미설정', allow: '' }),
  sendAlert: async (input: { recvIds: string[]; subject: string; contents: string; kind?: string }) => {
    for (const to of input.recvIds) msgr.outbox.push({ to, subject: input.subject, contents: input.contents, kind: input.kind });
    return { requested: input.recvIds.length, sent: input.recvIds, blocked: [], disabled: false, errors: [] };
  },
}));

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
  lead: 'le-lead@test.kei.re.kr',
  head: 'le-head@test.kei.re.kr',
  op: 'le-op@test.kei.re.kr',
  member: 'le-member@test.kei.re.kr',
  coord: 'le-coord@test.kei.re.kr',
  otherLead: 'le-other-lead@test.kei.re.kr',
  noTplLead: 'le-notpl-lead@test.kei.re.kr',
};
/** 부서원 — 명단 순서는 sortOrder (가온 < 나래 < 다솜 < 라온 < 마루 < 바다) */
const NAMES = ['가온', '나래', '다솜', '라온', '마루', '바다'] as const;
type Who = (typeof NAMES)[number];

function nx(url: string, identity?: string, init?: RequestInit) {
  const r = new Request(`http://test.local${url}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(identity ? { 'x-test-identity': identity } : {}) },
  }) as Request & { nextUrl: URL };
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(`http://test.local${url}`);
  return r as never;
}
const post = (url: string, identity: string, body: unknown) =>
  nx(url, identity, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Row = string | [string, string?, string?, string?];
type Doc = { a?: Row[]; p?: Row[]; n?: Row[] };
type Bucket = 'achievements' | 'plans' | 'notes';
const KEYS: [keyof Doc, Bucket][] = [
  ['a', 'achievements'],
  ['p', 'plans'],
  ['n', 'notes'],
];

let tpl: Buffer;
let divId = '';
let seq = 0;
const U = {} as Record<Who, { id: string; name: string }>;

async function db() {
  return (await import('@/server/db')).prisma;
}

/** 슬롯 — n주 전. 0은 이번 주 */
async function wk(n: number) {
  const { ensureCurrentSlot } = await import('@/server/worklog');
  return ensureCurrentSlot(new Date(Date.now() - n * 7 * 86_400_000));
}

const cellsOf = (b: Bucket, list: Row[] = []) =>
  list.map((r, i) => {
    const [c, dt = '', pl = '', at = ''] = typeof r === 'string' ? [r] : r;
    return [`${b === 'achievements' ? 1 : b === 'plans' ? 2 : 3}-${i + 1}`, c, dt, pl, at];
  });

async function docBytes(doc: Doc, emphasis: Partial<Record<keyof Doc, boolean[]>> = {}) {
  const { composeMergedHwp } = await import('@/server/merge');
  const rows = { achievements: cellsOf('achievements', doc.a), plans: cellsOf('plans', doc.p), notes: cellsOf('notes', doc.n) };
  const em = {
    achievements: emphasis.a ?? (doc.a ?? []).map(() => false),
    plans: emphasis.p ?? (doc.p ?? []).map(() => false),
    notes: emphasis.n ?? (doc.n ?? []).map(() => false),
  };
  return composeMergedHwp(tpl, rows, em, '늦실').bytes;
}

/** 제출 행을 직접 만든다 (파일 포함). `raw`를 주면 그 바이트를 그대로 둔다 — 읽을 수 없는 파일 시험 */
async function submit(slotId: string, who: Who, doc: Doc, o: { version?: number; isLatest?: boolean; raw?: Buffer; emphasis?: Partial<Record<keyof Doc, boolean[]>> } = {}) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const bytes = o.raw ?? (await docBytes(doc, o.emphasis));
  const rel = `divisions/Le_A/submissions/seed_${++seq}.hwp`;
  await writeFileAtomic(rel, bytes);
  return prisma.submission.create({
    data: {
      divisionId: divId,
      userId: U[who].id,
      weekSlotId: slotId,
      version: o.version ?? 1,
      isLatest: o.isLatest ?? true,
      filePath: rel,
      originalName: `${who}.hwp`,
      byteSize: bytes.length,
      sha256: `seed${seq}`,
    },
  });
}

/**
 * 병합 뒤 모양을 만든다: `merged`에 든 사람들의 제출(v1)과 그 행을 이어 붙인 병합본, 그 병합본을 가리키는 성공 실행.
 * `rowAuthors`·`missing`은 병합이 남기는 것과 같은 꼴이다.
 */
async function seedMerge(slot: { id: string }, merged: [Who, Doc, Partial<Record<keyof Doc, boolean[]>>?][], missing: string[] = []) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const subs = [];
  const all: Doc = { a: [], p: [], n: [] };
  const em = { a: [] as boolean[], p: [] as boolean[], n: [] as boolean[] };
  const authors: Record<Bucket, { c: string; a: string[] }[]> = { achievements: [], plans: [], notes: [] };
  for (const [who, doc, e] of merged) {
    subs.push(await submit(slot.id, who, doc, { emphasis: e }));
    for (const [k, b] of KEYS) {
      for (const [i, r] of (doc[k] ?? []).entries()) {
        all[k]!.push(r);
        em[k].push(e?.[k]?.[i] ?? false);
        authors[b].push({ c: typeof r === 'string' ? r : r[0], a: [who] });
      }
    }
  }
  const rel = `divisions/Le_A/merged/m${++seq}.hwp`;
  const bytes = await docBytes(all, em);
  await writeFileAtomic(rel, bytes);
  const run = await prisma.mergeRun.create({
    data: {
      divisionId: divId,
      weekSlotId: slot.id,
      status: 'succeeded',
      outputPath: rel,
      sourceIds: JSON.stringify(subs.map((s) => s.id)),
      ruleSnapshot: '{}',
      rowCounts: JSON.stringify({ achievements: all.a!.length, plans: all.p!.length, notes: all.n!.length }),
      reviewJson: JSON.stringify({ missing, rowAuthors: authors }),
      outputSha: (await import('@/server/storage')).sha256(bytes),
      finishedAt: new Date(),
    },
  });
  return { subs, run, rel };
}

async function viewedBy(slot: { isoKey: string }, identity = ID.lead) {
  const { GET } = await import('@/app/api/division/merged/content/route');
  const v = await (await GET(nx(`/api/division/merged/content?isoKey=${slot.isoKey}`, identity))).json();
  return { runId: v.runId as string, sha256: v.sha256 as string, tables: v.tables as { key: Bucket; rows: string[][] }[] };
}

async function appendAs(identity: string, slot: { isoKey: string }, viewed?: { runId?: unknown; sha256?: unknown }) {
  const { POST } = await import('@/app/api/division/merged/append/route');
  const v = viewed ?? (await viewedBy(slot));
  return POST(post('/api/division/merged/append', identity, { isoKey: slot.isoKey, runId: v.runId, sha256: v.sha256 }));
}

async function proxyAs(identity: string, userId: string | undefined, isoKey: string | undefined, doc: Doc) {
  const { POST } = await import('@/app/api/submissions/proxy/route');
  const body = (b: Row[] | undefined) => (b ?? []).map((r) => (typeof r === 'string' ? { content: r } : { content: r[0], date: r[1], place: r[2], attendee: r[3] }));
  return POST(post('/api/submissions/proxy', identity, { userId, isoKey, achievements: body(doc.a), plans: body(doc.p), notes: body(doc.n) }));
}

/** 지금 병합본의 표 — 머리행을 뺀 [번호, 내용, 일자, 장소, 참석자] */
async function mergedTables(slot: { isoKey: string }) {
  const v = await viewedBy(slot);
  return Object.fromEntries(v.tables.map((t) => [t.key, t.rows.slice(1)])) as Record<Bucket, string[][]>;
}
const contents = (rows: string[][]) => rows.map((r) => r[1]);

async function mergedFile(runId: string) {
  const prisma = await db();
  const { readStoredFile } = await import('@/server/storage');
  const run = await prisma.mergeRun.findUniqueOrThrow({ where: { id: runId } });
  return readStoredFile(run.outputPath!);
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  rmSync(TEST_DB, { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  if (!hasFixtures) return;
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  tpl = readFileSync(path.join(FIX, 'master-template.hwp'));

  const div = await prisma.division.create({ data: { slug: 'Le_A', nameKo: '늦실', nameEn: 'Le_A', isActive: true, notifyEnabled: true } });
  const other = await prisma.division.create({ data: { slug: 'Le_B', nameKo: '옆실', nameEn: 'Le_B', isActive: true } });
  const noTpl = await prisma.division.create({ data: { slug: 'Le_C', nameKo: '양식없는실', nameEn: 'Le_C', isActive: true } });
  divId = div.id;
  await writeFileAtomic('divisions/Le_A/template/active.hwp', tpl);
  await prisma.template.create({ data: { divisionId: div.id, filePath: 'divisions/Le_A/template/active.hwp', sha256: 'x', version: 1, uploadedBy: 'seed' } });

  const mk = (email: string, divisionId: string, extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], divisionId, ...extra } });
  await mk(ID.lead, div.id, { divisionRole: 'lead' });
  await mk(ID.head, div.id, { divisionRole: 'head', jobTitle: '실장' });
  await mk(ID.op, div.id, { isOperator: true });
  await mk(ID.member, div.id);
  await mk(ID.coord, other.id, { isCoordinator: true });
  await mk(ID.otherLead, other.id, { divisionRole: 'lead' });
  await mk(ID.noTplLead, noTpl.id, { divisionRole: 'lead' });
  for (const [i, name] of NAMES.entries()) {
    const u = await prisma.user.create({ data: { email: `le-m${i}@test.kei.re.kr`, name, divisionId: div.id, sortOrder: (i + 1) * 10 } });
    U[name] = { id: u.id, name };
  }
}, 60_000);

afterAll(() => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════
// ① 대신 쓰기
// ════════════════════════════════════════════════════════════
d('LE-01~13 대신 쓰기 (TACP-18)', () => {
  it('[LE-T01] canProxySubmit — 담당(lead·head)·같은 부서·활성·본인 아님만 참', async () => {
    const { canProxySubmit } = await import('@/server/authz');
    const division = { id: 'd1' } as never;
    const as = (isManager: boolean, id = 'me') => ({ isManager, user: { id }, division }) as never;
    const t = { id: 'x', divisionId: 'd1', isActive: true };
    expect(canProxySubmit(as(true), t)).toBe(true);
    expect(canProxySubmit(as(false), t)).toBe(false); // 부서원·총괄·부서장이 아닌 운영자
    expect(canProxySubmit(as(true), { ...t, divisionId: 'd2' })).toBe(false); // 타 부서 (TACP-6)
    expect(canProxySubmit(as(true), { ...t, isActive: false })).toBe(false); // 탈퇴자
    expect(canProxySubmit(as(true, 'x'), t)).toBe(false); // 본인
  });

  it('[LE-T02] ★ 대신 쓰기 → 그 사람의 v1 — 주인은 그 사람, 쓴 사람은 editedById, 감사에 남는다', async () => {
    const prisma = await db();
    const slot = await wk(0);
    const res = await proxyAs(ID.lead, U.다솜.id, slot.isoKey, { a: [['대신 쓴 실적', '10/14', '회의실', '다솜']], p: ['대신 쓴 계획'] });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, version: 1 });

    const lead = await prisma.user.findFirstOrThrow({ where: { email: ID.lead } });
    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: out.id } });
    expect(sub).toMatchObject({ userId: U.다솜.id, divisionId: divId, weekSlotId: slot.id, version: 1, isLatest: true, origin: 'lead_entry', editedById: lead.id });
    expect(sub.editedAt?.getTime()).toBe(sub.uploadedAt.getTime()); // 「언제 냈나」 = 쓴 시각 (LE-07)

    const { readStoredFile } = await import('@/server/storage');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const w = readWorklog(await readStoredFile(sub.filePath)).worklog;
    expect(w.achievements[0]).toMatchObject({ content: '대신 쓴 실적', date: '10/14', place: '회의실', attendee: '다솜' });
    expect(w.plans[0].content).toBe('대신 쓴 계획');

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'submission_proxy' } });
    expect(log.actor).toBe(ID.lead);
    expect(log.divisionId).toBe(divId);
  });

  it('[LE-T04] 대신 쓴 사람은 현황에서 제출로 잡히고 병합 대상(isLatest)이다', async () => {
    const { divisionStatus } = await import('@/server/worklog');
    const slot = await wk(0);
    const st = await divisionStatus(divId, slot.id);
    const row = st.members.find((m) => m.user.id === U.다솜.id)!;
    expect(row.status).toBe('submitted');
    expect(row.latest).toMatchObject({ origin: 'lead_entry', isLatest: true });
    expect(st.members.find((m) => m.user.id === U.가온.id)!.status).toBe('missing');
  });

  it('[LE-T06] 대신 쓴 뒤 본인이 올리면 본인의 v2 — 대신 쓴 v1은 이력에 남는다', async () => {
    const prisma = await db();
    const { uploadSubmission } = await import('@/server/worklog');
    const slot = await wk(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: U.다솜.id } });
    const division = await prisma.division.findUniqueOrThrow({ where: { id: divId } });
    const early = new Date(slot.opensAt.getTime() + 3_600_000); // 월요일 새벽 — 열려 있다
    const r = await uploadSubmission({ user, division, fileName: 'x.hwp', bytes: await docBytes({ a: ['본인이 올린 실적'] }), fromIp: null, origin: 'web' }, early);
    expect(r.submission.version).toBe(2);
    const all = await prisma.submission.findMany({ where: { userId: U.다솜.id, weekSlotId: slot.id }, orderBy: { version: 'asc' } });
    expect(all.map((s) => [s.version, s.isLatest, s.origin])).toEqual([
      [1, false, 'lead_entry'],
      [2, true, 'web'],
    ]);
  });

  it('[LE-T03] 마감이 지난 주차에도 된다 (LE-05)', async () => {
    const prisma = await db();
    const slot = await wk(3);
    const res = await proxyAs(ID.lead, U.마루.id, slot.isoKey, { a: ['지난 주 실적'] });
    expect(res.status).toBe(200);
    expect(await prisma.submission.count({ where: { userId: U.마루.id, weekSlotId: slot.id, origin: 'lead_entry' } })).toBe(1);
  });

  it('[LE-T05] 입력 오류 — 빈 내용 422 · 칸 초과 422 · isoKey 없음 422 · 없는 주차·아직 안 열린 주차 404 · 양식 없음 409 — 판도 파일도 안 남는다', async () => {
    const prisma = await db();
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const slot = await wk(1);
    const dir = path.join(TMP_STORAGE, 'divisions/Le_A/submissions');
    const files = () => {
      try {
        return readdirSync(dir, { recursive: true }).length;
      } catch {
        return 0;
      }
    };
    const before = files();

    expect((await proxyAs(ID.lead, U.가온.id, slot.isoKey, {})).status).toBe(422); // 빈 내용
    const empty = await proxyAs(ID.lead, U.가온.id, slot.isoKey, { a: [''] });
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toBe('empty_content');
    const long = await proxyAs(ID.lead, U.가온.id, slot.isoKey, { a: ['가'.repeat(501)] });
    expect(long.status).toBe(422);
    expect((await long.json()).error).toBe('cell_too_long');
    expect((await proxyAs(ID.lead, U.가온.id, undefined, { a: ['x'] })).status).toBe(422); // isoKey 없음
    expect((await proxyAs(ID.lead, U.가온.id, '1999-W01', { a: ['x'] })).status).toBe(404); // 없는 주차
    const future = await ensureCurrentSlot(new Date(Date.now() + 14 * 86_400_000));
    expect((await proxyAs(ID.lead, U.가온.id, future.isoKey, { a: ['x'] })).status).toBe(404); // 아직 안 열린 주차

    // 양식 없는 부서 — 그 부서의 lead가 자기 부서원을 대신 쓰려 해도 409
    const stranger = await prisma.user.create({ data: { email: 'le-c-member@test.kei.re.kr', name: '양식없음', divisionId: (await prisma.user.findFirstOrThrow({ where: { email: ID.noTplLead } })).divisionId } });
    const noTpl = await proxyAs(ID.noTplLead, stranger.id, slot.isoKey, { a: ['x'] });
    expect(noTpl.status).toBe(409);
    expect((await noTpl.json()).error).toBe('no_template');

    expect(await prisma.submission.count({ where: { weekSlotId: slot.id } })).toBe(0);
    expect(files()).toBe(before);
  });

  it('[LE-T07] ★ 동시에 두 번 대신 쓰기 → 하나만 성공, 다른 하나 409, 남은 파일은 성공한 것 하나 (LE-03·08)', async () => {
    const prisma = await db();
    const slot = await wk(2);
    const [x, y] = await Promise.all([
      proxyAs(ID.lead, U.바다.id, slot.isoKey, { a: ['동시 1'] }),
      proxyAs(ID.head, U.바다.id, slot.isoKey, { a: ['동시 2'] }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const bad = x.status === 409 ? x : y;
    expect((await bad.json()).error).toBe('already_submitted');
    expect(await prisma.submission.count({ where: { userId: U.바다.id, weekSlotId: slot.id } })).toBe(1);

    const dir = path.join(TMP_STORAGE, 'divisions/Le_A/submissions', String(slot.year));
    const mine = readdirSync(dir, { recursive: true }).filter((f) => String(f).includes('바다_'));
    expect(mine).toHaveLength(1); // 진 쪽이 쓴 파일은 지워졌다
  });

  it('[LE-T10] ★ lead·head 허용 · member·총괄·타 부서 lead·운영자는 404 — 판이 안 생긴다 (TACP §7)', async () => {
    const prisma = await db();
    const slot = await wk(4);
    for (const who of [ID.member, ID.coord, ID.otherLead, ID.op]) {
      expect((await proxyAs(who, U.가온.id, slot.isoKey, { a: ['x'] })).status, who).toBe(404);
    }
    expect(await prisma.submission.count({ where: { weekSlotId: slot.id } })).toBe(0);
    expect((await proxyAs(ID.lead, U.가온.id, slot.isoKey, { a: ['lead가 쓴 것'] })).status).toBe(200);
    expect((await proxyAs(ID.head, U.나래.id, slot.isoKey, { a: ['head가 쓴 것'] })).status).toBe(200);
  });

  it('[LE-T11] 권한 판정이 본문보다 먼저 — member는 본문이 비어도 404, lead는 사람이 없으면 422', async () => {
    const slot = await wk(4);
    expect((await proxyAs(ID.member, undefined, slot.isoKey, {})).status).toBe(404);
    expect((await proxyAs(ID.lead, undefined, slot.isoKey, { a: ['x'] })).status).toBe(422);
  });

  it('[LE-T12] 대상이 안 되는 사람 — 타 부서·탈퇴자·본인·없는 id 는 404 (같은 응답이라 존재 여부도 새지 않는다)', async () => {
    const prisma = await db();
    const slot = await wk(5);
    const gone = await prisma.user.create({ data: { email: 'le-gone@test.kei.re.kr', name: '탈퇴', divisionId: divId, isActive: false } });
    const lead = await prisma.user.findFirstOrThrow({ where: { email: ID.lead } });
    const foreign = await prisma.user.findFirstOrThrow({ where: { email: ID.otherLead } });
    for (const id of [foreign.id, gone.id, lead.id, 'no-such-id']) {
      const r = await proxyAs(ID.lead, id, slot.isoKey, { a: ['x'] });
      expect(r.status, id).toBe(404);
    }
    expect(await prisma.submission.count({ where: { weekSlotId: slot.id } })).toBe(0);
  });

  it('[LE-T13] 이미 낸 사람은 409 — [고치기]의 「남의 것만·최신 판만」을 새 판으로 우회하지 못한다 (LE-03)', async () => {
    const prisma = await db();
    const slot = await wk(4); // T10에서 가온이 대신 쓴 주
    const r = await proxyAs(ID.lead, U.가온.id, slot.isoKey, { a: ['또 쓰기'] });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('already_submitted');
    expect(await prisma.submission.count({ where: { userId: U.가온.id, weekSlotId: slot.id } })).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// ② 맨 뒤에 붙이기
// ════════════════════════════════════════════════════════════
d('LE-20~34 맨 뒤에 붙이기 (ADR-0023)', () => {
  it('[LE-T20] splitLate — 늦게 낸 사람 · 고쳐 낸 사람 · 이미 들어간 사람 · 판이 여럿인 사람', async () => {
    const { splitLate } = await import('@/lib/late');
    const subs = [
      { id: 'a1', userId: 'A', isLatest: true }, // 들어감
      { id: 'b1', userId: 'B', isLatest: false }, // B의 옛 판이 들어갔고
      { id: 'b2', userId: 'B', isLatest: true }, //   최신 판은 안 들어감 → 고쳐 낸 사람
      { id: 'c1', userId: 'C', isLatest: true }, // 늦게 낸 사람
      { id: 'd1', userId: 'D', isLatest: false }, // 옛 판은 어느 쪽도 아니다
      { id: 'd2', userId: 'D', isLatest: true }, // D는 늦게 낸 사람 (최신 판만 센다)
    ];
    const r = splitLate(subs, new Set(['a1', 'b1']));
    expect(r.candidates.map((s) => s.id)).toEqual(['c1', 'd2']);
    expect(r.revised.map((s) => s.id)).toEqual(['b2']);
  });

  it('[LE-T21] ★ 붙이기 → 각 표 끝에 붙고 기존 행은 글자까지 그대로 · rowCounts·sourceIds·rowAuthors·edits·감사', async () => {
    const prisma = await db();
    const slot = await wk(6);
    const { subs, run } = await seedMerge(
      slot,
      [
        ['가온', { a: [['가온 실적', '10/5']], p: ['가온 계획'] }],
        ['나래', { a: ['나래 실적'], n: ['나래 특이'] }],
      ],
      ['다솜', '라온'],
    );
    const late = await submit(slot.id, '다솜', { a: [['다솜 실적', '10/7', '현장', '다솜']], p: ['다솜 계획'], n: ['다솜 특이'] });
    const beforeFile = await mergedFile(run.id);
    const { worklogRows } = await import('@/server/merge/review');
    const before = worklogRows(beforeFile);
    const reviews = await prisma.mergeReview.count();

    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.appended).toEqual([{ name: '다솜', achievements: 1, plans: 1, notes: 1 }]);
    expect(out.rowCounts).toEqual({ achievements: 3, plans: 2, notes: 2 });

    // 기존 행은 글자까지 그대로, 새 행은 맨 뒤
    const after = worklogRows(await mergedFile(run.id));
    for (const b of ['achievements', 'plans', 'notes'] as const) {
      expect(after[b].slice(0, before[b].length)).toEqual(before[b]);
    }
    expect(after.achievements.at(-1)).toMatchObject({ content: '다솜 실적', date: '10/7', place: '현장', attendee: '다솜' });
    expect(after.plans.at(-1)?.content).toBe('다솜 계획');
    expect(after.notes.at(-1)?.content).toBe('다솜 특이');

    const row = await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(row.sourceIds).sort()).toEqual([...subs.map((s) => s.id), late.id].sort()); // LE-29 합집합
    expect(JSON.parse(row.rowCounts!)).toEqual({ achievements: 3, plans: 2, notes: 2 });
    expect(row.outputSha).toBe((await import('@/server/storage')).sha256(await mergedFile(run.id)));
    const info = JSON.parse(row.reviewJson!);
    expect(info.rowAuthors.achievements.at(-1)).toEqual({ c: '다솜 실적', a: ['다솜'] });
    expect(info.missing).toEqual(['라온']); // 다솜은 이제 들어갔다
    expect(info.appended).toHaveLength(1);
    expect(info.appended[0]).toMatchObject({ people: ['다솜'], rows: 3 });
    expect(info.edits.at(-1)).toMatchObject({ role: 'lead', places: 3 }); // 「다시 병합」이 알아야 하는 기록 (HM-49)

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'merge', target: `merged:${slot.isoKey}` } });
    expect(log.actor).toBe(ID.lead);
    expect(log.detail).toContain('append');
    expect(log.detail).not.toContain('다솜'); // 이름은 감사 로그에 쓰지 않는다
    expect(await prisma.mergeReview.count()).toBe(reviews); // 승인이 아니다 (LE-30)
  });

  it('[LE-T22] ★ 담당자가 손본(순서를 바꾸고 문장을 고친) 병합본에 붙여도 손본 곳이 그대로 (LE-25)', async () => {
    const slot = await wk(7);
    const { run } = await seedMerge(slot, [
      ['가온', { a: ['가온 실적 A', '가온 실적 B'], p: ['가온 계획'] }],
      ['나래', { a: ['나래 실적'] }],
    ]);
    // 담당자가 화면에서 순서를 바꾸고 문장을 고쳐 저장한다 — 실제 동선(PUT)
    const v = await viewedBy(slot);
    const { PUT } = await import('@/app/api/division/merged/content/route');
    const saved = await PUT(
      nx('/api/division/merged/content', ID.lead, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          isoKey: slot.isoKey,
          runId: v.runId,
          sha256: v.sha256,
          tables: [
            { key: 'achievements', rows: [['', '나래 실적 (다듬음)', '', '', ''], ['', '가온 실적 B', '', '', ''], ['', '가온 실적 A', '', '', '']] },
            { key: 'plans', rows: [['', '가온 계획', '', '', '']] },
            { key: 'notes', rows: [] },
          ],
        }),
      }),
    );
    expect(saved.status).toBe(200);
    expect((await mergedTables(slot)).achievements.map((r) => r[1])).toEqual(['나래 실적 (다듬음)', '가온 실적 B', '가온 실적 A']);

    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    expect((await appendAs(ID.lead, slot)).status).toBe(200);
    expect(contents((await mergedTables(slot)).achievements)).toEqual(['나래 실적 (다듬음)', '가온 실적 B', '가온 실적 A', '다솜 실적']);
    expect(run.id).toBeTruthy();
  });

  it('[LE-T23] 여러 명 — 명단 순서로 붙는다(낸 순서가 아니다) · 구분 번호는 이어진다', async () => {
    const slot = await wk(8);
    await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(slot.id, '마루', { a: ['마루 실적'] }); // 먼저 냈지만 명단은 뒤
    await submit(slot.id, '나래', { a: ['나래 실적'] });
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    expect((await res.json()).appended.map((a: { name: string }) => a.name)).toEqual(['나래', '다솜', '마루']);
    const rows = (await mergedTables(slot)).achievements;
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['1-1', '가온 실적'],
      ['1-2', '나래 실적'],
      ['1-3', '다솜 실적'],
      ['1-4', '마루 실적'],
    ]);
  });

  it('[LE-T24] 읽은 뒤 병합본이 바뀌었으면 409 merged_changed · member·총괄·타 부서 담당은 404 — 어느 쪽도 파일을 건드리지 않는다', async () => {
    const slot = await wk(9);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const stale = await viewedBy(slot);
    const sha0 = (await import('@/server/storage')).sha256(await mergedFile(run.id));

    for (const who of [ID.member, ID.coord, ID.otherLead]) {
      expect((await appendAs(who, slot, stale)).status, who).toBe(404);
    }
    // 열어 본 판이 아니면 — 누군가 그 사이에 저장했다
    expect((await appendAs(ID.lead, slot, { runId: stale.runId, sha256: 'old' })).status).toBe(409);
    const gone = await appendAs(ID.lead, slot, { runId: 'other-run', sha256: stale.sha256 });
    expect(gone.status).toBe(409);
    expect((await gone.json()).error).toBe('merged_changed');
    expect((await appendAs(ID.lead, slot, {})).status).toBe(409);
    expect((await import('@/server/storage')).sha256(await mergedFile(run.id))).toBe(sha0);
  });

  it('[LE-T25] 붙일 사람이 없으면 409 nothing_to_append — 고쳐 낸 사람만 있으면 detail.revised에 이름이', async () => {
    const prisma = await db();
    const slot = await wk(10);
    const { subs, run } = await seedMerge(slot, [
      ['가온', { a: ['가온 실적'] }],
      ['나래', { a: ['나래 실적'] }],
    ]);
    // 모두 들어갔다
    const none = await appendAs(ID.lead, slot);
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ error: 'nothing_to_append', detail: { revised: [] } });

    // 나래가 병합 뒤에 고쳐 냈다 — 붙이지 않는다 (앞서 들어간 줄과 겹쳐 같은 일이 두 번 나온다)
    await prisma.submission.update({ where: { id: subs[1].id }, data: { isLatest: false } });
    await submit(slot.id, '나래', { a: ['나래 실적 고침'] }, { version: 2 });
    const rev = await appendAs(ID.lead, slot);
    expect(rev.status).toBe(409);
    expect((await rev.json()).detail.revised).toEqual(['나래']);
    expect(contents((await mergedTables(slot)).achievements)).toEqual(['가온 실적', '나래 실적']);
    expect(run.id).toBeTruthy();
  });

  it('[LE-T26] 고쳐 낸 사람은 붙지 않고, 늦게 낸 사람과 함께 있으면 늦게 낸 사람만 붙는다 (LE-31)', async () => {
    const prisma = await db();
    const slot = await wk(11);
    const { subs, run } = await seedMerge(slot, [
      ['가온', { a: ['가온 실적'] }],
      ['나래', { a: ['나래 실적'] }],
    ]);
    await prisma.submission.update({ where: { id: subs[1].id }, data: { isLatest: false } });
    const v2 = await submit(slot.id, '나래', { a: ['나래 실적 고침'] }, { version: 2 });
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });

    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    expect((await res.json()).appended.map((a: { name: string }) => a.name)).toEqual(['다솜']);
    expect(contents((await mergedTables(slot)).achievements)).toEqual(['가온 실적', '나래 실적', '다솜 실적']);
    const row = await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(row.sourceIds)).not.toContain(v2.id); // 고쳐 낸 판은 여전히 「병합에 안 들어간」 것 — 다시 병합이 필요하다
  });

  it('[LE-T27] 네 칸이 같은 줄은 새로 만들지 않고 작성자만 더한다 (LE-24)', async () => {
    const prisma = await db();
    const slot = await wk(12);
    const { run } = await seedMerge(slot, [['가온', { a: [['공동 행사 준비', '10/8', '본관', '']], p: ['가온 계획'] }]]);
    await submit(slot.id, '다솜', { a: [['공동 행사 준비', '10/8', '본관', ''], '다솜만의 실적'], p: ['가온 계획'] });

    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    expect((await res.json()).appended).toEqual([{ name: '다솜', achievements: 1, plans: 0, notes: 0 }]); // 겹친 줄은 세지 않는다
    const t = await mergedTables(slot);
    expect(contents(t.achievements)).toEqual(['공동 행사 준비', '다솜만의 실적']);
    expect(contents(t.plans)).toEqual(['가온 계획']);
    const info = JSON.parse((await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } })).reviewJson!);
    expect(info.rowAuthors.achievements[0]).toEqual({ c: '공동 행사 준비', a: ['가온', '다솜'] });
    expect(info.rowAuthors.plans[0].a).toEqual(['가온', '다솜']);
  });

  it('[LE-T28] 강조 — 기존 파란 행은 유지되고, 붙는 행의 강조(서식·글 표시)가 따라간다 (LE-26)', async () => {
    const slot = await wk(13);
    await seedMerge(slot, [['가온', { a: ['가온 주요 사항', '가온 일반'] }, { a: [true, false] }]]);
    await submit(slot.id, '다솜', { a: ['다솜 주요 사항', '다솜 일반 (하이라이트) 표시', '다솜 일반'] }, { emphasis: { a: [true, false, false] } });
    expect((await appendAs(ID.lead, slot)).status).toBe(200);

    const { GET } = await import('@/app/api/division/merged/content/route');
    const v = await (await GET(nx(`/api/division/merged/content?isoKey=${slot.isoKey}`, ID.lead))).json();
    const ach = v.tables.find((t: { key: string }) => t.key === 'achievements');
    expect(ach.rows.slice(1).map((r: string[]) => r[1])).toEqual(['가온 주요 사항', '가온 일반', '다솜 주요 사항', '다솜 일반 표시', '다솜 일반']);
    expect(ach.emphasis).toEqual([true, false, true, true, false]); // 글로 적은 표시는 떼고 강조로 (HM-38)
  });

  it('[LE-T29] 붙인 뒤 늦게 낸 사람 세기가 0 · [다시 병합]은 HM-49의 409 edited (LE-27·29)', async () => {
    const prisma = await db();
    const { splitLate } = await import('@/lib/late');
    const slot = await wk(14);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const used = async () => new Set(JSON.parse((await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } })).sourceIds) as string[]);
    const subs = () => prisma.submission.findMany({ where: { divisionId: divId, weekSlotId: slot.id } });
    expect(splitLate(await subs(), await used()).candidates).toHaveLength(1);

    expect((await appendAs(ID.lead, slot)).status).toBe(200);
    expect(splitLate(await subs(), await used())).toEqual({ candidates: [], revised: [] });

    const { POST } = await import('@/app/api/division/merge/route');
    const re = await POST(post('/api/division/merge', ID.lead, { isoKey: slot.isoKey }));
    expect(re.status).toBe(409);
    const body = await re.json();
    expect(body.error).toBe('edited');
    expect(body.detail.edits.places).toBeGreaterThanOrEqual(1);
  });

  it('[LE-T31] 병합 작업이 줄에 있으면 409 merging — 그 위에 붙이면 새 병합본이 덮는다 (LE-28)', async () => {
    const prisma = await db();
    const slot = await wk(15);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const sha0 = (await import('@/server/storage')).sha256(await mergedFile(run.id));
    const job = await prisma.mergeJob.create({ data: { divisionId: divId, weekSlotId: slot.id, trigger: 'manual', orderKey: 1, status: 'queued', enqueuedAt: new Date() } });

    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('merging');
    expect((await import('@/server/storage')).sha256(await mergedFile(run.id))).toBe(sha0);

    await prisma.mergeJob.update({ where: { id: job.id }, data: { status: 'done' } });
    expect((await appendAs(ID.lead, slot)).status).toBe(200); // 줄이 비면 된다
  });

  it('[LE-T32] 읽을 수 없는 파일은 그 사람만 건너뛰고 sourceIds에 안 넣는다 (LE-22) — 다 못 읽으면 409', async () => {
    const prisma = await db();
    const slot = await wk(16);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    const broken = await submit(slot.id, '나래', {}, { raw: Buffer.from('이건 hwp가 아니다') });
    const only = await appendAs(ID.lead, slot);
    expect(only.status).toBe(409);
    expect((await only.json()).detail.skipped).toEqual([{ name: '나래', reason: 'unreadable' }]);

    const good = await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.appended.map((a: { name: string }) => a.name)).toEqual(['다솜']);
    expect(out.skipped).toEqual([{ name: '나래', reason: 'unreadable' }]);
    const ids = JSON.parse((await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } })).sourceIds) as string[];
    expect(ids).toContain(good.id);
    expect(ids).not.toContain(broken.id); // 못 읽은 사람은 계속 「늦게 낸 사람」으로 남는다 — 파일을 고치면 다시 붙일 수 있다
  });

  it('[LE-T34] 운영자(자기 부서)도 붙일 수 있고, 고친 기록의 역할은 operator다 — 부서의 결정이 아니다', async () => {
    const prisma = await db();
    const slot = await wk(17);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(slot.id, '다솜', { a: ['다솜 실적'] });
    const v = await viewedBy(slot, ID.op);
    expect((await appendAs(ID.op, slot, v)).status).toBe(200);
    const info = JSON.parse((await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } })).reviewJson!);
    expect(info.edits.at(-1).role).toBe('operator');
  });

  it('[LE-T33] ★ 대신 쓰기 → 붙이기 한 흐름 — 병합 뒤 낸 적 없는 사람을 대신 쓰고 맨 뒤에 붙인다', async () => {
    const prisma = await db();
    const slot = await wk(18);
    const { run } = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]], ['마루']);

    const made = await proxyAs(ID.lead, U.마루.id, slot.isoKey, { a: [['마루가 늦게 낸 실적', '10/13']], p: ['마루 계획'] });
    expect(made.status).toBe(200);
    const { id } = await made.json();

    const res = await appendAs(ID.lead, slot);
    expect(res.status).toBe(200);
    expect((await res.json()).appended).toEqual([{ name: '마루', achievements: 1, plans: 1, notes: 0 }]);
    const t = await mergedTables(slot);
    expect(contents(t.achievements)).toEqual(['가온 실적', '마루가 늦게 낸 실적']);
    expect(t.achievements[1].slice(0, 3)).toEqual(['1-2', '마루가 늦게 낸 실적', '10/13']);
    const row = await prisma.mergeRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(row.sourceIds)).toContain(id);
    expect(JSON.parse(row.reviewJson!).missing).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// ③ 알림 — 붙이기는 승인이 아니다 (LE-30 · NT-52)
// ════════════════════════════════════════════════════════════
d('LE-30 붙이기는 승인이 아니다 — 승인 뒤라면 부서장에게 「다시 승인」 한 번', () => {
  const reapprovals = () => msgr.outbox.filter((m) => m.kind?.startsWith('merge_reapprove:'));
  const HEAD_NO = 'LE100';

  beforeAll(async () => {
    const prisma = await db();
    await prisma.orgRollupSetting.upsert({ where: { id: 'org' }, update: { enabled: true }, create: { id: 'org', enabled: true } });
    await prisma.user.update({ where: { email: ID.head }, data: { employeeNo: HEAD_NO } });
  });
  afterAll(async () => {
    const prisma = await db();
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
  });

  /** 승인했던 판(옛 sha)이 있는 상태 — 병합본은 그 뒤 바뀐 것이다 */
  async function approvedThenMerged(n: number) {
    const prisma = await db();
    const slot = await wk(n);
    const seeded = await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    const head = await prisma.user.findFirstOrThrow({ where: { email: ID.head } });
    const review = await prisma.mergeReview.create({
      data: { divisionId: divId, weekSlotId: slot.id, mergeRunId: seeded.run.id, reviewerId: head.id, kind: 'approve', sha256: 'approved-before', filePath: null },
    });
    return { slot, review };
  }
  async function appendDirect(identity: string, slot: { isoKey: string; opensAt: Date }) {
    const { requireScope } = await import('@/server/authz');
    const { appendLate } = await import('@/server/merge/append');
    const scope = await requireScope(new Headers({ 'x-test-identity': identity }));
    const prisma = await db();
    const row = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: slot.isoKey } });
    const early = new Date(slot.opensAt.getTime() + 3_600_000); // 월요일 새벽 — 기한 전
    return appendLate(scope, row, await viewedBy(slot, identity), early);
  }

  it('[LE-T30] ★ 승인 뒤 붙이기 → MergeReview는 그대로(승인이 아니다) · 부서장에게 NT-52 한 번(승인당 한 번) · 문구에 「맨 뒤에 붙었어요」', async () => {
    const prisma = await db();
    const { unitTarget } = await import('@/server/rollup/handoff');
    expect(await unitTarget(divId)).toMatchObject({ kind: 'org' }); // 전제 — 이 부서는 바로 총괄로 간다(부서장 단계가 위로의 첫 승인)

    const { slot, review } = await approvedThenMerged(19);
    const reviews = await prisma.mergeReview.count({ where: { divisionId: divId, weekSlotId: (await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: slot.isoKey } })).id } });
    const before = reapprovals().length;

    await submit((await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: slot.isoKey } })).id, '다솜', { a: ['다솜 실적'] });
    await appendDirect(ID.lead, slot);
    expect(reapprovals()).toHaveLength(before + 1);
    const m = reapprovals().at(-1)!;
    expect(m.to).toBe(HEAD_NO);
    expect(m.kind).toBe(`merge_reapprove:${review.id}`);
    expect(m.contents).toContain('늦게 낸 1명');
    expect(m.contents).toContain('맨 뒤에 붙었어요');
    expect(m.contents).not.toContain('LE-'); // 사용자에게 보이는 곳에 요구사항 ID를 쓰지 않는다
    expect(await prisma.mergeReview.count({ where: { divisionId: divId, weekSlotId: review.weekSlotId } })).toBe(reviews); // 승인이 아니다

    // 같은 승인에 대해 또 붙여도 알림은 그대로 한 번
    await submit(review.weekSlotId, '나래', { a: ['나래 실적'] });
    await appendDirect(ID.lead, slot);
    expect(reapprovals()).toHaveLength(before + 1);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId, weekSlotId: review.weekSlotId, kind: `merge_reapprove:${review.id}` } })).toBe(1);
  });

  it('[LE-T30b] 부서장 본인이 붙이면 본인에게는 안 보낸다 — 받을 사람이 없으니 기록도 안 남아, 나중에 담당자가 붙이면 그때 한 번 간다', async () => {
    const prisma = await db();
    const { slot, review } = await approvedThenMerged(20);
    const before = reapprovals().length;

    await submit(review.weekSlotId, '다솜', { a: ['다솜 실적'] });
    await appendDirect(ID.head, slot);
    expect(reapprovals()).toHaveLength(before);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId, weekSlotId: review.weekSlotId, kind: `merge_reapprove:${review.id}` } })).toBe(0);

    await submit(review.weekSlotId, '나래', { a: ['나래 실적'] });
    await appendDirect(ID.lead, slot);
    expect(reapprovals()).toHaveLength(before + 1);
  });

  it('[LE-T30c] 승인한 적이 없는 병합본에 붙이면 「다시」 승인이 아니다 — 알림 없음', async () => {
    const prisma = await db();
    const slot = await wk(21);
    const row = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: slot.isoKey } });
    await seedMerge(slot, [['가온', { a: ['가온 실적'] }]]);
    await submit(row.id, '다솜', { a: ['다솜 실적'] });
    const before = reapprovals().length;
    await appendDirect(ID.lead, slot);
    expect(reapprovals()).toHaveLength(before);
    expect(await prisma.mergeReview.count({ where: { weekSlotId: row.id } })).toBe(0);
  });
});
