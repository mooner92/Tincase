/**
 * PG-101 · PG-102 — 사용 안내 갈래(연구 본부형 · 평가본부형) 그림용 **가짜** 연구 본부. `guide-seed.ts`가 GUIDE_VARIANT=project|erp일 때 부른다.
 *
 * 사람·과제·업무는 전부 지어낸 것이다(@example.invalid). 부서 이름은 공개 조직도의 것. 본부 양식(hwp)만 비공개 원본 취합본에서
 * **빈 칸으로** 만든다(GUIDE_HQ_SOURCE — 로컬에만 있다, 공개 저장소에는 없다) — 그림에는 지어낸 내용만 찍힌다.
 * 평가본부형은 ERP 「주간업무보고」 인쇄본을 흉내 낸 가짜 PDF 다섯 개를 만든다(LibreOffice로 글 → PDF).
 */
import path from 'node:path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Division, User, WeekSlot } from '@prisma/client';
import { prisma } from '../src/server/db';
import { uploadSubmission } from '../src/server/worklog';
import { runMergeRecorded } from '../src/server/merge/run';
import { writeFileAtomic, templateRelPath, sha256 } from '../src/server/storage';
import { buildProjectHwp, type ProjectBody } from '../src/server/project-form';
import { buildHqTemplate, type HqTemplateSpec } from '../src/lib/hwp/hq-form';
import { currentWeek } from '../src/lib/week';
import { approveAs, emailOf } from './fake-org';

export type ResearchVariant = 'project' | 'erp';

const DAY = 86400_000;
const md = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
};

interface Seat {
  name: string;
  local: string;
  div: string;
  role?: 'lead' | 'head';
  title?: string;
}

/** 국토환경연구본부와 산하 세 실(공개 조직도) · 지어낸 사람 */
const LAND_UNITS = [
  { ko: '국토관리연구실', slug: 'Land_Management_Office' },
  { ko: '물관리연구실', slug: 'Water_Management_Office' },
  { ko: '자연환경연구실', slug: 'Natural_Environment_Office' },
];
const LAND_PEOPLE: Seat[] = [
  { name: '홍가온', local: 'p-member', div: '국토관리연구실' },
  { name: '남궁별', local: 'p-m2', div: '국토관리연구실' },
  { name: '오세린', local: 'p-m3', div: '국토관리연구실' },
  { name: '진다솜', local: 'p-lead', div: '국토관리연구실', role: 'lead', title: '담당' },
  { name: '석우현', local: 'p-head', div: '국토관리연구실', role: 'head', title: '실장' },
  { name: '편아름', local: 'w-m1', div: '물관리연구실' },
  { name: '금하솔', local: 'w-lead', div: '물관리연구실', role: 'lead', title: '담당' },
  { name: '탁경민', local: 'w-head', div: '물관리연구실', role: 'head', title: '실장' },
  { name: '모아린', local: 'n-m1', div: '자연환경연구실' },
  { name: '빈소담', local: 'n-lead', div: '자연환경연구실', role: 'lead', title: '담당' },
  { name: '어태건', local: 'n-head', div: '자연환경연구실', role: 'head', title: '실장' },
  { name: '윤하진', local: 'p-hq-lead', div: '국토환경연구본부', role: 'lead', title: '담당' },
  { name: '백도현', local: 'p-hq-head', div: '국토환경연구본부', role: 'head', title: '본부장' },
];

/** 환경평가본부 산하 네 실(공개 조직도) — 켜지 않는다(혼자 모으는 본부, RH-90) */
const EVAL_UNITS = [
  { ko: '국토전략평가실', slug: 'Land_Strategy_Assessment' },
  { ko: '사회기반평가실', slug: 'Social_Infrastructure_Assessment' },
  { ko: '기후에너지평가실', slug: 'Climate_Energy_Assessment' },
  { ko: '환경자원평가실', slug: 'Environmental_Resources_Assessment' },
];
const EVAL_PEOPLE: Seat[] = [
  { name: '표지안', local: 'e-lead', div: '환경평가본부', role: 'lead', title: '담당' },
  { name: '함승주', local: 'e-head', div: '환경평가본부', role: 'head', title: '본부장' },
];

async function addPeople(seats: Seat[], div: Record<string, Division>, pwHash: string, since: Date): Promise<Record<string, User>> {
  const out: Record<string, User> = {};
  for (const [i, p] of seats.entries()) {
    out[p.local] = await prisma.user.create({
      data: {
        name: p.name,
        email: emailOf(p.local),
        divisionId: div[p.div].id,
        divisionRole: p.role ?? 'member',
        jobTitle: p.title ?? '담당',
        onRoster: p.role !== 'head',
        rosterNote: p.role === 'head' ? p.title : null,
        mustChangePassword: false,
        sortOrder: 500 + i * 10,
        passwordHash: pwHash,
        createdAt: since,
      },
    });
  }
  return out;
}

async function registerTemplate(d: Division, bytes: Buffer, by: string) {
  const rel = templateRelPath(d.slug, 1, true);
  await writeFileAtomic(rel, bytes);
  await prisma.template.create({ data: { divisionId: d.id, filePath: rel, sha256: sha256(bytes), version: 1, isActive: true, uploadedBy: by } });
}

/** 이번 주 요일(0=월) */
const dayOf = (now: Date, i: number) => new Date(currentWeek(now).opensAt.getTime() + i * DAY);

export interface ResearchSeed {
  /** 세션 역할 → 사람 */
  roles: Record<string, User>;
  /** 찍기가 여는 부서 주소 */
  slugs: Record<string, string>;
  /** 평가본부형 — 가짜 ERP PDF 경로 */
  erpPdfs?: string[];
}

/**
 * 갈래의 부서·사람·양식·제출을 만든다. `div`는 fake-org가 만든 부서(국토환경연구본부 · 환경평가본부가 이미 있다 — 꺼진 채).
 * `stamps`에 제출 시각을 남긴다(시드 끝에서 가짜 시계로 맞춘다).
 */
export async function seedResearch(
  variant: ResearchVariant,
  div: Record<string, Division>,
  donor: Buffer,
  pwHash: string,
  now: Date,
  work: string,
  stamps: [string, Date][],
): Promise<ResearchSeed> {
  const sourcePath = process.env.GUIDE_HQ_SOURCE ?? '';
  if (!sourcePath) throw new Error('GUIDE_HQ_SOURCE(원본 취합본 hwp — 본부 양식을 떼어 만든다)가 없습니다');
  const source = readFileSync(sourcePath);
  const since = new Date(now.getTime() - 6 * 7 * DAY);
  return variant === 'project' ? seedLand(div, source, donor, pwHash, now, since, stamps) : seedEval(div, source, donor, pwHash, now, since, work);
}

// ── 연구 본부형 — 국토환경연구본부 ─────────────────────────────────────────

async function seedLand(div: Record<string, Division>, source: Buffer, donor: Buffer, pwHash: string, now: Date, since: Date, stamps: [string, Date][]): Promise<ResearchSeed> {
  const hqKo = '국토환경연구본부';
  div[hqKo] = await prisma.division.update({ where: { id: div[hqKo].id }, data: { isActive: true, boardStatus: 'confirmed' } });
  for (const [i, u] of LAND_UNITS.entries()) {
    div[u.ko] = await prisma.division.create({
      data: { slug: u.slug, nameKo: u.ko, nameEn: u.slug.replace(/_/g, ' '), parentKo: hqKo, isActive: true, boardStatus: 'confirmed', createdAt: new Date(Date.UTC(2026, 0, 1, 1, i)) },
    });
  }
  const spec: HqTemplateSpec = {
    name: hqKo,
    units: LAND_UNITS.map((u) => u.ko),
    widths: {
      consult: [8959, 10398, 10398, 10398, 10398],
      results: [4147, 4996, 20595, 3898, 7013, 9807],
      plans: [4147, 4996, 20029, 6162, 7579, 7260],
      notes: [3015, 18580, 5845, 9524, 13203],
    },
  };
  const tpl = buildHqTemplate(source, spec, donor);
  const p = await addPeople(LAND_PEOPLE, div, pwHash, since);
  for (const d of [hqKo, ...LAND_UNITS.map((u) => u.ko)]) await registerTemplate(div[d], tpl, p['p-hq-lead'].id);

  const lastWeek = new Date(now.getTime() - 7 * DAY);
  const submit = async (u: User, d: string, body: Omit<ProjectBody, 'kind'>, when: Date, manager = false) => {
    const built = buildProjectHwp(tpl, { kind: 'project', ...body }, d, { counts: manager });
    const slot = currentWeek(when).label.replace(/ /g, '_');
    const res = await uploadSubmission({ user: u, division: div[d], fileName: `${slot}_${u.name}.hwp`, bytes: built.bytes, origin: 'web' }, when);
    stamps.push([res.submission.id, when]);
  };
  const item = (content: string, date: string, place: string, people: string) => ({ content, date, place, people });
  const task = (type: string, title: string, owner: string, items: ReturnType<typeof item>[]) => ({ type, title, owner, items });

  const T1 = ['수탁', '국토 그린인프라 진단체계 마련 연구', '진다솜'] as const;
  const T2 = ['기본', '도시 열섬 완화 공간계획 기법 개발', '석우현'] as const;
  // 지난주 — 주인공이 낸 판: 이번 주에 할 일을 계획에 적었다(「지난주 계획 가져오기」)
  await submit(
    p['p-member'],
    '국토관리연구실',
    {
      results: [task(...T1, [item('자료조사 회의', md(dayOf(lastWeek, 1)), '943호', '홍가온 외')])],
      plans: [task(...T1, [item('착수보고회', md(dayOf(now, 1)), '서울역', '진다솜 외')])],
      notes: [],
    },
    new Date(lastWeek.getTime() - 2 * 3600_000), // 지난주 수요일 — 마감(목) 전
  );
  // 이번 주 — 국토실 둘 · 담당(자문회의 줄) · 물실 · 자연실
  await submit(p['p-m2'], '국토관리연구실', { results: [task(...T2, [item('전문가 자문회의', md(dayOf(now, 0)), '서울역', '석우현 외')])], plans: [], notes: [] }, new Date(now.getTime() - 5 * 3600_000));
  await submit(
    p['p-m3'],
    '국토관리연구실',
    { results: [task(...T1, [item('착수보고회', md(dayOf(now, 1)), '서울역', '진다솜 외')])], plans: [task(...T2, [item('현장조사', md(new Date(dayOf(now, 7).getTime())), '세종', '오세린')])], notes: [] },
    new Date(now.getTime() - 4 * 3600_000),
  );
  await submit(p['p-lead'], '국토관리연구실', { results: [], plans: [], notes: [], consult: ['1', '-', '-', '-'] } as Omit<ProjectBody, 'kind'>, new Date(now.getTime() - 3 * 3600_000), true);
  await submit(
    p['w-m1'],
    '물관리연구실',
    { results: [task('수탁', '유역 물순환 관리체계 고도화', '금하솔', [item('중간보고회', md(dayOf(now, 0)), '오송역', '금하솔 외')])], plans: [], notes: [] },
    new Date(now.getTime() - 6 * 3600_000),
  );
  await submit(p['w-lead'], '물관리연구실', { results: [], plans: [], notes: [], consult: ['-', '1', '-', '-'] } as Omit<ProjectBody, 'kind'>, new Date(now.getTime() - 5.5 * 3600_000), true);
  await submit(
    p['n-m1'],
    '자연환경연구실',
    { results: [task('기본', '생태축 연결성 평가 방법 연구', '빈소담', [item('최종자문회의', md(dayOf(now, 1)), '943호', '빈소담 외')])], plans: [], notes: [] },
    new Date(now.getTime() - 7 * 3600_000),
  );
  await submit(p['p-hq-lead'], hqKo, { results: [], plans: [], notes: [item('본부 월례세미나', md(dayOf(now, 0)), '943호', '백도현 외')], consult: ['-', '1', '-', '-'] }, new Date(now.getTime() - 8 * 3600_000), true);

  // 물실 · 자연실 · 본부 자신은 병합하고 승인해 둔다 — 국토실은 찍기가 화면에서 병합·승인한다(그 뒤 본부본이 셋으로 모인다)
  const slot: WeekSlot = await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey: currentWeek(now).isoKey } });
  for (const [d, head] of [['물관리연구실', 'w-head'], ['자연환경연구실', 'n-head'], [hqKo, 'p-hq-head']] as const) {
    await runMergeRecorded(div[d].id, slot.id, 'manual');
    await approveAs(p[head], div[d], slot);
  }
  return {
    roles: { pMember: p['p-member'], pLead: p['p-lead'], pHead: p['p-head'], pHqLead: p['p-hq-lead'], pHqHead: p['p-hq-head'] },
    slugs: { land: div['국토관리연구실'].slug },
  };
}

// ── 평가본부형 — 환경평가본부(혼자 모은다) ───────────────────────────────────

async function seedEval(div: Record<string, Division>, source: Buffer, donor: Buffer, pwHash: string, now: Date, since: Date, work: string): Promise<ResearchSeed> {
  const hqKo = '환경평가본부';
  div[hqKo] = await prisma.division.update({ where: { id: div[hqKo].id }, data: { isActive: true, boardStatus: 'confirmed' } });
  for (const [i, u] of EVAL_UNITS.entries()) {
    div[u.ko] = await prisma.division.create({
      data: { slug: u.slug, nameKo: u.ko, nameEn: u.slug.replace(/_/g, ' '), parentKo: hqKo, isActive: false, boardStatus: 'confirmed', createdAt: new Date(Date.UTC(2026, 0, 1, 2, i)) },
    });
  }
  const tpl = buildHqTemplate(source, { name: hqKo, units: EVAL_UNITS.map((u) => u.ko), evaluation: { from: hqKo, place: 'beforeConsult' } }, donor);
  const p = await addPeople(EVAL_PEOPLE, div, pwHash, since);
  await registerTemplate(div[hqKo], tpl, p['e-lead'].id);
  return { roles: { eLead: p['e-lead'], eHead: p['e-head'] }, slugs: { eval: div[hqKo].slug }, erpPdfs: fakeErpPdfs(now, work) };
}

/**
 * ERP 「경영지원 > 주간업무보고」 인쇄본을 흉내 낸 가짜 PDF 다섯 개(본부 + 네 실). 모양은 실측(2026-10)과 같다 — 머리 「[부서명] (기간)」,
 * 구분 「N. 회의개최」 아래 「○ 과제(유형, 책임자)」 → 「- 내용(일자, 장소, 참석자)」. 사람·과제는 지어낸 것.
 * 미리 고르기(RH-93)가 두 건을 고르고 나머지는 이유와 함께 빼도록 섞었다.
 */
function fakeErpPdfs(now: Date, work: string): string[] {
  const dir = path.join(work, 'erp');
  mkdirSync(dir, { recursive: true });
  const w = currentWeek(now);
  const iso = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const from = iso(new Date(w.opensAt.getTime() - 4 * DAY));
  const to = iso(new Date(w.opensAt.getTime() + 2 * DAY));
  const d = (i: number) => md(dayOf(now, i));
  const full = (i: number) => iso(dayOf(now, i));
  const docs: Record<string, string[]> = {
    환경평가본부: ['1. 회의개최', '○ 평가서 검토 운영(기본, 함승주)', `- 평가서 검토를 위한 주간심의회의(4개실)(${d(0)}, 943호, 함승주, 표지안)`],
    국토전략평가실: [
      '1. 회의개최',
      '○ 소규모 평가 절차 개선 연구(수탁, 차은솔)',
      `- 향후 과제 진행방향 논의(${d(0)}, 910호, 차은솔)`,
      '2. 대외활동',
      `○ 지구단위계획 전략평가 심의(${full(1)} 10:00~12:00, 서면심의, 차은솔)`,
    ],
    사회기반평가실: [
      '1. 회의개최',
      '○ 도로 소음 저감 평가기법 연구(수탁, 국민혁)',
      `- 중간보고회(${d(1)}, 서울역 KTX2 회의실, 국민혁, 설지호)`,
      '○ 교통시설 대기영향 예측 고도화(기본, 설지호)',
      `- 자료 정리 회의(${d(0)}, 914호, 설지호)`,
      '2. 국내출장',
      ` - 도로 소음 저감 평가기법 연구 (과제 중간보고 발표, ${d(1)} , 서울역 회의실 , 국민혁)`,
    ],
    기후에너지평가실: [
      '1. 회의개최',
      '○ 해상풍력 환경성 평가 방안 연구(수탁, 도하람)',
      `- 착수자문회의(${d(2)}, 서울역 AREX 회의실, 도하람, 길새론)`,
      '○ 기후변화영향평가 운영체계 연구(기본, 길새론)',
      `- 최종자문회의 준비사항 점검 회의(${d(0)}, 9층 소회의실, 길새론)`,
      '2. 대외활동',
      `○ 학술지 논문 심사(${full(1)} 14:00~16:00, 한국환경연구원(서면), 도하람)`,
    ],
    환경자원평가실: [
      '1. 회의개최',
      '○ 하천 생태계 복원 평가 연구(기본, 반예준)',
      `- 최종자문회의 의견 반영 방향 논의(${d(1)}, 901호, 반예준)`,
      '2. 국내출장',
      ` - 하천 생태계 복원 평가 연구 (학회 발표, ${d(2)} , 부산 , 반예준)`,
    ],
  };
  const out: string[] = [];
  for (const [i, [unit, lines]] of Object.entries(docs).entries()) {
    const txt = path.join(dir, `erp-${i + 1}.txt`);
    writeFileSync(txt, [`    [${unit}] (${from} ~ ${to})`, '', ...lines.flatMap((l) => (/^\d+\./.test(l) ? [`                           ${l}`] : [l])), ''].join('\n'));
    const r = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, txt], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(`가짜 ERP PDF를 만들지 못했습니다: ${r.stderr}`);
  }
  for (const f of readdirSync(dir)) if (f.endsWith('.pdf')) out.push(path.join(dir, f));
  return out.sort();
}
