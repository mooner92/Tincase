// RU-60~65 · RU-83 — 전사본 **조립**과 그 결과 보기. 섹션 출처를 정하고(sections.ts) 실제 최종본 꼴로 조립한다(orgdoc.ts).
//
// 섹션을 **원래 꼴 그대로** 옮긴다 — 본부·센터형 6열 표가 섞여 있기 때문이다. 본부 이어 붙이기(run.ts)도 같은 엔진이다(RU-10,
// 2026-10-07 중복 제거) — 그래서 본부장이 검토한 본부본의 섹션과 여기서 만드는 최종본의 섹션이 같은 꼴이다.
// 2026-10-08(ADR-0015)부터 전사본은 총괄이 누르지 않는다 — 섹션 출처가 바뀌면 `system`이 다시 만든다(auto.ts). 총괄은 보고 받는다.
import path from 'node:path';
import type { RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError } from '../authz';
import { logger } from '../logger';
import { readStoredFile, sanitizeSegment, sha256, writeFileAtomic } from '../storage';
import { composeOrgDocument } from '@/lib/hwp/orgdoc';
import { resolveSections, uncoveredCopies, type SectionSource } from './sections';
import { loadTree, type OrgTree } from './tree';
import { causeLabel, type BuildCause } from './run';
import { fileSha } from './report';

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

/**
 * 「바뀜」 판정용 — 섹션마다 무엇을 썼나. 같은 열쇠면 같은 입력이다.
 * 제목도 넣는다(RU-61 — 제목은 생성한다): 만든 뒤 제목만 고쳐도 받은 파일에는 옛 제목이 있다 — 전사본은 새 제목으로 다시 만든다.
 * 본부 자신의 섹션은 사본이 여럿일 수 있어(RU-67) 그 사본들을 다 넣는다 — 남은 사본이 바뀌면 다른 입력이다
 */
export const inputKey = (s: SectionSource) =>
  `${s.section.id}:${s.section.title}:${s.parts ? s.parts.map((p) => p.refId).join('+') : (s.refId ?? s.kind)}`;

/** 양식 후보 — 총괄(isCoordinator)이 있는 부서들, 등록 순서로 (RU-68) */
async function orgTemplateOwners() {
  return prisma.division.findMany({
    where: { users: { some: { isCoordinator: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
    select: { nameKo: true, templates: { where: { isActive: true }, take: 1, select: { id: true, filePath: true, version: true, sha256: true } } },
  });
}

/** RU-74 — 전사본이 쓸 양식의 표지(파일을 읽지 않는다). 입력 열쇠에 들어간다 */
export async function orgTemplateRef(): Promise<string> {
  for (const d of await orgTemplateOwners()) {
    const t = d.templates[0];
    if (t) return `div:${t.id}:${t.version}:${t.sha256}`;
  }
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' }, select: { id: true, version: true } });
  return std ? `std:${std.id}:${std.version}` : 'none';
}

/**
 * RU-68 — 전사본 양식. **누가 일으켰나와 상관없이** 총괄(isCoordinator)이 있는 부서의 양식(여럿이면 등록 순서로 앞의 것),
 * 없으면 전사 표준. 예전에는 누른 사람의 부서 양식이라 운영자가 다시 만들면 같은 입력에서 다른 전사본이 나왔다. 무엇을 썼는지 결과에 남긴다.
 */
async function orgTemplate(): Promise<{ bytes: Buffer; label: string }> {
  for (const d of await orgTemplateOwners()) {
    const t = d.templates[0];
    if (!t) continue;
    try {
      return { bytes: await readStoredFile(t.filePath), label: `${d.nameKo} 양식 v${t.version}` };
    } catch {
      /* 양식 파일이 없는 부서 (OPS-41) — 다음 후보, 그다음 표준으로 */
    }
  }
  const std = await prisma.standardTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
  if (std) return { bytes: await readStoredFile(std.filePath), label: `전사 표준 양식 v${std.version}` };
  throw new HttpError(409, 'no_template', '전사 취합본 양식을 찾지 못했습니다. 총괄 부서의 부서 설정에서 양식을 등록하세요.');
}

/** RU-74 — 전사본의 입력 열쇠. 섹션마다의 열쇠(제목 포함)와 양식 */
export function orgInputKey(sources: readonly SectionSource[], templateRef: string): string {
  return sha256(Buffer.from(JSON.stringify({ v: 1, sections: sources.map(inputKey), template: templateRef })));
}

/**
 * RU-60~64 — 전사본 한 번. 기록의 주체는 `system` + 일으킨 사건·사람(TACP-23). 실패해도 RollupRun은 남는다(`failed` + 이유).
 * 부르는 쪽(auto.ts)이 섹션 출처와 열쇠를 이미 계산했고 `org:` 잠금을 쥐고 있다.
 */
export async function composeOrg(slot: WeekSlot, tree: OrgTree, sources: SectionSource[], key: string, ctx: BuildCause): Promise<RollupRun> {
  const run = await prisma.rollupRun.create({
    data: {
      level: 'org',
      divisionId: null,
      weekSlotId: slot.id,
      status: 'running',
      inputIds: JSON.stringify(sources.map(inputKey)),
      createdBy: 'system',
      inputKey: key,
      cause: ctx.cause,
      startedAt: new Date(),
    },
  });
  try {
    // RU-64 「누락」 — 도착했는데 어느 섹션에도 안 들어가는 사본. 결과 맨 앞에 남긴다(화면은 지금 상태로 따로 본다)
    const coverage = await uncoveredCopies(slot, sources, tree);
    const template = await orgTemplate();
    // 조립은 **사본 하나 = 제목 하나**. 섹션 대부분은 사본 하나지만 본부 자신의 섹션은 여럿일 수 있다(RU-67) —
    // 결과는 다시 섹션 단위로 묶는다(화면이 「13개 섹션 중 …」으로 센다)
    const blocks = sources.flatMap((s, i) => (s.parts ?? [{ title: s.section.title, filePath: s.filePath }]).map((p) => ({ i, title: p.title, filePath: p.filePath })));
    const inputs = await Promise.all(blocks.map(async (b) => ({ title: b.title, source: b.filePath ? await readStoredFile(b.filePath) : null })));
    const out = composeOrgDocument(template.bytes, inputs);
    const results: OrgSectionResult[] = sources.map((s, i) => {
      const os = out.outcomes.filter((_, k) => blocks[k].i === i);
      // 섹션 제목과 다른 사본(본부본에 든 실)은 그 제목을 앞에 붙인다 — 어느 사본의 일인지 알아야 한글에서 찾는다
      const tag = (o: (typeof os)[number], line: string) => (o.title === s.section.title ? line : `${o.title}: ${line}`);
      const failed = os.find((o) => o.status === 'failed');
      return {
        title: s.section.title,
        status: failed ? 'failed' : os.some((o) => o.status === 'copied') ? 'copied' : 'missing',
        source: s.kind,
        label: s.label,
        fixed: os.flatMap((o) => (o.fixed ?? []).map((f) => tag(o, f))),
        warnings: os.flatMap((o) => (o.warnings ?? []).map((w) => tag(o, w))),
        dropped: os.flatMap((o) => o.dropped.map((d) => tag(o, d))),
        error: failed?.error && tag(failed, failed.error),
      };
    });
    const rel = path.join('org', 'rollup', String(slot.year), `${sanitizeSegment(slot.label.replace(/ /g, '_'))}_${sanitizeSegment(run.id)}.hwp`);
    await writeFileAtomic(rel, out.bytes);
    const units: OrgUnitsJson = { template: template.label, sections: results };
    const done = await prisma.rollupRun.update({
      where: { id: run.id },
      data: { status: 'succeeded', outputPath: rel, unitsJson: JSON.stringify(units), warnings: JSON.stringify([...coverage, ...out.warnings]), finishedAt: new Date() },
    });
    await audit('system', 'rollup', null, `rollup:${run.id}`, {
      level: 'org',
      isoKey: slot.isoKey,
      cause: ctx.cause,
      causedBy: ctx.causedBy,
      template: template.label,
      sections: results.map((r) => `${r.title}:${r.status}`),
    });
    return done;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error({ err: message, runId: run.id }, '[취합] 전사 취합본 실패');
    return prisma.rollupRun.update({ where: { id: run.id }, data: { status: 'failed', errorText: message, finishedAt: new Date() } });
  }
}

/**
 * 전사 실행의 `RollupRun.unitsJson`. 본부 실행(단위 배열)과 달리 객체다 — 섹션 결과와 **쓴 양식**(RU-68).
 * 2026-10-08 전의 기록은 섹션 배열 그대로라 읽을 때 둘 다 받는다
 */
interface OrgUnitsJson {
  template: string;
  sections: OrgSectionResult[];
}

export interface OrgRunView {
  id: string;
  status: string;
  finishedAt: Date | null;
  sections: OrgSectionResult[];
  /** RU-68 — 쓴 양식 (「기획조정실 양식 v3」). 옛 기록에는 없다 */
  template: string | null;
  /** 문서 전체의 확인할 것 — 어느 섹션에도 없는 사본(RU-64)·서식 옮기기 메모 */
  warnings: string[];
  errorText: string | null;
  /** RU-74 — 이 결과의 입력이 지금 입력과 다르다(아직 맞추지 못함). 정상이면 거짓 — 바뀌면 저절로 다시 만들어진다 */
  stale: boolean;
  /** 결과 파일의 sha — 「받은 뒤 바뀜」(RU-57a)을 내용으로 본다 */
  sha256: string | null;
  /** RU-78 — 무엇 때문에 다시 만들어졌나 */
  causeLabel: string;
}

const parse = <T,>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

async function viewOf(run: RollupRun, key: string | null): Promise<OrgRunView> {
  const units = parse<OrgSectionResult[] | Partial<OrgUnitsJson> | null>(run.unitsJson, null);
  const sections = Array.isArray(units) ? units : (units?.sections ?? []);
  return {
    id: run.id,
    status: run.status,
    finishedAt: run.finishedAt,
    // 옛 이어 붙이기(v1)의 기록은 꼴이 다르다 — 제목이 없으면 비운다
    sections: sections.filter((x) => typeof x?.title === 'string'),
    template: !Array.isArray(units) && typeof units?.template === 'string' ? units.template : null,
    warnings: parse<string[]>(run.warnings, []),
    errorText: run.errorText,
    stale: key !== null && run.inputKey !== key,
    sha256: run.status === 'succeeded' ? await fileSha(run.outputPath) : null,
    causeLabel: await causeLabel(run.cause),
  };
}

/** 지금 입력의 열쇠 — 화면의 「아직 맞추지 못함」 판정용 */
export async function currentOrgKey(slot: WeekSlot, sources?: SectionSource[]): Promise<string> {
  return orgInputKey(sources ?? (await resolveSections(slot, await loadTree(), { create: false })), await orgTemplateRef());
}

/** 가장 최근 **시도** (실패일 수 있다) */
export async function lastOrgRun(slot: WeekSlot, sources?: SectionSource[]): Promise<OrgRunView | null> {
  const run = await prisma.rollupRun.findFirst({ where: { level: 'org', weekSlotId: slot.id }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] });
  return run ? viewOf(run, await currentOrgKey(slot, sources)) : null;
}

/**
 * RU-83 — 「전사」 화면의 전사본: 가장 최근 **성공한** 것(받을 수 있는 판)과, 그 뒤의 시도가 실패했으면 그 실패.
 * 실패일 때만 [다시 시도]가 보인다 — 성공 상태에서는 들어온 것이 바뀌면 이미 다시 만들어지므로 누를 이유가 없다(RU-76).
 */
export async function orgRunState(slot: WeekSlot, sources?: SectionSource[]): Promise<{ current: OrgRunView | null; failed: OrgRunView | null }> {
  const key = await currentOrgKey(slot, sources);
  const [last, ok] = await Promise.all([
    prisma.rollupRun.findFirst({ where: { level: 'org', weekSlotId: slot.id }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    prisma.rollupRun.findFirst({ where: { level: 'org', weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
  ]);
  return {
    current: ok ? await viewOf(ok, key) : null,
    failed: last && last.status === 'failed' ? await viewOf(last, key) : null,
  };
}
