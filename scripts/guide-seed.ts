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
 * 비밀번호는 매번 임의로 만든다 — 로그인은 세션 토큰으로 한다(공개 저장소에 비밀번호 모양의 문자열을 두지 않는다).
 */
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Division, User } from '@prisma/client';
import { prisma } from '../src/server/db';
import { openHwp } from '../src/lib/hwp/ole';
import { parseRecords, serializeRecords } from '../src/lib/hwp/record';
import { fillTable, packHwp } from '../src/lib/hwp/writer';
import { uploadSubmission } from '../src/server/worklog';
import { writeFileAtomic, templateRelPath, sha256 } from '../src/server/storage';
import { runMergeRecorded } from '../src/server/merge/run';
import { createSession } from '../src/server/session';
import { hashPassword } from '../src/server/password';
import { currentWeek } from '../src/lib/week';
import { submitReport } from '../src/server/rollup/report';
import { loadSections, uploadSectionFile } from '../src/server/rollup/sections';
import type { Scope } from '../src/server/authz';

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
  const real = await prisma.user.count({ where: { NOT: { email: { endsWith: '@example.invalid' } } } });
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
const CLOCK_COLS: [string, string][] = [
  ['division', 'createdAt'], ['user', 'createdAt'], ['weekSlot', 'createdAt'], ['submission', 'uploadedAt'],
  ['template', 'uploadedAt'], ['mergeRun', 'startedAt'], ['auditLog', 'at'], ['notifyLog', 'sentAt'],
  ['reportSubmission', 'submittedAt'], ['rollupRun', 'startedAt'], ['mergeReview', 'createdAt'],
  ['orgSectionUpload', 'uploadedAt'], ['slotOpening', 'openedAt'],
];

async function fixClock(): Promise<number> {
  const { work } = guard();
  const shift = Number(process.env.GUIDE_CLOCK_SHIFT_MS ?? 0);
  if (!shift) return 0;
  const ledgerPath = path.join(work, 'clock-ledger.json');
  const done: Record<string, string[]> = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
  let n = 0;
  for (const [model, col] of CLOCK_COLS) {
    // 모델마다 위임 객체가 다르다 — 이 스크립트에서만 쓰는 좁은 모양으로 본다
    const d = (prisma as unknown as Record<string, {
      findMany(a: unknown): Promise<Record<string, unknown>[]>;
      update(a: unknown): Promise<unknown>;
    }>)[model];
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

  // ── 부서 ── (공개 조직도의 이름. 사람은 전부 지어낸 것)
  type D = { ko: string; slug: string; parent?: string; active: boolean; board?: string };
  const DIVS: D[] = [
    { ko: '임원실', slug: 'Executive_Office', active: false, board: 'confirmed' },
    { ko: '글로벌대외협력단', slug: 'Global_Cooperation', active: false, board: 'confirmed' },
    { ko: '기획경영본부', slug: 'Planning_and_Management', active: true },
    { ko: '기획조정실', slug: 'Planning_and_Coordination_Office', parent: '기획경영본부', active: true },
    { ko: '연구관리실', slug: 'Research_Management_Office', parent: '기획경영본부', active: true },
    { ko: 'AI홍보전략실', slug: 'AI_and_Public_Relations_Division', parent: '기획경영본부', active: true },
    { ko: '인사관리실', slug: 'Human_Resources_Office', parent: '기획경영본부', active: false, board: 'confirmed' },
    { ko: '경영지원실', slug: 'Management_Support_Office', parent: '기획경영본부', active: false, board: 'confirmed' },
    { ko: '기후대기전략연구본부', slug: 'Climate_Air_Research', active: true },
    { ko: '생활환경연구본부', slug: 'Living_Environment_Research', active: false, board: 'confirmed' },
    { ko: '국토환경연구본부', slug: 'Land_Environment_Research', active: false, board: 'confirmed' },
    { ko: '환경평가본부', slug: 'Environmental_Assessment', active: false, board: 'unclear' },
    { ko: '국가기후위기적응센터', slug: 'Climate_Adaptation_Center', active: false, board: 'confirmed' },
    { ko: '국가지속가능발전연구센터', slug: 'Sustainable_Development_Center', active: false, board: 'none' },
  ];
  const div: Record<string, Division> = {};
  for (const [i, d] of DIVS.entries()) {
    div[d.ko] = await prisma.division.create({
      data: {
        slug: d.slug,
        nameKo: d.ko,
        nameEn: d.slug.replace(/_/g, ' '),
        parentKo: d.parent ?? '한국환경연구원',
        isActive: d.active,
        boardStatus: d.board ?? (d.active ? 'confirmed' : 'none'),
        rollupSelf: d.ko !== '기획경영본부',
        guideText:
          d.ko === 'AI홍보전략실'
            ? '항목 순서: AI → 홍보(정간물 포함) → 시스템 → 도서관\n상시 반복 업무는 일자를 공란으로 둡니다\n특정 일자가 있는 업무만 날짜를 적습니다'
            : '',
        mergeCategories: d.ko === 'AI홍보전략실' ? 'AI-홍보-시스템-도서관' : '',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      },
    });
  }
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });

  // ── 사람 ── (지어낸 이름, @example.invalid)
  const pwHash = await hashPassword(randomBytes(18).toString('base64url'));
  let sort = 10;
  const mk = (name: string, email: string, d: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { name, email, divisionId: div[d].id, passwordHash: pwHash, mustChangePassword: false, sortOrder: (sort += 10), ...extra },
    });

  const roles: Record<string, User> = {};
  roles.lead = await mk('한서린', 'lead@example.invalid', 'AI홍보전략실', { divisionRole: 'lead', jobTitle: '담당' });
  roles.head = await mk('도윤재', 'head@example.invalid', 'AI홍보전략실', { divisionRole: 'head', jobTitle: '실장', onRoster: false, rosterNote: '부서장' });
  roles.member = await mk('유단비', 'member@example.invalid', 'AI홍보전략실');
  // 부서원 장의 주인공 — 이번 주에는 아직 안 냈고, 지난주에는 냈다(「지난번에 낸 것」이 보이게)
  roles.memberPending = await mk('남시우', 'member2@example.invalid', 'AI홍보전략실');
  const ai: User[] = [roles.lead, roles.member, roles.memberPending];
  for (const [n, e] of [['표하람', 'ai-04'], ['설이든', 'ai-05'], ['천보라', 'ai-06'], ['마준서', 'ai-07'], ['연바다', 'ai-08'], ['우지안', 'ai-09'], ['채온유', 'ai-10']]) {
    ai.push(await mk(n, `${e}@example.invalid`, 'AI홍보전략실'));
  }

  roles.coordinator = await mk('봉하늘', 'coord@example.invalid', '기획조정실', { divisionRole: 'lead', isCoordinator: true, jobTitle: '담당' });
  const pco: User[] = [roles.coordinator];
  for (const [n, e] of [['구다온', 'pc-02'], ['석로운', 'pc-03'], ['탁새봄', 'pc-04'], ['국하린', 'pc-05']]) pco.push(await mk(n, `${e}@example.invalid`, '기획조정실'));

  const rmoLead = await mk('반서후', 'rm-lead@example.invalid', '연구관리실', { divisionRole: 'lead' });
  const rmo: User[] = [rmoLead];
  for (const [n, e] of [['피가람', 'rm-02'], ['여누리', 'rm-03'], ['함도담', 'rm-04']]) rmo.push(await mk(n, `${e}@example.invalid`, '연구관리실'));

  roles.hqLead = await mk('어진솔', 'hq-lead@example.invalid', '기획경영본부', { divisionRole: 'lead', jobTitle: '담당' });
  roles.hqHead = await mk('편무진', 'hq-head@example.invalid', '기획경영본부', { divisionRole: 'head', jobTitle: '본부장', onRoster: false, rosterNote: '본부장' });

  const caLead = await mk('엄태린', 'ca-lead@example.invalid', '기후대기전략연구본부', { divisionRole: 'lead' });
  const ca: User[] = [caLead];
  for (const [n, e] of [['소하윤', 'ca-02'], ['인재희', 'ca-03'], ['좌은결', 'ca-04'], ['곽나래', 'ca-05'], ['맹시안', 'ca-06']]) ca.push(await mk(n, `${e}@example.invalid`, '기후대기전략연구본부'));

  // ── 양식 ──
  for (const d of DIVS.filter((x) => x.active)) {
    const rel = templateRelPath(d.slug, 1, true);
    await writeFileAtomic(rel, template);
    await prisma.template.create({ data: { divisionId: div[d.ko].id, filePath: rel, sha256: sha256(template), version: 1, isActive: true, uploadedBy: roles.lead.id } });
  }

  // ── 제출물 ── (지어낸 업무 — 실제 업무일지 어휘를 흉내 냈다. 겹치는 업무를 섞어 중복 묶기가 보이게)
  const POOL = [
    'AI 기반 환경데이터 분석 모델 성능 개선', 'LLM 기반 문서 검색 시범 서비스 점검', '보도자료 배포(3건)', '온라인 홍보 콘텐츠 제작 및 등록',
    '정기간행물 발간 진행(8건)', '언론 모니터링 및 일일 브리핑 발송', '연구정보시스템 장애 대응', '내부망 백업 정책 재정비',
    '전자저널 구독 갱신 협의', '신착 자료 정리 및 등록', '연구운영회의 자료 취합', '대정부 예산 협의', '국정감사 대응 자료 정리',
    '기후 시나리오 분석 워크숍 준비', '대기질 예측 모델 검증 회의',
  ];
  const SHARED = ['부서 전체회의 참석', '2026년 하반기 업무계획 수립 회의'];
  const PLACES = ['', '', '본원 중회의실', '세종청사', '온라인'];
  const rng = (s0: number) => {
    let s = s0 >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  };
  const md = (d: Date) => {
    const k = new Date(d.getTime() + 9 * 3600_000);
    return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
  };
  const build = (i: number, when: Date) => {
    const r = rng(i * 7919 + 13);
    const pick = (a: string[], n: number) => [...a].sort(() => r() - 0.5).slice(0, n);
    const items = [...pick(POOL, 3 + Math.floor(r() * 3)), ...(i % 3 === 0 ? pick(SHARED, 1) : [])];
    // 일자는 그 주의 월·화·수 중에서 — 찍는 날에 따라 달라지지만 늘 그 주 안이다
    const monday = new Date(currentWeek(when).opensAt.getTime());
    const ach = items.map((c, k) => [`1-${k + 1}`, c, r() < 0.5 ? md(new Date(monday.getTime() + Math.floor(r() * 3) * 86400_000)) : '', PLACES[Math.floor(r() * PLACES.length)], '']);
    const plans = pick(POOL, 2).map((c, k) => [`2-${k + 1}`, `${c} (계속)`, '', '', '']);
    const recs = parseRecords(openHwp(template).sections[0]);
    fillTable(recs, 0, ach);
    fillTable(recs, 1, plans);
    if (i % 4 === 0) fillTable(recs, 2, [['3-1', '차주 수요일 오후 부서 워크숍으로 부재', '', '', '']]);
    return packHwp(template, [serializeRecords(recs)]);
  };
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

  // ── 3단계 ── 실·팀 → 본부 → 총괄. AI홍보전략실은 아직 안 냈다(찍기가 승인 → 제출을 화면에서 누른다)
  const scopeOf = (u: User, d: string): Scope =>
    ({
      user: u,
      division: div[d],
      isLead: u.divisionRole === 'lead',
      isHead: u.divisionRole === 'head',
      isManager: u.divisionRole === 'lead' || u.divisionRole === 'head',
      readAll: u.isOperator || u.isCoordinator,
      source: 'dev',
    }) as unknown as Scope;
  await loadSections();
  await submitReport(scopeOf(roles.coordinator, '기획조정실'), 'unit', slot);
  await submitReport(scopeOf(rmoLead, '연구관리실'), 'unit', slot);
  await submitReport(scopeOf(caLead, '기후대기전략연구본부'), 'unit', slot); // 본부 단계 없는 본부 → 총괄로 바로
  // 아직 Tincase를 안 쓰는 섹션 하나는 총괄이 게시판으로 받은 파일을 올려 두었다 — 「최종본에」 열에 「올린 파일」이 보이게
  try {
    const sec = await prisma.orgSection.findFirst({ where: { title: '국토환경연구본부' } });
    if (sec) await uploadSectionFile(scopeOf(roles.coordinator, '기획조정실'), sec.id, slot, build(99, now), '국토환경연구본부_주간업무.hwp');
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
