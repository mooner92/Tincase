// HM-47 — [고칠 것 없음 · 승인]. 부서장(head)이 자기 부서 병합본을 그대로 승인한다 (TACP-16).
// 고쳐 저장하는 경로(`merged/content` PUT)는 저장 자체가 승인이라 이 버튼이 필요 없다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireReviewer, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { readStoredFile, sha256 } from '@/server/storage';
import { latestReview, recordReview, UNIT_REVIEW } from '@/server/merge/review';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireReviewer(req.headers);
  rateLimit(`merged-approve:${scope.user.email}`, 10, 60_000);
  const body = (await req.json().catch(() => null)) as { isoKey?: string } | null;
  const division = scope.division; // TACP-6 — 신원의 부서
  const slot = body?.isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey: body.isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (!run?.outputPath) throw new HttpError(409, 'no_merge', '아직 병합본이 없습니다.');

  const bytes = await readStoredFile(run.outputPath);
  // 같은 판을 두 번 승인하지 않는다 — 두 번 누르면 담당자에게 알림이 두 번 간다.
  // 본부장의 본부본 승인(hq_approve)은 다른 문서의 승인이라 비교 대상이 아니다
  const last = await prisma.mergeReview.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, ...UNIT_REVIEW },
    orderBy: { createdAt: 'desc' },
  });
  if (last && last.mergeRunId === run.id && last.sha256 === sha256(bytes)) {
    return json({ ok: true, unchanged: true, review: await latestReview(division.id, slot.id) });
  }
  await recordReview({ scope, run, slot, kind: 'approve', changes: [], bytes });
  return json({ ok: true, unchanged: false, review: await latestReview(division.id, slot.id) });
});
