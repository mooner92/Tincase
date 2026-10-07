// RU-60·65 — 전사 섹션: 순서·제목·출처. **각 섹션을 무엇으로 채우나**를 정하는 유일한 곳이다.
//
// 출처는 셋 중 하나다:
//   tincase  Tincase에서 낸 실·팀 사본(ReportSubmission). 본부 단계가 있는 본부의 실이면 **본부가 총괄에 낸 판**에
//            들어간 그 실의 사본을 쓴다 — 본부장이 검토한 것과 같은 것이 최종본에 들어간다
//   upload   총괄이 올린 파일 — 아직 Tincase를 안 쓰는 섹션(취합게시판으로 받은 것)
//   missing  아무것도 없다 → 제목 + 「미제출」 (분석 Q3 기본값)
// 화면에는 둘이 더 있다(조립에는 미제출과 같다): waiting_hq(본부가 아직 총괄에 안 냄) · not_in_hq(실은 냈는데 본부본에 없음)
import path from 'node:path';
import type { OrgSection, ReportSubmission, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, type Scope } from '../authz';
import { audit } from '../audit';
import { readStoredFile, sanitizeSegment, sha256, writeFileAtomic } from '../storage';
import { extractSectionBody } from '@/lib/hwp/orgdoc';
import { currentReport } from './report';
import { loadTree, parseOrder, type OrgTree } from './tree';

/**
 * 9월 4주차 최종본의 실제 순서(분석 §6.1) + 제목 통일안(§6.3 — AI홍보전략실에도 `기획경영본부(…)`).
 * 경영지원실만 접두 없이 `경영지원실`이다(RU-61) — 실제 최종본이 그렇게 쓴다(2026-10-07 실측). 통일안대로 붙이면
 * 총괄이 매주 받는 최종본과 제목이 갈라진다. 이미 만들어진 섹션 목록은 바뀌지 않는다 — 처음 만들 때의 기본값일 뿐이다.
 * 부서 이름은 공개 조직도에 있는 이름이다 (사람 이름 아님).
 */
export const DEFAULT_SECTIONS: { title: string; division: string; kind: string }[] = [
  { title: '임원실', division: '임원실', kind: 'exec' },
  { title: '글로벌대외협력단', division: '글로벌대외협력단', kind: 'global' },
  { title: '기획경영본부(기획조정실)', division: '기획조정실', kind: 'unit' },
  { title: '기획경영본부(연구관리실)', division: '연구관리실', kind: 'unit' },
  { title: '기획경영본부(AI홍보전략실)', division: 'AI홍보전략실', kind: 'unit' },
  { title: '기획경영본부(인사관리실)', division: '인사관리실', kind: 'unit' },
  { title: '경영지원실', division: '경영지원실', kind: 'unit' },
  { title: '기후대기전략연구본부', division: '기후대기전략연구본부', kind: 'hq' },
  { title: '생활환경연구본부', division: '생활환경연구본부', kind: 'hq' },
  { title: '국토환경연구본부', division: '국토환경연구본부', kind: 'hq' },
  { title: '환경평가본부', division: '환경평가본부', kind: 'eval' },
  { title: '국가기후위기적응센터', division: '국가기후위기적응센터', kind: 'hq' },
  { title: '국가지속가능발전연구센터', division: '국가지속가능발전연구센터', kind: 'hq' },
];

/** 섹션 목록 — 비어 있으면 기본 13개를 만든다(부서는 이름으로 찾는다) */
export async function loadSections(): Promise<OrgSection[]> {
  const have = await prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' } });
  if (have.length) return have;
  const divisions = await prisma.division.findMany({ select: { id: true, nameKo: true } });
  const byName = new Map(divisions.map((d) => [d.nameKo, d.id]));
  await prisma.orgSection.createMany({
    data: DEFAULT_SECTIONS.map((s, i) => ({ sortOrder: (i + 1) * 10, title: s.title, kind: s.kind, divisionId: byName.get(s.division) ?? null })),
  });
  return prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' } });
}

/**
 * RU-61 · RU-10 — 부서 → 섹션 제목. 본부 이어 붙이기도 전사와 **같은 제목**을 단다 — 본부장이 검토한 문서와
 * 최종본의 섹션 제목이 갈라지지 않게(`기획경영본부(기획조정실)`). 섹션이 없는 부서는 부서 이름.
 *
 * loadSections와 달리 섹션 목록을 **만들지 않는다**: 본부의 [이어 붙이기]가 총괄의 섹션 설정을 건드리면 안 된다.
 * 목록이 아직 비어 있으면 기본 13개를 이름으로 맞춰 본다 — 총괄이 처음 열 때 loadSections가 만들 제목과 같다.
 * 같은 부서를 가리키는 섹션이 여럿이면 켜진 것 → 앞 순서.
 */
export async function sectionTitles(divisions: readonly { id: string; nameKo: string }[]): Promise<Map<string, string>> {
  const rows = await prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' }, select: { divisionId: true, title: true, isActive: true } });
  const byDivision = new Map<string, string>();
  for (const s of [...rows.filter((r) => r.isActive), ...rows.filter((r) => !r.isActive)]) {
    if (s.divisionId && !byDivision.has(s.divisionId)) byDivision.set(s.divisionId, s.title);
  }
  return new Map(
    divisions.map((d) => [
      d.id,
      (rows.length ? byDivision.get(d.id) : DEFAULT_SECTIONS.find((s) => s.division === d.nameKo)?.title) ?? d.nameKo,
    ]),
  );
}

/** 「전사」 화면의 한 줄이 가리키는 섹션 — 저장된 OrgSection이거나, 아직 없으면 기본 13개 중 하나 */
export interface SectionItem {
  /** OrgSection.id — 기본 목록에서 온 것은 `default-n` (저장된 행이 아니다) */
  id: string;
  title: string;
  divisionId: string | null;
  /** 섹션을 채우는 부서의 이름. 부서 행이 없어도 기본 목록이면 이름은 안다 — 제출 현황을 이름으로 맞춘다 (PG-51c) */
  divisionName: string | null;
  kind: string;
}

/**
 * PG-51d — 화면용 섹션 목록, **읽기만**. 켜진 것만, 최종본 순서대로.
 *
 * loadSections와 달리 목록을 **만들지 않는다**: 3단계가 꺼져 있어 취합을 못 여는 총괄이 화면을 여는 것(GET)만으로
 * 섹션 설정이 생기면 안 된다(sectionTitles와 같은 이유). 비어 있으면 기본 13개를 부서 이름으로 맞춰 보여 준다 —
 * 취합을 처음 여는 사람에게 loadSections가 만들어 줄 목록과 같은 순서다.
 */
export async function sectionList(divisions: readonly { id: string; nameKo: string }[]): Promise<SectionItem[]> {
  const rows = await prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' } });
  const nameOf = new Map(divisions.map((d) => [d.id, d.nameKo]));
  if (rows.length) {
    return rows
      .filter((r) => r.isActive)
      .map((r) => ({ id: r.id, title: r.title, divisionId: r.divisionId, divisionName: r.divisionId ? (nameOf.get(r.divisionId) ?? null) : null, kind: r.kind }));
  }
  const idOf = new Map(divisions.map((d) => [d.nameKo, d.id]));
  return DEFAULT_SECTIONS.map((s, i) => ({ id: `default-${i + 1}`, title: s.title, divisionId: idOf.get(s.division) ?? null, divisionName: s.division, kind: s.kind }));
}

export type SectionSourceKind = 'tincase' | 'upload' | 'waiting_hq' | 'not_in_hq' | 'missing';

/** 섹션을 이루는 사본 하나 — 본부본에 붙어 있던 제목 그대로 (RU-67) */
export interface SectionPart {
  title: string;
  filePath: string;
  /** ReportSubmission.id (실·팀 사본) */
  refId: string;
}

export interface SectionSource {
  section: OrgSection;
  kind: SectionSourceKind;
  /** 파일 자리 (STORAGE_ROOT 기준) — tincase·upload일 때. parts가 있으면 그 첫 사본 */
  filePath?: string;
  /** 화면용 — 「제출 10-07 13:52 · 담당자 이름」 등 */
  label: string;
  /** tincase: ReportSubmission.id(사본이 여럿이면 본부본) · upload: OrgSectionUpload.id */
  refId?: string;
  /** Tincase 부서가 정해져 있으나 꺼져 있는가 — 「Tincase 밖」 */
  offline: boolean;
  /**
   * RU-67 — 본부 단계가 있는 본부 **자신의** 섹션에만 있다: 본부본에서 다른 섹션이 가져가지 않은 사본들, 붙인 순서대로.
   * 섹션 하나가 사본 여럿이 될 수 있는 곳은 여기뿐이다 — 조립은 사본마다 제목 하나씩 (orgrun.ts)
   */
  parts?: SectionPart[];
}

const kstShort = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

async function latestUpload(sectionId: string, weekSlotId: string) {
  return prisma.orgSectionUpload.findFirst({
    where: { sectionId, weekSlotId, withdrawnAt: null },
    orderBy: { uploadedAt: 'desc' },
  });
}

type CopyWithDivision = ReportSubmission & { division: { id: string; nameKo: string } };

/**
 * 본부가 총괄에 낸 판(hq 사본)과, 그 판을 만든 이어 붙이기에 들어간 실·팀 사본들 — **붙인 순서대로**.
 * 지난 자료 적재처럼 만든 실행이 없는 본부본은 「아직 안 냄」과 같게 본다(예전과 같다).
 */
async function hqCopies(nodeId: string, slot: WeekSlot): Promise<{ hq: ReportSubmission | null; copies: CopyWithDivision[] }> {
  const hq = await currentReport(nodeId, slot.id, 'hq');
  if (!hq?.sourceRunId) return { hq: null, copies: [] };
  const run = await prisma.rollupRun.findUnique({ where: { id: hq.sourceRunId }, select: { inputIds: true } });
  const ids = parseOrder(run?.inputIds);
  const rows = await prisma.reportSubmission.findMany({
    where: { id: { in: ids } },
    include: { division: { select: { id: true, nameKo: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { hq, copies: ids.map((id) => byId.get(id)).filter((r): r is CopyWithDivision => !!r) };
}

/** 섹션마다 무엇으로 채울지 — 전사 조립과 현황판이 같은 판정을 쓴다 */
export async function resolveSections(slot: WeekSlot, tree?: OrgTree): Promise<SectionSource[]> {
  const sections = (await loadSections()).filter((s) => s.isActive);
  const t = tree ?? (await loadTree());
  const names = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // RU-67 — 켜진 섹션이 가리키는 부서. 본부 자신의 섹션은 여기 없는 부서의 사본을 「남은 것」으로 가져간다
  const claimed = new Set(sections.map((s) => s.divisionId).filter((id): id is string => !!id));
  const hqCache = new Map<string, ReturnType<typeof hqCopies>>();
  const copiesOf = (nodeId: string) => {
    if (!hqCache.has(nodeId)) hqCache.set(nodeId, hqCopies(nodeId, slot));
    return hqCache.get(nodeId)!;
  };
  const out: SectionSource[] = [];
  for (const section of sections) {
    const upload = await latestUpload(section.id, slot.id);
    const node = section.divisionId
      ? t.nodes.find((n) => n.node.id === section.divisionId || n.contributors.some((c) => c.id === section.divisionId))
      : undefined;
    if (node && section.divisionId) {
      if (node.hasHqStep) {
        // 본부 단계가 있는 본부 — 본부가 낸 판에 든 사본. 실의 섹션은 그 실의 것, 본부 자신의 섹션은 남은 것 전부 (RU-67).
        // 예전에는 본부 자신의 섹션이 아래 「본부 단계 없음」으로 빠져 본부의 실·팀 사본 하나만 집었다 — 본부본에 든 실의 것이 경고 없이 사라졌다
        const { hq, copies } = await copiesOf(node.node.id);
        const own = node.node.id === section.divisionId;
        const mine = copies.filter((c) => c.divisionId === section.divisionId || (own && !claimed.has(c.divisionId)));
        if (hq && mine.length) {
          const at = `${node.node.nameKo} 제출 ${kstShort(hq.submittedAt)}`;
          if (!own) {
            out.push({ section, kind: 'tincase', filePath: mine[0].filePath, refId: mine[0].id, offline: false, label: at });
            continue;
          }
          // 사본마다 본부본에 붙어 있던 제목 그대로 — 본부장이 검토한 꼴이 최종본의 꼴이다 (RU-11)
          const titles = await sectionTitles(mine.map((c) => c.division));
          const parts = mine.map((c) => ({ title: titles.get(c.divisionId) ?? c.division.nameKo, filePath: c.filePath, refId: c.id }));
          out.push({
            section,
            kind: 'tincase',
            filePath: parts[0].filePath,
            // 받기는 사본이 하나면 그 사본, 여럿이면 본부가 낸 본부본 그대로
            refId: parts.length === 1 ? parts[0].refId : hq.id,
            offline: false,
            label: parts.length > 1 ? `${at} · ${parts.length}개 단위` : at,
            parts,
          });
          continue;
        }
        if (!upload) {
          if (!hq) {
            out.push({ section, kind: 'waiting_hq', offline: false, label: `${node.node.nameKo} 제출 전` });
            continue;
          }
          // 본부본은 왔는데 이 부서가 없다. 이 부서가 본부에 냈다면 본부가 다시 이어 붙여 내야 한다 —
          // 회색 「미제출」로 두면 낸 실이 안 낸 것처럼 보이고, 총괄은 고칠 곳(본부)을 모른다 (RU-32)
          const sent = await currentReport(section.divisionId, slot.id, 'unit');
          out.push(
            sent
              ? { section, kind: 'not_in_hq', offline: false, label: `${node.node.nameKo}에서 다시 이어 붙여야 합니다` }
              : { section, kind: 'missing', offline: false, label: '미제출' },
          );
          continue;
        }
      } else {
        // 본부 단계가 없다 — 그 단위의 [제출]이 곧 총괄로 (RU-07)
        const sender = node.node.id === section.divisionId && node.contributors.length === 1 ? node.contributors[0] : t.nodes.flatMap((n) => n.contributors).find((c) => c.id === section.divisionId);
        const r = sender ? await currentReport(sender.id, slot.id, 'unit') : null;
        if (r) {
          out.push({ section, kind: 'tincase', filePath: r.filePath, refId: r.id, offline: false, label: `제출 ${kstShort(r.submittedAt)} · ${names.get(r.submittedBy) ?? ''}`.trim() });
          continue;
        }
      }
    }
    if (upload) {
      out.push({ section, kind: 'upload', filePath: upload.filePath, refId: upload.id, offline: !node, label: `총괄 업로드 ${kstShort(upload.uploadedAt)} · ${upload.originalName}` });
      continue;
    }
    out.push({ section, kind: 'missing', offline: !node, label: node ? '미제출' : 'Tincase 밖 — 게시판 파일을 올려 주세요' });
  }
  return out;
}

/**
 * RU-64 「누락」 — 총괄에 **도착한** 사본 중 어느 섹션에도 들어가지 않는 것. 본부본에 든 실·팀 사본과,
 * 본부 단계 없이 바로 낸 단위의 사본을 본다. 섹션 구성에 그 부서가 없으면 최종본에서 **조용히** 빠진다 —
 * 본부장이 승인한 본부본의 일부가 NAMS 제출본에 없는데 아무도 모른다. 그래서 「전사」 화면과 만들기 결과에 경고로 남긴다.
 */
export async function uncoveredCopies(slot: WeekSlot, sources: readonly SectionSource[], tree?: OrgTree): Promise<string[]> {
  const t = tree ?? (await loadTree());
  const used = new Set(sources.flatMap((s) => [s.refId, ...(s.parts ?? []).map((p) => p.refId)]).filter((id): id is string => !!id));
  const fix = '[섹션 구성 편집]에서 부서를 정해 주세요';
  const out: string[] = [];
  for (const n of t.nodes) {
    if (n.hasHqStep) {
      const { copies } = await hqCopies(n.node.id, slot);
      for (const c of copies.filter((x) => !used.has(x.id))) {
        out.push(`「${c.division.nameKo}」 사본이 어느 섹션에도 없어 최종본에서 빠집니다(${n.node.nameKo} 본부본) — ${fix}`);
      }
      continue;
    }
    const r = await currentReport(n.contributors[0].id, slot.id, 'unit');
    if (r && !used.has(r.id)) out.push(`「${n.contributors[0].nameKo}」 제출본이 어느 섹션에도 없어 최종본에서 빠집니다 — ${fix}`);
  }
  return out;
}

/** RU-60 — 총괄이 게시판으로 받은 섹션 파일을 올린다. 섹션 본문을 실제로 골라낼 수 있는지 먼저 본다 */
export async function uploadSectionFile(scope: Scope, sectionId: string, slot: WeekSlot, bytes: Buffer, originalName: string) {
  const section = await prisma.orgSection.findUnique({ where: { id: sectionId } });
  if (!section) throw new HttpError(404, 'not_found', '섹션을 찾을 수 없습니다.');
  if (!/\.hwp$/i.test(originalName)) throw new HttpError(422, 'invalid_file', '한글(.hwp) 파일만 올릴 수 있습니다. .hwpx는 한글에서 .hwp로 저장해 주세요.');
  try {
    extractSectionBody(bytes);
  } catch (e) {
    throw new HttpError(422, 'invalid_file', `이 파일에서 본문(표)을 찾지 못했습니다 — ${(e as Error).message}`);
  }
  const digest = sha256(bytes);
  const rel = path.join('org', 'sections', String(slot.year), sanitizeSegment(slot.label.replace(/ /g, '_')), `${sanitizeSegment(section.id)}_${digest.slice(0, 12)}.hwp`);
  await writeFileAtomic(rel, bytes);
  const row = await prisma.orgSectionUpload.create({
    data: { sectionId, weekSlotId: slot.id, filePath: rel, originalName: originalName.slice(0, 200), sha256: digest, byteSize: bytes.length, uploadedBy: scope.user.id },
  });
  await audit(scope.user.email, 'rollup', null, `org-section:${section.id}`, { action: 'upload', title: section.title, isoKey: slot.isoKey, sha256: digest });
  return row;
}

export async function withdrawSectionFile(scope: Scope, uploadId: string) {
  const u = await prisma.orgSectionUpload.findUnique({ where: { id: uploadId } });
  if (!u) throw new HttpError(404, 'not_found', '올린 파일을 찾을 수 없습니다.');
  await prisma.orgSectionUpload.update({ where: { id: u.id }, data: { withdrawnAt: new Date() } });
  await audit(scope.user.email, 'rollup', null, `org-section:${u.sectionId}`, { action: 'withdraw_upload', upload: u.id });
}

/** 섹션 설정 저장 — 순서·제목·부서·사용 */
export async function saveSections(
  scope: Scope,
  list: { id: string; title: string; divisionId: string | null; isActive: boolean }[],
) {
  const rows = await prisma.orgSection.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, divisionId: true, isActive: true } });
  const existing = new Set(rows.map((s) => s.id));
  if (list.some((s) => !existing.has(s.id)) || new Set(list.map((s) => s.id)).size !== list.length) {
    throw new HttpError(422, 'invalid_sections', '섹션 목록이 맞지 않습니다. 새로 고친 뒤 다시 시도하세요.');
  }
  // RU-60 · RU-64 「중복」 — 켜진 섹션 둘이 같은 부서를 가리키면 같은 사본이 최종본에 두 번 들어간다. 저장 뒤 모습으로 본다
  // (목록에 없는 켜진 섹션도 그대로 남으므로 함께 센다). 어느 부서·어느 섹션인지 말해야 편집기에서 바로 고친다
  const after = new Map(rows.map((r) => [r.id, r]));
  for (const s of list) after.set(s.id, { id: s.id, title: s.title.trim(), divisionId: s.divisionId || null, isActive: s.isActive });
  const byDivision = new Map<string, string[]>();
  for (const r of after.values()) {
    if (r.isActive && r.divisionId) byDivision.set(r.divisionId, [...(byDivision.get(r.divisionId) ?? []), r.title]);
  }
  const dups = [...byDivision].filter(([, titles]) => titles.length > 1);
  if (dups.length) {
    const nameOf = new Map(
      (await prisma.division.findMany({ where: { id: { in: dups.map(([id]) => id) } }, select: { id: true, nameKo: true } })).map((d) => [d.id, d.nameKo]),
    );
    const what = dups.map(([id, titles]) => `${nameOf.get(id) ?? '알 수 없는 부서'}(${titles.map((t) => `「${t}」`).join('·')})`).join(', ');
    throw new HttpError(422, 'duplicate_division', `한 부서는 한 섹션에만 둘 수 있습니다 — ${what}`);
  }
  for (const [i, s] of list.entries()) {
    const title = s.title.trim().slice(0, 60);
    if (!title) throw new HttpError(422, 'invalid_sections', '제목이 빈 섹션이 있습니다.');
    await prisma.orgSection.update({ where: { id: s.id }, data: { sortOrder: (i + 1) * 10, title, divisionId: s.divisionId || null, isActive: s.isActive } });
  }
  await audit(scope.user.email, 'rollup_order', null, 'org:sections', { count: list.length });
}

/** 파일 읽기 — 조립용 */
export async function sourceBytes(s: SectionSource): Promise<Buffer | null> {
  return s.filePath ? readStoredFile(s.filePath) : null;
}
