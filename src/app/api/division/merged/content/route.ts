// GET·PUT /api/division/merged/content — 병합본 **보기·고치기** (API-48~51).
//
// 왜 필요한가: 담당자는 병합본을 받아 한글로 열고, 표를 복사해 취합게시판에 붙여넣는다.
// 그 과정에서 이상한 행 하나를 고치려고 한글을 여는 것이 유일한 이유가 된다.
// 화면에서 보고 고칠 수 있으면 한글을 열 일이 없다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, requireLead, resolveTargetDivision, requireMergedAccess, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { readStoredFile, writeFileAtomic } from '@/server/storage';
import { readWorklog, TABLE_TITLES, TABLE_COLUMNS } from '@/lib/hwp/reader';
import { tableGrid } from '@/lib/hwp/model';
import { composeMergedHwp } from '@/server/merge';
import { boardTitle } from '@/lib/docname';
import { slotKind, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

const BUCKETS = ['achievements', 'plans', 'notes'] as const;
const MAX_CELL = 500;
const MAX_ROWS = 200;

async function locate(req: NextRequest, slugParam: string | null, isoKey: string | null) {
  const scope = await requireScope(req.headers);
  const { division } = await resolveTargetDivision(scope, slugParam); // TACP-7
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) throw new HttpError(404, 'not_found', '아직 병합본이 없습니다.');
  return { scope, division, slot, run };
}

export const GET = handler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const { scope, division, slot, run } = await locate(req, q.get('division'), q.get('isoKey'));
  await requireMergedAccess(scope, division.id); // TACP §3.2 — 병합본은 담당자부터
  rateLimit(`merged-view:${scope.user.email}`, 40, 60_000);

  const parsed = readWorklog(await readStoredFile(run.outputPath!));
  await audit(scope.user.email, 'preview', division.id, `merged:${slot.isoKey}`);

  return json({
    title: boardTitle(slot.month, slot.label, division.nameKo, slotKind(slot)),
    slot: { isoKey: slot.isoKey, label: slot.label, year: slot.year, kind: slotKind(slot) },
    editedAt: toKstIso(run.finishedAt ?? run.startedAt),
    tables: parsed.tables.slice(0, 3).map((t, i) => ({
      key: BUCKETS[i],
      title: TABLE_TITLES[i] ?? `표 ${i + 1}`,
      columns: [...TABLE_COLUMNS],
      rows: tableGrid(t),
    })),
  });
});

/** API-50 — 담당자가 고친 내용으로 병합본을 **다시 쓴다**. 원본 제출물은 건드리지 않는다 */
export const PUT = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as
    | { isoKey?: string; tables?: { key: string; rows: string[][] }[] }
    | null;
  if (!body?.tables) throw new HttpError(422, 'invalid_request', '표 내용이 없습니다.');

  // TACP-6 — 쓰기는 신원의 부서에만. 슬러그로 남의 부서 병합본을 고칠 수 없다
  const scope = await requireLead(req.headers);
  if (!scope.isLead) throw new HttpError(404, 'not_found', '요청한 페이지를 찾을 수 없습니다');
  rateLimit(`merged-edit:${scope.user.email}`, 20, 60_000);
  const { division, slot, run } = await locate(req, null, body.isoKey ?? null);

  const template = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true } });
  if (!template) throw new HttpError(422, 'no_template', '부서 양식이 없어 다시 쓸 수 없습니다.');

  const clean = (v: unknown) =>
    String(v ?? '')
      .split('')
      .filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\t')
      .join('')
      .trim()
      .slice(0, MAX_CELL);

  const tableRows = { achievements: [] as string[][], plans: [] as string[][], notes: [] as string[][] };
  for (const t of body.tables) {
    const key = BUCKETS.find((b) => b === t.key);
    if (!key) continue;
    // ABS-5 — 구분 채번은 언제나 시스템이 다시 만든다. 사람이 고친 번호는 버린다
    const prefix = BUCKETS.indexOf(key) + 1;
    tableRows[key] = (t.rows ?? [])
      .slice(0, MAX_ROWS)
      .map((r) => [clean(r[1]), clean(r[2]), clean(r[3]), clean(r[4])])
      .filter((r) => r.some(Boolean))
      .map((r, i) => [`${prefix}-${i + 1}`, ...r]);
  }

  const composed = composeMergedHwp(await readStoredFile(template.filePath), tableRows);
  await writeFileAtomic(run.outputPath!, composed.bytes);

  const rowCounts = {
    achievements: tableRows.achievements.length,
    plans: tableRows.plans.length,
    notes: tableRows.notes.length,
  };
  await prisma.mergeRun.update({
    where: { id: run.id },
    data: { rowCounts: JSON.stringify(rowCounts), finishedAt: new Date() },
  });
  await audit(scope.user.email, 'merge', division.id, `merged:${slot.isoKey}`, { action: 'edit', rowCounts });

  return json({ ok: true, rowCounts, warnings: composed.warnings });
});
