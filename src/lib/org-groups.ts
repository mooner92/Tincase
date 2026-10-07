// PG-50 — 전사 현황을 **본부 → 팀**으로 묶는다. 상하 관계는 ERP 「상위부서」(parentKo)다.
//
// 6개 본부의 정확한 구성은 확인 중이다(2026-10-07). 그때까지는 ERP 그대로 묶고,
// 상위가 연구원 자체인 단위 중 산하가 없는 곳(임원실·글로벌대외협력단 등)은 「본부 밖」 한 묶음으로 둔다.
import type { DivisionNode } from './orgtree';

export const ORG_ROOT = '한국환경연구원';
export const OUTSIDE = '본부 밖';

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

export interface HqGroup {
  name: string;
  teams: TeamProgress[];
  roster: number;
  submitted: number;
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

/**
 * 집계 대상 부서만(`counted`) 묶는다. 순서는 들어온 순서(ERP 등록 순) 그대로.
 * 최상위 단위를 찾을 때는 **모든 부서**를 본다 — 본부 자체는 집계 대상이 아니어도(기후대기전략연구본부)
 * 산하 실은 그 본부 이름 아래 있어야 한다.
 */
export function groupByHq(all: readonly DivisionNode[]): HqGroup[] {
  const byName = new Map(all.map((d) => [d.name, d]));
  const topOf = (d: DivisionNode) => {
    let cur = d;
    const seen = new Set<string>();
    while (cur.parent !== ORG_ROOT && byName.has(cur.parent) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byName.get(cur.parent)!;
    }
    return cur;
  };
  const hasChildren = new Set(all.filter((d) => d.parent !== ORG_ROOT).map((d) => d.parent));

  const groups = new Map<string, HqGroup>();
  for (const d of all) {
    if (!d.counted) continue;
    const top = topOf(d);
    // 산하가 없는 최상위 단위는 본부가 아니다 — 「본부 밖」 한 묶음으로
    const key = top.id === d.id && !hasChildren.has(d.name) ? OUTSIDE : top.name;
    const g = groups.get(key) ?? { name: key, teams: [], roster: 0, submitted: 0 };
    const t = teamOf(d);
    g.teams.push(t);
    if (t.isActive) {
      g.roster += t.roster;
      g.submitted += t.submitted;
    }
    groups.set(key, g);
  }
  // 「본부 밖」은 맨 뒤 — 본부들이 먼저 읽혀야 한다
  const list = [...groups.values()];
  return [...list.filter((g) => g.name !== OUTSIDE), ...list.filter((g) => g.name === OUTSIDE)];
}
