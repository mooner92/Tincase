/**
 * OPS-50 — 브라우저 e2e 스모크(`scripts/e2e-v2.cjs`)의 시드 **보탬**. 혼자 쓰지 않는다 — e2e가 `rehearsal.ts prepare`로 만든 가짜 저장소 위에 부른다.
 *
 *   npx tsx scripts/e2e-seed.ts --root=<rehearsal prepare가 만든 임시 저장소>
 *
 * 리허설 저장소에 없는 것 둘만 더한다:
 *   1. **지난 주차** — AI홍보전략실의 지난 다섯 주(1·4·8·12·16주 전)에 부서원 몇이 낸 일지와 그 주의 병합본(결정론 병합).
 *      부서원 홈의 「지난 주차」가 달 묶음 넷 이상이 되어, 처음 펼쳐진 두 달 밑에 **접힌 달**이 생긴다(PG-69 — 펼치기를 눌러 볼 것)
 *   2. **역할별 세션** — 부서원(아직 안 냄) · 부서원(냄) · 담당 · 실장 · 본부장 · 총괄. 운영자는 세션 대신 새 비밀번호 — e2e가 로그인 화면으로 들어간다
 *
 * 세션·비밀번호는 `<root>/e2e/seed.json`(0600)에만 쓴다 — 출력에 찍지 않는다. 저장소는 임시 디렉터리 안·리허설 표식이 있는 것·
 * @example.invalid 사람만 있는 것만 받는다(시연·리허설 시드와 같은 경계). 알림·모델은 끄고 돈다.
 */
import path from 'node:path';
import os from 'node:os';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathRefusal } from './demo-plan';

const MARK_ACTOR = 'rehearsal@example.invalid';
const MARK_ACTION = 'rehearsal_seed';
const DAY = 24 * 60 * 60_000;
/** 지난 주차 — 이번 주에서 몇 주 전. 16주면 달이 넷 이상 걸친다(처음 두 달만 펼쳐진다 — groupPast openRecent=2) */
export const PAST_WEEKS_BACK = [1, 4, 8, 12, 16] as const;
/** 지난 주차에 낸 사람(이메일 앞부분) — 「아직 안 낸」 부서원(member2)이 꼭 든다: 그 사람의 홈에 「지난 주차」가 생긴다 */
const PAST_SUBMITTERS = ['member2', 'member', 'lead', 'ai-04', 'ai-05'];
/** 세션을 만들 역할 → 이메일 앞부분 (fake-org ROLES) */
const SESSION_ROLES = { memberPending: 'member2', member: 'member', lead: 'lead', head: 'head', hqHead: 'hq-head', coordinator: 'coord' } as const;
const OPS_LOCAL = 'rh-ops';

const die = (why: string): never => {
  console.error(`e2e-seed: 멈춤 — ${why}`);
  process.exit(2);
};

function rootArg(): string {
  const hit = process.argv.find((a) => a.startsWith('--root='));
  return hit ? hit.slice('--root='.length) : die('--root=<rehearsal prepare가 만든 저장소>가 필요합니다');
}

async function main() {
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
    for (const [role, local] of Object.entries(SESSION_ROLES)) tokens[role] = (await createSession(org.person[local].id)).token;
    const ops = await prisma.user.findUnique({ where: { email: fake.emailOf(OPS_LOCAL) } });
    if (!ops) die('리허설 운영자가 없습니다 — rehearsal.ts prepare가 만든 저장소인지 보세요');
    const opsPassword = `${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`;
    await prisma.user.update({ where: { id: ops!.id }, data: { passwordHash: await hashPassword(opsPassword), mustChangePassword: false } });

    await prisma.auditLog.create({ data: { actor: MARK_ACTOR, action: 'e2e_seed', target: 'tincase-e2e', detail: `지난 주차 ${past.length} · 세션 ${Object.keys(tokens).length}` } });
    const out = path.join(root, 'e2e');
    mkdirSync(out, { recursive: true });
    const file = path.join(out, 'seed.json');
    writeFileSync(
      file,
      JSON.stringify({ isoKey: currentWeek(new Date()).isoKey, tokens, ops: { email: ops!.email, password: opsPassword }, past, aiSlug: ai.slug }, null, 1),
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
    console.log(`e2e-seed: 지난 주차 ${past.join(' · ')} · 세션 ${Object.keys(tokens).join(',')} · 운영자 비밀번호 → ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('e2e-seed: 실패 —', e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
