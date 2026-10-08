/**
 * 가짜 조직·사람·업무일지 — **사용 안내 그림**(`guide-seed.ts`, PG-62)과 **운영회의 시연 데이터**(`demo-seed.ts`, RU-45)가
 * 같은 사람들을 쓴다. 슬라이드에서 본 「한서린·남시우」가 시연 화면에도 그대로 나온다 — 강당의 사람들이 한 이야기로 따라온다.
 *
 * 이름·업무·이메일이 전부 지어낸 것이다. 부서 이름은 공개 조직도의 것(사람 이름 아님). 사람은 전부 @example.invalid —
 * 두 시드 모두 **그 밖의 이메일이 하나라도 있는 DB는 실제 DB로 보고 거절한다.**
 *
 * 혼자 돌리지 않는다 — 시드 스크립트가 부른다.
 */
import { Prisma, type Division, type User, type WeekSlot } from '@prisma/client';
import { prisma } from '../src/server/db';
import { readStoredFile } from '../src/server/storage';
import { recordReview } from '../src/server/merge/review';
import { freeze, withUnitLock } from '../src/server/rollup/handoff';
import { syncAfterUnit } from '../src/server/rollup/auto';
import { openHwp } from '../src/lib/hwp/ole';
import { parseRecords, serializeRecords } from '../src/lib/hwp/record';
import { fillTable, packHwp } from '../src/lib/hwp/writer';
import { writeFileAtomic, templateRelPath, sha256 } from '../src/server/storage';
import { currentWeek } from '../src/lib/week';
import type { Scope } from '../src/server/authz';

export const FAKE_DOMAIN = '@example.invalid';

/** 가짜가 아닌 계정 수 — 0이 아니면 실제 DB다(운영·테스트 DB는 언제나 사람이 있다) */
export function foreignUserCount(): Promise<number> {
  return prisma.user.count({ where: { NOT: { email: { endsWith: FAKE_DOMAIN } } } });
}

// ── 부서 ── (공개 조직도의 이름. 사람은 전부 지어낸 것)
export interface DivSpec {
  ko: string;
  slug: string;
  parent?: string;
  active: boolean;
  board?: string;
}
export const DIVS: DivSpec[] = [
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

/** 부서 행 — 처음 만들 때와 시연 DB를 되돌릴 때(demo-seed) 같은 값 */
export function divisionData(d: DivSpec, i: number) {
  return {
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
    // ERP(등록) 순서 = 조직도 순서 — 본부·섹션의 기본 순서가 이것으로 정해진다(RU-09)
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
  };
}

// ── 사람 ── (지어낸 이름, @example.invalid). **만드는 순서가 정렬 순서다** — 바꾸면 안내 그림의 명단 순서가 바뀐다
type Group = 'ai' | 'pco' | 'rmo' | 'ca';
interface PersonSpec {
  name: string;
  /** 이메일 앞부분 — 사람을 가리키는 열쇠로도 쓴다 */
  local: string;
  div: string;
  /** 그 부서의 제출 명단(부서장은 빠진다) */
  group?: Group;
  extra?: Partial<Pick<User, 'divisionRole' | 'jobTitle' | 'onRoster' | 'rosterNote' | 'isCoordinator'>>;
}
const LEAD = { divisionRole: 'lead' } as const;
export const PEOPLE: PersonSpec[] = [
  { name: '한서린', local: 'lead', div: 'AI홍보전략실', group: 'ai', extra: { ...LEAD, jobTitle: '담당' } },
  { name: '도윤재', local: 'head', div: 'AI홍보전략실', extra: { divisionRole: 'head', jobTitle: '실장', onRoster: false, rosterNote: '부서장' } },
  { name: '유단비', local: 'member', div: 'AI홍보전략실', group: 'ai' },
  // 부서원 장의 주인공 — 이번 주에는 아직 안 냈고, 지난주에는 냈다(「지난번에 낸 것」이 보이게)
  { name: '남시우', local: 'member2', div: 'AI홍보전략실', group: 'ai' },
  ...[['표하람', 'ai-04'], ['설이든', 'ai-05'], ['천보라', 'ai-06'], ['마준서', 'ai-07'], ['연바다', 'ai-08'], ['우지안', 'ai-09'], ['채온유', 'ai-10']].map(
    ([name, local]): PersonSpec => ({ name, local, div: 'AI홍보전략실', group: 'ai' }),
  ),
  { name: '봉하늘', local: 'coord', div: '기획조정실', group: 'pco', extra: { ...LEAD, isCoordinator: true, jobTitle: '담당' } },
  ...[['구다온', 'pc-02'], ['석로운', 'pc-03'], ['탁새봄', 'pc-04'], ['국하린', 'pc-05']].map(
    ([name, local]): PersonSpec => ({ name, local, div: '기획조정실', group: 'pco' }),
  ),
  { name: '반서후', local: 'rm-lead', div: '연구관리실', group: 'rmo', extra: LEAD },
  ...[['피가람', 'rm-02'], ['여누리', 'rm-03'], ['함도담', 'rm-04']].map(([name, local]): PersonSpec => ({ name, local, div: '연구관리실', group: 'rmo' })),
  { name: '어진솔', local: 'hq-lead', div: '기획경영본부', extra: { ...LEAD, jobTitle: '담당' } },
  { name: '편무진', local: 'hq-head', div: '기획경영본부', extra: { divisionRole: 'head', jobTitle: '본부장', onRoster: false, rosterNote: '본부장' } },
  { name: '엄태린', local: 'ca-lead', div: '기후대기전략연구본부', group: 'ca', extra: LEAD },
  ...[['소하윤', 'ca-02'], ['인재희', 'ca-03'], ['좌은결', 'ca-04'], ['곽나래', 'ca-05'], ['맹시안', 'ca-06']].map(
    ([name, local]): PersonSpec => ({ name, local, div: '기후대기전략연구본부', group: 'ca' }),
  ),
  // 2026-10-08(ADR-0015 · RU-84) — 실·팀 셋의 부서장. 승인이 곧 위로 가는 제출이 되면서, 부서장 없는 단위는 **마감 뒤** 최종본만
  // 저절로 올라간다(RU-71) — 마감 전 아침의 시연(11/2 월, 마감은 목)·안내 그림에서는 아무것도 올라가지 않는다. 그래서 이 셋의
  // 승인이 올린다. 맨 뒤에 둔다 — 만드는 순서가 정렬 순서라 앞사람들의 순서(안내 그림의 명단)가 바뀌지 않게. 명단 밖(부서장)
  { name: '변소율', local: 'pc-head', div: '기획조정실', extra: { divisionRole: 'head', jobTitle: '실장', onRoster: false, rosterNote: '부서장' } },
  { name: '하도겸', local: 'rm-head', div: '연구관리실', extra: { divisionRole: 'head', jobTitle: '실장', onRoster: false, rosterNote: '부서장' } },
  { name: '경채윤', local: 'ca-head', div: '기후대기전략연구본부', extra: { divisionRole: 'head', jobTitle: '본부장', onRoster: false, rosterNote: '본부장' } },
];

/** RU-84 — 실·팀 셋의 부서장(이메일 앞부분). 시드가 이 사람들로 승인해 위로 올린다 — 시연 계정(`ROLES`)은 아니다 */
export const UNIT_HEADS = { pco: 'pc-head', rmo: 'rm-head', ca: 'ca-head' } as const;

/** 이야기의 역할 → 그 사람(이메일 앞부분). 안내 그림의 세션과 시연 계정이 이 목록이다 */
export const ROLES = {
  member: 'member',
  memberPending: 'member2',
  lead: 'lead',
  head: 'head',
  hqLead: 'hq-lead',
  hqHead: 'hq-head',
  coordinator: 'coord',
} as const;
export type Role = keyof typeof ROLES;

export const emailOf = (local: string) => `${local}${FAKE_DOMAIN}`;

export interface FakeOrg {
  div: Record<string, Division>;
  /** 이메일 앞부분 → 사람 */
  person: Record<string, User>;
  roles: Record<Role, User>;
  /** 부서별 제출 명단 — 만든 순서 */
  ai: User[];
  pco: User[];
  rmo: User[];
  ca: User[];
}

function assemble(div: Record<string, Division>, person: Record<string, User>): FakeOrg {
  const group = (g: Group) => PEOPLE.filter((p) => p.group === g).map((p) => person[p.local]);
  const roles = Object.fromEntries(Object.entries(ROLES).map(([k, local]) => [k, person[local]])) as Record<Role, User>;
  return { div, person, roles, ai: group('ai'), pco: group('pco'), rmo: group('rmo'), ca: group('ca') };
}

/** 사람 행 — 처음 만들 때와 되돌릴 때 같은 값. 정렬 순서는 만드는 순서(20부터 10씩) */
export function personData(p: PersonSpec, i: number) {
  return { name: p.name, email: emailOf(p.local), mustChangePassword: false, sortOrder: 20 + i * 10, ...p.extra };
}

/** 빈 DB에 부서 14 · 사람 31 · 켜진 부서의 양식을 만든다. 3단계 취합은 켠다 */
export async function createFakeOrg(template: Buffer, pwHash: string): Promise<FakeOrg> {
  const div: Record<string, Division> = {};
  for (const [i, d] of DIVS.entries()) div[d.ko] = await prisma.division.create({ data: divisionData(d, i) });
  await prisma.orgRollupSetting.create({ data: { id: 'org', enabled: true } });

  const person: Record<string, User> = {};
  for (const [i, p] of PEOPLE.entries()) {
    person[p.local] = await prisma.user.create({ data: { ...personData(p, i), divisionId: div[p.div].id, passwordHash: pwHash } });
  }
  const org = assemble(div, person);

  // ── 양식 ──
  for (const d of DIVS.filter((x) => x.active)) {
    const rel = templateRelPath(d.slug, 1, true);
    await writeFileAtomic(rel, template);
    await prisma.template.create({ data: { divisionId: div[d.ko].id, filePath: rel, sha256: sha256(template), version: 1, isActive: true, uploadedBy: org.roles.lead.id } });
  }
  return org;
}

/** 이미 만든 가짜 조직을 다시 읽는다. 하나라도 빠졌으면 이 시드가 만든 DB가 아니다 */
export async function loadFakeOrg(): Promise<FakeOrg> {
  const div: Record<string, Division> = {};
  for (const d of DIVS) div[d.ko] = await prisma.division.findUniqueOrThrow({ where: { slug: d.slug } });
  const person: Record<string, User> = {};
  for (const p of PEOPLE) person[p.local] = await prisma.user.findUniqueOrThrow({ where: { email: emailOf(p.local) } });
  return assemble(div, person);
}

/**
 * 스키마의 기본값 — 되돌릴 때 「만든 그대로」로 돌리는 데 쓴다. 기본값을 여기 다시 적지 않는다(스키마가 바뀌면 갈라진다).
 * 글자·숫자·참거짓 기본값만. `cuid()`·`now()` 같은 함수 기본값은 뺀다
 */
export function schemaDefaults(model: 'Division' | 'User'): Record<string, unknown> {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  if (!m) throw new Error(`스키마에 ${model}이 없습니다`);
  const out: Record<string, unknown> = {};
  for (const f of m.fields) {
    if (f.kind !== 'scalar' || !f.hasDefaultValue) continue;
    if (f.default === null || typeof f.default === 'object') continue;
    out[f.name] = f.default;
  }
  return out;
}

/**
 * 시연 DB를 되돌릴 때 — 부서·사람 설정을 만든 그대로. 비밀번호·세션은 건드리지 않는다(미리 로그인해 둔 창이 살아 있게).
 * 이 목록에 나중에 더한 사람(2026-10-08 실·팀 부서장 셋)이 옛 시연 DB에 없으면 만든다 — 비밀번호 없이(로그인하지 않는 사람)
 */
export async function restoreFakeOrg(): Promise<void> {
  const divDefaults = schemaDefaults('Division');
  for (const [i, d] of DIVS.entries()) {
    await prisma.division.update({ where: { slug: d.slug }, data: { ...divDefaults, ...divisionData(d, i) } });
  }
  const userDefaults = schemaDefaults('User');
  const divs = await prisma.division.findMany({ select: { id: true, nameKo: true } });
  const idOf = new Map(divs.map((d) => [d.nameKo, d.id]));
  for (const [i, p] of PEOPLE.entries()) {
    const data = { ...userDefaults, rosterNote: null, jobTitle: null, employeeNo: null, lockedUntil: null, ...personData(p, i), divisionId: idOf.get(p.div)! };
    await prisma.user.upsert({ where: { email: emailOf(p.local) }, update: data, create: { ...data, createdAt: new Date(Date.UTC(2026, 0, 2)) } });
  }
}

// ── 업무일지 ── (지어낸 업무 — 실제 업무일지 어휘를 흉내 냈다. 겹치는 업무를 섞어 중복 묶기가 보이게)
const POOL = [
  'AI 기반 환경데이터 분석 모델 성능 개선', 'LLM 기반 문서 검색 시범 서비스 점검', '보도자료 배포(3건)', '온라인 홍보 콘텐츠 제작 및 등록',
  '정기간행물 발간 진행(8건)', '언론 모니터링 및 일일 브리핑 발송', '연구정보시스템 장애 대응', '내부망 백업 정책 재정비',
  '전자저널 구독 갱신 협의', '신착 자료 정리 및 등록', '연구운영회의 자료 취합', '대정부 예산 협의', '국정감사 대응 자료 정리',
  '기후 시나리오 분석 워크숍 준비', '대기질 예측 모델 검증 회의',
];
const SHARED = ['부서 전체회의 참석', '2026년 하반기 업무계획 수립 회의'];
const PLACES = ['', '', '본원 중회의실', '세종청사', '온라인'];

function rng(s0: number) {
  let s = s0 >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function md(d: Date) {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
}

/** 업무일지 hwp 만들기 — 같은 번호면 같은 내용이다. 일자는 그 주의 월·화·수 중에서 */
export function hwpBuilder(template: Buffer): (i: number, when: Date) => Buffer {
  return (i, when) => {
    const r = rng(i * 7919 + 13);
    const pick = (a: string[], n: number) => [...a].sort(() => r() - 0.5).slice(0, n);
    const items = [...pick(POOL, 3 + Math.floor(r() * 3)), ...(i % 3 === 0 ? pick(SHARED, 1) : [])];
    const monday = new Date(currentWeek(when).opensAt.getTime());
    const ach = items.map((c, k) => [`1-${k + 1}`, c, r() < 0.5 ? md(new Date(monday.getTime() + Math.floor(r() * 3) * 86400_000)) : '', PLACES[Math.floor(r() * PLACES.length)], '']);
    const plans = pick(POOL, 2).map((c, k) => [`2-${k + 1}`, `${c} (계속)`, '', '', '']);
    const recs = parseRecords(openHwp(template).sections[0]);
    fillTable(recs, 0, ach);
    fillTable(recs, 1, plans);
    if (i % 4 === 0) fillTable(recs, 2, [['3-1', '차주 수요일 오후 부서 워크숍으로 부재', '', '', '']]);
    return packHwp(template, [serializeRecords(recs)]);
  };
}

/**
 * HM-47 · RU-70 — 부서장의 [고칠 것 없음 · 승인] = 위로 제출(3단계가 켜져 있으면). 화면과 같은 길이다: 같은 (부서, 주차) 줄에서
 * 지금 병합본의 불변 사본 → 승인·사본(한 트랜잭션) → 받는 곳(본부본·전사본) 맞추기. 올라갔으면 true.
 * 두 시드(시연·안내 그림)가 같이 쓴다 — 2026-10-08(ADR-0015)부터 [제출]이 없어 승인 말고는 위로 보낼 길이 없다
 */
export async function approveAs(u: User, d: Division, slot: WeekSlot): Promise<boolean> {
  const sub = await withUnitLock(d.id, slot.id, async () => {
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId: d.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run?.outputPath) throw new Error(`${d.nameKo} 승인할 병합본이 없습니다`);
    const frozen = await freeze(d.slug, slot, 'unit', await readStoredFile(run.outputPath));
    return (await recordReview({ scope: scopeOf(u, d), run, slot, kind: 'approve', changes: [], frozen })).handedOff;
  });
  if (sub) await syncAfterUnit(d.id, slot, { cause: `unit_handoff:${sub.submissionId}`, causedBy: u.email });
  return !!sub;
}

/** 화면의 게이트를 지난 뒤의 신원 — 시드는 라우트를 거치지 않고 서버 함수를 바로 부른다 */
export function scopeOf(u: User, d: Division): Scope {
  return {
    user: u,
    division: d,
    isLead: u.divisionRole === 'lead',
    isHead: u.divisionRole === 'head',
    isManager: u.divisionRole === 'lead' || u.divisionRole === 'head',
    readAll: u.isOperator || u.isCoordinator,
    source: 'dev',
  };
}

/**
 * Prisma의 `@default(now())`는 쿼리 엔진(Rust)이 채워 **진짜 시각**이 들어간다 — 시드가 정한 시각과 섞이지 않게
 * 시드가 뒤에서 고쳐 쓰는 칸들. (앱이 `new Date()`로 직접 넣는 칸 중 화면에 보이는 것도 — 병합 시작 시각)
 */
export const CLOCK_COLS: [string, string][] = [
  ['division', 'createdAt'], ['user', 'createdAt'], ['weekSlot', 'createdAt'], ['submission', 'uploadedAt'],
  ['template', 'uploadedAt'], ['mergeRun', 'startedAt'], ['auditLog', 'at'], ['notifyLog', 'sentAt'],
  ['reportSubmission', 'submittedAt'], ['rollupRun', 'startedAt'], ['mergeReview', 'createdAt'],
  ['orgSectionUpload', 'uploadedAt'], ['slotOpening', 'openedAt'],
];

/** CLOCK_COLS의 모델을 이름으로 — 이 스크립트들에서만 쓰는 좁은 모양으로 본다 */
export function delegate(model: string) {
  return (prisma as unknown as Record<string, {
    findMany(a: unknown): Promise<Record<string, unknown>[]>;
    update(a: unknown): Promise<unknown>;
  }>)[model];
}
