// S-08 §6 — 병합 규칙 파서(HM-18)와 모델 하네스(HM-24).
// 모델 호출 자체는 테스트하지 않는다 (외부 프로세스). **하네스가 모델을 못 믿는지**를 테스트한다.
import { describe, expect, it } from 'vitest';
import { parseCategories, toPlan, orderPeople } from '@/server/merge/rules';
import { sortByCategory, OTHER } from '@/server/merge/order';
import { exactDuplicates, validateGroups, type MergeRow } from '@/server/merge/dedupe';

const row = (id: number, who: string, content: string, date = '', place = ''): MergeRow => ({
  id,
  who,
  content,
  date,
  place,
  attendee: '',
});

describe('HM-18 병합 규칙 — 문법 없는 설정', () => {
  it('[HM-T30] 부서가 실제로 보낸 원문을 그대로 받는다', () => {
    // 실제 수신 문구: "순서: AI-홍보(정간물 포함)-시스템-도서관"
    expect(parseCategories('AI-홍보(정간물 포함)-시스템-도서관')).toEqual([
      'AI', '홍보(정간물 포함)', '시스템', '도서관',
    ]);
  });

  it('[HM-T31] 구분자를 외우게 하지 않는다 — 쉼표·가운뎃점·하이픈 모두', () => {
    const want = ['AI', '홍보', '시스템'];
    for (const raw of ['AI, 홍보, 시스템', 'AI·홍보·시스템', 'AI-홍보-시스템', 'AI / 홍보 / 시스템']) {
      expect(parseCategories(raw), raw).toEqual(want);
    }
  });

  it('[HM-T32] 빈 값·중복·과다 입력을 조용히 정리한다 (오류로 막지 않는다)', () => {
    expect(parseCategories('')).toEqual([]);
    expect(parseCategories('  ,  , ')).toEqual([]);
    expect(parseCategories('AI, AI, 홍보')).toEqual(['AI', '홍보']);
    expect(parseCategories(Array.from({ length: 30 }, (_, i) => `분류${i}`).join(','))).toHaveLength(12);
  });

  it('[HM-T33] 설정 4종이 계획으로 옮겨진다', () => {
    const plan = toPlan({
      mergeCategories: 'AI, 홍보',
      mergeDedupe: false,
      mergeDropNotes: false,
      mergeRuleText: '  도서관 업무는 맨 뒤로  ',
    });
    expect(plan).toEqual({
      categories: ['AI', '홍보'],
      dedupe: false,
      dropEmptyNotes: false,
      guidance: '도서관 업무는 맨 뒤로',
    });
  });

  it('[HM-T34] 제출자 순서는 sortOrder — 규칙에 이름을 또 적게 하지 않는다', () => {
    const people = [
      { name: '나', sortOrder: 2 },
      { name: '가', sortOrder: 2 },
      { name: '다', sortOrder: 1 },
    ];
    expect(orderPeople(people).map((p) => p.name)).toEqual(['다', '가', '나']);
  });
});

describe('HM-27 분류 정렬', () => {
  const cats = ['AI', '홍보', '시스템'];
  const item = (id: number, cat: string) => ({ id, cat });

  it('[HM-T40] 분류 순서대로 재배치한다', () => {
    const got = sortByCategory([item(1, '시스템'), item(2, 'AI'), item(3, '홍보')], (x) => x.cat, cats);
    expect(got.map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it('[HM-T41] 같은 분류 안에서는 원래 순서를 유지한다 (ABS-6)', () => {
    const got = sortByCategory(
      [item(1, '홍보'), item(2, 'AI'), item(3, '홍보'), item(4, 'AI')],
      (x) => x.cat,
      cats,
    );
    expect(got.map((x) => x.id)).toEqual([2, 4, 1, 3]);
  });

  it('[HM-T42] 기타는 언제나 맨 뒤 — 분류에 없는 업무가 앞에 오면 규칙이 무의미해진다', () => {
    const got = sortByCategory(
      [item(1, OTHER), item(2, '시스템'), item(3, OTHER), item(4, 'AI')],
      (x) => x.cat,
      cats,
    );
    expect(got.map((x) => x.id)).toEqual([4, 2, 1, 3]);
  });

  it('[HM-T43] 행은 재배치될 뿐 사라지지 않는다', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, ['AI', '홍보', '시스템', OTHER, '없는분류'][i % 5]));
    const got = sortByCategory(items, (x) => x.cat, cats);
    expect(got).toHaveLength(items.length);
    expect(new Set(got.map((x) => x.id))).toEqual(new Set(items.map((x) => x.id)));
  });
});

describe('HM-24 모델 하네스', () => {
  const rows = [
    row(1, '최명헌', '정기간행물 발간 진행(10건)'),
    row(2, '최명헌', '보도자료 배포'),
    row(3, '김영인', '정기간행물 발간 진행 (10건)'), // 괄호·공백만 다름
    row(4, '김영인', '데이터기반행정 평가 컨설팅'),
  ];

  it('[HM-T35] 결정론 중복 — 정규화 후 같은 행만 묶는다 (모델 없이)', () => {
    const d = exactDuplicates(rows);
    expect(d).toHaveLength(1);
    expect(d[0].ids).toEqual([1, 3]);
  });

  it('[HM-T36] 빈 내용은 묶지 않는다 — 빈 행끼리 합쳐지면 표가 무너진다', () => {
    expect(exactDuplicates([row(1, 'A', ''), row(2, 'B', ''), row(3, 'C', '  ')])).toEqual([]);
  });

  it('[HM-T37] 다른 업무를 묶지 않는다', () => {
    expect(exactDuplicates([row(1, 'A', '설문 설계'), row(2, 'B', '설문 결과 분석')])).toEqual([]);
  });

  it('[HM-T38] 검증이 모델의 거짓말을 잡는다', () => {
    const cases: [string, unknown][] = [
      ['없는 id', [{ ids: [1, 99], reason: '' }]],
      ['id 겹침', [{ ids: [1, 2], reason: '' }, { ids: [2, 3], reason: '' }]],
      ['묶음이 1개짜리', [{ ids: [1], reason: '' }]],
      ['정수 아님', [{ ids: [1, 2.5], reason: '' }]],
      ['배열 아님', [{ ids: 'all', reason: '' }]],
    ];
    for (const [label, groups] of cases) {
      expect(validateGroups(rows, groups as never), label).not.toBeNull();
    }
  });

  it('[HM-T39] 정상 묶음은 통과한다', () => {
    expect(validateGroups(rows, [{ ids: [1, 3], reason: '같은 업무' }])).toBeNull();
    expect(validateGroups(rows, [])).toBeNull(); // 중복 없음도 정상
  });
});

// ── OPS-31 연속 미제출 (순수 규칙만 검증) ──────────────────────
// DB에 의존하는 집계는 통합 테스트가 아니라 **규칙**을 확인한다:
// "최신부터 세다가 낸 주차를 만나면 끊긴다"가 전부다.
describe('OPS-31 연속 미제출 계산 규칙', () => {
  /** missingStreaks 안의 계산과 동일한 규칙 — 여기서 규칙 자체를 고정한다 */
  const streakOf = (slotsNewestFirst: string[], submitted: Set<string>) => {
    let n = 0;
    for (const s of slotsNewestFirst) {
      if (submitted.has(s)) break;
      n++;
    }
    return n;
  };
  const W = ['W35', 'W34', 'W33', 'W32', 'W31'];

  it('[OPS-T01] 한 번도 안 냈으면 전 구간이 연속이다', () => {
    expect(streakOf(W, new Set())).toBe(5);
  });

  it('[OPS-T02] 최신 주차에 냈으면 0 — 지난주 안 낸 이력은 연속이 아니다', () => {
    expect(streakOf(W, new Set(['W35']))).toBe(0);
    expect(streakOf(W, new Set(['W35', 'W31']))).toBe(0);
  });

  it('[OPS-T03] 중간에 냈으면 거기서 끊긴다', () => {
    expect(streakOf(W, new Set(['W33']))).toBe(2); // W35·W34만 연속
    expect(streakOf(W, new Set(['W32', 'W31']))).toBe(3);
  });

  it('[OPS-T04] 오래된 주차 제출은 최근 연속을 줄이지 못한다', () => {
    expect(streakOf(W, new Set(['W31']))).toBe(4);
  });
});
