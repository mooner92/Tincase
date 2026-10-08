/**
 * OPS-47 — **한 주 리허설.** 가짜 13개 단위로 마감부터 전사본까지를 진짜 스케줄러로 한 번 돌리고, 가짜 알림 수신함(NT-56)에 쌓인 알림이
 * 「각 종류가 맞는 사람에게, 한 번, 제 창 안에」 갔는지 판정한다. 절차는 docs/REHEARSAL.md.
 *
 *   npx tsx scripts/rehearsal.ts prepare [--root=DIR] [--wipe]
 *       가짜 저장소를 만든다 — 13개 단위가 모두 켜진 가짜 조직(사용 안내·시연과 같은 사람 + 역할 이름의 사람), 이번 주 제출(몇 명은 안 냄),
 *       마감은 이번 주 일요일 23:00으로 미뤄 둔다(리허설이 총괄처럼 옮길 수 있게 — 지난 마감은 옮길 수 없다, WS-19j).
 *       DIR는 /data/worklog-demo(11112 시연 모드가 붙는 곳) 또는 임시 디렉터리 안. 기본은 새 임시 디렉터리.
 *       --wipe  이미 가짜 사람이 있는 저장소를 지우고 다시 만든다. 시연 저장소면 **먼저 스냅숏**(demo-snapshot.sh save)
 *   npx tsx scripts/rehearsal.ts run --base=URL [--root=DIR] [--deadline-in=12] [--stages=60,120]
 *       떠 있는 서버(그 저장소를 띄운 — 수신함과 스케줄러가 켜진)를 상대로 돌린다: 총괄이 마감을 지금 + N분으로 옮기고, 부서장·본부장은
 *       받은 알림을 보고 HTTP로 승인한다. 「본부 → 총괄」 기한 + 14분에 끝나 보고서를 찍는다. 종료 코드 0 = 통과
 *       --stages  3단계 기한(부서 마감에서 센 분) — 총괄 설정 화면과 같은 API로 바꾼다. 없으면 저장소 값(기본 60,120) 그대로
 *   npx tsx scripts/rehearsal.ts local [--deadline-in=12] [--stages=40,50] [--port=3417] [--real-model]
 *       로컬 끝까지 한 번에 — 임시 저장소 · 가짜 병합 모델 · next dev(수신함·스케줄러 켬) · run. 서버는 끝나면 끈다
 *   npx tsx scripts/rehearsal.ts fake-model [--port=11499] [--delay-ms=800]
 *       가짜 병합 모델(ollama `/api/generate` 흉내 — 묶을 것 없음 · 분류는 첫 이름). 진짜 모델 없이 병합 길을 끝까지 탄다
 *
 * 왜 진짜 스케줄러인가: 알림 시각은 「마감 + n분」·「병합이 끝난 시각」·「다 모인 순간」이 얽힌다(HM-50 · RU-54·57). 함수 하나씩 시험한 것은
 * 이미 있다 — 리허설이 보는 것은 그것들이 **한 프로세스에서 1분 주기로 함께 돌 때**다. 판정 규칙은 scripts/rehearsal-plan.ts.
 *
 * 알림은 어떤 경우에도 밖으로 나가지 않는다: 서버는 시험·시연 모드에 수신함 주소일 때만 뜨고(OPS-46), 이 스크립트는 메신저를 부르지 않는다.
 * 사람은 전부 @example.invalid — 실제 계정이 하나라도 있는 저장소는 거절한다(시연 시드와 같은 기준).
 */
import path from 'node:path';
import os from 'node:os';
import type http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DEMO_ROOT, pathRefusal } from './demo-plan';
import { fakeModelServer } from './fake-model';
import { currentWeek } from '../src/lib/week';
import { EXISTING_MISSING, HQ_APPROVE_AFTER, HQ_DIV, MIN, UNITS, expectNotices, judge, newPeople, type Facts, type Received, type UnitScript, type Verdict } from './rehearsal-plan';

const REPO = path.resolve(__dirname, '..');
const MARK_ACTOR = 'rehearsal@example.invalid';
const MARK_ACTION = 'rehearsal_seed';
/** 수신함 화면을 볼 가짜 운영자 (이메일 앞부분) */
const OPS_LOCAL = 'rh-ops';
/** 서버마다 쿠키 이름이 다르다(RU-42) — 셋 다 실어 보낸다. 서버는 제 이름만 읽는다 */
const COOKIE_NAMES = ['repman_session', 'repman_test_session', 'repman_demo_session', 'repman_rehearsal_session'];
/** 판정이 끝나는 때 — 「본부 → 총괄」 기한의 총괄 알림 창(12분) + 여유 */
const TAIL_MIN = 14;

const die = (why: string): never => {
  console.error(`rehearsal: 멈춤 — ${why}`);
  process.exit(2);
};
const log = (s: string) => console.log(`[${hms(Date.now())}] ${s}`);
const kst = (ms: number) => new Date(ms + 9 * 3600_000).toISOString();
const hms = (ms: number) => kst(ms).slice(11, 19);
const hm = (ms: number) => kst(ms).slice(5, 16).replace('T', ' ');

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}
const num = (name: string, dflt: number) => {
  const v = arg(name);
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) die(`--${name}는 양수입니다 (받은 값: ${v})`);
  return n;
};

// ── 저장소 ──────────────────────────────────────────────────────────────────

/**
 * 이 프로세스가 쓸 저장소 — DATABASE_URL·STORAGE_ROOT를 정한다. **서버 모듈을 불러오기 전에** 부른다(env.ts는 처음 읽힐 때 굳는다).
 * 시연 저장소(/data/worklog-demo) 또는 임시 디렉터리 안만 — 운영·테스트(실명 사본)를 가리킬 길을 없앤다(시연 시드와 같은 경계).
 */
function openStore(rootArg: string): { root: string; dbFile: string } {
  // 경계를 먼저 본다 — 거절할 곳(/data/worklog-test 옆 등)에 빈 디렉터리부터 만들지 않게(2026-10-08 검증에서 발견)
  const tmpRoot = realpathSync(os.tmpdir());
  const pre = existsSync(rootArg) ? realpathSync(rootArg) : path.resolve(rootArg);
  const early = pathRefusal(path.join(pre, 'db', 'worklog.db'), pre, tmpRoot);
  if (early) die(early);
  mkdirSync(path.join(rootArg, 'db'), { recursive: true });
  // 만든 뒤 한 번 더 — 심볼릭 링크를 푼 진짜 경로로
  const root = realpathSync(rootArg);
  const dbFile = path.join(root, 'db', 'worklog.db');
  const why = pathRefusal(dbFile, root, tmpRoot);
  if (why) die(why);
  const url = `file:${dbFile}`;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) die(`DATABASE_URL(${process.env.DATABASE_URL})이 --root와 다릅니다 — 하나만 주세요`);
  if (process.env.STORAGE_ROOT && path.resolve(process.env.STORAGE_ROOT) !== root) die(`STORAGE_ROOT(${process.env.STORAGE_ROOT})가 --root와 다릅니다`);
  process.env.DATABASE_URL = url;
  process.env.STORAGE_ROOT = root;
  process.env.CF_ACCESS_TEAM ||= 'tincase-rehearsal';
  // 이 프로세스는 알림을 보내지 않고 모델을 부르지 않는다 — 셸에 무엇이 있든
  process.env.MESSENGER_URL = '';
  process.env.MESSENGER_SINK = 'off';
  process.env.TINCASE_ENV = '';
  process.env.MERGE_MODEL = '';
  return { root, dbFile };
}

function rootFrom(): string {
  const r = arg('root');
  if (r) return r;
  if (process.env.STORAGE_ROOT) return process.env.STORAGE_ROOT;
  return die('--root=<저장소> 가 필요합니다 (prepare가 출력한 경로 · 11112면 /data/worklog-demo)');
}

const stateDir = (root: string) => path.join(root, 'rehearsal');
const sessionsFile = (root: string) => path.join(stateDir(root), 'sessions.json');

interface SessionFile {
  isoKey: string;
  /** 이메일 → 세션 토큰 (총괄·부서장·본부장 — HTTP로 승인·마감 옮기기) */
  tokens: Record<string, string>;
}

// ── prepare ─────────────────────────────────────────────────────────────────

async function prepare(rootArg: string, wipe: boolean): Promise<string> {
  const { root, dbFile } = openStore(rootArg);
  const tplPath = process.env.DEMO_TEMPLATE || process.env.GUIDE_TEMPLATE || path.join(REPO, 'fixtures/master-template.hwp');
  if (!existsSync(tplPath)) die(`부서 양식 hwp가 없습니다 (${tplPath}). DEMO_TEMPLATE=<빈 양식.hwp>로 알려 주세요`);
  const template = readFileSync(tplPath);

  // 이미 있는 저장소 — 가짜 사람만이면 --wipe로 지운다. 실제 계정이 있으면 어떤 경우에도 손대지 않는다
  if (existsSync(dbFile) && readFileSync(dbFile).length > 0) {
    const n = sqlite(dbFile, "SELECT COUNT(*) FROM User WHERE email NOT LIKE '%@example.invalid';");
    if (n === null) die(`DB를 읽지 못했습니다: ${dbFile} (sqlite3 필요)`);
    if (n !== '0') die(`@example.invalid가 아닌 계정이 ${n}명 있습니다 — 실제 DB입니다. 손대지 않습니다`);
    const people = sqlite(dbFile, 'SELECT COUNT(*) FROM User;');
    if (people !== '0' && !wipe) {
      die(`가짜 사람이 이미 있는 저장소입니다 — 지우고 다시 만들려면 --wipe${root === DEMO_ROOT ? ' (시연 저장소: 먼저 sudo bash scripts/demo-snapshot.sh save before-rehearsal)' : ''}`);
    }
  }
  if (wipe || existsSync(dbFile)) {
    for (const e of readdirSync(root)) {
      if (e === 'snapshots') continue; // 시연 스냅숏은 남긴다 — 리허설 뒤 되돌릴 곳
      if (e === 'db') {
        for (const f of readdirSync(path.join(root, 'db'))) rmSync(path.join(root, 'db', f), { recursive: true, force: true });
        continue;
      }
      rmSync(path.join(root, e), { recursive: true, force: true });
    }
  }

  const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js', { paths: [REPO] }), 'db', 'push', '--skip-generate'], {
    cwd: REPO,
    env: process.env,
    encoding: 'utf8',
  });
  if (push.status !== 0) die(`prisma db push 실패\n${push.stdout}\n${push.stderr}`);

  const { prisma } = await import('../src/server/db');
  const { hashPassword } = await import('../src/server/password');
  const { createSession } = await import('../src/server/session');
  const { ensureCurrentSlot, uploadSubmission } = await import('../src/server/worklog');
  const { loadSections } = await import('../src/server/rollup/sections');
  const { templateRelPath, writeFileAtomic, sha256 } = await import('../src/server/storage');
  const fake = await import('./fake-org');

  try {
    const hash = await hashPassword(randomBytes(18).toString('base64url')); // 아무도 모르는 비밀번호 — 로그인은 세션으로
    const org = await fake.createFakeOrg(template, hash);

    // 13개 단위 모두 켠다 — 2026-10-12(월)부터 전 섹션이 Tincase다. 본부(기획경영본부) 자신은 문서가 없어 부서 알림을 끈다:
    // 켜 두면 본부 담당자에게 마감 독촉과 「병합본이 아직 없어요」(NT-40)가 간다. 본부장에게 가는 3단계 알림은 이 스위치를 보지 않는다(RU-52)
    for (const d of fake.DIVS) {
      const div = org.div[d.ko];
      await prisma.division.update({ where: { id: div.id }, data: { isActive: true, notifyEnabled: d.ko !== HQ_DIV } });
      if (!d.active) {
        const rel = templateRelPath(d.slug, 1, true);
        await writeFileAtomic(rel, template);
        await prisma.template.create({ data: { divisionId: div.id, filePath: rel, sha256: sha256(template), version: 1, isActive: true, uploadedBy: org.roles.lead.id } });
      }
    }
    // 새 단위의 사람 — 역할 이름 그대로
    let sort = 1000;
    for (const u of UNITS) {
      for (const p of newPeople(u)) {
        await prisma.user.create({
          data: {
            name: p.name,
            email: fake.emailOf(p.local),
            divisionId: org.div[u.div].id,
            divisionRole: p.role === 'member' ? 'member' : p.role,
            onRoster: p.role !== 'head',
            rosterNote: p.role === 'head' ? '부서장' : null,
            jobTitle: p.role === 'head' ? '부서장' : p.role === 'lead' ? '담당' : null,
            mustChangePassword: false,
            passwordHash: hash,
            sortOrder: (sort += 10),
          },
        });
      }
    }
    // 수신함 화면(/ops/notify-sink — 운영자만, TACP-26)을 볼 가짜 운영자. 명단 밖·알림 끔 — 리허설의 알림 판정에 끼지 않는다.
    // 비밀번호는 끝에 한 번 출력한다(저장소에 남기지 않는다)
    const opsPassword = `${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}`;
    await prisma.user.create({
      data: {
        name: '리허설운영',
        email: fake.emailOf(OPS_LOCAL),
        divisionId: org.div['기획조정실'].id,
        isOperator: true,
        onRoster: false,
        rosterNote: '리허설 운영',
        notifyEnabled: false,
        mustChangePassword: false,
        passwordHash: await hashPassword(opsPassword),
        sortOrder: (sort += 10),
      },
    });
    // 사번 — 메신저는 사번으로만 사람을 찾는다(NT-01). 사번 꼴이 아닌 값이라 실제 메신저로 새어도 아무도 못 찾는다
    const everyone = await prisma.user.findMany({ orderBy: [{ sortOrder: 'asc' }, { email: 'asc' }], select: { id: true } });
    for (const [i, u] of everyone.entries()) await prisma.user.update({ where: { id: u.id }, data: { employeeNo: `RH${String(i + 1).padStart(3, '0')}` } });

    // 이번 주 — 마감을 일요일 23:00으로 미뤄 둔다. 리허설이 총괄처럼 「지금 + N분」으로 당긴다(둘 다 아직 오지 않은 마감이어야 옮겨진다)
    const now = new Date();
    const monday = currentWeek(now).opensAt.getTime();
    const sunday = monday + 6 * 24 * 60 * MIN + 23 * 60 * MIN;
    if (sunday - now.getTime() < 3 * 60 * MIN) die('이번 주가 3시간 안에 끝납니다 — 리허설 도중 주차가 바뀌면 스케줄러가 새 주를 봅니다. 월요일에 하세요');
    let slot = await ensureCurrentSlot(now);
    slot = await prisma.weekSlot.update({
      where: { id: slot.id },
      data: { deadlineDowOverride: 7, deadlineTimeOverride: '23:00', deadlineNote: '리허설 준비 — 리허설이 마감을 옮긴다' },
    });

    // 제출 — 각본의 안 낸 사람만 빼고. 시각은 지금 앞 두어 시간에 고르게
    const build = fake.hwpBuilder(template);
    const missing = new Set<string>([
      ...Object.values(EXISTING_MISSING).flat().map(fake.emailOf),
      ...UNITS.flatMap((u) => newPeople(u).filter((p) => p.missing).map((p) => fake.emailOf(p.local))),
    ]);
    const roster = await prisma.user.findMany({
      where: { onRoster: true, isActive: true, division: { nameKo: { in: UNITS.map((u) => u.div) } } },
      include: { division: true },
      orderBy: { sortOrder: 'asc' },
    });
    const submitters = roster.filter((u) => !missing.has(u.email));
    for (const [k, u] of submitters.entries()) {
      const at = new Date(now.getTime() - (120 - (100 * k) / Math.max(1, submitters.length)) * MIN);
      await uploadSubmission({ user: u, division: u.division, fileName: `${slot.label.replace(/ /g, '_')}_${u.name}.hwp`, bytes: build(k + 1, at), origin: 'web' }, at);
    }
    await loadSections();

    // 표식 · 세션 — 승인·마감 옮기기는 HTTP로(화면과 같은 길). 세션은 여기서 만들어 두고 run은 DB에 쓰지 않는다(서버가 쓰는 DB에 다른 프로세스가 쓰지 않게)
    await prisma.auditLog.create({ data: { actor: MARK_ACTOR, action: MARK_ACTION, target: 'tincase-rehearsal', detail: '한 주 리허설용 가짜 DB (OPS-47)' } });
    const actors = await prisma.user.findMany({
      where: { OR: [{ isCoordinator: true }, { divisionRole: 'head' }] },
      select: { id: true, email: true },
    });
    const tokens: Record<string, string> = {};
    for (const a of actors) tokens[a.email] = (await createSession(a.id)).token;
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(sessionsFile(root), JSON.stringify({ isoKey: slot.isoKey, tokens } satisfies SessionFile, null, 1), { mode: 0o600 });
    chmodSync(sessionsFile(root), 0o600);

    const units = await prisma.division.count({ where: { isActive: true, notifyEnabled: true } });
    console.log(
      [
        '',
        `rehearsal prepare: ${slot.label} (${slot.isoKey}) · 단위 ${units}곳 · 사람 ${everyone.length}명 · 제출 ${submitters.length} · 안 냄 ${roster.length - submitters.length}`,
        `  저장소  ${root}`,
        `  마감    일요일 23:00으로 미뤄 둠 — run이 지금 + N분으로 당긴다`,
        `  수신함  /ops/notify-sink — ${fake.emailOf(OPS_LOCAL)} / ${opsPassword}   ← 이 비밀번호는 다시 나오지 않는다`,
        '',
        root === DEMO_ROOT
          ? '  다음: sudo bash scripts/demo-snapshot.sh perms → TINCASE_TEST_MODE=demo TINCASE_REHEARSAL=on bash scripts/deploy.sh test --no-build → run --base=http://127.0.0.1:11112'
          : `  다음: 이 저장소로 서버를 띄우고(docs/REHEARSAL.md) run --root=${root} --base=<서버>`,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
  return root;
}

/** sqlite3 CLI로 한 값 — Prisma 없이 「실제 DB인가」를 먼저 본다(스키마가 다른 DB여도 읽힌다) */
function sqlite(dbFile: string, sql: string): string | null {
  const r = spawnSync('sqlite3', [dbFile, sql], { encoding: 'utf8' });
  if (r.status !== 0) return r.stderr.includes('no such table') ? '0' : null;
  return r.stdout.trim();
}

// ── run ─────────────────────────────────────────────────────────────────────

interface Approval {
  key: string;
  label: string;
  /** 승인하는 사람 */
  email: string;
  kind: 'unit' | 'hq';
  /** 이 알림을 받고 나서 */
  after: string;
  earliest: number | null;
  /** 이때까지 알림이 안 오면 그냥 승인한다(그리고 판정이 「안 왔다」로 남긴다) */
  giveUpAt: () => number | null;
  dueAt: number | null;
  doneAt: number | null;
  note: string | null;
}

async function run(rootArg: string, base: string): Promise<boolean> {
  const { root } = openStore(rootArg);
  if (!existsSync(sessionsFile(root))) die(`${sessionsFile(root)}가 없습니다 — prepare 먼저`);
  const sess = JSON.parse(readFileSync(sessionsFile(root), 'utf8')) as SessionFile;
  const deadlineIn = num('deadline-in', 12);
  const stagesArg = arg('stages');

  const { prisma } = await import('../src/server/db');
  const { readSinkEntries } = await import('../src/server/messenger-sink');

  const cookie = (email: string) => {
    const t = sess.tokens[email] ?? die(`세션이 없습니다: ${email} — prepare를 다시`);
    return COOKIE_NAMES.map((n) => `${n}=${t}`).join('; ');
  };
  const call = async (method: string, p: string, email: string | null, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      redirect: 'manual',
      headers: { ...(email ? { cookie: cookie(email) } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json: json as Record<string, unknown> };
  };

  try {
    const mark = await prisma.auditLog.findFirst({ where: { actor: MARK_ACTOR, action: MARK_ACTION } });
    if (!mark) die('리허설 표식이 없는 저장소입니다 — prepare로 만든 것만 돌린다');
    const coordinators = await prisma.user.findMany({ where: { isCoordinator: true, isActive: true }, select: { email: true, name: true } });
    const coord = coordinators[0] ?? die('총괄이 없습니다');

    // ── 겨눈 서버가 이 저장소를, 수신함을 켜고 띄웠나 ──
    const health = await call('GET', '/api/health', null).catch(() => null);
    if (!health || health.status !== 200) die(`서버가 응답하지 않습니다: ${base}/api/health`);
    const sink = await call('GET', '/api/dev/messenger-sink', null);
    if (sink.status !== 200) die('가짜 알림 수신함이 닫혀 있습니다 — 서버를 TINCASE_ENV=demo(또는 test) · MESSENGER_SINK=on · MESSENGER_URL=<서버>/api/dev/messenger-sink로 띄우세요 (OPS-46)');
    const probe = await call('GET', '/org', coord.email);
    if (probe.status !== 200) die(`이 서버는 이 저장소를 보고 있지 않습니다 (리허설 세션으로 /org → HTTP ${probe.status})`);

    // ── 3단계 기한 (총괄 설정 — 같은 API) ──
    if (stagesArg) {
      const [u, h] = stagesArg.split(',').map(Number);
      if (!(u > 0 && h >= u)) die(`--stages는 「실·팀 → 본부,본부 → 총괄」 분 (예: 40,50 — 뒤가 앞보다 크거나 같다). 받은 값: ${stagesArg}`);
      const r = await call('PUT', '/api/rollup/org/settings', coord.email, { enabled: true, unitDueMinutes: u, hqDueMinutes: h });
      if (r.status !== 200) die(`3단계 기한을 바꾸지 못했습니다: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    }
    const setting = (await prisma.orgRollupSetting.findUnique({ where: { id: 'org' } })) ?? die('3단계 설정이 없습니다');
    if (!setting.enabled) die('3단계가 꺼져 있습니다');

    // ── 마감을 지금 + N분으로 — 총괄의 [일정 바꾸기]와 같은 API(WS-19, TACP-20). 대외 마감 = 부서 마감 + 60분 ──
    const deadline = Math.ceil((Date.now() + deadlineIn * MIN) / MIN) * MIN;
    const hqDue = deadline + setting.hqDueMinutes * MIN;
    // 주차가 바뀌면(월 00:00 KST) 스케줄러는 새 주를 본다 — 리허설은 그 전에 끝나야 한다
    const nextMonday = currentWeek(new Date(deadline)).opensAt.getTime() + 7 * 24 * 60 * MIN;
    if (hqDue + (TAIL_MIN + 2) * MIN > nextMonday) die(`리허설이 월요일 0시를 넘깁니다(끝 ${hm(hqDue + TAIL_MIN * MIN)}) — 주차가 바뀌면 스케줄러가 새 주를 봅니다. --deadline-in이나 --stages를 줄이세요`);
    const external = kst(deadline + 60 * MIN).slice(0, 16);
    const runStart = Date.now();
    const applied = await call('POST', '/api/schedule/deadline', coord.email, { mode: 'apply', external });
    if (applied.status !== 200) die(`마감을 옮기지 못했습니다: HTTP ${applied.status} ${JSON.stringify(applied.json)}`);
    const plan = (applied.json as { plan: { department: string; isoKey: string } }).plan;
    if (new Date(plan.department).getTime() !== deadline) die(`옮긴 마감이 계산과 다릅니다: ${plan.department}`);
    if (plan.isoKey !== sess.isoKey) die(`주차가 다릅니다 — 준비 ${sess.isoKey} · 지금 ${plan.isoKey}. prepare를 다시`);
    const unitDue = deadline + setting.unitDueMinutes * MIN;
    log(`마감 ${hm(deadline)} · 실·팀 → 본부 ${hm(unitDue)} · 본부 → 총괄 ${hm(hqDue)} · 끝 ${hm(hqDue + TAIL_MIN * MIN)} (총괄 ${coord.name})`);

    // ── 사람 ──
    const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: sess.isoKey } });
    const divs = await prisma.division.findMany({ include: { users: { where: { isActive: true } } } });
    const divOf = (ko: string) => divs.find((d) => d.nameKo === ko) ?? die(`부서가 없습니다: ${ko}`);
    const headOf = (ko: string) => divOf(ko).users.find((u) => u.divisionRole === 'head') ?? null;
    const hqHead = headOf(HQ_DIV) ?? die('본부장이 없습니다');

    // ── 승인 각본 ──
    const sinkSince = async (): Promise<Received[]> =>
      (await readSinkEntries())
        .filter((e) => Date.parse(e.at) >= runStart)
        .flatMap((e) => e.recipients.map((r) => ({ at: Date.parse(e.at), kind: e.kind, email: r.email, employeeNo: r.employeeNo, subject: e.subject })));
    const mergedAt = new Map<string, number>();
    const approvals: Approval[] = [];
    for (const u of UNITS) {
      const h = headOf(u.div);
      if (!u.approve || !h) continue;
      const a = u.approve;
      const due = (u.toHq ? unitDue : hqDue) - 15 * MIN;
      approvals.push({
        key: u.div,
        label: `${u.div} 부서장`,
        email: h.email,
        kind: 'unit',
        after: a.after,
        earliest: a.after === 'merge_review' ? deadline + a.earliest * MIN : null,
        giveUpAt: () => {
          if (a.after === 'merge_review') {
            const m = mergedAt.get(u.div);
            return m === undefined ? null : Math.max(deadline + 10 * MIN, m) + (12 + 3) * MIN;
          }
          return due + (12 + 3) * MIN;
        },
        dueAt: null,
        doneAt: null,
        note: null,
      });
    }
    approvals.push({
      key: HQ_DIV,
      label: '본부장',
      email: hqHead.email,
      kind: 'hq',
      after: HQ_APPROVE_AFTER,
      earliest: null,
      giveUpAt: () => hqDue - 15 * MIN + (12 + 3) * MIN,
      dueAt: null,
      doneAt: null,
      note: null,
    });

    const approve = async (a: Approval): Promise<boolean> => {
      if (a.kind === 'unit') {
        const view = await call('GET', `/api/division/merged/content?isoKey=${sess.isoKey}`, a.email);
        if (view.status !== 200) return false; // 아직 병합본이 없다 — 다음 바퀴에
        const t0 = Date.now();
        const r = await call('POST', '/api/division/merged/approve', a.email, { isoKey: sess.isoKey, runId: view.json.runId, sha256: view.json.sha256 });
        if (r.status !== 200) {
          log(`  ${a.label} 승인 실패 HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
          return false;
        }
        a.doneAt = t0;
        return true;
      }
      const view = await call('GET', `/api/rollup/hq?isoKey=${sess.isoKey}`, a.email);
      const cur = (view.json.board as { current?: { id?: string; sha256?: string } } | undefined)?.current;
      if (view.status !== 200 || !cur?.id) return false;
      const t0 = Date.now();
      const r = await call('POST', '/api/rollup/hq/approve', a.email, { isoKey: sess.isoKey, runId: cur.id, sha256: cur.sha256 });
      if (r.status !== 200) {
        log(`  ${a.label} 승인 실패 HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
        return false;
      }
      a.doneAt = t0;
      return true;
    };

    // ── 돌린다 ──
    const end = hqDue + TAIL_MIN * MIN;
    // 승인이 계속 실패해도(409 등) 끝은 있다 — 판정은 그때까지 본 것으로 한다
    const hardEnd = end + 10 * MIN;
    const seenSink = new Set<string>();
    const seenRows = new Set<string>();
    const timeline: { at: number; text: string }[] = [{ at: deadline, text: '부서 마감' }];
    let warnedNoMerge = false;
    while (Date.now() < hardEnd) {
      const now = Date.now();
      // 수신함
      for (const r of await sinkSince()) {
        const k = `${r.at}|${r.kind}|${r.email}`;
        if (seenSink.has(k)) continue;
        seenSink.add(k);
        // 받은 시각으로 찍는다 — 이 바퀴(10초)의 시각이 아니라
        console.log(`[${hms(r.at)}] 알림 ${r.kind.split(':')[0]} → ${r.email.replace('@example.invalid', '') || r.employeeNo} · ${r.subject}`);
      }
      // 병합 · 넘김 · 본부본·전사본
      try {
        for (const m of await prisma.mergeRun.findMany({ where: { weekSlotId: slot.id, startedAt: { gte: new Date(deadline) }, status: { in: ['succeeded', 'failed'] } }, include: { division: true } })) {
          const k = `merge:${m.id}`;
          if (seenRows.has(k) || !m.finishedAt) continue;
          seenRows.add(k);
          if (m.status === 'succeeded' && !mergedAt.has(m.division.nameKo)) mergedAt.set(m.division.nameKo, m.finishedAt.getTime());
          const text = `병합 ${m.status === 'succeeded' ? '끝' : '실패'} — ${m.division.nameKo}${m.errorText ? ` (${m.errorText.slice(0, 60)})` : ''}`;
          timeline.push({ at: m.finishedAt.getTime(), text });
          log(text);
        }
        for (const s of await prisma.reportSubmission.findMany({ where: { weekSlotId: slot.id }, include: { division: true } })) {
          const k = `report:${s.id}`;
          if (seenRows.has(k)) continue;
          seenRows.add(k);
          const text = `${s.level === 'hq' ? '본부본 → 총괄' : '위로 올라감'} — ${s.division.nameKo} (${s.basis}${s.cause ? ` · ${s.cause}` : ''})`;
          timeline.push({ at: s.submittedAt.getTime(), text });
          log(text);
        }
        for (const r of await prisma.rollupRun.findMany({ where: { weekSlotId: slot.id }, include: { division: true } })) {
          const k = `rollup:${r.id}:${r.status}`;
          if (seenRows.has(k) || r.status === 'running') continue;
          seenRows.add(k);
          const text = `${r.level === 'hq' ? `본부본 ${r.division?.nameKo ?? ''}` : '전사본'} ${r.status === 'succeeded' ? '만듦' : `실패 (${(r.errorText ?? '').slice(0, 60)})`}${r.cause ? ` · ${r.cause}` : ''}`;
          timeline.push({ at: (r.finishedAt ?? r.startedAt).getTime(), text });
          log(text);
        }
      } catch (e) {
        log(`DB 읽기 건너뜀 (${(e as Error).message.slice(0, 80)}) — 다음 바퀴에`);
      }
      if (!warnedNoMerge && now > deadline + 5 * MIN && mergedAt.size === 0) {
        warnedNoMerge = true;
        log('⚠ 마감 5분이 지났는데 병합이 하나도 없습니다 — 서버의 스케줄러가 켜져 있나요(MERGE_SCHEDULER · TINCASE_REHEARSAL=on)?');
      }
      // 승인
      const received = await sinkSince();
      for (const a of approvals) {
        if (a.doneAt !== null) continue;
        if (a.dueAt === null) {
          const got = received.find((r) => r.kind.split(':')[0] === a.after && r.email === a.email);
          if (got) a.dueAt = Math.max(got.at + (a.kind === 'hq' || a.after !== 'merge_review' ? 30_000 : 20_000), a.earliest ?? 0);
          else {
            const g = a.giveUpAt();
            if (g !== null && now >= g) {
              a.dueAt = now;
              a.note = `${a.after}를 받지 못해 ${hms(now)}에 그냥 승인`;
              log(`⚠ ${a.label}: ${a.note}`);
            }
          }
        }
        if (a.dueAt !== null && now >= a.dueAt && (await approve(a))) {
          timeline.push({ at: a.doneAt!, text: `${a.label} 승인${a.note ? ' (알림 없이)' : ''}` });
          log(`${a.label} 승인`);
        }
      }
      if (Date.now() >= end && approvals.every((a) => a.doneAt !== null || a.dueAt === null)) break; // 할 승인이 남았으면 조금 더
      await new Promise((r) => setTimeout(r, 10_000));
    }

    // ── 판정 ──
    await new Promise((r) => setTimeout(r, 5_000)); // 마지막 사건 알림(after())이 들어올 틈
    const facts = await collectFacts(prisma, slot.id, { runStart, deadline, unitDue, hqDue }, approvals, mergedAt);
    const verdict = judge(expectNotices(facts), await sinkSince());
    const report = formatReport(sess.isoKey, facts, verdict, approvals, timeline);
    mkdirSync(stateDir(root), { recursive: true });
    const out = path.join(stateDir(root), `report-${kst(Date.now()).slice(0, 16).replace(/[-:T]/g, '')}.txt`);
    writeFileSync(out, report);
    console.log(`\n${report}\n보고서: ${out}`);
    return verdict.ok && approvals.every((a) => !a.note);
  } finally {
    await prisma.$disconnect();
  }
}

type Db = (typeof import('../src/server/db'))['prisma'];

async function collectFacts(
  prisma: Db,
  weekSlotId: string,
  t: { runStart: number; deadline: number; unitDue: number; hqDue: number },
  approvals: Approval[],
  mergedAt: Map<string, number>,
): Promise<Facts> {
  const person = (u: { email: string; name: string }) => ({ email: u.email, name: u.name });
  const units = [];
  for (const u of UNITS as UnitScript[]) {
    const d = await prisma.division.findFirstOrThrow({ where: { nameKo: u.div }, include: { users: { where: { isActive: true } } } });
    const subs = await prisma.submission.findMany({ where: { divisionId: d.id, weekSlotId, isLatest: true }, select: { userId: true } });
    const who = new Set(subs.map((s) => s.userId));
    const arrived = await prisma.reportSubmission.findFirst({ where: { divisionId: d.id, weekSlotId, level: 'unit' }, orderBy: { submittedAt: 'asc' } });
    const lead = d.users.find((x) => x.divisionRole === 'lead')!;
    const head = d.users.find((x) => x.divisionRole === 'head') ?? null;
    units.push({
      div: u.div,
      toHq: u.toHq,
      lead: person(lead),
      head: head ? person(head) : null,
      missing: d.users.filter((x) => x.onRoster && x.notifyEnabled && x.employeeNo && !who.has(x.id)).map(person),
      submitted: subs.length,
      mergedAt: mergedAt.get(u.div) ?? null,
      approvedAt: approvals.find((a) => a.key === u.div)?.doneAt ?? null,
      arrivedAt: arrived ? arrived.submittedAt.getTime() : null,
    });
  }
  const hq = await prisma.division.findFirstOrThrow({ where: { nameKo: HQ_DIV }, include: { users: true } });
  const coordinators = await prisma.user.findMany({ where: { isCoordinator: true, isActive: true, notifyEnabled: true, employeeNo: { not: null } } });
  // NT-60 — 「병합 점검」 받는 사람: 운영자 ∪ 총괄이 있는 부서의 lead (TACP-30 표를 옮겨 적었다 — authz.ts를 부르지 않는다)
  const coordDivisions = await prisma.division.findMany({ where: { users: { some: { isCoordinator: true, isActive: true } } }, select: { id: true } });
  const batchAudience = await prisma.user.findMany({
    where: {
      isActive: true,
      notifyEnabled: true,
      employeeNo: { not: null },
      OR: [{ isOperator: true }, { divisionRole: 'lead', divisionId: { in: coordDivisions.map((d) => d.id) } }],
    },
  });
  return {
    ...t,
    units,
    hqHead: person(hq.users.find((x) => x.divisionRole === 'head')!),
    hqApprovedAt: approvals.find((a) => a.kind === 'hq')?.doneAt ?? null,
    coordinators: coordinators.map(person),
    batchAudience: batchAudience.map(person),
  };
}

function formatReport(isoKey: string, f: Facts, v: Verdict, approvals: Approval[], timeline: { at: number; text: string }[]): string {
  const short = (e: string) => e.replace('@example.invalid', '');
  const bad = v.rows.filter((r) => !r.ok);
  const lines = [
    `리허설 ${isoKey} — 마감 ${hm(f.deadline)} · 실·팀 → 본부 ${hm(f.unitDue)} · 본부 → 총괄 ${hm(f.hqDue)}`,
    `알림 기대 ${v.rows.length} (반드시 ${v.rows.filter((r) => r.expect.required).length}) · 맞음 ${v.rows.length - bad.length} · 틀림 ${bad.length} · 뜻밖 ${v.unexpected.length}` +
      ` · 승인 ${approvals.filter((a) => a.doneAt).length}/${approvals.length}${approvals.some((a) => a.note) ? ' (알림 없이 승인 있음)' : ''}`,
    `결과: ${v.ok && approvals.every((a) => !a.note) ? '통과' : '실패'}`,
    '',
    '알림',
    ...[...v.rows]
      .sort((a, b) => a.expect.from - b.expect.from)
      .map((r) => {
        const got = r.got.map((g) => hms(g.at)).join(',') || '—';
        return `  ${r.ok ? '✓' : '✗'} ${got.padEnd(8)} ${r.expect.kind.padEnd(17)} ${short(r.expect.to.email).padEnd(14)} 창 ${hms(r.expect.from)}~${hms(r.expect.until)}${r.expect.required ? '' : ' (와도 되는)'} · ${r.expect.why}${r.problem ? `  ← ${r.problem}` : ''}`;
      }),
    ...(v.unexpected.length ? ['', '뜻밖의 알림 (기대하지 않은 것)', ...v.unexpected.map((r) => `  ✗ ${hms(r.at)} ${r.kind} → ${short(r.email) || r.employeeNo} · ${r.subject}`)] : []),
    ...(approvals.some((a) => a.note) ? ['', '승인', ...approvals.filter((a) => a.note).map((a) => `  ✗ ${a.label}: ${a.note}`)] : []),
    '',
    '흐름',
    ...[...timeline].sort((a, b) => a.at - b.at).map((x) => `  ${hms(x.at)} ${x.text}`),
  ];
  return lines.join('\n');
}

// ── local ───────────────────────────────────────────────────────────────────

/** next dev가 고쳐 쓰는 파일 — 끝나면 되돌린다(scripts/guide-capture.cjs와 같다) */
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'next-env.d.ts'];

async function local(): Promise<boolean> {
  const port = num('port', 3417);
  const real = arg('real-model') !== undefined;
  const root = mkdtempSync(path.join(os.tmpdir(), 'tincase-rehearsal-'));
  await prepare(root, false);

  let model: http.Server | null = null;
  let modelCalls = () => 0;
  // 진짜 모델은 이 서버의 tincase-ollama(:11437) — 운영 마감(목 14:00)과 겹치지 않는 때에만
  let modelUrl = 'http://127.0.0.1:11437';
  if (!real) {
    const fake = fakeModelServer(num('delay-ms', 800));
    model = fake.server;
    modelCalls = fake.calls;
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    modelUrl = `http://127.0.0.1:${(fake.server.address() as { port: number }).port}`;
  }
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    CF_ACCESS_AUD: '',
    TINCASE_ENV: 'demo',
    MESSENGER_SINK: 'on',
    MESSENGER_URL: `${base}/api/dev/messenger-sink`,
    MESSENGER_ALLOWLIST: '*',
    MESSENGER_LINK_BASE: '',
    MERGE_SCHEDULER: 'on',
    MERGE_PAUSE_UNTIL: '',
    MERGE_MODEL: real ? 'hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M' : 'fake-model',
    MERGE_MODEL_URL: modelUrl,
    SUBMIT_HWP_UPLOAD: 'off',
    SESSION_COOKIE_NAME: 'repman_rehearsal_session',
    LOG_LEVEL: 'warn',
  };
  delete env.DEV_IDENTITY;
  const saved = Object.fromEntries(AGENT_FILES.map((f) => [f, existsSync(path.join(REPO, f)) ? readFileSync(path.join(REPO, f)) : null]));
  let server: ChildProcess | null = null;
  const restore = () => {
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* 이미 꺼졌다 */
      }
      server = null;
    }
    model?.close();
    for (const [f, buf] of Object.entries(saved)) {
      const p = path.join(REPO, f);
      if (buf === null) {
        if (existsSync(p)) rmSync(p);
      } else if (!existsSync(p) || !readFileSync(p).equals(buf)) writeFileSync(p, buf);
    }
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
  try {
    const logFile = path.join(root, 'next-dev.log');
    const { openSync } = await import('node:fs');
    const fd = openSync(logFile, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [REPO] }), 'dev', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: REPO,
      env,
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    log(`next dev → ${base} (로그 ${logFile}) · 모델 ${real ? '진짜' : '가짜'} ${modelUrl}`);
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 240_000) die(`서버가 뜨지 않습니다 — ${logFile}`);
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    // 개발 서버는 경로를 처음 부를 때 컴파일한다(수 초) — 알림 클라이언트의 10초 제한에 걸리지 않게 미리 부른다
    const sess = JSON.parse(readFileSync(sessionsFile(root), 'utf8')) as SessionFile;
    const anyHead = Object.keys(sess.tokens).find((e) => e.startsWith('head@')) ?? Object.keys(sess.tokens)[0];
    const c = (e: string) => COOKIE_NAMES.map((n) => `${n}=${sess.tokens[e]}`).join('; ');
    for (const p of ['/api/dev/messenger-sink', '/org', `/api/division/merged/content?isoKey=${sess.isoKey}`, `/api/rollup/hq?isoKey=${sess.isoKey}`, '/hq']) {
      await fetch(`${base}${p}`, { headers: { cookie: c(p.includes('hq') ? 'hq-head@example.invalid' : anyHead) }, redirect: 'manual' }).catch(() => null);
    }
    await fetch(`${base}/api/dev/messenger-sink`, { method: 'POST', body: 'warm=1' }).catch(() => null); // 422 — 컴파일만
    const ok = await run(root, base);
    if (!real) log(`가짜 모델이 받은 호출 ${modelCalls()}번`);
    return ok;
  } finally {
    restore();
    log(`저장소는 남겨 둔다: ${root}`);
  }
}

// ── 입구 ────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'prepare') {
    await prepare(arg('root') || mkdtempSync(path.join(os.tmpdir(), 'tincase-rehearsal-')), arg('wipe') !== undefined);
    return;
  }
  if (cmd === 'run') {
    const base = arg('base') ?? die('--base=<서버 주소> (예: http://127.0.0.1:11112)');
    process.exit((await run(rootFrom(), base.replace(/\/+$/, ''))) ? 0 : 1);
  }
  if (cmd === 'local') process.exit((await local()) ? 0 : 1);
  if (cmd === 'fake-model') {
    const { server } = fakeModelServer(num('delay-ms', 800));
    const port = num('port', 11499);
    server.listen(port, '127.0.0.1', () => log(`가짜 병합 모델 http://127.0.0.1:${port} — MERGE_MODEL_URL로 주세요 (끄려면 Ctrl+C)`));
    return;
  }
  console.error('사용법: npx tsx scripts/rehearsal.ts <prepare|run|local|fake-model> … (docs/REHEARSAL.md)');
  process.exit(1);
}

// 이 파일을 직접 돌릴 때만 — 시험이 불러도 아무것도 하지 않는다
if (/rehearsal\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('rehearsal: 실패 —', e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  });
}
