// RU-60·65 — 전사 섹션: 순서·제목·출처. **각 섹션을 무엇으로 채우나**를 정하는 유일한 곳이다.
//
// 출처는 셋 중 하나다:
//   tincase  Tincase에서 낸 실·팀 사본(ReportSubmission). 본부 단계가 있는 본부의 실이면 **본부가 총괄에 낸 판**에
//            들어간 그 실의 사본을 쓴다 — 본부장이 검토한 것과 같은 것이 최종본에 들어간다
//   upload   총괄이 올린 파일 — 아직 Tincase를 안 쓰는 섹션(취합게시판으로 받은 것)
//   missing  아무것도 없다 → 제목 + 「미제출」 (분석 Q3 기본값)
import path from 'node:path';
import type { OrgSection, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, type Scope } from '../authz';
import { audit } from '../audit';
import { readStoredFile, sanitizeSegment, sha256, writeFileAtomic } from '../storage';
import { extractSectionBody } from '@/lib/hwp/orgdoc';
import { currentReport } from './report';
import { loadTree, type OrgTree } from './tree';

/**
 * 9월 4주차 최종본의 실제 순서(분석 §6.1) + 제목 통일안(§6.3 — AI홍보전략실·경영지원실에도 `기획경영본부(…)`).
 * 부서 이름은 공개 조직도에 있는 이름이다 (사람 이름 아님).
 */
export const DEFAULT_SECTIONS: { title: string; division: string; kind: string }[] = [
  { title: '임원실', division: '임원실', kind: 'exec' },
  { title: '글로벌대외협력단', division: '글로벌대외협력단', kind: 'global' },
  { title: '기획경영본부(기획조정실)', division: '기획조정실', kind: 'unit' },
  { title: '기획경영본부(연구관리실)', division: '연구관리실', kind: 'unit' },
  { title: '기획경영본부(AI홍보전략실)', division: 'AI홍보전략실', kind: 'unit' },
  { title: '기획경영본부(인사관리실)', division: '인사관리실', kind: 'unit' },
  { title: '기획경영본부(경영지원실)', division: '경영지원실', kind: 'unit' },
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

export type SectionSourceKind = 'tincase' | 'upload' | 'waiting_hq' | 'missing';

export interface SectionSource {
  section: OrgSection;
  kind: SectionSourceKind;
  /** 파일 자리 (STORAGE_ROOT 기준) — tincase·upload일 때 */
  filePath?: string;
  /** 화면용 — 「제출 10-07 13:52 · 담당자 이름」 등 */
  label: string;
  /** tincase: ReportSubmission.id · upload: OrgSectionUpload.id */
  refId?: string;
  /** Tincase 부서가 정해져 있으나 꺼져 있는가 — 「Tincase 밖」 */
  offline: boolean;
}

const kstShort = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

async function latestUpload(sectionId: string, weekSlotId: string) {
  return prisma.orgSectionUpload.findFirst({
    where: { sectionId, weekSlotId, withdrawnAt: null },
    orderBy: { uploadedAt: 'desc' },
  });
}

/** 본부가 총괄에 낸 판(hq 사본)을 만든 이어 붙이기에 들어간, 이 실의 사본 */
async function unitCopyInHqReport(nodeId: string, divisionId: string, slot: WeekSlot) {
  const hq = await currentReport(nodeId, slot.id, 'hq');
  if (!hq?.sourceRunId) return { hq: null, unit: null };
  const run = await prisma.rollupRun.findUnique({ where: { id: hq.sourceRunId } });
  const ids: string[] = run ? JSON.parse(run.inputIds) : [];
  const unit = await prisma.reportSubmission.findFirst({ where: { id: { in: ids }, divisionId } });
  return { hq, unit };
}

/** 섹션마다 무엇으로 채울지 — 전사 조립과 현황판이 같은 판정을 쓴다 */
export async function resolveSections(slot: WeekSlot, tree?: OrgTree): Promise<SectionSource[]> {
  const sections = (await loadSections()).filter((s) => s.isActive);
  const t = tree ?? (await loadTree());
  const names = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const out: SectionSource[] = [];
  for (const section of sections) {
    const upload = await latestUpload(section.id, slot.id);
    const node = section.divisionId
      ? t.nodes.find((n) => n.node.id === section.divisionId || n.contributors.some((c) => c.id === section.divisionId))
      : undefined;
    if (node && section.divisionId) {
      // 본부 단계가 있는 본부의 실 — 본부가 낸 판에 든 사본
      if (node.hasHqStep && node.node.id !== section.divisionId) {
        const { hq, unit } = await unitCopyInHqReport(node.node.id, section.divisionId, slot);
        if (unit) {
          out.push({ section, kind: 'tincase', filePath: unit.filePath, refId: unit.id, offline: false, label: `${node.node.nameKo} 제출 ${kstShort(hq!.submittedAt)}` });
          continue;
        }
        if (!upload) {
          out.push({ section, kind: hq ? 'missing' : 'waiting_hq', offline: false, label: hq ? `${node.node.nameKo} 본부본에 없음` : `${node.node.nameKo} 제출 전` });
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
  const existing = new Set((await prisma.orgSection.findMany({ select: { id: true } })).map((s) => s.id));
  if (list.some((s) => !existing.has(s.id)) || new Set(list.map((s) => s.id)).size !== list.length) {
    throw new HttpError(422, 'invalid_sections', '섹션 목록이 맞지 않습니다. 새로 고친 뒤 다시 시도하세요.');
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
