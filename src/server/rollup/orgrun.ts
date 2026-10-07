// RU-60~65 — 전사 취합본 만들기 (총괄 「딸깍」). 섹션 출처를 정하고(sections.ts) 실제 최종본 꼴로 조립한다(orgdoc.ts).
//
// 섹션을 **원래 꼴 그대로** 옮긴다 — 본부·센터형 6열 표가 섞여 있기 때문이다. 본부 이어 붙이기(run.ts)도 같은 엔진이다(RU-10,
// 2026-10-07 중복 제거) — 그래서 본부장이 검토한 본부본의 섹션과 여기서 만드는 최종본의 섹션이 같은 꼴이다.
import path from 'node:path';
import type { RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { HttpError, type Scope } from '../authz';
import { logger } from '../logger';
import { readStoredFile, sanitizeSegment, writeFileAtomic } from '../storage';
import { composeOrgDocument } from '@/lib/hwp/orgdoc';
import { resolveSections, uncoveredCopies, type SectionSource } from './sections';
import { loadTree } from './tree';

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
 * 제목도 넣는다(RU-61 — 제목은 생성한다): 만든 뒤 제목만 고쳐도 받은 파일에는 옛 제목이 있는데 「준비됨」으로 남았다.
 * 본부 자신의 섹션은 사본이 여럿일 수 있어(RU-67) 그 사본들을 다 넣는다 — 남은 사본이 바뀌면 다른 입력이다
 */
export const inputKey = (s: SectionSource) =>
  `${s.section.id}:${s.section.title}:${s.parts ? s.parts.map((p) => p.refId).join('+') : (s.refId ?? s.kind)}`;

/**
 * RU-68 — 전사본 양식. **누가 눌렀나와 상관없이** 총괄(isCoordinator)이 있는 부서의 양식(여럿이면 등록 순서로 앞의 것),
 * 없으면 전사 표준. 예전에는 누른 사람의 부서 양식이었다 — 운영자(다른 부서)가 [다시 만들기]를 누르면 같은 주차·같은
 * 입력인데 제목 문단·쪽 설정이 다른 전사본이 나왔다(양식 첫 문단이 표인 부서면 만들기 자체가 실패). 무엇을 썼는지 결과에 남긴다.
 */
async function orgTemplate(): Promise<{ bytes: Buffer; label: string }> {
  const owners = await prisma.division.findMany({
    where: { users: { some: { isCoordinator: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
    select: { nameKo: true, templates: { where: { isActive: true }, take: 1, select: { filePath: true, version: true } } },
  });
  for (const d of owners) {
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

export async function runOrgDocument(scope: Scope, slot: WeekSlot): Promise<RollupRun> {
  const tree = await loadTree();
  const sources = await resolveSections(slot, tree);
  if (!sources.some((s) => s.filePath)) throw new HttpError(409, 'nothing_submitted', '아직 들어온 섹션이 없습니다.');
  // RU-64 「누락」 — 도착했는데 어느 섹션에도 안 들어가는 사본. 결과 맨 앞에 남긴다(화면은 지금 상태로 따로 본다)
  const coverage = await uncoveredCopies(slot, sources, tree);
  const template = await orgTemplate();
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
    await audit(scope.user.email, 'rollup', null, `rollup:${run.id}`, {
      level: 'org',
      isoKey: slot.isoKey,
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
    stale: run.status === 'succeeded' && JSON.stringify(parse<string[]>(run.inputIds, [])) !== JSON.stringify(now),
  };
}
