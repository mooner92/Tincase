// S-08 §6 — 병합 규칙 파서(HM-18)와 모델 하네스(HM-24).
// 모델 호출 자체는 테스트하지 않는다 (외부 프로세스). **하네스가 모델을 못 믿는지**를 테스트한다.
import { describe, expect, it } from 'vitest';
import { parseMergeRule, orderPeople, RuleParseError, DEFAULT_PLAN } from '@/server/merge/rules';
import { exactDuplicates, validateGroups, type MergeRow } from '@/server/merge/dedupe';

const row = (id: number, who: string, content: string, date = '', place = ''): MergeRow => ({
  id,
  who,
  content,
  date,
  place,
  attendee: '',
});

describe('HM-18 병합 규칙 파서', () => {
  it('[HM-T30] 빈 규칙은 기본값', () => {
    expect(parseMergeRule('')).toEqual(DEFAULT_PLAN);
    expect(parseMergeRule('  \n\n # 주석만 \n')).toEqual(DEFAULT_PLAN);
  });

  it('[HM-T31] 지시어 4종을 해석한다', () => {
    const p = parseMergeRule(
      ['# AI홍보전략실', '순서: 최명헌, 김영인 · 하주연', '빈행유지: 실적 10, 특이 2', '특이사항: 항상 유지', '중복묶기: 끔'].join('\n'),
    );
    expect(p.order).toEqual(['최명헌', '김영인', '하주연']);
    expect(p.minRows).toEqual({ achievements: 10, plans: 8, notes: 2 });
    expect(p.dropEmptyNotes).toBe(false);
    expect(p.dedupe).toBe(false);
  });

  it('[HM-T32] 잘못된 규칙은 행 번호와 함께 거부한다 — 조용히 무시하면 먹은 줄 안다', () => {
    const bad: [string, number][] = [
      ['순서 최명헌', 1],
      ['# 주석\n빈행유지: 실적 열개', 2],
      ['없는지시어: 값', 1],
      ['특이사항: 아무거나', 1],
      ['중복묶기: 아마도', 1],
      ['빈행유지: 실적 9999', 1],
    ];
    for (const [text, line] of bad) {
      try {
        parseMergeRule(text);
        throw new Error(`통과하면 안 됨: ${text}`);
      } catch (e) {
        expect(e).toBeInstanceOf(RuleParseError);
        expect((e as RuleParseError).line).toBe(line);
      }
    }
  });

  it('[HM-T33] 규칙에 없는 사람도 사라지지 않는다 — 뒤에 붙는다', () => {
    const people = [
      { name: '하주연', sortOrder: 3 },
      { name: '최명헌', sortOrder: 1 },
      { name: '박신입', sortOrder: 9 },
      { name: '김영인', sortOrder: 2 },
    ];
    const got = orderPeople(people, parseMergeRule('순서: 최명헌, 김영인')).map((p) => p.name);
    expect(got).toEqual(['최명헌', '김영인', '하주연', '박신입']);
  });

  it('[HM-T34] 규칙이 비면 sortOrder → 이름 순', () => {
    const people = [
      { name: '나', sortOrder: 2 },
      { name: '가', sortOrder: 2 },
      { name: '다', sortOrder: 1 },
    ];
    expect(orderPeople(people, parseMergeRule('')).map((p) => p.name)).toEqual(['다', '가', '나']);
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
