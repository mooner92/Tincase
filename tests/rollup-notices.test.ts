// RU-53~57b · NT-46′·47′·52 — 3단계 자동 진행의 알림은 **막고 있는 사람에게만**, 종류마다 한 번 (ADR-0015 · messenger.md §4-3).
//
// 넘기는 사람(본부 담당자·실·팀 담당자의 [제출])에게 가던 알림이 없어졌다 — 넘길 일이 없다. 남은 것은 「당신의 결정을 기다리는 것이
// 준비됐다」(사건 — 그 순간)와 「기한 15분 전인데 당신이 막고 있다」(시각 — 스케줄러)다. 메신저는 시험 안의 가짜 서버로 받는다.
// 픽스처 hwp 없이 돈다 — 조립 엔진은 흉내(rollup-auto.test.ts와 같다). 사람·부서 이름은 지어낸 것이다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TMP_STORAGE = mkdtempSync(path.join(tmpdir(), 'repman-notices-'));
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-notices.db';
process.env.STORAGE_ROOT = TMP_STORAGE;
process.env.CF_ACCESS_TEAM = 'test-team';
process.env.MESSENGER_ALLOWLIST = '*';
delete process.env.DEV_IDENTITY;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const nextMerge = new Map<string, string>();

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
      // 엔진은 쓰지 않는다 — 바이트를 돌려주면 runMergeRecorded가 잠금 안에서 쓰고 기록한다 (2026-10-08 결정 c)
      return {
        outputRelPath: rel,
        output: Buffer.from(JSON.stringify({ achievements: [['1-1', nextMerge.get(divisionId) ?? division.nameKo, '', '', '']], plans: [], notes: [] })),
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
  const row = (r: string[]) => ({ no: r[0] ?? '', content: r[1] ?? '', date: '', place: '', attendee: '', emphasis: false });
  return {
    ...orig,
    readWorklog: (buf: Buffer) => {
      let j: Record<string, string[][]> = {};
      try {
        j = JSON.parse(buf.toString('utf8'));
      } catch {
        j = {};
      }
      return { worklog: { achievements: (j.achievements ?? []).map(row), plans: (j.plans ?? []).map(row), notes: (j.notes ?? []).map(row) }, tables: [], warnings: [] };
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

const DIV = {
  hq: { slug: 'NT_HQ', nameKo: '본부가', parentKo: '한국환경연구원', self: false },
  u1: { slug: 'NT_U1', nameKo: '실하나', parentKo: '본부가', self: true },
  u2: { slug: 'NT_U2', nameKo: '실둘', parentKo: '본부가', self: true },
  solo: { slug: 'NT_SOLO', nameKo: '단독단', parentKo: '한국환경연구원', self: true },
} as const;
type Key = keyof typeof DIV;
// 사번 — 받은 알림을 이것으로 가른다
const P = {
  hqHead: { email: 'n-hq-head@test.local', no: '7001', div: 'hq', role: 'head' },
  hqLead: { email: 'n-hq-lead@test.local', no: '7002', div: 'hq', role: 'lead' },
  u1Head: { email: 'n-u1-head@test.local', no: '7101', div: 'u1', role: 'head' },
  u1Lead: { email: 'n-u1-lead@test.local', no: '7102', div: 'u1', role: 'lead' },
  u2Lead: { email: 'n-u2-lead@test.local', no: '7202', div: 'u2', role: 'lead' },
  soloHead: { email: 'n-solo-head@test.local', no: '7301', div: 'solo', role: 'head' },
  soloLead: { email: 'n-solo-lead@test.local', no: '7302', div: 'solo', role: 'lead' },
  c1: { email: 'n-coord1@test.local', no: '7901', div: 'solo', role: 'coord' },
  c2: { email: 'n-coord2@test.local', no: '7902', div: 'solo', role: 'coord' },
} as const;
const divId = {} as Record<Key, string>;
const userId = {} as Record<keyof typeof P, string>;
let isoKey = '';

interface Got {
  to: string;
  subject: string;
  contents: string;
}
const inbox: Got[] = [];
/** 지금까지 받은 것을 꺼낸다(비운다) */
const take = () => inbox.splice(0, inbox.length);
const to = (gs: Got[]) => gs.map((g) => g.to).sort();
/** 가짜 메신저의 상태 — 느리게(`delayMs`) · 고장(`fail` — 500, 아무에게도 안 감) (RU-T143) */
const mailbox = { delayMs: 0, fail: false };
let server: Server;

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

async function merged(key: Key, text: string) {
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const { mergedRelPath } = await import('@/server/merge');
  const s = await slot();
  const rel = mergedRelPath(DIV[key].slug, s.year, s.label);
  await writeFileAtomic(rel, Buffer.from(JSON.stringify({ achievements: [['1-1', text, '', '', '']], plans: [], notes: [] })));
  return prisma.mergeRun.create({ data: { divisionId: divId[key], weekSlotId: s.id, status: 'succeeded', outputPath: rel, sourceIds: '[]', ruleSnapshot: '{}', startedAt: new Date(), finishedAt: new Date() } });
}
async function viewed(key: Key) {
  const prisma = await db();
  const { readStoredFile } = await import('@/server/storage');
  const run = await prisma.mergeRun.findFirstOrThrow({ where: { divisionId: divId[key], weekSlotId: (await slot()).id, status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
  return { runId: run.id, sha256: sha(await readStoredFile(run.outputPath!)) };
}
async function approve(who: string, key: Key) {
  const { POST } = await import('@/app/api/division/merged/approve/route');
  return POST(nx('/api/division/merged/approve', who, jsonInit('POST', { isoKey, ...(await viewed(key)) })));
}
async function save(who: string, key: Key, text: string) {
  const { PUT } = await import('@/app/api/division/merged/content/route');
  return PUT(
    nx('/api/division/merged/content', who, jsonInit('PUT', { isoKey, ...(await viewed(key)), tables: [{ key: 'achievements', rows: [['', text, '', '', '']] }] })),
  );
}
/**
 * [지금 병합] — 2026-10-08 2단계(HM-60b)부터 202로 줄에 넣고 바로 돌아온다. 이 시험이 보는 것은 병합 **뒤**의 일(넘김 · 사본 · 알림)이라
 * 줄이 빌 때까지 기다린 뒤 돌려준다
 */
async function mergeNow(who: string) {
  const { POST } = await import('@/app/api/division/merge/route');
  const res = (await POST(nx('/api/division/merge', who, jsonInit('POST', { isoKey, overwriteEdits: true })))) as Response;
  if (res.status === 202) {
    const { settleMergeQueue } = await import('@/server/merge/queue');
    await settleMergeQueue();
  }
  return res;
}
async function hqApprove(who: string) {
  const { latestHqRun } = await import('@/server/rollup/handoff');
  const { readStoredFile } = await import('@/server/storage');
  const run = (await latestHqRun(divId.hq, (await slot()).id))!;
  const { POST } = await import('@/app/api/rollup/hq/approve/route');
  return POST(nx('/api/rollup/hq/approve', who, jsonInit('POST', { isoKey, runId: run.id, sha256: sha(await readStoredFile(run.outputPath!)) })));
}
async function times() {
  const { stageTimes } = await import('@/server/rollup/schedule');
  return stageTimes(await slot());
}
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
async function due(now: Date) {
  const { runDueRollupNotices } = await import('@/server/rollup/notices');
  return runDueRollupNotices(now);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reply = () => {
        if (mailbox.fail) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('down\n');
          return;
        }
        const f = new URLSearchParams(body);
        for (const r of (f.get('RecvId') ?? '').split(',')) inbox.push({ to: r, subject: f.get('Subject') ?? '', contents: f.get('Contents') ?? '' });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('send ok\n');
      };
      if (mailbox.delayMs > 0) setTimeout(reply, mailbox.delayMs);
      else reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.MESSENGER_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  const root = path.resolve(__dirname, '..');
  rmSync(path.join(root, 'prisma/test-notices.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const prisma = await db();
  const { writeFileAtomic } = await import('@/server/storage');
  const { ensureCurrentSlot } = await import('@/server/worklog');
  isoKey = (await ensureCurrentSlot()).isoKey;
  for (const [key, d] of Object.entries(DIV) as [Key, (typeof DIV)[Key]][]) {
    const row = await prisma.division.create({
      data: { slug: d.slug, nameKo: d.nameKo, nameEn: d.slug, isActive: true, parentKo: d.parentKo, rollupSelf: d.self, deadlineDow: 1, deadlineTime: '00:00', notifyEnabled: key !== 'hq' },
    });
    divId[key] = row.id;
    const rel = `divisions/${d.slug}/template/active.hwp`;
    await writeFileAtomic(rel, Buffer.from(`양식:${d.slug}`));
    await prisma.template.create({ data: { divisionId: row.id, filePath: rel, sha256: 'x', version: 1, uploadedBy: 'seed' } });
  }
  for (const [k, p] of Object.entries(P) as [keyof typeof P, (typeof P)[keyof typeof P]][]) {
    const u = await prisma.user.create({
      data: {
        email: p.email,
        name: k,
        employeeNo: p.no,
        divisionId: divId[p.div as Key],
        ...(p.role === 'coord' ? { isCoordinator: true } : { divisionRole: p.role, jobTitle: p.role === 'head' ? '실장' : null }),
      },
    });
    userId[k] = u.id;
  }
  await prisma.orgSection.createMany({
    data: [
      { sortOrder: 10, title: '본부가(실하나)', divisionId: divId.u1 },
      { sortOrder: 20, title: '본부가(실둘)', divisionId: divId.u2 },
      { sortOrder: 30, title: '단독단', divisionId: divId.solo },
    ],
  });
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true, unitDueMinutes: 60, hqDueMinutes: 120 } });
}, 60_000);

afterAll(async () => {
  rmSync(TMP_STORAGE, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

describe('NT-46′·47′·52 — 실·팀 알림 문구 (순수)', () => {
  it('[NT-T63] NT-46′ — 3단계면 「○○에 자동으로 올라갔어요」, 꺼져 있으면 지금 문구', async () => {
    const { approvalMessage } = await import('@/server/merge/review');
    const s = { label: '10월 2주차', opensAt: new Date('2026-10-11T15:00:00Z') } as never;
    const at = new Date('2026-10-15T05:12:00Z');
    expect(approvalMessage({ name: '담당', employeeNo: '1' }, '홍길동 실장', s, at, [], '기획경영본부').contents).toMatch(/기획경영본부에 자동으로 올라갔어요\.$/);
    const off = approvalMessage({ name: '담당', employeeNo: '1' }, '홍길동 실장', s, at, []).contents;
    expect(off).toContain('취합게시판');
    expect(off).not.toContain('자동으로 올라갔어요');
  });

  it('[NT-T64] NT-47′ — 승인돼 올라갔으면 안 보냄 · 승인 전 「승인되면 저절로」 · 부서장 없음 「올라갔어요」 · 3단계를 안 쓰면 게시판 문구', async () => {
    const { pickJobs, submitLines } = await import('@/server/notify/merge-notices');
    const ok = { by: '홍 실장', at: new Date(), summary: '', changedAfter: false };
    const base = { submitTo: '본부가', submitDue: '15:00' };
    expect(pickJobs(false, true, { ok: true, approval: ok, ...base, hasHead: true })).toEqual([]);
    expect(pickJobs(false, true, { ok: true, approval: { ...ok, changedAfter: true }, ...base, hasHead: true })).toEqual([{ kind: 'merge_done', role: 'lead' }]);
    expect(pickJobs(false, true, { ok: true, approval: ok, submitTo: null, submitDue: null, hasHead: true })).toEqual([{ kind: 'merge_done', role: 'lead' }]); // 3단계를 안 쓰면 그대로
    expect(submitLines({ ...base, hasHead: true, approval: null }).join(' ')).toBe('아직 부서장 승인 전이에요 — 승인되면 저절로 본부가에 올라갑니다(기한 15:00).');
    expect(submitLines({ ...base, hasHead: true, approval: { ...ok, changedAfter: true } }).join(' ')).toContain('다시 승인되면 저절로 본부가에 올라갑니다(기한 15:00)');
    expect(submitLines({ ...base, hasHead: false, approval: null }).join(' ')).toBe('병합본이 본부가에 올라갔어요 — 고칠 곳은 고쳐 저장하면 다시 올라갑니다.');
    expect(submitLines({ submitTo: null, submitDue: null, hasHead: true, approval: null })[0]).toContain('취합게시판');
    expect(submitLines({ ...base, hasHead: true, approval: null }).join(' ')).not.toMatch(/\[.*에 제출\]/);
  });
});

describe('RU-53~57b · NT-52 — 3단계 알림은 막고 있는 사람에게만, 종류마다 한 번', () => {
  it('[NT-T63] 승인 순간 담당자에게 「○○에 자동으로 올라갔어요」 — 본부 담당자에게는 안 간다', async () => {
    await merged('u1', '실하나 첫 판');
    take();
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    const got = take();
    expect(to(got)).toEqual([P.u1Lead.no]);
    expect(got[0].contents).toContain('본부가에 자동으로 올라갔어요');
  });

  it('[RU-T125] ★ RU-54 — 일부만 모였으면 「실·팀 → 본부」 기한에 본부장에게 한 번 · 뒤에 다 모이면 「다 모였어요」 한 번 · 본부 담당자에게는 없음', async () => {
    const t = await times();
    expect(await due(plus(t.unitDue, 1))).toEqual([expect.objectContaining({ kind: 'ru_hq_ready', sent: 1 })]);
    let got = take();
    expect(to(got)).toEqual([P.hqHead.no]);
    expect(got[0].contents).toContain('산하 1/2곳');
    expect(got[0].contents).toContain('아직 1곳: 실둘');
    expect(await due(plus(t.unitDue, 2))).toEqual([]); // 같은 창에서 두 번 가지 않는다
    // 실둘(부서장 없음) 마감 뒤 병합 → 저절로 올라옴 → 다 모임
    nextMerge.set(divId.u2, '실둘 최종본');
    expect((await mergeNow(P.u2Lead.email)).status).toBe(202);
    await settle();
    got = take();
    expect(to(got)).toEqual([P.hqHead.no]);
    expect(got[0].subject).toContain('다 모였어요');
    // 다시 만들어져도 「다 모였어요」는 한 번
    expect((await save(P.u2Lead.email, 'u2', '실둘 고침')).status).toBe(200);
    await settle();
    expect(take()).toEqual([]);
  });

  it('[RU-T126] ★ RU-55 — 본부장 승인 순간 본부 담당자에게 아무것도 안 간다 · RU-55a 「다시 승인」은 풀린 승인마다 한 번', async () => {
    take();
    expect((await hqApprove(P.hqHead.email)).status).toBe(200);
    await settle();
    expect(to(take()).filter((n) => n === P.hqLead.no)).toEqual([]);
    // 승인 뒤 실둘이 고쳐 다시 올라온다 → 본부본이 바뀌어 승인이 풀린다
    expect((await save(P.u2Lead.email, 'u2', '실둘 승인 뒤 고침')).status).toBe(200);
    await settle();
    let got = take();
    expect(to(got)).toEqual([P.hqHead.no]);
    expect(got[0].subject).toContain('다시 승인해 주세요');
    expect(got[0].contents).toContain('총괄에는');
    // 그 사이 또 바뀌어도 같은 승인에 대해서는 한 번
    expect((await save(P.u2Lead.email, 'u2', '실둘 또 고침')).status).toBe(200);
    await settle();
    expect(take()).toEqual([]);
    // 다시 승인하고 또 풀리면 — 새 승인이므로 한 번 더
    expect((await hqApprove(P.hqHead.email)).status).toBe(200);
    await settle();
    expect((await save(P.u2Lead.email, 'u2', '실둘 세 번째')).status).toBe(200);
    await settle();
    got = take();
    expect(to(got)).toEqual([P.hqHead.no]);
  });

  it('[NT-T65] NT-52 — 승인 뒤 병합본이 바뀌면 부서장에게 그 승인마다 한 번(또 바뀌어도 더 안 감) · 다시 승인한 뒤 바뀌면 다시 한 번 · 담당자 저장은 위로 가지 않는다 · 3단계 꺼짐이면 없음', async () => {
    const prisma = await db();
    const latestApproval = () =>
      prisma.mergeReview.findFirstOrThrow({ where: { divisionId: divId.u1, kind: { not: 'hq_approve' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    take();
    expect((await save(P.u1Lead.email, 'u1', '실하나 담당자 고침')).status).toBe(200);
    await settle();
    let got = take();
    expect(to(got)).toEqual([P.u1Head.no]);
    expect(got[0].contents).toContain('담당자가 승인 뒤 병합본을 1곳 고쳤어요');
    expect(got[0].contents).toContain('다시 승인하면 바로 본부가에 올라갑니다');
    // 종류는 승인 id — 판(sha)이 아니다 (2026-10-08 결정 e)
    const kind = (await prisma.notifyLog.findFirstOrThrow({ where: { kind: { startsWith: 'merge_reapprove:' } } })).kind;
    expect(kind).toBe(`merge_reapprove:${(await latestApproval()).id}`);
    // 같은 판으로 다시 저장 — 아무것도 없다
    expect((await save(P.u1Lead.email, 'u1', '실하나 담당자 고침')).status).toBe(200);
    await settle();
    expect(take()).toEqual([]);
    // 다시 병합(늦게 낸 사람) — 판은 또 바뀌었지만 부서장의 할 일(다시 승인)은 같다. 그 승인에 대해서는 이미 알렸다
    nextMerge.set(divId.u1, '실하나 다시 병합');
    expect((await mergeNow(P.u1Lead.email)).status).toBe(202);
    await settle();
    expect(take().filter((g) => g.to === P.u1Head.no)).toEqual([]);
    // 부서장이 다시 승인한 뒤 또 바뀌면 — 새 승인이므로 한 번 더
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    take();
    expect((await save(P.u1Lead.email, 'u1', '실하나 다시 승인 뒤 고침')).status).toBe(200);
    await settle();
    got = take();
    expect(to(got)).toEqual([P.u1Head.no]);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId.u1, kind: { startsWith: 'merge_reapprove:' } } })).toBe(2);
    // 3단계 꺼짐 — 없음 (새 승인을 두고 꺼진 동안 고친다 — 켜져 있었으면 NT-52가 갔을 상태)
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    take();
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    try {
      expect((await save(P.u1Lead.email, 'u1', '실하나 꺼진 동안 고침')).status).toBe(200);
      await settle();
      expect(take()).toEqual([]);
    } finally {
      await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: true } });
    }
  });

  it('[RU-T127] ★ RU-56·56a — 기한 15분 전 알림은 막고 있는 사람에게만(승인했으면 안 감) · 부서 알림 스위치(56a)·3단계 스위치를 따른다', async () => {
    const prisma = await db();
    const t = await times();
    // 실하나 — 지금 판을 승인해 둔다(U2) → 「실·팀 → 본부」 15분 전에 실장에게 안 간다
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    take();
    expect((await due(plus(t.unitDue, -14))).map((r) => r.kind)).toEqual([]);
    // 승인 뒤 바뀌면(U3) 같은 창에서 실장에게
    await merged('u1', '실하나 기한 직전 병합');
    expect((await due(plus(t.unitDue, -13))).map((r) => r.kind)).toEqual(['ru_unit_due_soon']);
    expect(to(take())).toEqual([P.u1Head.no]);
    // 단독단(바로 총괄) — 「본부 → 총괄」 기한 기준. 부서 알림을 끈 부서에는 가지 않는다
    await prisma.division.update({ where: { id: divId.solo }, data: { notifyEnabled: false } });
    await merged('solo', '단독단 승인 전');
    const atHqSoon = await due(plus(t.hqDue, -14));
    expect(atHqSoon.map((r) => r.kind)).toEqual(['ru_hq_due_soon']); // 본부본도 승인 뒤 바뀜(Q3) — 본부장에게만
    expect(to(take())).toEqual([P.hqHead.no]);
    await prisma.division.update({ where: { id: divId.solo }, data: { notifyEnabled: true } });
    expect((await due(plus(t.hqDue, -13))).map((r) => r.kind)).toEqual(['ru_unit_due_soon']);
    expect(to(take())).toEqual([P.soloHead.no]);
    // 3단계를 끄면 시각 알림이 하나도 없다
    await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: false } });
    try {
      expect(await due(plus(t.unitDue, 1))).toEqual([]);
    } finally {
      await prisma.orgRollupSetting.update({ where: { id: 'org' }, data: { enabled: true } });
    }
  });

  it('[RU-T128] ★ RU-57 — 총괄 각자에게 「전사본 준비」(기한에 일부로)·「다 들어왔어요」 한 번씩 · RU-57a 「받은 뒤 바뀜」은 받은 사람에게만, 받은 판마다 한 번', async () => {
    const prisma = await db();
    const t = await times();
    take();
    // 「본부 → 총괄」 기한 — 본부가는 승인 뒤 바뀜(옛 판이 가 있음), 단독단은 아직 → 일부로
    const sent = await due(plus(t.hqDue, 1));
    expect(sent.map((r) => r.kind).sort()).toEqual([`ru_org_ready:${userId.c1}`, `ru_org_ready:${userId.c2}`].sort());
    const got = take();
    expect(to(got)).toEqual([P.c1.no, P.c2.no]);
    expect(got[0].contents).toContain('아직 1곳: 단독단');
    // 다 들어온다 — 단독단 승인 (본부가는 승인한 옛 판이 총괄에 있어 이미 「도착」이다 — §12 Q10)
    expect((await approve(P.soloHead.email, 'solo')).status).toBe(200);
    await settle();
    const complete = take().filter((g) => g.to === P.c1.no || g.to === P.c2.no);
    expect(to(complete)).toEqual([P.c1.no, P.c2.no]);
    expect(complete.every((g) => g.subject.includes('다 들어왔어요'))).toBe(true);
    // 본부장이 다시 승인해 전사본이 또 만들어져도 「다 들어왔어요」는 한 번
    expect((await hqApprove(P.hqHead.email)).status).toBe(200);
    await settle();
    expect(take().filter((g) => g.to === P.c1.no || g.to === P.c2.no)).toEqual([]);
    // 총괄 1이 받는다 → 그 뒤 전사본이 바뀐다 → 총괄 1에게만
    const orgRun = await prisma.rollupRun.findFirstOrThrow({ where: { level: 'org', status: 'succeeded' }, orderBy: { startedAt: 'desc' } });
    const run = await import('@/app/api/rollup/run/[id]/route');
    expect((await run.GET(nx(`/api/rollup/run/${orgRun.id}`, P.c1.email), { params: Promise.resolve({ id: orgRun.id }) })).status).toBe(200);
    await merged('solo', '단독단 받은 뒤 바뀜');
    expect((await approve(P.soloHead.email, 'solo')).status).toBe(200);
    await settle();
    let changed = take().filter((g) => g.subject.includes('받은 전사본이 바뀌었어요'));
    expect(to(changed)).toEqual([P.c1.no]);
    // 다시 바뀌어도 그 받은 판에 대해서는 한 번
    await merged('solo', '단독단 또 바뀜');
    expect((await approve(P.soloHead.email, 'solo')).status).toBe(200);
    await settle();
    changed = take().filter((g) => g.subject.includes('받은 전사본이 바뀌었어요'));
    expect(changed).toEqual([]);
    // 「전사」 화면의 주황 줄도 받은 사람에게만
    const { orgBoard } = await import('@/server/org-board');
    expect((await orgBoard(await slot(), { progress: false, desk: true }, '', { email: P.c1.email })).changedSinceDownload).toMatch(/\d\d:\d\d$/);
    expect((await orgBoard(await slot(), { progress: false, desk: true }, '', { email: P.c2.email })).changedSinceDownload).toBeNull();
  });

  it('[RU-T129] RU-57b — 만들기 실패는 고칠 수 있는 사람에게(본부본: 본부 담당자), 실패한 입력마다 한 번', async () => {
    const prisma = await db();
    const { writeFileAtomic } = await import('@/server/storage');
    take();
    await prisma.template.updateMany({ where: { divisionId: divId.hq }, data: { isActive: false } });
    await writeFileAtomic('divisions/NT_HQ/template/broken.hwp', Buffer.from('BROKEN'));
    await prisma.template.create({ data: { divisionId: divId.hq, filePath: 'divisions/NT_HQ/template/broken.hwp', sha256: 'b', version: 2, uploadedBy: 'seed' } });
    const { syncHq } = await import('@/server/rollup/auto');
    const { hqNodeOf, loadTree } = await import('@/server/rollup/tree');
    const node = hqNodeOf(await loadTree(), divId.hq)!;
    await syncHq(node, await slot(), { cause: 'template', causedBy: null });
    const got = take();
    expect(to(got)).toEqual([P.hqLead.no]);
    expect(got[0].contents).toContain('양식 첫 문단');
    await syncHq(node, await slot(), { cause: 'retry', causedBy: null, force: true }); // 같은 열쇠로 다시 실패
    expect(take()).toEqual([]);
  });
});

// ── 검증(2026-10-08) — 같은 할 일을 두 번 말하지 않는다 ─────────────────
describe('검증 — NT-52(바뀐 순간)와 NT-40(+10분 검토 요청)이 겹치지 않는다', () => {
  it('[NT-T66] 실장이 승인한 뒤 담당자가 고쳐 NT-52가 간 판이면 +10분 검토 요청을 또 보내지 않는다 · NT-52가 없었으면 검토 요청은 그대로', async () => {
    const prisma = await db();
    const s = await slot();
    const { effectiveDeadline } = await import('@/server/worklog');
    const { runDueMergeNotices } = await import('@/server/notify/merge-notices');
    const deadline = effectiveDeadline(s, await prisma.division.findUniqueOrThrow({ where: { id: divId.u1 } }));
    await merged('u1', '실하나 14:03 승인한 판');
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    take();
    // 14:06 담당자가 고친다 → 실장에게 NT-52 한 번
    expect((await save(P.u1Lead.email, 'u1', '실하나 14:06 담당자 고침')).status).toBe(200);
    await settle();
    expect(take().filter((g) => g.to === P.u1Head.no).map((g) => g.subject)).toEqual([expect.stringContaining('다시 승인해 주세요')]);
    // 병합본이 저장된 시각을 마감 +6분으로 — +10분 검토 창이 열린다 (HM-50)
    await prisma.mergeRun.updateMany({ where: { divisionId: divId.u1, weekSlotId: s.id }, data: { finishedAt: plus(deadline, 6) } });
    await runDueMergeNotices(plus(deadline, 11));
    expect(take().filter((g) => g.to === P.u1Head.no)).toEqual([]);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId.u1, weekSlotId: s.id, kind: 'merge_review' } })).toBe(0);
    // 대조 — NT-52가 나가지 않았던 판이면(기록이 없으면) 검토 요청은 그대로 간다
    await prisma.notifyLog.deleteMany({ where: { divisionId: divId.u1, weekSlotId: s.id, kind: { startsWith: 'merge_reapprove:' } } });
    await runDueMergeNotices(plus(deadline, 12));
    expect(take().filter((g) => g.to === P.u1Head.no)).toHaveLength(1);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId.u1, weekSlotId: s.id, kind: 'merge_review' } })).toBe(1);
  });
});

// ── 결정 f (2026-10-08) — 알림 기록을 보내기 전에 잡는다 ─────────────────
describe('결정 f — 같은 알림을 둘이 같은 순간에 판정해도 한 번', () => {
  it('[RU-T143] ★ 「실·팀 → 본부」 기한의 RU-54(스케줄러)와 다 모인 순간의 RU-54(조립 직후)가 같은 순간 → 본부장에게 한 번, 기록 한 줄 · 못 보냈으면 줄을 놓아 다음에 다시', async () => {
    const prisma = await db();
    const { writeFileAtomic } = await import('@/server/storage');
    const { ensureCurrentSlot } = await import('@/server/worklog');
    const { noticeHqBuilt } = await import('@/server/rollup/notices');
    const { stageTimes } = await import('@/server/rollup/schedule');
    const { hqNodeOf, loadTree } = await import('@/server/rollup/tree');
    // 다음 주 — 아직 아무 알림도 없는 주차. 산하 둘 다 올라와 있고 본부본은 승인 전
    const next = await ensureCurrentSlot(new Date((await slot()).opensAt.getTime() + 10 * 86400_000));
    for (const k of ['u1', 'u2'] as const) {
      const rel = `divisions/${DIV[k].slug}/reports/next-${k}.hwp`;
      await writeFileAtomic(rel, Buffer.from(`${k} 다음 주`));
      await prisma.reportSubmission.create({
        data: { level: 'unit', divisionId: divId[k], weekSlotId: next.id, filePath: rel, sha256: sha(`${k} 다음 주`), byteSize: 1, submittedBy: 'system', basis: 'no_head' },
      });
    }
    const out = 'divisions/NT_HQ/rollup/next.hwp';
    await writeFileAtomic(out, Buffer.from('본부가 다음 주 본부본'));
    const run = await prisma.rollupRun.create({ data: { level: 'hq', divisionId: divId.hq, weekSlotId: next.id, status: 'succeeded', outputPath: out, inputIds: '[]', createdBy: 'system' } });
    const node = hqNodeOf(await loadTree(), divId.hq)!;
    const t = await stageTimes(next);
    const logs = () => prisma.notifyLog.count({ where: { divisionId: divId.hq, weekSlotId: next.id, kind: { in: ['ru_hq_ready', 'ru_hq_complete'] } } });
    take();
    // 메신저가 느리다 — 둘 다 「아직 안 보냄」을 본 뒤에야 첫 전송이 끝난다. 예전(보낸 뒤 기록)에는 여기서 두 번 갔다
    mailbox.delayMs = 150;
    try {
      await Promise.all([due(plus(t.unitDue, 1)), noticeHqBuilt(node, next, run, '')]);
    } finally {
      mailbox.delayMs = 0;
    }
    expect(take().filter((g) => g.to === P.hqHead.no)).toHaveLength(1);
    expect(await logs()).toBe(1);
    expect(JSON.parse((await prisma.notifyLog.findFirstOrThrow({ where: { divisionId: divId.hq, weekSlotId: next.id, kind: 'ru_hq_ready' } })).recipients)).toEqual([P.hqHead.no]);

    // 못 보냈으면(메신저 고장) 잡은 줄을 놓는다 — 「실제로 나간 것만 기록한다」. 다음 판정이 다시 보낸다
    await prisma.notifyLog.deleteMany({ where: { divisionId: divId.hq, weekSlotId: next.id } });
    mailbox.fail = true;
    try {
      expect(await noticeHqBuilt(node, next, run, '')).toEqual([expect.objectContaining({ kind: 'ru_hq_ready', sent: 0 })]);
    } finally {
      mailbox.fail = false;
    }
    expect(await logs()).toBe(0);
    expect((await noticeHqBuilt(node, next, run, '')).map((r) => r.sent)).toEqual([1]);
    expect(take().filter((g) => g.to === P.hqHead.no)).toHaveLength(1);
    expect(await logs()).toBe(1);

    // 엇갈림 (검증 2026-10-08) — 기한 판정(스케줄러)이 일부(1/2)를 보고 먼저 잡았는데, 다 모인 순간의 판정은 그 잡기 **전에** 「아직 안 보냄」을 봤다.
    // 잡기에 진 쪽이 그대로 물러나면 본부장은 「1/2 준비」만 받고 「다 모였어요」는 끝내 못 받는다(예전에는 둘 다 보내 겹쳤다).
    // 진 쪽은 잡힌 줄을 다시 읽어, 일부였으면 「다 모였어요」를 보낸다
    await prisma.notifyLog.deleteMany({ where: { divisionId: divId.hq, weekSlotId: next.id } });
    take();
    const { claimNotice } = await import('@/server/notify/claim');
    const realFindFirst = prisma.notifyLog.findFirst.bind(prisma.notifyLog);
    let raced = false;
    const spy = vi.spyOn(prisma.notifyLog, 'findFirst').mockImplementation((async (args: Parameters<typeof realFindFirst>[0]) => {
      const seen = await realFindFirst(args);
      if (!raced && (args?.where as { kind?: unknown } | undefined)?.kind === 'ru_hq_ready') {
        raced = true; // 「아직 안 보냄」을 본 바로 뒤 — 스케줄러가 일부로 잡는다(보내는 중이라 받은 사람은 아직 비어 있다)
        await claimNotice(divId.hq, next.id, 'ru_hq_ready', { complete: false });
      }
      return seen;
    }) as never);
    try {
      await noticeHqBuilt(node, next, run, '');
    } finally {
      spy.mockRestore();
    }
    expect(raced).toBe(true);
    expect(take().filter((g) => g.to === P.hqHead.no).map((g) => g.subject)).toEqual([expect.stringContaining('다 모였어요')]);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId.hq, weekSlotId: next.id, kind: 'ru_hq_complete' } })).toBe(1);
  });

  it('[RU-T143] (NT-52) 병합 뒤 맞추기와 저장 뒤 맞추기가 같은 승인에 대해 같은 순간 「다시 승인해 주세요」를 판정 → 부서장에게 한 번', async () => {
    const prisma = await db();
    const { notifyReapprove } = await import('@/server/merge/review');
    const s = await slot();
    const division = await prisma.division.findUniqueOrThrow({ where: { id: divId.u1 } });
    // 승인한 판 → 담당자가 고친다(승인 뒤 바뀜). 그 승인에 대한 NT-52 기록은 지우고 같은 순간 둘이 판정하게 한다
    await merged('u1', '실하나 NT-52 동시 승인한 판');
    expect((await approve(P.u1Head.email, 'u1')).status).toBe(200);
    await settle();
    expect((await save(P.u1Lead.email, 'u1', '실하나 NT-52 동시 담당자 고침')).status).toBe(200);
    await settle();
    await prisma.notifyLog.deleteMany({ where: { divisionId: divId.u1, weekSlotId: s.id, kind: { startsWith: 'merge_reapprove:' } } });
    take();
    mailbox.delayMs = 150;
    let counts: number[];
    try {
      counts = await Promise.all([
        notifyReapprove(division, s, '본부가', { kind: 'merge', late: 1 }),
        notifyReapprove(division, s, '본부가', { kind: 'edit', places: 1 }),
      ]);
    } finally {
      mailbox.delayMs = 0;
    }
    expect(counts.sort()).toEqual([0, 1]);
    expect(take().filter((g) => g.to === P.u1Head.no)).toHaveLength(1);
    expect(await prisma.notifyLog.count({ where: { divisionId: divId.u1, weekSlotId: s.id, kind: { startsWith: 'merge_reapprove:' } } })).toBe(1);
  });
});
