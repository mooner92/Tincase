// RH-80~86 — 연구실 병합(실)과 본부 합치기. 데이터만 다룬다(hwp 없이). 사람·과제 이름은 지어낸 것이다.
import { describe, expect, it } from 'vitest';
import { combineHqDocs, itemCounts, mergeProjectDocs } from '@/lib/hwp/hq-merge';
import type { HqFormData } from '@/lib/hwp/hq-form';

const it_ = (content: string, date = '10/13', place = '본관', people = '갑') => ({ content, date, place, people });
const doc = (d: Partial<HqFormData>): HqFormData => ({ results: [], plans: [], notes: [], ...d });

describe('RH-80~82 — 실 병합', () => {
  it('[RH-T30] 과제는 처음 나온 자리에 · 같은 과제(과제명·책임자, 띄어쓰기 무시) 아래로 모은다 · 같은 항목은 하나로, 강조는 누구라도 했으면', () => {
    const m = mergeProjectDocs(
      [
        { name: '갑', isManager: false, data: doc({ results: [{ unit: '가실', type: '수탁', title: '과제 하나', owner: '홍', items: [it_('회의 A'), it_('회의 B')] }] }) },
        {
          name: '을',
          isManager: false,
          data: doc({
            results: [
              { unit: '가실', type: '기본', title: '과제 둘', owner: '김', items: [it_('조사')] },
              { unit: '가실', type: '수탁', title: '과제  하나', owner: '홍', items: [{ ...it_('회의 B'), emphasis: true }, it_('회의 C')] },
            ],
          }),
        },
      ],
      '가연구실',
    );
    expect(m.data.results.map((t) => [t.title, t.items.map((i) => i.content)])).toEqual([
      ['과제 하나', ['회의 A', '회의 B', '회의 C']],
      ['과제 둘', ['조사']],
    ]);
    expect(m.data.results[0].items[1].emphasis).toBe(true);
    expect(m.merged).toBe(1);
    expect(m.authors.results.map((a) => [a.content, a.authors])).toEqual([
      ['회의 A', ['갑']],
      ['회의 B', ['갑', '을']],
      ['회의 C', ['을']],
      ['조사', ['을']],
    ]);
  });

  it('[RH-T31] 자문회의(이 실의 줄)·평가 실적은 담당·부서장 것 먼저 — 여럿이 다르게 적으면 알린다 · 아무도 안 적었으면 비운다', () => {
    const consult = (label: string, values: string[]) => [{ label, values }];
    const people = [
      { name: '부서원', isManager: false, data: doc({ notes: [it_('발표')], consult: consult('가연구실', ['1', '-', '-', '-']) }) },
      { name: '담당', isManager: true, data: doc({ consult: consult('가 연구실', ['2', '-', '1', '-']), evaluation: ['3건'] }) },
    ];
    const m = mergeProjectDocs(people, '가연구실');
    expect(m.data.consult).toEqual([{ label: '가연구실', values: ['2', '-', '1', '-'] }]);
    expect(m.data.evaluation).toEqual(['3건']);
    expect(m.warnings).toEqual(['자문회의 실적을 여러 사람이 다르게 적었습니다 — 담당 님 것을 넣었습니다']);
    expect(mergeProjectDocs([{ name: '갑', isManager: true, data: doc({ notes: [it_('발표')] }) }], '가연구실').data.consult).toEqual([]);
  });
});

describe('RH-84 — 본부 합치기', () => {
  it('[RH-T32] 실 순서대로 한 표에 · 자문회의는 실마다 자기 줄 · 본부 줄과 평가 실적은 본부 자신의 것 · 수는 항목으로', () => {
    const d = combineHqDocs(
      [
        { nameKo: '가나본부', data: doc({ results: [{ unit: '본부', type: '수탁', title: '본부 과제', owner: '정', items: [it_('착수')] }], consult: [{ label: '가나본부', values: ['-', '-', '1', '-'] }], evaluation: ['5건', '2건'] }) },
        { nameKo: '가연구실', data: doc({ results: [{ unit: '가실', type: '기본', title: '가 과제', owner: '홍', items: [it_('a'), it_('b')] }], consult: [{ label: '가연구실', values: ['1', '-', '-', '-'] }, { label: '나연구실', values: ['9', '9', '9', '9'] }] }) },
        { nameKo: '나연구실', data: doc({ plans: [{ unit: '나실', type: 'R&D', title: '나 과제', owner: '김', items: [it_('c')] }], notes: [it_('수상')] }) },
      ],
      '가나본부',
    );
    expect(d.results.map((t) => t.unit)).toEqual(['본부', '가실']);
    expect(d.plans.map((t) => t.unit)).toEqual(['나실']);
    expect(d.consult).toEqual([
      { label: '가나본부', values: ['-', '-', '1', '-'] },
      { label: '가연구실', values: ['1', '-', '-', '-'] },
    ]); // 나연구실 줄은 나연구실 것에서만 — 가연구실 판에 적힌 남의 줄은 쓰지 않는다
    expect(d.evaluation).toEqual(['5건', '2건']);
    expect(itemCounts(d)).toEqual({ achievements: 3, plans: 1, notes: 1 });
  });
});

describe('RH-97 — 자문회의 여러 줄', () => {
  it('[RH-T33] 본부 담당이 적은 산하 실 줄은 실 병합에 남고 · 본부 합치기는 실 자신의 줄이 없을 때만 본부 판의 줄을 쓴다', () => {
    const rows = [
      { label: '가나본부', values: ['-', '1건', '-', '-'] },
      { label: '가연구실', values: ['2건', '-', '-', '-'] },
      { label: '나연구실', values: ['1건', '-', '-', '-'] },
    ];
    const m = mergeProjectDocs([{ name: '담당', isManager: true, data: doc({ notes: [it_('세미나')], consult: rows }) }], '가나본부');
    expect(m.data.consult).toEqual(rows);
    const d = combineHqDocs(
      [
        { nameKo: '가나본부', data: m.data },
        { nameKo: '가연구실', data: doc({ consult: [{ label: '가연구실', values: ['3건', '-', '-', '-'] }] }) },
        { nameKo: '나연구실', data: doc({}) },
      ],
      '가나본부',
    );
    expect(d.consult).toEqual([
      { label: '가나본부', values: ['-', '1건', '-', '-'] },
      { label: '가연구실', values: ['3건', '-', '-', '-'] }, // 실 자신의 줄이 먼저
      { label: '나연구실', values: ['1건', '-', '-', '-'] }, // 없으니 본부 판의 줄
    ]);
  });
});
