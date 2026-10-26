// RH-120~126 — 본부 다듬기 (순수 함수). 규칙은 국토환경 본부 담당이 보낸 취합 규칙(2026-10-22) — 9월 4주 · 10월 3주 제출본 모양으로 본다.
// 사람·과제·회의 이름은 지어낸 것이다(실 이름은 공개 조직도). 제출본은 모양(유형 · 회의 종류 · 날짜)만 따랐다.
import { describe, expect, it } from 'vitest';
import type { HqFormData, HqItem, HqTask } from '@/lib/hwp/hq-form';
import type { UnitDoc } from '@/lib/hwp/hq-merge';
import { combineHqDocs } from '@/lib/hwp/hq-merge';
import {
  consultColOf,
  countConsult,
  curateHq,
  curateRulesOf,
  curateUnits,
  curateView,
  curationFingerprint,
  dateSpan,
  itemKey,
  judgeListItem,
  judgeNote,
  mondayDay,
  periodsOf,
  type CurateContext,
} from '@/lib/hq-curate';
import { estimatePages, linesOf, pageLimit } from '@/lib/hq-pages';

const HQ = '국토환경연구본부';
const RULES = curateRulesOf(HQ)!;
// 2026-10-12(월) KST 00:00 — 슬롯의 opensAt은 그 순간(UTC 전날 15:00)
const MON = mondayDay(new Date('2026-10-11T15:00:00Z'));
const ctx: CurateContext = { hqNameKo: HQ, monday: MON, rules: RULES };
const W = { monday: MON };
const day = (m: number, d: number) => Math.round(Date.UTC(2026, m - 1, d) / 86_400_000);

const it_ = (content: string, date = '10/14', place = '서울역', people = '가나다 외'): HqItem => ({ content, date, place, people });
const task = (unit: string, type: string, title: string, items: HqItem[]): HqTask => ({ unit, type, title, owner: '가나다', items });
const doc = (results: HqTask[], plans: HqTask[] = [], notes: HqItem[] = [], consult?: HqFormData['consult']): HqFormData => ({
  results,
  plans,
  notes,
  ...(consult ? { consult } : {}),
});

describe('RH-121 — 일자 읽기', () => {
  it('[RH-T120] 한 날 · 범위 · 「~23」 · 쉼표 · 점 · 해 넘김 · 못 읽음', () => {
    expect(mondayDay(new Date('2026-10-11T15:00:00Z'))).toBe(day(10, 12));
    expect(dateSpan('10/16', MON)).toEqual([day(10, 16), day(10, 16)]);
    expect(dateSpan('10/10-10/19', MON)).toEqual([day(10, 10), day(10, 19)]);
    expect(dateSpan('10/17~\n10/26', MON)).toEqual([day(10, 17), day(10, 26)]);
    expect(dateSpan('10/19~23', MON)).toEqual([day(10, 19), day(10, 23)]);
    expect(dateSpan('10/29, 10/30', MON)).toEqual([day(10, 29), day(10, 30)]);
    expect(dateSpan('9.30', MON)).toEqual([day(9, 30), day(9, 30)]);
    const dec = mondayDay(new Date('2026-12-27T15:00:00Z')); // 12/28(월)
    expect(dateSpan('1/2', dec)).toEqual([Math.round(Date.UTC(2027, 0, 2) / 86_400_000), Math.round(Date.UTC(2027, 0, 2) / 86_400_000)]);
    expect(dateSpan('-', MON)).toBeNull();
    expect(dateSpan('상시', MON)).toBeNull();
  });
});

describe('RH-121 — 목록 미리 고르기', () => {
  it('[RH-T121] 기간 밖 · 연구원 사업 보고회는 뺌 · 수탁 보고회 · 연구원 사업의 다른 일은 넣음', () => {
    expect(judgeListItem(RULES, 'results', '수탁', it_('중간보고회', '10/14'), W)).toEqual({ suggested: true });
    expect(judgeListItem(RULES, 'results', '기본', it_('착수보고회', '10/14'), W)).toMatchObject({ suggested: false, reason: expect.stringContaining('출연금 과제') });
    expect(judgeListItem(RULES, 'results', '일반사업', it_('최종 자문회의', '10/14'), W).suggested).toBe(false);
    // 10월 3주 제출본의 모양 — 기본 과제의 정책실무협의회 · 전문가 포럼은 목록에 있다
    expect(judgeListItem(RULES, 'results', '기본', it_('정책실무협의회(가 부처)', '10/12'), W).suggested).toBe(true);
    expect(judgeListItem(RULES, 'results', '기본', it_('제9차 전문가 포럼 개최', '10/13'), W).suggested).toBe(true);
    // 기간 — 실적은 이번 주 월~일, 계획은 다음 주 월~일, 겹치면 넣음
    expect(judgeListItem(RULES, 'results', '수탁', it_('현장 회의', '10/9'), W)).toMatchObject({ suggested: false, reason: expect.stringContaining('기간 밖') });
    expect(judgeListItem(RULES, 'results', '수탁', it_('현장 회의', '10/18'), W).suggested).toBe(true);
    expect(judgeListItem(RULES, 'plans', '수탁', it_('현장 조사', '10/10-10/19'), W).suggested).toBe(true);
    expect(judgeListItem(RULES, 'plans', '정부지원', it_('국외출장: 국제회의 참석', '10/17~10/26'), W).suggested).toBe(true);
    expect(judgeListItem(RULES, 'plans', '수탁', it_('워크숍', '10/16'), W).suggested).toBe(false);
    expect(judgeListItem(RULES, 'plans', '수탁', it_('워크숍', '11/3'), W).suggested).toBe(false);
    expect(judgeListItem(RULES, 'plans', '수탁', it_('워크숍', '미정'), W).suggested).toBe(true);
  });

  it('[RH-T121] 월간 주 — 실적은 그 달 1일~이번 주, 계획은 다음 달 (2026-08·09 월간본 모양)', () => {
    const aug = { monday: Math.round(Date.UTC(2026, 7, 31) / 86_400_000), monthly: true }; // 8/31(월) — 8월 말일이 든 주
    expect(periodsOf(aug)).toEqual({ results: [day(8, 1), day(9, 6)], plans: [day(9, 1), day(9, 30)], notes: [day(8, 1), day(9, 6)] });
    expect(judgeListItem(RULES, 'results', '정부지원', it_('정부대표단 참석', '8/2~8/14'), aug).suggested).toBe(true);
    expect(judgeListItem(RULES, 'results', '수탁', it_('현장 훈련', '9/1-9/4'), aug).suggested).toBe(true);
    expect(judgeListItem(RULES, 'plans', '역무대행', it_('설명회 - 중부권역', '9/1'), aug).suggested).toBe(true);
    expect(judgeListItem(RULES, 'plans', '수탁', it_('2차 포럼', '9/29'), aug).suggested).toBe(true);
    expect(judgeListItem(RULES, 'results', '수탁', it_('포럼', '7/30'), aug)).toMatchObject({ suggested: false, reason: '기간 밖 — 실적은 이번 달' });
    expect(judgeNote(RULES, it_('국회 포럼 토론', '8/13'), aug).suggested).toBe(true);
    expect(judgeNote(RULES, it_('국회 포럼 토론', '9/8'), aug)).toMatchObject({ suggested: false, reason: expect.stringContaining('다음 달') });
    // 연구원 사업(출연금 과제) — 연구개발적립금은 연적금의 긴 이름
    expect(judgeListItem(RULES, 'plans', '연구개발적립금', it_('최종자문회의 개최', '9/14'), aug).suggested).toBe(false);
  });

  it('[RH-T121] 규칙이 없는 본부는 모두 넣음', () => {
    expect(curateRulesOf('생활환경연구본부')).toBeNull();
    const units: UnitDoc[] = [{ nameKo: '순환경제연구실', data: doc([task('순환실', '기본', '과제', [it_('착수보고회', '1/1')])], [], [it_('강의', '1/1')]) }];
    const v = curateView(units, { hqNameKo: '생활환경연구본부', monday: MON, rules: null }, null);
    expect(v.items.every((i) => i.included && i.suggested && !i.reason)).toBe(true);
    expect(v.consult.find((c) => c.label === '순환경제연구실')?.counted).toBeNull();
  });
});

describe('RH-121 — 특이사항 미리 고르기', () => {
  it('[RH-T122] 다음 주 · 지난주 · 빼는 말 · 넣는 말 · 애매', () => {
    expect(judgeNote(RULES, it_('관계기관 회의 참석', '10/21'), W)).toMatchObject({ suggested: false, reason: expect.stringContaining('다음 주') });
    expect(judgeNote(RULES, it_('협의체 발제', '10/5'), W)).toMatchObject({ suggested: false, reason: '지난주 일' });
    expect(judgeNote(RULES, it_('가상 기준 마련 협의체 발제', '10/13'), W)).toMatchObject({ suggested: true, reason: '협의체' });
    expect(judgeNote(RULES, it_('가상학회 특별세션 개최 및 발표', '10/16'), W).suggested).toBe(true);
    expect(judgeNote(RULES, it_('국회 토론회 발표', '10/15'), W)).toMatchObject({ suggested: true, reason: '국회' });
    expect(judgeNote(RULES, it_('기후부 정책 간담회', '10/15'), W)).toMatchObject({ suggested: true, reason: '관계부처' });
    expect(judgeNote(RULES, it_('대학 특강 강의', '10/15'), W)).toMatchObject({ suggested: false, reason: '강의·교육은 빼요' });
    expect(judgeNote(RULES, it_('신규 직원 연수', '10/15'), W)).toMatchObject({ suggested: false, reason: '연수는 빼요' });
    expect(judgeNote(RULES, it_('장비 시연 참관', '10/15'), W).suggested).toBe(false);
    // 「도시연구단」은 시연이 아니다 — 애매(세미나)로 남는다
    expect(judgeNote(RULES, it_('가상 탄소중립도시연구단 세미나', '10/15'), W).reason).toContain('애매');
    expect(judgeNote(RULES, it_('기후대응 전환 발표 및 논의', '10/15'), W)).toMatchObject({ suggested: true, reason: '발제·토론' });
    expect(judgeNote(RULES, it_('본부 내부 논의', '10/15'), W)).toMatchObject({ suggested: false, reason: '내부 논의는 빼요' });
    expect(judgeNote(RULES, it_('타 기관 개별 사업 자문', '10/15'), W).suggested).toBe(false);
    // 빼는 말이 넣는 말보다 먼저 — 위원회 교육은 교육
    expect(judgeNote(RULES, it_('위원회 위원 교육', '10/15'), W).suggested).toBe(false);
    expect(judgeNote(RULES, it_('본부 수요세미나 개최', '10/15'), W)).toMatchObject({ suggested: false, reason: expect.stringContaining('애매') });
    expect(judgeNote(RULES, it_('협의체 발제', ''), W).suggested).toBe(true);
  });
});

describe('RH-122 — 자문회의 세기', () => {
  it('[RH-T123] 칸 — 연구원 사업 보고회 → 자문회의 · 수탁 보고회 · 정책실무협의회 · 그 밖의 회의 → 기타 · 세미나 · 포럼 · 출장은 세지 않음', () => {
    expect(consultColOf(RULES, '기본', '착수보고회')).toBe(0);
    expect(consultColOf(RULES, '수시', '중간 자문회의')).toBe(0);
    expect(consultColOf(RULES, '수탁', '최종보고회')).toBe(3);
    expect(consultColOf(RULES, 'R&D', '중간보고')).toBe(3);
    expect(consultColOf(RULES, '기본', '정책실무협의회(가 부처)')).toBe(3);
    expect(consultColOf(RULES, '수탁', '전문가 세미나 개최')).toBe(1);
    expect(consultColOf(RULES, '수탁', '제8차 전문가 포럼 개최')).toBe(2);
    expect(consultColOf(RULES, '수탁', '현장 시험 워크샵')).toBe(2);
    expect(consultColOf(RULES, '수탁', '과제 실무자 회의')).toBe(3);
    expect(consultColOf(RULES, '수탁', '국외출장: 착수회의 참석')).toBeNull();
    expect(consultColOf(RULES, '역무대행', '가상학술대회 특별세션 개최')).toBeNull();
  });

  it('[RH-T123] 9월 4주 모양 — 전문가 포럼 둘 → 포럼 2 · 실무자 회의 → 기타 1 · 이번 주 밖은 세지 않음', () => {
    const mon = mondayDay(new Date('2026-09-20T15:00:00Z')); // 9/21(월)
    const nature = doc([
      task('자연실', '수탁', '가 연구', [it_('제8차 전문가 포럼 개최', '9/22')]),
      task('자연실', '기본', '나 연구', [it_('제9차 전문가 포럼 개최', '9/22'), it_('착수보고회', '9/14')]),
    ]);
    expect(countConsult(RULES, nature, { monday: mon })).toEqual([0, 0, 2, 0]);
    expect(countConsult(RULES, doc([task('국토실', '수탁', '다 연구', [it_('과제 실무자 회의', '9/21')])]), { monday: mon })).toEqual([0, 0, 0, 1]);
  });

  it('[RH-T123] 줄 값 — 고친 값 → 실이 적은 값 → 본부 판의 그 실 줄 → 센 값(0은 「-」) · 뺀 항목도 센다', () => {
    const units: UnitDoc[] = [
      { nameKo: HQ, data: doc([], [], [], [{ label: '물관리연구실', values: ['2', '-', '-', '-'] }]) },
      { nameKo: '국토관리연구실', data: doc([task('국토실', '기본', '과제가', [it_('착수보고회', '10/13')])], [], [], [{ label: '국토관리연구실', values: ['-', '-', '-', '-'] }]) },
      { nameKo: '물관리연구실', data: doc([task('물실', '수탁', '과제나', [it_('현장 회의', '10/14')])]) },
      { nameKo: '자연환경연구실', data: doc([task('자연실', '기본', '과제다', [it_('정책실무협의회', '10/12')])], [], [], [{ label: '자연환경연구실', values: ['3', '-', '-', '1'] }]) },
    ];
    const v = curateView(units, ctx, null);
    const row = (l: string) => v.consult.find((c) => c.label === l)!;
    expect(row('국토관리연구실')).toMatchObject({ reported: null, counted: [1, 0, 0, 0], values: ['1', '-', '-', '-'] });
    expect(row('물관리연구실')).toMatchObject({ reported: ['2', '-', '-', '-'], values: ['2', '-', '-', '-'] });
    expect(row('자연환경연구실')).toMatchObject({ reported: ['3', '-', '-', '1'], counted: [0, 0, 0, 1], values: ['3', '-', '-', '1'] });
    // 착수보고회는 목록에서 빠지지만 센다
    expect(v.items.find((i) => i.item.content === '착수보고회')?.included).toBe(false);
    const fixed = curateView(units, ctx, { decisions: {}, consult: { 국토관리연구실: ['-', '-', '-', '2'] } });
    expect(fixed.consult.find((c) => c.label === '국토관리연구실')).toMatchObject({ override: ['-', '-', '-', '2'], values: ['-', '-', '-', '2'] });
  });
});

describe('RH-124 — 적용', () => {
  const units = (): UnitDoc[] => [
    {
      nameKo: '국토관리연구실',
      data: doc(
        [task('국토실', '기본', '연구원 과제', [it_('착수보고회', '10/13')]), task('국토실', '수탁', '수탁 과제', [it_('중간보고회', '10/14'), it_('현장 회의', '10/15')])],
        [task('국토실', '수탁', '수탁 과제', [it_('전문가 세미나', '10/20')])],
        [it_('협의체 발제', '10/13'), it_('내부 논의', '10/14')],
      ),
    },
    { nameKo: '물관리연구실', data: doc([task('물실', '기본', '물 과제', [it_('최종보고회', '10/16')])], [task('물실', '기본', '물 과제', [it_('최종보고회 준비', '9/1')])]) },
  ];

  it('[RH-T124] 뺀 항목 · 빈 과제 · 빈 실 칸이 걷힌다 · 자문회의는 줄 값으로', () => {
    const out = curateHq(units(), ctx, null);
    expect(out.results.map((t) => [t.unit, t.title, t.items.map((i) => i.content)])).toEqual([['국토실', '수탁 과제', ['중간보고회', '현장 회의']]]);
    expect(out.plans.map((t) => t.title)).toEqual(['수탁 과제']);
    expect(out.notes.map((n) => n.content)).toEqual(['협의체 발제']);
    expect(out.consult).toEqual([
      { label: '국토관리연구실', values: ['1', '-', '-', '2'] },
      { label: '물관리연구실', values: ['1', '-', '-', '-'] },
    ]);
  });

  it('[RH-T124] 사람의 결정이 규칙을 이긴다 · 열쇠는 내용으로(실이 다시 내도 같다)', () => {
    const v = curateView(units(), ctx, null);
    const kick = v.items.find((i) => i.item.content === '현장 회의')!;
    const keep = v.items.find((i) => i.item.content === '착수보고회')!;
    const out = curateHq(units(), ctx, { decisions: { [kick.key]: false, [keep.key]: true }, consult: {} });
    expect(out.results.flatMap((t) => t.items.map((i) => i.content))).toEqual(['착수보고회', '중간보고회']);
    // 다시 낸 사본(장소만 바뀜) — 열쇠는 그대로
    const again = units();
    again[0].data.results[1].items[1].place = '세종';
    expect(curateView(again, ctx, null).items.find((i) => i.item.content === '현장 회의')!.key).toBe(kick.key);
    // 내용이 바뀌면 새 항목 — 규칙의 답
    expect(itemKey('results', '국토관리연구실', { type: '수탁', title: '수탁 과제' }, it_('현장 회의 (2차)', '10/15'))).not.toBe(kick.key);
  });

  it('[RH-T124] 같은 항목이 두 번이면 둘째 열쇠에 번호 · 순서대로 걷힌다', () => {
    const twice: UnitDoc[] = [{ nameKo: '국토관리연구실', data: doc([task('국토실', '수탁', '과제', [it_('현장 회의'), it_('현장 회의')])]) }];
    const v = curateView(twice, ctx, null);
    expect(v.items.map((i) => i.key)).toEqual([v.items[0].key, `${v.items[0].key}.2`]);
    const out = curateUnits(twice, ctx, { decisions: { [`${v.items[0].key}.2`]: false }, consult: {} });
    expect(out[0].data.results[0].items).toHaveLength(1);
  });

  it('[RH-T124] 규칙도 저장값도 없으면 합치기 그대로 · 지문은 null(본부본 열쇠가 다듬기 전과 같다)', () => {
    const plain = { hqNameKo: '생활환경연구본부', monday: MON, rules: null };
    expect(curateHq(units(), plain, null)).toEqual(combineHqDocs(units(), '생활환경연구본부'));
    expect(curationFingerprint(null, null)).toBeNull();
    expect(curationFingerprint(null, RULES)).toContain(RULES.version);
    const a = curationFingerprint({ decisions: { b: true, a: false }, consult: {} }, null);
    expect(a).toBe(curationFingerprint({ decisions: { a: false, b: true }, consult: {} }, null));
    expect(a).not.toBe(curationFingerprint({ decisions: { a: true, b: true }, consult: {} }, null));
  });
});

describe('RH-123 — 분량 어림', () => {
  it('[RH-T126] 줄이 늘면 쪽이 는다 · 긴 글은 줄을 더 먹는다 · 월간은 2쪽', () => {
    const small = doc([task('국토실', '수탁', '과제', [it_('회의')])]);
    const many = doc(Array.from({ length: 12 }, (_, k) => task('국토실', '수탁', `과제 ${k}`, [it_('회의'), it_('포럼')])));
    expect(estimatePages(small)).toBeLessThan(0.8);
    expect(estimatePages(many)).toBeGreaterThan(1);
    expect(linesOf('가'.repeat(10), 23)).toBe(1);
    expect(linesOf('가'.repeat(30), 23)).toBe(2);
    expect(linesOf('첫 줄\n둘째 줄', 23)).toBe(2);
    expect(estimatePages(small, { consultRows: 8 })).toBeGreaterThan(estimatePages(small));
    expect([pageLimit(false), pageLimit(true)]).toEqual([1, 2]);
  });
});
