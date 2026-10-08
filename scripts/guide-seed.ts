/**
 * PG-62 — 사용 안내 그림을 찍을 **가짜** DB. 이름·업무·이메일이 전부 지어낸 것이다.
 *
 * 혼자 돌리지 않는다 — `node scripts/guide-capture.cjs`가 새 임시 디렉터리를 만들고 이 스크립트를 부른다.
 *
 *   npx tsx scripts/guide-seed.ts               시드 (빈 DB에만)
 *   npx tsx scripts/guide-seed.ts --verify      표식 확인 — 이 시드가 만든 DB가 아니면 종료 코드 1
 *   npx tsx scripts/guide-seed.ts --fix-clock   가짜 시계로 찍을 때, DB가 스스로 채운 시각을 가짜 시각으로 맞춘다
 *
 * 왜 이렇게 겹겹이 막는가: 저장소가 public이고 이 그림은 강당 프로젝터로 회사 전체에 보인다.
 * 테스트 서버의 DB도 운영의 사본이라 **실명이 들어 있다.** 그 DB에 이 시드를 섞거나 그 DB로 그림을 찍는 일이
 * 한 번이라도 있으면 실명이 저장소와 화면에 남는다. 그래서:
 *   1. DB 파일은 `GUIDE_WORK`(찍기 스크립트가 방금 만든 임시 디렉터리) 안에만 — `/data`는 이름만 봐도 거절
 *   2. **사람이 한 명이라도 있는 DB에는 시드하지 않는다** — 실제 DB는 언제나 사람이 있다
 *   3. 시드는 표식(감사 기록 `guide_seed` + 이번 실행의 nonce)을 남기고, 찍기는 표식이 맞을 때만 시작한다
 *
 * 부서 이름은 공개 조직도의 것이다(사람 이름 아님). 사람은 전부 @example.invalid.
 * 조직·사람·업무일지는 `scripts/fake-org.ts`에 있다 — 운영회의 시연 서버(`scripts/demo-seed.ts`, RU-45)와 같은 사람들이다.
 * 비밀번호는 매번 임의로 만든다 — 로그인은 세션 토큰으로 한다(공개 저장소에 비밀번호 모양의 문자열을 두지 않는다).
 */
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../src/server/db';
import { uploadSubmission } from '../src/server/worklog';
import { runMergeRecorded } from '../src/server/merge/run';
import { createSession } from '../src/server/session';
import { hashPassword } from '../src/server/password';
import { currentWeek } from '../src/lib/week';
import { syncUnit } from '../src/server/rollup/handoff';
import { syncAfterUnit } from '../src/server/rollup/auto';
import { settleLater } from '../src/server/after';
import { loadSections, uploadSectionFile } from '../src/server/rollup/sections';
import { CLOCK_COLS, createFakeOrg, delegate, foreignUserCount, hwpBuilder, scopeOf } from './fake-org';

const MARK_ACTOR = 'guide-seed@example.invalid';
const MARK_ACTION = 'guide_seed';

function guard(): { work: string; nonce: string } {
  const work = process.env.GUIDE_WORK ?? '';
  const nonce = process.env.GUIDE_NONCE ?? '';
  const url = process.env.DATABASE_URL ?? '';
  const file = url.replace(/^file:/, '');
  const refuse = (why: string): never => {
    console.error(`guide-seed: 거절 — ${why}`);
    process.exit(2);
  };
  if (!work || !nonce) refuse('GUIDE_WORK·GUIDE_NONCE가 없습니다. node scripts/guide-capture.cjs로 실행하세요.');
  if (/^\/data(\/|$)/.test(file) || /^\/data(\/|$)/.test(process.env.STORAGE_ROOT ?? '')) refuse('/data는 운영 경로입니다.');
  if (!path.isAbsolute(file) || !path.resolve(file).startsWith(path.resolve(work) + path.sep)) {
    refuse(`DATABASE_URL(${url})이 GUIDE_WORK(${work}) 안이 아닙니다.`);
  }
  if (!path.resolve(process.env.STORAGE_ROOT ?? '').startsWith(path.resolve(work) + path.sep)) refuse('STORAGE_ROOT가 GUIDE_WORK 안이 아닙니다.');
  return { work, nonce };
}

async function verify() {
  const { nonce } = guard();
  const mark = await prisma.auditLog.findFirst({ where: { actor: MARK_ACTOR, action: MARK_ACTION, target: nonce } });
  // 표식 말고 다른 사람이 있으면 안 된다 — 가짜 사람은 전부 @example.invalid
  const real = await foreignUserCount();
  if (!mark || real > 0) {
    console.error(`guide-seed --verify: 이 DB는 안내용 가짜 DB가 아닙니다 (표식 ${mark ? '있음' : '없음'} · 다른 계정 ${real}명)`);
    process.exit(1);
  }
  console.log('guide-seed --verify: ok');
}

/**
 * 가짜 시계로 찍을 때만 (GUIDE_CLOCK_SHIFT_MS ≠ 0). 앱의 `new Date()`는 시계 심(shim)이 옮기지만,
 * Prisma의 `@default(now())`는 쿼리 엔진(Rust)이 채워 **진짜 시각**이 들어간다. 그대로 두면 「10-07 15:00 마감 전」 화면에
 * 「10-08 02:13 제출」이 섞인다. 그래서 그 칸들을 같은 만큼 옮긴다.
 *
 * 시각으로 고르지 않고 **장부(ledger)** 로 고른다 — 이미 옮긴 행은 장부에 적어 두고 다시 옮기지 않는다. 시각으로 고르면
 * 시드가 일부러 넣은 시각(지난주 제출 등)과 엔진이 넣은 진짜 시각이 겹치는 날이 생긴다.
 * 이 실행 중에 앱 코드가 이 칸들을 직접 쓰는 길(첨삭·마감 열기·설정 링크)은 찍기에서 누르지 않는다.
 */
async function fixClock(): Promise<number> {
  const { work } = guard();
  const shift = Number(process.env.GUIDE_CLOCK_SHIFT_MS ?? 0);
  if (!shift) return 0;
  const ledgerPath = path.join(work, 'clock-ledger.json');
  const done: Record<string, string[]> = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
  let n = 0;
  for (const [model, col] of CLOCK_COLS) {
    const d = delegate(model);
    const key = `${model}.${col}`;
    const seen = new Set(done[key] ?? []);
    for (const r of await d.findMany({ select: { id: true, [col]: true } })) {
      const id = r.id as string;
      if (seen.has(id)) continue;
      await d.update({ where: { id }, data: { [col]: new Date((r[col] as Date).getTime() + shift) } });
      seen.add(id);
      n++;
    }
    done[key] = [...seen];
  }
  writeFileSync(ledgerPath, JSON.stringify(done));
  return n;
}

async function seed() {
  const { work, nonce } = guard();
  if ((await prisma.user.count()) > 0) {
    console.error('guide-seed: 거절 — 사람이 있는 DB입니다. 안내용 시드는 빈 DB에만 넣습니다.');
    process.exit(2);
  }
  const tplPath = process.env.GUIDE_TEMPLATE || path.resolve('fixtures/master-template.hwp');
  if (!existsSync(tplPath)) {
    console.error(`guide-seed: 부서 양식 hwp가 없습니다 (${tplPath}). GUIDE_TEMPLATE=<빈 양식.hwp>로 알려 주세요.`);
    process.exit(2);
  }
  const template = readFileSync(tplPath);
  const now = new Date();
  const lastWeek = new Date(now.getTime() - 7 * 86400_000);

  // ── 부서 · 사람 · 양식 ── (scripts/fake-org.ts — 시연 서버와 같은 사람들)
  const org = await createFakeOrg(template, await hashPassword(randomBytes(18).toString('base64url')));
  const { div, roles, ai, pco, rmo, ca } = org;
  const rmoLead = org.person['rm-lead'];
  const caLead = org.person['ca-lead'];

  // ── 제출물 ── (지어낸 업무 — scripts/fake-org.ts)
  const build = hwpBuilder(template);
  let seq = 0;
  /** 제출 시각 — DB가 채운 시각(지금)을 시드 끝에서 이 시각으로 바꾼다. 지난주 것이 「오늘 제출」로 보이지 않게 */
  const stamps: [string, Date][] = [];
  const submit = async (u: User, d: string, when: Date) => {
    const slotLabel = currentWeek(when).label.replace(/ /g, '_');
    const res = await uploadSubmission({ user: u, division: div[d], fileName: `${slotLabel}_${u.name}.hwp`, bytes: build(++seq, when), origin: 'web' }, when);
    stamps.push([res.submission.id, when]);
    return res;
  };
  const before = (ms: number) => new Date(now.getTime() - ms);

  // 지난주 — 「지난번에 낸 것」·이력·보관함
  for (const [k, u] of ai.slice(0, 8).entries()) await submit(u, 'AI홍보전략실', new Date(lastWeek.getTime() - (8 - k) * 1800_000));
  // 이번 주 — AI홍보전략실 10명 중 7명. 주인공(남시우)은 아직이다. 유단비는 다시 내 v2
  const aiNow = ai.filter((u) => u.id !== roles.memberPending.id).slice(0, 7);
  for (const [k, u] of aiNow.entries()) await submit(u, 'AI홍보전략실', before((9 - k) * 3600_000));
  await submit(roles.member, 'AI홍보전략실', before(1800_000));
  for (const [k, u] of pco.slice(0, 4).entries()) await submit(u, '기획조정실', before((6 - k) * 3600_000));
  for (const [k, u] of rmo.slice(0, 3).entries()) await submit(u, '연구관리실', before((7 - k) * 3600_000));
  for (const [k, u] of ca.slice(0, 4).entries()) await submit(u, '기후대기전략연구본부', before((8 - k) * 3600_000));

  // ── 병합 ── 지난주는 마감 뒤 자동, 이번 주는 담당자가 미리 만들어 본 것
  const prevSlot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: currentWeek(lastWeek).isoKey } });
  const slot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: currentWeek(now).isoKey } });
  await runMergeRecorded(div['AI홍보전략실'].id, prevSlot.id, 'auto');
  for (const d of ['AI홍보전략실', '기획조정실', '연구관리실', '기후대기전략연구본부']) {
    const r = await runMergeRecorded(div[d].id, slot.id, 'manual');
    console.log(`merge ${d}: ${r.status}`);
  }

  // ── 3단계 ── 실·팀 → 본부 → 총괄. AI홍보전략실은 아직 승인 전이다(찍기가 승인을 화면에서 누른다).
  // 2026-10-08(ADR-0015 · RU-84) — 사람이 누르는 [제출]은 없다. 부서장이 없는 단위는 마감 뒤 최종본이 저절로 올라간다 —
  // 그 맞추기를 한 번 돌린다(이번 주 병합이 마감 전 미리보기면 아무것도 올라가지 않는다 — 그것이 지금의 규칙이다).
  // 사용 안내의 단계·그림은 사용 안내 세션이 이 규칙에 맞춰 다시 짠다
  await loadSections();
  for (const [d, u] of [['기획조정실', roles.coordinator], ['연구관리실', rmoLead], ['기후대기전략연구본부', caLead]] as const) {
    const sub = await syncUnit(div[d].id, slot, { cause: 'seed', causedBy: u.email });
    if (sub) await syncAfterUnit(div[d].id, slot, { cause: `unit_handoff:${sub.id}`, causedBy: u.email });
  }
  await settleLater();
  // 아직 Tincase를 안 쓰는 섹션 하나는 총괄이 게시판으로 받은 파일을 올려 두었다 — 「최종본에」 열에 「올린 파일」이 보이게
  try {
    const sec = await prisma.orgSection.findFirst({ where: { title: '국토환경연구본부' } });
    if (sec) await uploadSectionFile(scopeOf(roles.coordinator, div['기획조정실']), sec.id, slot, build(99, now), '국토환경연구본부_주간업무.hwp');
  } catch (e) {
    console.log('section upload skipped:', (e as Error).message);
  }

  // ── 시각 ── 엔진이 채운 시각을 가짜 시계에 맞춘 **뒤에** 제출 시각을 넣는다 — 넣은 시각이 다시 옮겨지지 않게(장부에 이미 있다)
  const fixed = await fixClock();
  for (const [id, when] of stamps) await prisma.submission.update({ where: { id }, data: { uploadedAt: when } });
  if (fixed) console.log(`guide-seed: 시각 ${fixed}칸을 가짜 시계에 맞춤`);

  // ── 표식 · 세션 ──
  await prisma.auditLog.create({ data: { actor: MARK_ACTOR, action: MARK_ACTION, target: nonce, detail: '사용 안내 그림용 가짜 DB (PG-62)' } });
  const sessions: Record<string, string> = {};
  for (const [k, u] of Object.entries(roles)) sessions[k] = (await createSession(u.id)).token;
  const out = path.join(work, 'sessions.json');
  writeFileSync(out, JSON.stringify({ week: slot.label, slugs: { ai: div['AI홍보전략실'].slug }, sessions }, null, 2));
  console.log(`guide-seed: ${slot.label} · 세션 → ${out}`);
}

const mode = process.argv[2];
(mode === '--verify' ? verify() : mode === '--fix-clock' ? fixClock().then((n) => console.log(`guide-seed --fix-clock: ${n}칸`)) : seed())
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
