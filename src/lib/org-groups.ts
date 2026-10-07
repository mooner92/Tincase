// PG-51 — 「전사」 화면의 제출 현황을 **최종본 섹션**으로 묶는다. 상하 관계는 ERP 「상위부서」(parentKo)다.
//
// 2026-10-07 전에는 [현황] 탭이 본부별로 묶었고(PG-50b), [취합] 탭이 같은 부서를 섹션 순서로 한 번 더
// 보여 주었다 — 같은 부서가 두 모양으로 두 번. 한 화면으로 합치면서(PG-49f) 묶는 기준을 섹션 하나로 줄였다.
//
// 부서 → 섹션: 자기 자신부터 상위부서를 따라 올라가며 **가장 가까운** 섹션의 부서에 붙는다 — 기획조정실은 자기 섹션에,
// 본부·센터 산하 실은 그 본부 섹션에. 어느 섹션에도 닿지 않는 집계 부서는 「섹션 밖」에 모은다 — 빼 버리면
// 화면의 합계가 감사 문서(OPS-30)와 갈라진다 ([PG-T73]).
import type { DivisionNode } from './orgtree';

export const ORG_ROOT = '한국환경연구원';
export const OUTSIDE = '섹션 밖';

export interface TeamProgress {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  roster: number;
  submitted: number;
  /** 명단 안에서 아직 안 낸 사람 */
  missing: string[];
}

/** 섹션 하나(또는 「섹션 밖」)의 제출 현황. 숫자·이름은 Tincase를 쓰는 팀만 센다 — 미사용 팀은 게시판으로 낸다 */
export interface SectionProgress {
  teams: TeamProgress[];
  roster: number;
  submitted: number;
  missing: string[];
}

function teamOf(d: DivisionNode): TeamProgress {
  const roster = d.people.filter((p) => p.onRoster);
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    isActive: d.isActive,
    roster: roster.length,
    submitted: roster.filter((p) => p.submitted).length,
    missing: roster.filter((p) => !p.submitted).map((p) => p.name),
  };
}

const empty = (): SectionProgress => ({ teams: [], roster: 0, submitted: 0, missing: [] });

/**
 * 집계 대상 부서(`counted`)를 섹션에 붙인다. 섹션 순서·팀 순서는 들어온 순서 그대로.
 *
 * 섹션은 **부서 이름**으로 맞춘다 — 상위 본부에 부서 행이 없어도(ERP 상위부서 이름만 안다) 그 이름의 섹션이
 * 있으면 산하가 거기 붙는다(PG-50b와 같은 이유). 같은 부서를 가리키는 섹션이 여럿이면 앞 섹션에만 — 두 번 세지 않는다.
 * 올라가는 길에는 **모든 부서**를 본다 — 본부 자체는 집계 대상이 아니어도 산하 실은 그 본부 섹션에 붙어야 한다.
 */
export function groupBySection(
  sections: readonly { divisionName: string | null }[],
  all: readonly DivisionNode[],
): { sections: SectionProgress[]; outside: SectionProgress } {
  const byName = new Map(all.map((d) => [d.name, d]));
  const sectionOf = new Map<string, number>();
  sections.forEach((s, i) => {
    if (s.divisionName && !sectionOf.has(s.divisionName)) sectionOf.set(s.divisionName, i);
  });
  const out = sections.map(empty);
  const outside = empty();
  for (const d of all) {
    if (!d.counted) continue;
    // 자기 → 상위 → … 연구원 바로 아래까지. 고리가 있으면 멈춘다
    let name: string | undefined = d.name;
    let hit: number | undefined;
    const seen = new Set<string>();
    while (name !== undefined && name !== ORG_ROOT && !seen.has(name)) {
      seen.add(name);
      hit = sectionOf.get(name);
      if (hit !== undefined) break;
      name = byName.get(name)?.parent;
    }
    const g = hit === undefined ? outside : out[hit];
    const t = teamOf(d);
    g.teams.push(t);
    if (t.isActive) {
      g.roster += t.roster;
      g.submitted += t.submitted;
      g.missing.push(...t.missing);
    }
  }
  return { sections: out, outside };
}
