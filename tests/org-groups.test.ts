// PG-50 — 전사 현황 본판: 본부 → 팀 묶음
import { describe, expect, it } from 'vitest';
import { groupByHq, OUTSIDE } from '@/lib/org-groups';
import { layoutOrg, type DivisionNode } from '@/lib/orgtree';

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

  it('[PG-T72] 상위 본부에 부서 행이 없어도 그 본부 이름 아래로 묶는다 — 「본부 밖」으로 떨어지지 않는다', () => {
    const g = groupByHq([
      d('임원실', ROOT, { people: [p('가', true)] }),
      // 「물환경연구본부」는 Division 행이 없다 — ERP 상위부서 이름만 안다
      d('물정책연구실', '물환경연구본부', { people: [p('나', false)] }),
      d('물순환연구실', '물환경연구본부', { people: [p('다', true)] }),
    ]);
    expect(g.map((x) => [x.name, x.teams.map((t) => t.name)])).toEqual([
      ['물환경연구본부', ['물정책연구실', '물순환연구실']],
      [OUTSIDE, ['임원실']],
    ]);
    expect([g[0].submitted, g[0].roster]).toEqual([1, 2]);
  });

  // 예전에는 「조직도 그래프의 합계 = 본판」이었다. 그래프는 걷어 냈고(2026-10-07, PG-50e) 같은 계산(layoutOrg)은
  // 감사 문서(OPS-30)가 쓴다 — 보관용 기록의 숫자가 화면과 다르면 어느 쪽도 믿을 수 없게 된다.
  it('[PG-T73] 감사 문서(OPS-30)의 합계는 본판과 같다 — Tincase 미사용 부서·명단 밖 제출·집계 밖 부서는 세지 않는다', () => {
    // 감사 문서는 집계 밖 부서까지 **전부** 받는다(report 라우트) — 본판(monitorData.nodes)과 같은 입력
    const nodes = [
      ...all,
      // 미사용 부서 — 감사 문서 그림에는 그리지만(회색) 분모에 넣지 않는다
      d('홍보실', ROOT, { isActive: false, people: [p('사', false), p('아', false)] }),
      // 집계 밖 부서의 제출 — 「제외」로 따로 말하고 합계에는 넣지 않는다
      d('대기환경연구실', '기후대기전략연구본부', { counted: false, people: [p('자', true)] }),
    ];
    const g = groupByHq(nodes);
    const teams = g.flatMap((x) => x.teams).filter((t) => t.isActive);
    const board = { submitted: teams.reduce((n, t) => n + t.submitted, 0), roster: teams.reduce((n, t) => n + t.roster, 0) };
    const report = layoutOrg(nodes);
    expect([report.totals.submitted, report.totals.roster]).toEqual([board.submitted, board.roster]);
    // 기획조정실의 「라」는 명단 밖인데 냈다 — 「낸 사람」 수에 들어가면 분자가 분모를 넘을 수 있다
    expect(report.totals).toMatchObject({ submitted: 3, roster: 5 });
    expect(report.excluded).toEqual({ divisions: 1, people: 1 });
  });

  it('[PG-T71] 팀 숫자는 명단(onRoster) 기준 「7/8」 · 미제출 이름 · Tincase 미사용 팀은 본부 합계에 넣지 않는다', () => {
    const g = groupByHq(all);
    const t = g[0].teams[0];
    expect([t.submitted, t.roster, t.missing]).toEqual([1, 2, ['다']]);
    expect([g[0].submitted, g[0].roster]).toEqual([1, 2]); // 연구관리실(미사용)은 합계에서 빠진다
  });
});
