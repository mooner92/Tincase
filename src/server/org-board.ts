// PG-51 — 「전사」 한 화면의 표를 만든다. 섹션 하나 = 한 줄, 최종본 순서대로.
//
// 제출 열(사람이 냈나)과 최종본 열(그 섹션이 무엇으로 들어가나)을 **같은 섹션 목록**에서 만든다 —
// 두 탭이 각자 목록을 읽던 때는 같은 부서가 두 모양으로 나왔다. 열마다 그 열을 보는 사람에게만 값을 채운다(TACP-9):
// 못 보는 열은 계산도 하지 않고 내려보내지도 않는다.
import type { WeekSlot } from '@prisma/client';
import { prisma } from './db';
import { progressNodes } from './monitor';
import { resolveSections, sectionList, type SectionItem, type SectionSource } from './rollup/sections';
import { loadTree, type OrgTree } from './rollup/tree';
import { lastOrgRun } from './rollup/orgrun';
import { kst } from './rollup/view';
import { groupBySection, OUTSIDE } from '@/lib/org-groups';
import type { OrgBoardRow } from '@/components/OrgBoard';

/** 이 섹션의 부서가 본부 단계가 있는 본부에 속하나 — 그 본부 (본부 자신이거나 산하 실) */
function hqOf(tree: OrgTree, divisionId: string | null) {
  if (!divisionId) return null;
  const n = tree.nodes.find((x) => x.node.id === divisionId || x.contributors.some((c) => c.id === divisionId));
  return n?.hasHqStep ? n.node : null;
}

export async function orgBoard(
  slot: WeekSlot,
  can: { progress: boolean; desk: boolean },
  /** 지난 주차를 볼 때 링크에 붙일 `isoKey=…` (이번 주면 빈 글자) */
  weekQuery: string,
) {
  const divisions = await prisma.division.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nameKo: true, isActive: true } });
  const nameOf = new Map(divisions.map((d) => [d.id, d.nameKo]));

  // 취합을 여는 사람: 섹션마다 무엇이 들어가나(resolveSections — 섹션 목록이 비어 있으면 기본 13개를 만든다, 예전 [취합] 탭과 같다).
  // 읽기만 하는 사람: 목록을 만들지 않고 읽는다(PG-51d)
  const tree = can.desk ? await loadTree() : null;
  const sources: SectionSource[] | null = can.desk ? await resolveSections(slot, tree!) : null;
  const sections: SectionItem[] = sources
    ? sources.map(({ section: s }) => ({
        id: s.id,
        title: s.title,
        divisionId: s.divisionId,
        divisionName: s.divisionId ? (nameOf.get(s.divisionId) ?? null) : null,
        kind: s.kind,
      }))
    : await sectionList(divisions);

  const data = can.progress ? await progressNodes(slot) : null;
  const grouped = data ? groupBySection(sections, data.nodes) : null;
  const hqLink = (slug: string) => `/hq?node=${encodeURIComponent(slug)}${weekQuery ? `&${weekQuery}` : ''}`;

  const rows: OrgBoardRow[] = sections.map((s, i) => {
    const src = sources?.[i];
    const hq = tree ? hqOf(tree, s.divisionId) : null;
    return {
      key: s.id,
      no: i + 1,
      title: s.title,
      offline: !s.divisionName,
      progress: grouped ? grouped.sections[i] : null,
      final: src ? { sectionId: s.id, source: src.kind, label: src.label, refId: src.refId ?? null } : null,
      hq: hq ? { name: hq.nameKo, href: hqLink(hq.slug) } : null,
    };
  });
  // PG-51c — 집계 부서인데 어느 섹션에도 닿지 않는 곳. 숨기면 합계가 감사 문서와 갈라진다 (PG-T73)
  if (grouped && grouped.outside.teams.length > 0) {
    rows.push({ key: 'outside', no: null, title: OUTSIDE, offline: false, progress: grouped.outside, final: null, hq: null });
  }

  const all = grouped ? [...grouped.sections, grouped.outside] : null;
  const run = sources ? await lastOrgRun(slot, sources) : null;
  return {
    rows,
    /** 제출 합계 — 섹션과 「섹션 밖」을 더한 것 = 감사 문서의 합계 */
    totals: all && {
      submitted: all.reduce((n, g) => n + g.submitted, 0),
      roster: all.reduce((n, g) => n + g.roster, 0),
      missing: all.flatMap((g) => g.missing),
    },
    excludedNote: data?.excludedNote ?? null,
    capturedAtKst: data?.capturedAtKst ?? null,
    /** 최종본에 들어올 것이 있는 섹션 수 (취합을 여는 사람에게만) */
    ready: sources ? sources.filter((x) => x.kind === 'tincase' || x.kind === 'upload').length : null,
    run: run && { ...run, finishedAtKst: kst(run.finishedAt) },
    /** 섹션 구성 편집기에 넘길 것 (취합을 여는 사람에게만) */
    editor: sources && {
      sections: sections.map((s) => ({ id: s.id, title: s.title, divisionId: s.divisionId })),
      divisions,
    },
  };
}
