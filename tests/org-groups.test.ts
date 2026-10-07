// PG-50 — 전사 현황 본판: 본부 → 팀 묶음
import { describe, expect, it } from 'vitest';
import { groupByHq, OUTSIDE } from '@/lib/org-groups';
import type { DivisionNode } from '@/lib/orgtree';

const p = (name: string, submitted: boolean, onRoster = true) => ({ id: name, name, submitted, isLead: false, onRoster, submittedAtKst: null });
const d = (name: string, parent: string, extra: Partial<DivisionNode> = {}): DivisionNode => ({
  id: name,
  name,
  slug: name,
  parent,
  isActive: true,
  counted: true,
  people: [],
  ...extra,
});
const ROOT = '한국환경연구원';

describe('PG-50 본부별 팀 묶음', () => {
  const all = [
    d('임원실', ROOT, { people: [p('가', true)] }),
    d('기획경영본부', ROOT, { counted: false }),
    d('기획조정실', '기획경영본부', { people: [p('나', true), p('다', false), p('라', true, false)] }),
    d('연구관리실', '기획경영본부', { isActive: false }),
    d('기후대기전략연구본부', ROOT, { counted: false, isActive: false }),
    d('탄소중립에너지연구실', '기후대기전략연구본부', { people: [p('마', true)] }),
    d('녹색경제연구실', '기후대기전략연구본부', { counted: false }),
    d('국토환경연구본부', ROOT, { people: [p('바', false)] }),
    d('국토관리연구실', '국토환경연구본부', { counted: false }),
  ];

  it('[PG-T70] 본부 아래 팀, 산하 없는 최상위 단위는 「본부 밖」으로 맨 뒤', () => {
    const g = groupByHq(all);
    expect(g.map((x) => [x.name, x.teams.map((t) => t.name)])).toEqual([
      ['기획경영본부', ['기획조정실', '연구관리실']],
      ['기후대기전략연구본부', ['탄소중립에너지연구실']],
      ['국토환경연구본부', ['국토환경연구본부']],
      [OUTSIDE, ['임원실']],
    ]);
  });

  it('[PG-T71] 팀 숫자는 명단(onRoster) 기준 「7/8」 · 미제출 이름 · Tincase 미사용 팀은 본부 합계에 넣지 않는다', () => {
    const g = groupByHq(all);
    const t = g[0].teams[0];
    expect([t.submitted, t.roster, t.missing]).toEqual([1, 2, ['다']]);
    expect([g[0].submitted, g[0].roster]).toEqual([1, 2]); // 연구관리실(미사용)은 합계에서 빠진다
  });
});
