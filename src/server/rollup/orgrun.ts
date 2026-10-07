// RU-60~65 — 전사 취합본 만들기 (총괄 「딸깍」). 섹션 출처를 정하고(sections.ts) 실제 최종본 꼴로 조립한다(orgdoc.ts).
//
// 본부 단계의 이어 붙이기(rollup.ts)와 달리 섹션을 **원래 꼴 그대로** 옮긴다 — 본부·센터형 6열 표가 섞여 있기 때문이다.
import path from 'node:path';
import type { RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, type Scope } from '../authz';
import { logger } from '../logger';
import { readStoredFile, sanitizeSegment, writeFileAtomic } from '../storage';
import { composeOrgDocument } from '@/lib/hwp/orgdoc';
import { resolveSections, type SectionSource } from './sections';

export interface OrgSectionResult {
  title: string;
  status: 'copied' | 'missing' | 'failed';
  source: SectionSource['kind'];
  label: string;
  fixed: string[];
  warnings: string[];
  dropped: string[];
  error?: string;
}

/** 「바뀜」 판정용 — 섹션마다 무엇을 썼나. 같은 열쇠면 같은 입력이다 */
export const inputKey = (s: SectionSource) => `${s.section.id}:${s.refId ?? s.kind}`;

/** 양식 — 총괄 부서의 양식(최종본과 같은 제목 문단 꼴), 없으면 전사 표준 */
async function orgTemplate(divisionId: string): Promise<Buffer> {
  const t = await prisma.template.findFirst({ where: { divisionId, isActive: true } });
  if (t) {
    try {
      return await readStoredFile(t.filePath);
    } catch {
      /* 양식 파일이 없는 부서 (OPS-41) — 표준으로 */
    }
  }
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
  if (std) return readStoredFile(std.filePath);
  throw new HttpError(409, 'no_template', '전사 취합본 양식을 찾지 못했습니다. 부서 설정에서 양식을 등록하세요.');
}

export async function runOrgDocument(scope: Scope, slot: WeekSlot): Promise<RollupRun> {
  const sources = await resolveSections(slot);
  if (!sources.some((s) => s.filePath)) throw new HttpError(409, 'nothing_submitted', '아직 들어온 섹션이 없습니다.');
  const run = await prisma.rollupRun.create({
    data: {
      level: 'org',
      divisionId: null,
      weekSlotId: slot.id,
      status: 'running',
      inputIds: JSON.stringify(sources.map(inputKey)),
      createdBy: scope.user.id,
    },
  });
  try {
    const inputs = await Promise.all(
      sources.map(async (s) => ({ title: s.section.title, source: s.filePath ? await readStoredFile(s.filePath) : null })),
    );
    const out = composeOrgDocument(await orgTemplate(scope.division.id), inputs);
    const results: OrgSectionResult[] = out.outcomes.map((o, i) => ({
      title: o.title,
      status: o.status,
      source: sources[i].kind,
      label: sources[i].label,
      fixed: o.fixed ?? [],
      warnings: o.warnings ?? [],
      dropped: o.dropped,
      error: o.error,
    }));
    const rel = path.join('org', 'rollup', String(slot.year), `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${sanitizeSegment(run.id)}.hwp`);
    await writeFileAtomic(rel, out.bytes);
    const done = await prisma.rollupRun.update({
      where: { id: run.id },
      data: { status: 'succeeded', outputPath: rel, unitsJson: JSON.stringify(results), warnings: JSON.stringify(out.warnings), finishedAt: new Date() },
    });
    await audit(scope.user.email, 'rollup', null, `rollup:${run.id}`, {
      level: 'org',
      isoKey: slot.isoKey,
      sections: results.map((r) => `${r.title}:${r.status}`),
    });
    return done;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: message, runId: run.id }, '[취합] 전사 취합본 실패');
    return prisma.rollupRun.update({ where: { id: run.id }, data: { status: 'failed', errorText: message, finishedAt: new Date() } });
  }
}

export interface OrgRunView {
  id: string;
  status: string;
  finishedAt: Date | null;
  sections: OrgSectionResult[];
  warnings: string[];
  errorText: string | null;
  /** 만든 뒤 섹션 출처가 바뀌었다 — 새로 냄·올림·취소·순서 변경 */
  stale: boolean;
}

export async function lastOrgRun(slot: WeekSlot, sources?: SectionSource[]): Promise<OrgRunView | null> {
  const run = await prisma.rollupRun.findFirst({ where: { level: 'org', weekSlotId: slot.id }, orderBy: { startedAt: 'desc' } });
  if (!run) return null;
  const now = (sources ?? (await resolveSections(slot))).map(inputKey);
  const parse = <T,>(s: string | null, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  const sections = parse<OrgSectionResult[]>(run.unitsJson, []);
  return {
    id: run.id,
    status: run.status,
    finishedAt: run.finishedAt,
    // 옛 이어 붙이기(v1)의 기록은 꼴이 다르다 — 제목이 없으면 비운다
    sections: sections.filter((x) => typeof x?.title === 'string'),
    warnings: parse<string[]>(run.warnings, []),
    errorText: run.errorText,
    stale: run.status === 'succeeded' && JSON.stringify(parse<string[]>(run.inputIds, [])) !== JSON.stringify(now),
  };
}
