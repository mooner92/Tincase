// 조직 트리 레이아웃 — 방사형 덴드로그램 (순수 계산, 외부 의존성 없음).
//
// 337명을 한 화면에 놓아야 한다. 세로 트리는 세로로 337칸이 필요해 스크롤 없이는 불가능하고,
// 원 둘레에 놓으면 반지름 420px 기준 한 사람당 약 7.8px가 나와 점으로 표현하기에 충분하다.
//
// 계층: 한국환경연구원 → 본부(7) → 실(30) → 사람(337)
//
// 라이브러리를 쓰지 않는 이유: 계산이 20줄이고, 사내망 배포에 CDN을 쓸 수 없으며,
// 우리가 원하는 건 범용 그래프가 아니라 **이 조직 하나**를 잘 보여주는 그림이기 때문이다.

export interface PersonNode {
  id: string;
  name: string;
  submitted: boolean;
  isLead: boolean;
  onRoster: boolean;
  submittedAtKst: string | null;
}

export interface DivisionNode {
  id: string;
  name: string;
  slug: string;
  parent: string;
  isActive: boolean;
  people: PersonNode[];
}

export interface LaidOutPerson extends PersonNode {
  angle: number;
  x: number;
  y: number;
}

export interface LaidOutDivision extends DivisionNode {
  angle: number;
  x: number;
  y: number;
  submitted: number;
  roster: number;
  laidOut: LaidOutPerson[];
}

export interface LaidOutParent {
  name: string;
  angle: number;
  x: number;
  y: number;
  submitted: number;
  roster: number;
  divisions: LaidOutDivision[];
}

export interface OrgLayout {
  parents: LaidOutParent[];
  divisions: LaidOutDivision[];
  people: LaidOutPerson[];
  totals: { submitted: number; roster: number; divisions: number; activeDivisions: number };
  radii: { parent: number; division: number; person: number };
}

/** 각도 → 좌표. 12시 방향에서 시계 방향으로 (사람이 시계를 읽는 방향) */
function polar(angle: number, r: number): { x: number; y: number } {
  const a = angle - Math.PI / 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export const RADII = { parent: 150, division: 275, person: 420 } as const;

/**
 * 잎(사람)에 균등하게 각도를 주고, 부모는 자식들의 평균 각도에 놓는다.
 * 이 규칙 하나로 "같은 부서 사람은 서로 붙어 있고, 부서는 자기 사람들 한가운데 있다"가 보장된다.
 */
export function layoutOrg(divisions: DivisionNode[], gapRatio = 0.35): OrgLayout {
  // 본부 → 실 순서를 고정한다 (매주 그림이 흔들리면 비교가 안 된다)
  const byParent = new Map<string, DivisionNode[]>();
  for (const d of divisions) {
    const list = byParent.get(d.parent);
    if (list) list.push(d);
    else byParent.set(d.parent, [d]);
  }

  // 사람이 있는 부서만 각도를 차지한다 (빈 부서가 여백을 먹으면 밀도가 균일하지 않다)
  const totalPeople = divisions.reduce((n, d) => n + d.people.length, 0);
  // 부서 사이에 사람 1명 몫의 gapRatio만큼 간격을 둔다 — 경계가 눈에 보여야 한다
  const gaps = divisions.filter((d) => d.people.length > 0).length;
  const unit = (Math.PI * 2) / (totalPeople + gaps * gapRatio);

  const laidDivisions: LaidOutDivision[] = [];
  const laidPeople: LaidOutPerson[] = [];
  const laidParents: LaidOutParent[] = [];

  let cursor = 0;
  for (const [parentName, group] of byParent) {
    const parentDivs: LaidOutDivision[] = [];

    for (const d of group) {
      if (d.people.length === 0) continue;
      const people: LaidOutPerson[] = d.people.map((p, i) => {
        const angle = (cursor + i + 0.5) * unit;
        return { ...p, angle, ...polar(angle, RADII.person) };
      });
      cursor += d.people.length + gapRatio;

      const angle = (people[0].angle + people[people.length - 1].angle) / 2;
      const div: LaidOutDivision = {
        ...d,
        angle,
        ...polar(angle, RADII.division),
        submitted: people.filter((p) => p.submitted).length,
        roster: people.filter((p) => p.onRoster).length,
        laidOut: people,
      };
      parentDivs.push(div);
      laidDivisions.push(div);
      laidPeople.push(...people);
    }

    if (parentDivs.length === 0) continue;
    const angle = (parentDivs[0].angle + parentDivs[parentDivs.length - 1].angle) / 2;
    laidParents.push({
      name: parentName,
      angle,
      ...polar(angle, RADII.parent),
      submitted: parentDivs.reduce((n, d) => n + d.submitted, 0),
      roster: parentDivs.reduce((n, d) => n + d.roster, 0),
      divisions: parentDivs,
    });
  }

  return {
    parents: laidParents,
    divisions: laidDivisions,
    people: laidPeople,
    totals: {
      submitted: laidPeople.filter((p) => p.submitted).length,
      roster: laidPeople.filter((p) => p.onRoster).length,
      divisions: divisions.length,
      activeDivisions: divisions.filter((d) => d.isActive).length,
    },
    radii: { ...RADII },
  };
}

/**
 * 곡선 간선 — 두 점을 원 중심 쪽으로 휘게 잇는다.
 * 직선으로 이으면 337개가 별 모양으로 교차해 어디서 어디로 가는지 안 보인다.
 * 부모 각도로 한 번 꺾어 주면 같은 부서 선들이 다발로 묶여 보인다.
 */
export function bundledPath(fromAngle: number, fromR: number, toAngle: number, toR: number): string {
  const a = polar(fromAngle, fromR);
  const b = polar(toAngle, toR);
  const midR = (fromR + toR) / 2;
  const c1 = polar(fromAngle, midR);
  const c2 = polar(toAngle, midR);
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}
