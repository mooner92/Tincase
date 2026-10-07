// PG-50 · PG-51 — 「전사」 화면의 제출 현황: 부서 → 최종본 섹션 묶음
//
// 2026-10-07 묶는 기준이 본부(groupByHq)에서 섹션(groupBySection)으로 바뀌었다(PG-51c). T70~T73은 같은 경우
// (본부 아래 팀 · 미사용 팀 · 부서 행이 없는 상위 본부 · 감사 문서 합계)를 새 묶음으로 그대로 본다.
import { describe, expect, it } from 'vitest';
import { groupBySection, OUTSIDE } from '@/lib/org-groups';
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
const sec = (...names: (string | null)[]) => names.map((divisionName) => ({ divisionName }));
const teamNames = (g: { teams: { name: string }[] }) => g.teams.map((t) => t.name);

describe('PG-51 부서 → 섹션 묶음', () => {
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
  // 최종본 순서 — 실 단위 섹션과 본부 단위 섹션이 섞여 있다. null = Tincase 밖(게시판으로 받는 섹션)
  const sections = sec('임원실', '기획조정실', '연구관리실', '기후대기전략연구본부', '국토환경연구본부', null);

  it('[PG-T70] 실은 자기 섹션에, 본부 섹션에는 산하 실이 — 섹션 순서 그대로. 집계 밖 부서는 어디에도 없다', () => {
    const g = groupBySection(sections, all);
    expect(g.sections.map(teamNames)).toEqual([
      ['임원실'],
      ['기획조정실'],
      ['연구관리실'],
      ['탄소중립에너지연구실'], // 본부 자체·녹색경제연구실은 집계 밖
      ['국토환경연구본부'], // 본부 자신이 집계 대상 — 국토관리연구실은 집계 밖
      [],
    ]);
    expect(teamNames(g.outside)).toEqual([]);
  });

  it('[PG-T71] 숫자는 명단(onRoster) 기준 「1/2」 · 미제출 이름 · Tincase 미사용 팀은 합계·이름에 넣지 않는다', () => {
    const g = groupBySection(sections, all);
    const t = g.sections[1].teams[0];
    expect([t.submitted, t.roster, t.missing]).toEqual([1, 2, ['다']]);
    expect([g.sections[1].submitted, g.sections[1].roster, g.sections[1].missing]).toEqual([1, 2, ['다']]);
    // 연구관리실(미사용)은 팀으로는 보이지만(「게시판으로 제출」) 섹션 합계에는 0
    expect(g.sections[2].teams[0].isActive).toBe(false);
    expect([g.sections[2].submitted, g.sections[2].roster, g.sections[2].missing]).toEqual([0, 0, []]);
  });

  it('[PG-T72] 상위 본부에 부서 행이 없어도 그 이름의 섹션에 붙는다 — 「섹션 밖」으로 떨어지지 않는다', () => {
    const g = groupBySection(sec('임원실', '물환경연구본부'), [
      d('임원실', ROOT, { people: [p('가', true)] }),
      // 「물환경연구본부」는 Division 행이 없다 — ERP 상위부서 이름만 안다 (기본 섹션 목록은 이름으로 맞춘다, PG-51d)
      d('물정책연구실', '물환경연구본부', { people: [p('나', false)] }),
      d('물순환연구실', '물환경연구본부', { people: [p('다', true)] }),
    ]);
    expect(g.sections.map(teamNames)).toEqual([['임원실'], ['물정책연구실', '물순환연구실']]);
    expect([g.sections[1].submitted, g.sections[1].roster]).toEqual([1, 2]);
    expect(g.outside.teams).toEqual([]);
  });

  // 예전에는 「조직도 그래프의 합계 = 본판」이었다. 그래프는 걷어 냈고(2026-10-07, PG-50e) 같은 계산(layoutOrg)은
  // 감사 문서(OPS-30)가 쓴다 — 보관용 기록의 숫자가 화면과 다르면 어느 쪽도 믿을 수 없게 된다.
  it('[PG-T73] 감사 문서(OPS-30)의 합계는 화면(섹션 + 「섹션 밖」)과 같다 — 미사용 부서·명단 밖 제출·집계 밖 부서는 세지 않는다', () => {
    // 감사 문서는 집계 밖 부서까지 **전부** 받는다(report 라우트) — 화면(progressNodes().nodes)과 같은 입력
    const nodes = [
      ...all,
      // 미사용 부서 — 감사 문서 그림에는 그리지만(회색) 분모에 넣지 않는다
      d('홍보실', ROOT, { isActive: false, people: [p('사', false), p('아', false)] }),
      // 집계 밖 부서의 제출 — 「제외」로 따로 말하고 합계에는 넣지 않는다
      d('대기환경연구실', '기후대기전략연구본부', { counted: false, people: [p('자', true)] }),
    ];
    // 임원실·국토환경연구본부 섹션이 없다 — 둘은 「섹션 밖」으로 가지만 합계에서 빠지면 안 된다
    const g = groupBySection(sec('기획조정실', '연구관리실', '기후대기전략연구본부'), nodes);
    expect(teamNames(g.outside)).toEqual(['임원실', '국토환경연구본부', '홍보실']);
    const groups = [...g.sections, g.outside];
    const screen = { submitted: groups.reduce((n, x) => n + x.submitted, 0), roster: groups.reduce((n, x) => n + x.roster, 0) };
    const report = layoutOrg(nodes);
    expect([report.totals.submitted, report.totals.roster]).toEqual([screen.submitted, screen.roster]);
    // 기획조정실의 「라」는 명단 밖인데 냈다 — 「낸 사람」 수에 들어가면 분자가 분모를 넘을 수 있다
    expect(report.totals).toMatchObject({ submitted: 3, roster: 5 });
    expect(report.excluded).toEqual({ divisions: 1, people: 1 });
  });

  it('[PG-T82] ★ 가장 가까운 섹션에 붙는다 · 어디에도 안 닿으면 「섹션 밖」 · 같은 부서를 가리키는 섹션이 둘이면 앞 섹션에만', () => {
    // 본부 섹션과 그 산하 실 섹션이 같이 있으면 실은 자기 섹션(가까운 쪽), 섹션이 없는 형제 실은 본부 섹션
    const g = groupBySection(sec('기획경영본부', '기획조정실', '임원실', '임원실'), all);
    expect(g.sections.map(teamNames)).toEqual([['연구관리실'], ['기획조정실'], ['임원실'], []]);
    // 섹션이 하나도 안 닿는 집계 부서 — 탄소중립에너지연구실(본부 섹션 없음)·국토환경연구본부
    expect(teamNames(g.outside)).toEqual(['탄소중립에너지연구실', '국토환경연구본부']);
    expect(OUTSIDE).toBe('섹션 밖');
    expect([g.outside.submitted, g.outside.roster, g.outside.missing]).toEqual([1, 2, ['바']]);

    // 상위부서가 서로를 가리켜도(데이터 오류) 멈추고 「섹션 밖」으로
    const loop = groupBySection(sec('임원실'), [d('가실', '나실', { people: [p('가', true)] }), d('나실', '가실')]);
    expect(teamNames(loop.outside)).toEqual(['가실', '나실']);
  });
});
