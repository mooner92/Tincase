/**
 * OPS-50 — 브라우저 e2e 스모크(`scripts/e2e-v2.cjs`)의 시드 **보탬**. 혼자 쓰지 않는다 — e2e가 `rehearsal.ts prepare`로 만든 가짜 저장소 위에 부른다.
 *
 *   npx tsx scripts/e2e-seed.ts --root=<rehearsal prepare가 만든 임시 저장소> [--scope=full|launch]
 *
 * 리허설 저장소에 없는 것 둘만 더한다:
 *   1. **지난 주차** — AI홍보전략실의 지난 다섯 주(1·4·8·12·16주 전)에 부서원 몇이 낸 일지와 그 주의 병합본(결정론 병합).
 *      부서원 홈의 「지난 주차」가 달 묶음 넷 이상이 되어, 처음 펼쳐진 두 달 밑에 **접힌 달**이 생긴다(PG-69 — 펼치기를 눌러 볼 것)
 *   2. **역할별 세션** — 부서원(아직 안 냄) · 부서원(냄) · 담당 · 실장 · 본부장 · 총괄. 운영자는 세션 대신 새 비밀번호 — e2e가 로그인 화면으로 들어간다
 *
 * `--scope=launch`(OPS-50h)면 셋째로 **출시 범위**로 줄인다 — 켜는 부서 둘 · 3단계 끔 · 부서 알림은 그 둘(과 범위 밖 한 줄 — 운영자가 끈다) ·
 * 기획조정실은 부서장 없이 · 총괄은 담당이 아니다(`scripts/e2e-plan.ts`). e2e가 판정에 쓸 사실(누가 어느 부서이고 그 부서가 켜졌나)을
 * seed.json에 함께 적는다 — 기대값을 앱 코드로 만들지 않는다(리허설 OPS-47b와 같은 까닭: 같은 함수로 만든 기대는 틀려도 맞다고 나온다).
 *
 * 세션·비밀번호는 `<root>/e2e/seed.json`(0600)에만 쓴다 — 출력에 찍지 않는다. 저장소는 임시 디렉터리 안·리허설 표식이 있는 것·
 * @example.invalid 사람만 있는 것만 받는다(시연·리허설 시드와 같은 경계). 알림·모델은 끄고 돈다.
 */
import path from 'node:path';
import os from 'node:os';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathRefusal } from './demo-plan';
import { LAUNCH_ACTIVE, LAUNCH_LEFTOVER, LAUNCH_OPERATOR, LAUNCH_ROLES, launchDivisionState, parseScope, type E2eScope } from './e2e-plan';

const MARK_ACTOR = 'rehearsal@example.invalid';
const MARK_ACTION = 'rehearsal_seed';
const DAY = 24 * 60 * 60_000;
/** 지난 주차 — 이번 주에서 몇 주 전. 16주면 달이 넷 이상 걸친다(처음 두 달만 펼쳐진다 — groupPast openRecent=2) */
export const PAST_WEEKS_BACK = [1, 4, 8, 12, 16] as const;
/** 지난 주차에 낸 사람(이메일 앞부분) — 「아직 안 낸」 부서원(member2)이 꼭 든다: 그 사람의 홈에 「지난 주차」가 생긴다 */
const PAST_SUBMITTERS = ['member2', 'member', 'lead', 'ai-04', 'ai-05'];
/** 세션을 만들 역할 → 이메일 앞부분 (fake-org ROLES) */
const SESSION_ROLES = { memberPending: 'member2', member: 'member', lead: 'lead', head: 'head', hqHead: 'hq-head', coordinator: 'coord' } as const;
/** 출시 범위에서만 더하는 세션 — 기획조정실의 담당(부서장 없는 부서의 수합 관리를 본다) */
const LAUNCH_SESSION_ROLES = { pcLead: 'pc-02' } as const;
const OPS_LOCAL = 'rh-ops';

const die = (why: string): never => {
  console.error(`e2e-seed: 멈춤 — ${why}`);
  process.exit(2);
};

function rootArg(): string {
  const hit = process.argv.find((a) => a.startsWith('--root='));
  return hit ? hit.slice('--root='.length) : die('--root=<rehearsal prepare가 만든 저장소>가 필요합니다');
}

function scopeArg(): E2eScope {
  try {
    return parseScope(process.argv.slice(2));
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  const scope = scopeArg(); // 저장소를 보기 전에 — 모르는 범위로 반쯤 시드하지 않게
  const given = rootArg();
  if (!existsSync(given)) die(`저장소가 없습니다: ${given} — rehearsal.ts prepare 먼저`);
  // 경계를 먼저 — 임시 디렉터리 안만. e2e는 시연 저장소(/data/worklog-demo)도 쓰지 않는다(심볼릭 링크는 푼 경로로 본다)
  const root = realpathSync(given);
  const tmp = realpathSync(os.tmpdir());
  if (!root.startsWith(tmp + path.sep)) die(`임시 디렉터리(${tmp}) 밖의 저장소입니다: ${root}`);
  const dbFile = path.join(root, 'db', 'worklog.db');
  const why = pathRefusal(dbFile, root, tmp);
  if (why) die(why);
  if (!existsSync(dbFile)) die(`DB가 없습니다: ${dbFile} — rehearsal.ts prepare 먼저`);

  // 서버 모듈을 불러오기 전에 — env.ts는 처음 읽힐 때 굳는다. 알림·모델은 끈다
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.STORAGE_ROOT = root;
  process.env.CF_ACCESS_TEAM ||= 'tincase-e2e';
  process.env.MESSENGER_URL = '';
  process.env.MESSENGER_SINK = 'off';
  process.env.TINCASE_ENV = '';
  process.env.MERGE_MODEL = '';

  const { prisma } = await import('../src/server/db');
  const { createSession } = await import('../src/server/session');
  const { hashPassword } = await import('../src/server/password');
  const { uploadSubmission } = await import('../src/server/worklog');
  const { runMergeRecorded } = await import('../src/server/merge/run');
  const { currentWeek } = await import('../src/lib/week');
  const fake = await import('./fake-org');

  try {
    if ((await fake.foreignUserCount()) > 0) die('@example.invalid가 아닌 계정이 있습니다 — 실제 DB입니다. 손대지 않습니다');
    const mark = await prisma.auditLog.findFirst({ where: { actor: MARK_ACTOR, action: MARK_ACTION } });
    if (!mark) die('리허설 표식이 없는 저장소입니다 — rehearsal.ts prepare로 만든 것만 받습니다');
    if (await prisma.auditLog.findFirst({ where: { actor: MARK_ACTOR, action: 'e2e_seed' } })) die('이미 e2e 시드를 더한 저장소입니다 — 새 저장소로');

    const org = await fake.loadFakeOrg();
    const ai = org.div['AI홍보전략실'];
    const tplPath = process.env.DEMO_TEMPLATE || process.env.GUIDE_TEMPLATE || path.join(__dirname, '..', 'fixtures/master-template.hwp');
    const build = fake.hwpBuilder(readFileSync(tplPath));

    // ── 1. 지난 주차 ── 그 주 화요일 10:00(KST)에 냈다 — 마감(목 14:00) 전이라 받는다
    const monday = currentWeek(new Date()).opensAt.getTime();
    const past: string[] = [];
    let n = 0;
    for (const back of PAST_WEEKS_BACK) {
      const at = new Date(monday - back * 7 * DAY + DAY + 10 * 60 * 60_000);
      let slotId = '';
      let isoKey = '';
      for (const local of PAST_SUBMITTERS) {
        const u = org.person[local];
        const r = await uploadSubmission({ user: u, division: ai, fileName: `e2e_${local}.hwp`, bytes: build(9000 + ++n, at), origin: 'web' }, at);
        slotId = r.submission.weekSlotId;
      }
      const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { id: slotId } });
      isoKey = slot.isoKey;
      const m = await runMergeRecorded(ai.id, slot.id, 'manual');
      if (m.status !== 'succeeded') die(`${isoKey} 병합 실패: ${m.errorText}`);
      past.push(`${isoKey}(${slot.label})`);
    }

    // ── 2. 세션 · 운영자 비밀번호 ──
    const tokens: Record<string, string> = {};
    const roles: Record<string, string> = scope === 'launch' ? { ...SESSION_ROLES, ...LAUNCH_SESSION_ROLES } : { ...SESSION_ROLES };
    for (const [role, local] of Object.entries(roles)) tokens[role] = (await createSession(org.person[local].id)).token;
    const ops = await prisma.user.findUnique({ where: { email: fake.emailOf(OPS_LOCAL) } });
    if (!ops) die('리허설 운영자가 없습니다 — rehearsal.ts prepare가 만든 저장소인지 보세요');
    const opsPassword = `${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`;
    await prisma.user.update({ where: { id: ops!.id }, data: { passwordHash: await hashPassword(opsPassword), mustChangePassword: false } });

    // ── 3. 출시 범위 (OPS-50h · --scope=launch) ── 세션을 만든 뒤 — 꺼진 부서의 사람도 세션 행은 남는다(들어오면 「준비 중」이 그 사람의 화면이다)
    const launch = scope === 'launch' ? await applyLaunchScope(prisma, fake, org) : null;

    await prisma.auditLog.create({
      data: { actor: MARK_ACTOR, action: 'e2e_seed', target: 'tincase-e2e', detail: `지난 주차 ${past.length} · 세션 ${Object.keys(tokens).length} · 범위 ${scope}` },
    });
    const out = path.join(root, 'e2e');
    mkdirSync(out, { recursive: true });
    const file = path.join(out, 'seed.json');
    writeFileSync(
      file,
      JSON.stringify(
        { isoKey: currentWeek(new Date()).isoKey, scope, tokens, ops: { email: ops!.email, password: opsPassword }, past, aiSlug: ai.slug, launch },
        null,
        1,
      ),
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
    console.log(
      `e2e-seed: 지난 주차 ${past.join(' · ')} · 세션 ${Object.keys(tokens).join(',')}` +
        (launch ? ` · 출시 범위 — 켬 ${launch.active.join('·')} · 3단계 끔` : '') +
        ` · 운영자 비밀번호 → ${file}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** e2e가 판정에 쓰는 사실 — 이메일마다 부서와 그 부서가 켜졌나. 사번이 있는 사람만(쪽지는 사번으로만 간다 — NT-01) */
export interface LaunchFacts {
  active: string[];
  leftover: string;
  slugs: Record<string, string>;
  people: Record<string, { div: string; active: boolean }>;
  /** 「병합 점검」(NT-60)을 받아야 하는 사람 — 운영자 · 총괄이 있는 부서의 담당(TACP-30을 옮겨 적었다) */
  batch: string[];
  coordinator: string;
  /** AI홍보전략실 담당 — 「승인 완료」(NT-46)를 받을 사람 */
  aiLead: string;
}

/**
 * OPS-50h — 리허설 저장소(13개 단위 · 3단계 켬)를 출시 범위로 줄인다. 무엇을 바꾸는지는 `e2e-plan.ts`에 있다 — 여기는 옮기기만 한다.
 * 사람·부서 칸은 운영자가 화면(`/ops`)에서 바꾸는 값과 같다(켜짐 · 알림 · 역할 · 알림 칸).
 */
async function applyLaunchScope(
  prisma: typeof import('../src/server/db').prisma,
  fake: typeof import('./fake-org'),
  org: Awaited<ReturnType<typeof import('./fake-org').loadFakeOrg>>,
): Promise<LaunchFacts> {
  const divs = await prisma.division.findMany({ select: { id: true, nameKo: true, slug: true } });
  // 바꾸기 전에 — 가짜 조직의 이름이 바뀌었으면 반쯤 줄인 저장소를 남기지 않고 멈춘다
  for (const name of [...LAUNCH_ACTIVE, LAUNCH_LEFTOVER]) if (!divs.some((d) => d.nameKo === name)) die(`출시 범위의 부서가 저장소에 없습니다: ${name}`);
  for (const d of divs) await prisma.division.update({ where: { id: d.id }, data: launchDivisionState(d.nameKo) });
  // 3단계 끔 — 「전사」 [일정 바꾸기]의 스위치와 같은 값(RU-52). 아무것도 위로 저절로 가지 않는다
  await prisma.orgRollupSetting.upsert({ where: { id: 'org' }, update: { enabled: false }, create: { id: 'org', enabled: false } });
  for (const [local, role] of Object.entries(LAUNCH_ROLES)) {
    await prisma.user.update({ where: { id: org.person[local].id }, data: { divisionRole: role } });
  }
  await prisma.user.update({ where: { email: fake.emailOf(LAUNCH_OPERATOR) }, data: { notifyEnabled: true } });

  const people = await prisma.user.findMany({
    where: { employeeNo: { not: null } },
    select: { email: true, isOperator: true, isCoordinator: true, divisionRole: true, isActive: true, notifyEnabled: true, division: { select: { nameKo: true, isActive: true } } },
  });
  const coordDivs = new Set(people.filter((u) => u.isCoordinator && u.isActive).map((u) => u.division.nameKo));
  const batch = people
    .filter((u) => u.isActive && u.notifyEnabled && (u.isOperator || (u.divisionRole === 'lead' && coordDivs.has(u.division.nameKo))))
    .map((u) => u.email)
    .sort();
  const coordinator = people.find((u) => u.isCoordinator)?.email;
  if (!coordinator) die('총괄이 없습니다 — 가짜 조직이 바뀌었나요');
  return {
    active: [...LAUNCH_ACTIVE],
    leftover: LAUNCH_LEFTOVER,
    slugs: Object.fromEntries(divs.map((d) => [d.nameKo, d.slug])),
    people: Object.fromEntries(people.map((u) => [u.email, { div: u.division.nameKo, active: u.division.isActive }])),
    batch,
    coordinator: coordinator!,
    aiLead: fake.emailOf('lead'),
  };
}

main().catch((e) => {
  console.error('e2e-seed: 실패 —', e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
