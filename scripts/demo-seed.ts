/**
 * RU-45 — 운영회의(11/2) **시연 데이터**의 가짜 DB. 테스트 서버(11112, `docker-compose.test.yml`)를
 *   `TINCASE_TEST_MODE=demo`로 띄우면 이 저장소(/data/worklog-demo)가 붙는다 — 시연용 포트·인스턴스는 따로 없다. 절차는 docs/DEMO.md.
 *
 *   npx tsx scripts/demo-seed.ts [--stage=ready] [--week=2026-W45] [--until=09:40]
 *
 *   --stage  open  이번 주는 비어 있다(지난주만 끝까지)
 *            ready (기본) 부서원 대부분 제출·몇 명 남음 · 실·팀 셋 병합·실장 승인(= 저절로 올라감) · 본부본은 둘로 모여
 *                  본부장 승인 전 · AI홍보전략실 병합 전 — 시연자가 [지금 병합] → 실장 [승인] → 본부장 [승인]을 누른다
 *            hq    ready + AI홍보전략실 병합·실장 승인 — 남은 것은 본부장 [검토 완료 · 승인]
 *            done  hq + 본부장 승인 — 총괄로 갔고 전사본까지 저절로
 *            2026-10-08(ADR-0015 · RU-84) — 승인이 곧 위로 가는 제출이다. [제출]·[이어 붙이기]·[총괄에 제출]·[전사 취합본 만들기]는 없고,
 *            본부본·전사본은 승인 뒤에 저절로 맞춰진다(시드는 화면의 `after()` 대신 단계마다 `settleLater()`로 기다린다)
 *   --week   그 주차(ISO 키). 기본은 이야기 시각이 든 주. 그 앞 주는 늘 끝까지 간 한 주로 만든다(「지난번에 낸 것」·주차 고르기)
 *   --until  이야기의 「지금」 — 시드가 만든 일이 모두 이 시각 전에 일어난 것으로 찍힌다. 「09:40」(오늘, KST) 또는 ISO.
 *            기본은 지금. 새벽에 시드하면 「03:12 제출」이 강당에 뜨므로 **회의 시작 조금 전**을 준다.
 *            화면에서 누를 일(제출·병합·승인)은 이 시각 **뒤**여야 한다 — 「가장 최근」을 시각으로 고르는 곳이 있다
 *   SUBMIT_HWP_UPLOAD=off  (11112와 같게) 총괄이 올린 섹션 파일을 만들지 않는다(RU-60a — hwp 스위치를 그대로 따른다)
 *   --keep-open  그 주의 마감을 일요일 20:00으로 미룬다(주차 마감 예외, WS-18 — 화면에 이유가 보인다).
 *            목 14:00 마감이 지난 금요일 리허설에서 부서원 [제출]을 눌러 보려고. 회의 날(월)에는 주지 않는다
 *
 * 사람·업무는 `scripts/fake-org.ts` — 사용 안내 슬라이드와 같은 사람들이다. 사람은 전부 @example.invalid.
 *
 * 다시 돌리면(시연 표식이 있는 DB) 주차 기록을 모두 지우고 지난주 + 그 주를 다시 만든다. 부서·사람 설정도 만든 그대로 되돌린다.
 * **비밀번호·세션은 그대로다** — 리허설 때 역할별 브라우저에 로그인해 둔 것이 회의 날 아침 다시 시드한 뒤에도 살아 있다.
 *
 * 거절하는 경우 (종료 코드 2) — 강당 프로젝터에 실명이 뜨는 길을 막는다:
 *   - DB·저장소가 /data/worklog-demo 또는 임시 디렉터리 밖 — 운영(/data/worklog)·테스트(/data/worklog-test, 운영 사본)를 가리킬 길이 없다
 *   - DB에 @example.invalid가 아닌 계정이 하나라도 있다 — 실제 DB다
 *   - 사람은 있는데 시연 표식이 없다 — 이 시드가 만든 DB가 아니다
 *   - 저장소에 쓸 수 없는 디렉터리가 있다 — 컨테이너(uid 10001)가 만든 것. `sudo bash scripts/demo-snapshot.sh perms` 먼저
 *
 * 비밀번호: `DEMO_PASSWORD`가 있으면 그것, 없으면 **처음 시드할 때 만들어 끝에 한 번** 출력한다(저장소에 남기지 않는다).
 * 역할 계정(fake-org `ROLES`)만 이 비밀번호다 — 나머지 가짜 사람의 비밀번호는 아무도 모른다.
 * 알림은 어떤 경우에도 나가지 않는다 — 메신저를 끄고 시작한다. 병합 보조 모델도 끈다(시드는 결정론 병합, 시연 때는 컨테이너가 부른다).
 */
import path from 'node:path';
import os from 'node:os';
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Division, User, WeekSlot } from '@prisma/client';
import { env } from '../src/server/env';
import { prisma } from '../src/server/db';
import { messengerStatus } from '../src/server/messenger';
import { hashPassword } from '../src/server/password';
import { resolveInRoot } from '../src/server/storage';
import { ensureCurrentSlot, uploadSubmission } from '../src/server/worklog';
import { runMergeRecorded } from '../src/server/merge/run';
import { hqNodeOf, loadTree, type RollupNode } from '../src/server/rollup/tree';
import { approveHq, latestHqRun } from '../src/server/rollup/handoff';
import { syncOrg } from '../src/server/rollup/auto';
import { fileSha } from '../src/server/rollup/report';
import { settleLater } from '../src/server/after';
import { loadSections, uploadSectionFile } from '../src/server/rollup/sections';
import { hwpUploadOpen } from '../src/server/submit-mode';
import { currentWeek, deadlineFor, describeWeek, toKstIso } from '../src/lib/week';
import {
  CLOCK_COLS, PEOPLE, ROLES, approveAs, createFakeOrg, delegate, emailOf, foreignUserCount, hwpBuilder, loadFakeOrg, restoreFakeOrg, scopeOf, UNIT_HEADS,
  type FakeOrg, type Role,
} from './fake-org';
import { AI, CA, HQ, KEEP_OPEN, PCO, RMO, STAGE_NOTE, contentNo, mondayOfIsoKey, parseArgs, pathRefusal, planWeek, type Action, type Cast, type Planned, type Stage } from './demo-plan';

const MARK_ACTOR = 'demo-seed@example.invalid';
const MARK_ACTION = 'demo_seed';
const MIN = 60_000;

const refuse = (why: string): never => {
  console.error(`demo-seed: 거절 — ${why}`);
  process.exit(2);
};
const kst = (d: Date) => toKstIso(d).slice(5, 16).replace('T', ' ');
/** 터미널 칸 맞춤 — 한글은 두 칸 */
const pad = (s: string, cols: number) => s + ' '.repeat(Math.max(1, cols - [...s].reduce((n, ch) => n + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af]/.test(ch) ? 2 : 1), 0)));

/** 화면에 보이는 역할 이름 — 마지막 안내에 쓴다 */
const ROLE_KO: Record<Role, string> = {
  memberPending: '부서원 · 아직 안 냄 (화면에서 제출)',
  member: '부서원 · 이미 냄',
  lead: '부서담당자 (AI홍보전략실)',
  head: '실장 (AI홍보전략실)',
  hqLead: '본부 담당 (기획경영본부)',
  hqHead: '본부장 (기획경영본부)',
  coordinator: '총괄 (기획조정실)',
};

// ── 지키는 것 ────────────────────────────────────────────────────────────────

function realDir(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return refuse(`경로가 없습니다: ${p} — 먼저 만들고 prisma db push 하세요 (docs/DEMO.md D-7)`);
  }
}

function checkPaths(): { dbFile: string; storage: string } {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) refuse(`DATABASE_URL이 SQLite 파일이 아닙니다: ${url || '(없음)'}`);
  const raw = url.slice('file:'.length);
  if (!path.isAbsolute(raw)) refuse(`DATABASE_URL은 절대 경로여야 합니다 (file:/…): ${url}`);
  // 심볼릭 링크를 푼 진짜 경로로 본다 — /tmp/x → /data/worklog 같은 링크로 빠져나가지 않게
  const dbFile = path.join(realDir(path.dirname(raw)), path.basename(raw));
  if (!existsSync(dbFile)) refuse(`DB 파일이 없습니다: ${dbFile} — prisma db push 먼저`);
  const storage = realDir(process.env.STORAGE_ROOT ?? '');
  const why = pathRefusal(dbFile, storage, realDir(os.tmpdir()));
  if (why) refuse(why);
  return { dbFile, storage };
}

/** 컨테이너(uid 10001)가 만든 디렉터리는 750이라 여기서 못 쓴다 — 반쯤 시드하고 멈추기 전에 미리 본다 */
function unwritable(root: string, dbFile: string): string[] {
  const bad: string[] = [];
  const walk = (dir: string) => {
    try {
      accessSync(dir, constants.W_OK | constants.X_OK);
    } catch {
      bad.push(dir);
      return;
    }
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !(dir === root && e.name === 'snapshots')) walk(path.join(dir, e.name));
    }
  };
  walk(root);
  for (const p of [dbFile, path.dirname(dbFile)]) {
    try {
      accessSync(p, constants.W_OK);
    } catch {
      bad.push(p);
    }
  }
  return [...new Set(bad)];
}

// ── 시각 ────────────────────────────────────────────────────────────────────

/**
 * 장부 — 이미 시각을 정한 행. 일 하나를 한 뒤 **새로 생긴 행**만 그 일의 시각으로 고쳐 쓴다.
 * 시각으로 고르지 않는 이유는 guide-seed의 fixClock과 같다: 시드가 넣은 시각과 엔진이 넣은 진짜 시각이 겹친다.
 */
const ledger = new Map<string, Set<string>>();

async function fillLedger() {
  for (const [model] of CLOCK_COLS) {
    const rows = await delegate(model).findMany({ select: { id: true } });
    ledger.set(model, new Set(rows.map((r) => r.id as string)));
  }
}

async function stampNew(at: Date) {
  for (const [model, col] of CLOCK_COLS) {
    const seen = ledger.get(model) ?? new Set<string>();
    ledger.set(model, seen);
    const fresh = (await delegate(model).findMany({ select: { id: true } })).map((r) => r.id as string).filter((id) => !seen.has(id));
    for (const id of fresh) {
      const data: Record<string, Date> = { [col]: at };
      // 앱이 진짜 시각으로 넣은 「끝난 시각」도 같이 — 시작보다 앞서면 화면이 「병합 07:01」·「제출 09:12」로 뒤집힌다
      if (model === 'mergeRun' || model === 'rollupRun') data.finishedAt = new Date(at.getTime() + 4000);
      await delegate(model).update({ where: { id }, data });
      seen.add(id);
    }
  }
}

// ── 되돌리기 ────────────────────────────────────────────────────────────────

/** 주차 기록을 모두 지운다 — 부서·사람·양식·세션·표식은 남는다. 지우지 못한 파일 수를 돌려준다 */
async function resetWeeks(): Promise<{ rows: number; files: number; failed: number }> {
  const files = [
    ...(await prisma.submission.findMany({ select: { filePath: true } })).map((r) => r.filePath),
    ...(await prisma.mergeRun.findMany({ select: { outputPath: true } })).map((r) => r.outputPath),
    ...(await prisma.reportSubmission.findMany({ select: { filePath: true } })).map((r) => r.filePath),
    ...(await prisma.rollupRun.findMany({ select: { outputPath: true } })).map((r) => r.outputPath),
    ...(await prisma.orgSectionUpload.findMany({ select: { filePath: true } })).map((r) => r.filePath),
  ].filter((f): f is string => !!f);

  let rows = 0;
  for (const n of await prisma.$transaction([
    prisma.orgSectionUpload.deleteMany({}),
    prisma.mergeReview.deleteMany({}),
    prisma.rollupRun.deleteMany({}),
    prisma.reportSubmission.deleteMany({}),
    prisma.mergeRun.deleteMany({}),
    prisma.submission.deleteMany({}),
    prisma.slotOpening.deleteMany({}),
    prisma.notifyLog.deleteMany({}),
    prisma.weekSlot.deleteMany({}),
    prisma.orgSection.deleteMany({}), // 섹션 구성 편집을 리허설에서 눌렀어도 기본 13개로 — loadSections가 다시 만든다
    prisma.auditLog.deleteMany({ where: { NOT: { actor: MARK_ACTOR } } }),
  ])) {
    rows += n.count;
  }
  await prisma.orgRollupSetting.upsert({
    where: { id: 'org' },
    update: { enabled: true, order: '[]', note: '', pageBreak: true, unitDueMinutes: 60, hqDueMinutes: 120 },
    create: { id: 'org', enabled: true },
  });
  await restoreFakeOrg();

  let removed = 0;
  let failed = 0;
  for (const rel of new Set(files)) {
    try {
      await unlink(resolveInRoot(rel));
      removed++;
    } catch (e) {
      // 없어진 것은 괜찮다. 못 지운 것은 센다 — DB 행은 지웠으니 아무도 안 보는 고아 파일이다
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
    }
  }
  return { rows, files: removed, failed };
}

// ── 실행 ────────────────────────────────────────────────────────────────────

function castOf(): Cast {
  const group = (div: string) => PEOPLE.filter((p) => p.div === div && p.group).map((p) => p.local);
  return {
    ai: group(AI),
    pco: group(PCO),
    rmo: group(RMO),
    ca: group(CA),
    ...ROLES,
    rmLead: 'rm-lead',
    caLead: 'ca-lead',
    pcHead: UNIT_HEADS.pco,
    rmHead: UNIT_HEADS.rmo,
    caHead: UNIT_HEADS.ca,
  };
}

interface Ctx {
  org: FakeOrg;
  slot: WeekSlot;
  build: (i: number, when: Date) => Buffer;
  versions: Map<string, number>;
}

const who = (ctx: Ctx, local: string): User => ctx.org.person[local] ?? refuse(`등장인물이 없습니다: ${local}`);
const divOf = (ctx: Ctx, ko: string): Division => ctx.org.div[ko] ?? refuse(`부서가 없습니다: ${ko}`);

async function hqNode(ctx: Ctx): Promise<RollupNode> {
  const node = hqNodeOf(await loadTree(), divOf(ctx, HQ).id);
  if (!node) throw new Error(`${HQ}에 본부 단계가 없습니다 — 산하 실이 켜져 있는지 보세요`);
  return node;
}

async function perform(ctx: Ctx, a: Action, at: Date): Promise<void> {
  const { slot } = ctx;
  switch (a.kind) {
    case 'submit': {
      const u = who(ctx, a.who);
      const v = (ctx.versions.get(u.id) ?? 0) + 1;
      ctx.versions.set(u.id, v);
      const bytes = ctx.build(contentNo(a.who, slot.isoKey, v), at);
      await uploadSubmission({ user: u, division: divOf(ctx, a.div), fileName: `${slot.label.replace(/ /g, '_')}_${u.name}.hwp`, bytes, origin: 'web' }, at);
      return;
    }
    case 'merge': {
      const r = await runMergeRecorded(divOf(ctx, a.div).id, slot.id, a.trigger);
      if (r.status !== 'succeeded') throw new Error(`${a.div} 병합 실패: ${JSON.stringify(r)}`);
      return;
    }
    case 'approve':
      // HM-47 · RU-70 — 부서장 승인 = 위로 제출 (3단계가 켜져 있다). 화면과 같은 길 — fake-org `approveAs`
      await approveAs(who(ctx, a.who), divOf(ctx, a.div), slot);
      return;
    case 'upload': {
      const sec = await prisma.orgSection.findFirst({ where: { title: a.section } });
      if (!sec) throw new Error(`전사 섹션이 없습니다: ${a.section}`);
      const bytes = ctx.build(contentNo(a.section, slot.isoKey, 1), at);
      await uploadSectionFile(scopeOf(who(ctx, a.who), divOf(ctx, PCO)), sec.id, slot, bytes, `${a.section}_${slot.label.replace(/ /g, '_')}.hwp`);
      await syncOrg(slot, { cause: 'upload', causedBy: who(ctx, a.who).email });
      return;
    }
    case 'hqApprove': {
      // RU-55 — 본부장 승인 = 총괄로 제출. 화면처럼 **지금 본부본**(본 판)에
      const node = await hqNode(ctx);
      const run = await latestHqRun(node.node.id, slot.id);
      if (!run) throw new Error(`${a.div} 승인할 본부본이 없습니다`);
      const r = await approveHq(scopeOf(who(ctx, a.who), divOf(ctx, a.div)), node, slot, { runId: run.id, sha256: await fileSha(run.outputPath) });
      if (r.handedOff) await syncOrg(slot, { cause: `hq_handoff:${r.handedOff.submissionId}`, causedBy: who(ctx, a.who).email });
      return;
    }
  }
}

async function seedWeek(
  org: FakeOrg,
  build: Ctx['build'],
  monday: Date,
  stage: Stage,
  end: Date,
  keepOpen = false,
): Promise<{ slot: WeekSlot; plan: Planned[]; deadline: Date }> {
  // RU-60a — hwp 스위치가 꺼졌으면(11112와 같게 SUBMIT_HWP_UPLOAD=off) 총괄이 올린 섹션 파일을 만들지 않는다 — 꺼진 서버에 「올린 파일」이 보이지 않게
  const uploads = hwpUploadOpen();
  let slot = await ensureCurrentSlot(new Date(monday.getTime() + MIN));
  if (keepOpen) {
    slot = await prisma.weekSlot.update({
      where: { id: slot.id },
      data: { deadlineDowOverride: KEEP_OPEN.dow, deadlineTimeOverride: KEEP_OPEN.time, deadlineNote: KEEP_OPEN.note },
    });
  }
  const deadline = deadlineFor(slot, org.div[AI]); // 켜진 부서는 모두 기본 마감(목 14:00) — 주차 예외는 슬롯이 들고 온다
  const plan = planWeek({ cast: castOf(), stage, monday, deadline, end, uploads });
  const ctx: Ctx = { org, slot, build, versions: new Map() };
  for (const p of plan) {
    await perform(ctx, p.action, p.at);
    await settleLater(); // 요청 뒤로 미룬 맞추기(본부본·전사본)도 이 단계의 시각으로 찍히게
    await stampNew(p.at);
  }
  await stampNew(new Date(monday.getTime() + MIN)); // 주차 행 자체(ensureCurrentSlot)
  return { slot, plan, deadline };
}

/** 마지막 안내 — 시연자가 화면에서 볼 것을 숫자로 */
async function summary(slot: WeekSlot, org: FakeOrg) {
  const lines: string[] = [];
  for (const d of [AI, PCO, RMO, CA]) {
    const division = org.div[d];
    const roster = PEOPLE.filter((p) => p.div === d && p.group);
    const subs = await prisma.submission.findMany({ where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true }, select: { userId: true } });
    const ids = new Set(subs.map((s) => s.userId));
    const pending = roster.filter((p) => !ids.has(org.person[p.local].id)).map((p) => p.name);
    const merged = await prisma.mergeRun.count({ where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded' } });
    const report = await prisma.reportSubmission.count({ where: { divisionId: division.id, weekSlotId: slot.id, level: 'unit', withdrawnAt: null } });
    lines.push(
      `    ${pad(d, 22)}${ids.size}/${roster.length} 제출${pending.length ? ` (남음: ${pending.join('·')})` : ''} · ${merged ? '병합됨' : '병합 전'} · ${report ? '승인 · 올라감' : '실장 승인 전'}`,
    );
  }
  const hq = await prisma.reportSubmission.count({ where: { divisionId: org.div[HQ].id, weekSlotId: slot.id, level: 'hq', withdrawnAt: null } });
  const uploads = await prisma.orgSectionUpload.count({ where: { weekSlotId: slot.id, withdrawnAt: null } });
  const orgRun = await prisma.rollupRun.count({ where: { level: 'org', weekSlotId: slot.id, status: 'succeeded' } });
  lines.push(`    ${pad(HQ, 22)}${hq ? '본부장 승인 · 총괄로 감' : '본부장 승인 전'}`);
  lines.push(`    ${pad('전사', 22)}${hwpUploadOpen() ? `총괄이 올린 섹션 ${uploads}곳 · ` : ''}전사본 ${orgRun ? '있음(저절로)' : '아직'}`);
  return lines.join('\n');
}

async function main() {
  // 시드는 알림을 보내지 않고 모델을 부르지 않는다 — 셸이나 .env에 무엇이 있든
  env.MESSENGER_URL = '';
  env.MERGE_MODEL = '';
  if (messengerStatus().enabled) refuse('메신저가 꺼지지 않았습니다');

  const realNow = new Date();
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2), realNow);
  } catch (e) {
    return refuse((e as Error).message);
  }
  const { dbFile, storage } = checkPaths();

  const tplPath = process.env.DEMO_TEMPLATE || path.resolve('fixtures/master-template.hwp');
  if (!existsSync(tplPath)) refuse(`부서 양식 hwp가 없습니다 (${tplPath}). DEMO_TEMPLATE=<빈 양식.hwp>로 알려 주세요.`);
  const template = readFileSync(tplPath);

  const foreign = await foreignUserCount();
  if (foreign > 0) refuse(`@example.invalid가 아닌 계정이 ${foreign}명 있습니다 — 실제 DB입니다. 시연 시드는 빈 DB나 이 시드가 만든 DB에만 넣습니다.`);
  const people = await prisma.user.count();
  const mark = await prisma.auditLog.findFirst({ where: { actor: MARK_ACTOR, action: MARK_ACTION } });
  if (people > 0 && !mark) refuse(`사람 ${people}명이 있는데 시연 표식이 없습니다 — 이 시드가 만든 DB가 아닙니다(사용 안내 DB?).`);
  const bad = unwritable(storage, dbFile);
  if (bad.length) {
    refuse(`쓸 수 없는 곳이 ${bad.length}곳 있습니다 (컨테이너가 만든 디렉터리): ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}\n` +
      '        sudo bash scripts/demo-snapshot.sh perms   ← 먼저 (docs/DEMO.md)');
  }

  if (process.env.DEMO_PASSWORD !== undefined && process.env.DEMO_PASSWORD.length < 8) refuse('DEMO_PASSWORD는 8자 이상이어야 합니다');

  // 이야기 시각과 주차 — 여기까지는 아무것도 쓰지 않았다
  const end0 = args.until ?? realNow;
  const monday = args.isoKey ? mondayOfIsoKey(args.isoKey) : currentWeek(end0).opensAt;
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * MIN);
  if (end0.getTime() < monday.getTime() + 10 * MIN) {
    refuse(`이야기 시각(${kst(end0)})이 ${describeWeek(monday).label}(${describeWeek(monday).isoKey}) 전입니다 — --until=<그 주 안의 시각>을 주세요`);
  }
  const end = end0 < nextMonday ? end0 : new Date(nextMonday.getTime() - MIN);
  const prevMonday = new Date(monday.getTime() - 7 * 24 * 60 * MIN);

  // 조직 — 처음이면 만들고, 다시면 되돌린다
  let org: FakeOrg;
  let reset = '';
  if (!mark) {
    org = await createFakeOrg(template, await hashPassword(randomBytes(18).toString('base64url')));
    await prisma.user.updateMany({ data: { createdAt: new Date(Date.UTC(2026, 0, 2)) } });
    await prisma.template.updateMany({ data: { uploadedAt: new Date(Date.UTC(2026, 0, 2)) } });
    await prisma.auditLog.create({ data: { actor: MARK_ACTOR, action: MARK_ACTION, target: 'tincase-demo', detail: '운영회의 시연용 가짜 DB (RU-45)' } });
  } else {
    const r = await resetWeeks();
    org = await loadFakeOrg();
    reset = `지난 기록 ${r.rows}행·파일 ${r.files}개를 지우고 다시 만듦${r.failed ? ` (⚠ 못 지운 파일 ${r.failed}개 — 고아 파일, 화면과 무관)` : ''}`;
  }

  // 비밀번호 — 역할 계정만. 처음이면 만들고, 다시 돌릴 때는 DEMO_PASSWORD가 있을 때만 바꾼다
  let password: string | null = process.env.DEMO_PASSWORD ?? null;
  if (password === null && !mark) password = `${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}`;
  if (password !== null) {
    const hash = await hashPassword(password);
    await prisma.user.updateMany({ where: { email: { in: Object.values(ROLES).map(emailOf) } }, data: { passwordHash: hash, mustChangePassword: false } });
  }

  // 주차 — 지난주는 끝까지, 그 주는 단계까지
  await loadSections();
  await fillLedger();
  const build = hwpBuilder(template);
  const prev = await seedWeek(org, build, prevMonday, 'done', new Date(monday.getTime() - MIN));
  const cur = await seedWeek(org, build, monday, args.stage, end, args.keepOpen);

  const isCurrent = cur.slot.isoKey === currentWeek(realNow).isoKey;
  const out = [
    '',
    `demo-seed: ${cur.slot.label} (${cur.slot.isoKey}) · 단계 ${args.stage} — ${STAGE_NOTE[args.stage]}`,
    `  이야기 시각  ${kst(end)} KST — 화면에서 누르는 일은 이 시각 뒤여야 순서가 맞습니다`,
    `  마감        ${kst(cur.deadline)}${args.keepOpen ? ` (${KEEP_OPEN.note})` : ''}${end >= cur.deadline || realNow >= cur.deadline ? '  ⚠ 지났습니다 — 부서원 제출은 화면에서 할 수 없습니다(잠김). 리허설이면 --keep-open' : ''}`,
    `  지난주      ${prev.slot.label} (${prev.slot.isoKey}) — 끝까지(본부장 승인 · 전사본까지)`,
    // RU-60a — 11112는 꺼져 있다. 켜진 채 시드하면 꺼진 서버에 「올린 파일」이 생긴다(화면에는 [올린 것 취소] 없이)
    `  hwp 올리기  ${hwpUploadOpen() ? '켜짐 — 총괄이 올린 섹션 파일을 만들었습니다  ⚠ 11112는 꺼져 있습니다(SUBMIT_HWP_UPLOAD=off로 다시 시드)' : '꺼짐 — 섹션 파일 없음 (11112와 같다)'}`,
    ...(reset ? [`  되돌림      ${reset}`] : []),
    `  DB          ${dbFile}`,
    '',
    '  이번 주 상태:',
    await summary(cur.slot, org),
    '',
    `  열기        /org${isCurrent ? '' : `?isoKey=${cur.slot.isoKey}   ⚠ 지금 주차가 아닙니다 — 머리의 주차 고르기로도 갑니다`}`,
    '',
    '  시연 계정 (이메일로 로그인):',
    ...(Object.keys(ROLE_KO) as Role[]).map((r) => `    ${pad(ROLE_KO[r], 40)}${pad(org.roles[r].name, 8)}${emailOf(ROLES[r])}`),
    password !== null
      ? `  비밀번호 (위 계정 공통)  ${password}\n    ↑ 저장소에 적지 마세요 — docs/private/ 나 개인 메모에. 다시 시드해도 바뀌지 않습니다(DEMO_PASSWORD를 주면 바뀝니다)`
      : '  비밀번호    처음 시드할 때 출력한 그대로입니다 (바꾸려면 DEMO_PASSWORD=… 로 다시 시드)',
    '',
  ];
  console.log(out.join('\n'));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('demo-seed: 실패 —', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
