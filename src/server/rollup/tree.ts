// RU-07·09·20 — 단위 나무. **누가 누구에게 내는가**를 정하는 유일한 곳이다.
//
// 상하 관계를 새로 저장하지 않는다 — `Division.parentKo`(ERP 「상위부서」)를 쓴다.
// 인원 최신화(RS)가 매주 맞춰 주는 값이라, 따로 두면 언젠가 둘이 갈라진다.
import type { Division } from '@prisma/client';
import { prisma } from '../db';

/** 최상위 단위의 상위부서 값 — 연구원 자체 */
export const ORG_ROOT_KO = '한국환경연구원';

export type TreeDivision = Pick<
  Division,
  'id' | 'slug' | 'nameKo' | 'parentKo' | 'isActive' | 'rollupOrder' | 'rollupSelf' | 'rollupPageBreak' | 'boardStatus' | 'createdAt'
>;

export interface RollupNode {
  /** 최상위 단위 — 본부 또는 본부 밖 단위 */
  node: TreeDivision;
  /** 이어 붙일 단위들, **순서대로** (RU-20). 본부 자신이 쓰면 그것도 들어간다 (RU-05·08) */
  contributors: TreeDivision[];
  /** RU-07 — 기여 단위가 둘 이상일 때만 본부 단계가 있다 */
  hasHqStep: boolean;
}

export interface OrgTree {
  /** 전사 순서대로 — 기여 단위가 하나라도 있는 최상위 단위만 */
  nodes: RollupNode[];
  /** 취합게시판으로 내는데(boardStatus=confirmed) 아직 Tincase를 안 쓰는 단위 — 총괄이 따로 챙길 곳 */
  offline: TreeDivision[];
}

export function parseOrder(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * RU-20 — 저장된 순서를 먼저, 목록에 없는 것은 **등록(ERP) 순서**로 뒤에.
 * 새로 켠 실이 순서 목록에 없다고 사라지면 안 된다. 없어진 id는 조용히 건너뛴다.
 */
export function applyOrder<T extends { id: string; createdAt: Date }>(items: readonly T[], order: readonly string[]): T[] {
  const byErp = [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const rank = new Map(order.map((id, i) => [id, i]));
  const placed = byErp.filter((d) => rank.has(d.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...placed, ...byErp.filter((d) => !rank.has(d.id))];
}

/** 이 부서의 최상위 단위 — 상위부서를 따라 올라간다. 고리가 있으면 자기 자신 */
function topOf(d: TreeDivision, byName: Map<string, TreeDivision>): TreeDivision {
  let cur = d;
  const seen = new Set<string>();
  while (cur.parentKo !== ORG_ROOT_KO && byName.has(cur.parentKo) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byName.get(cur.parentKo)!;
  }
  return cur;
}

/** 순수 함수 — DB 없이 시험할 수 있게 */
export function buildTree(divisions: readonly TreeDivision[], orgOrder: readonly string[]): OrgTree {
  const byName = new Map(divisions.map((d) => [d.nameKo, d]));
  const groups = new Map<string, { node: TreeDivision; members: TreeDivision[] }>();
  for (const d of divisions) {
    const top = topOf(d, byName);
    const g = groups.get(top.id) ?? { node: top, members: [] };
    groups.set(top.id, g);
    // 쓰는 단위만 기여한다. 본부 자신은 rollupSelf가 켜져 있을 때만 (RU-08)
    if (!d.isActive) continue;
    if (d.id === top.id && !d.rollupSelf && divisions.some((x) => x.id !== d.id && topOf(x, byName).id === d.id && x.isActive)) continue;
    g.members.push(d);
  }

  const nodes: RollupNode[] = [];
  for (const { node, members } of groups.values()) {
    if (members.length === 0) continue;
    const contributors = applyOrder(members, parseOrder(node.rollupOrder));
    nodes.push({ node, contributors, hasHqStep: contributors.length >= 2 });
  }
  const ordered = applyOrder(
    nodes.map((n) => ({ ...n, id: n.node.id, createdAt: n.node.createdAt })),
    orgOrder,
  ).map(({ node, contributors, hasHqStep }) => ({ node, contributors, hasHqStep }));

  const offline = divisions
    .filter((d) => !d.isActive && d.boardStatus === 'confirmed')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { nodes: ordered, offline };
}

const SELECT = {
  id: true,
  slug: true,
  nameKo: true,
  parentKo: true,
  isActive: true,
  rollupOrder: true,
  rollupSelf: true,
  rollupPageBreak: true,
  boardStatus: true,
  createdAt: true,
} as const;

export async function loadOrgSetting() {
  return (
    (await prisma.orgRollupSetting.findUnique({ where: { id: 'org' } })) ?? {
      id: 'org',
      order: '[]',
      note: '',
      pageBreak: true,
      enabled: false,
      unitDueMinutes: 60,
      hqDueMinutes: 120,
      updatedBy: null,
      updatedAt: new Date(0),
    }
  );
}

export async function loadTree(): Promise<OrgTree> {
  const [divisions, setting] = await Promise.all([
    prisma.division.findMany({ select: SELECT }),
    loadOrgSetting(),
  ]);
  return buildTree(divisions, parseOrder(setting.order));
}

/** 이 부서가 기여하는 최상위 단위 (없으면 null — 꺼진 부서) */
export function nodeOfContributor(tree: OrgTree, divisionId: string): RollupNode | null {
  return tree.nodes.find((n) => n.contributors.some((c) => c.id === divisionId)) ?? null;
}

/** 이 부서가 **본부 단계를 가진 본부**인가 — 그 본부 (TACP-21) */
export function hqNodeOf(tree: OrgTree, divisionId: string): RollupNode | null {
  return tree.nodes.find((n) => n.node.id === divisionId && n.hasHqStep) ?? null;
}

/**
 * RU-07 — 이 단위의 [제출]이 어디로 가는가. 본부 단계가 있으면 그 본부, 없으면 총괄.
 * 화면의 버튼 글자(「기획경영본부에 제출」 / 「총괄에 제출」)가 여기서 나온다.
 */
export function submitTarget(tree: OrgTree, divisionId: string): { kind: 'hq'; node: RollupNode } | { kind: 'org' } | null {
  const n = nodeOfContributor(tree, divisionId);
  if (!n) return null;
  return n.hasHqStep ? { kind: 'hq', node: n } : { kind: 'org' };
}
