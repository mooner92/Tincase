// POST /api/division/merge — 병합을 **줄에 넣는다** (API-30 · API-31a · HM-60b). GET ?jobId= — 그 작업의 상태 (API-65).
// 마감이 지나면 스케줄러가 알아서 넣으므로(HM-25) 이 경로는 **재실행**이 주 용도다:
// 설정을 고쳤거나, 자동 실행이 실패했거나, 늦게 낸 사람을 반영할 때.
//
// 2026-10-08 2단계 — 요청이 병합을 끝까지 붙잡지 않는다. 예전에는 병합이 끝날 때까지 응답을 붙잡아, 100초를 넘기면 Cloudflare가 524를
// 내고 사람이 한 번 더 눌렀다(그 둘째가 겹침을 불렀다). 이제 줄에 넣고 202로 바로 답한다 — 같은 부서·주차가 이미 줄에 있으면 합류한다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, resolveTargetDivision, HttpError, notFound } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { editedMessage, latestEdits } from '@/server/merge/edits';
import { mergeInFlight, MERGING_TEXT } from '@/server/merge/inflight';
import { activeMergeJob, enqueueMerge, jobView } from '@/server/merge/queue';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 병합 대상은 언제나 신원의 부서다. 슬러그로 남의 부서를 병합할 수 없다
  // TACP §3.2 — 병합 **실행**은 lead·head·coordinator·operator (자기 부서).
  // 「병합본 수정」과 다른 칸이다 — 그쪽은 coordinator가 빠진다 (requireOwnManager)
  const scope = await requireManager(req.headers);

  const body = ((await req.json().catch(() => null)) ?? {}) as { isoKey?: unknown; overwriteEdits?: unknown };
  const isoKey = String(body.isoKey ?? '');
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  /*
   * HM-58a (2단계 개정) — 같은 프로세스의 병합은 모두 줄을 지나므로, 줄에 작업이 없는데 running이 있으면 **다른 프로세스**
   * (개발용 scripts/run-merge.ts 등)가 돌리는 것이다. 그것과는 합류할 수 없다 — 예전처럼 409 `merging`.
   * 고친 병합본 확인보다 먼저 본다 — 돌고 있는 동안 「고친 내용이 사라져요」를 묻고 확인까지 받아 봐야 결국 시작하지 못한다.
   */
  if (!(await activeMergeJob(scope.division.id, slot.id))) {
    const busy = await mergeInFlight(scope.division.id, slot.id);
    if (busy) {
      return json(
        { error: 'merging', message: MERGING_TEXT, detail: { runId: busy.runId, startedAt: toKstIso(busy.startedAt) } },
        { status: 409 },
      );
    }
  }

  /*
   * HM-49 · API-55 — 사람이 고친 병합본이면 **묻기 전에는 덮지 않는다.**
   * 다시 병합은 같은 경로에 새로 쓰므로 고친 내용이 어디에도 남지 않는다. 화면이 `detail.edits`로
   * 「누가 몇 곳」을 보여 주고, 확인하면 `overwriteEdits: true`를 붙여 다시 보낸다. 참(true)만 확인으로 친다.
   * 줄에 이미 작업이 있어도 먼저 묻는다 — 합류하면 그 작업이 덮는다.
   */
  const latest = await latestEdits(scope.division.id, slot.id);
  const edits = latest?.edits ?? null;
  const overwriteEdits = body.overwriteEdits === true;
  if (edits && !overwriteEdits) {
    return json({ error: 'edited', message: editedMessage(edits), detail: { edits, runId: latest!.run.id } }, { status: 409 });
  }

  const r = await enqueueMerge(scope.division.id, slot.id, { trigger: 'manual', actorEmail: scope.user.email, overwriteEdits });
  await audit(scope.user.email, 'merge', scope.division.id, `slot:${slot.isoKey}`, {
    status: 'queued',
    jobId: r.jobId,
    joined: r.joined,
    // 덮은 수고가 기록에 남아야 「실장 수정이 왜 사라졌나」에 답할 수 있다
    ...(edits && { overwroteEdits: { places: edits.places, by: edits.by, runId: latest!.run.id } }),
  });
  return json(r, { status: 202 });
});

/**
 * API-65 — 줄에 넣은 작업의 상태. 문은 실행과 같고(TACP §3.2 · TACP-30), 작업은 **신원의 부서** 것만 —
 * 남의 부서 작업 id · 없는 id는 구별 없이 404 (TACP-5). 화면(CP-130)이 2초마다 묻는다.
 */
export const GET = handler(async (req: NextRequest) => {
  const scope = await requireManager(req.headers);
  // TACP-7 — 읽기 대상은 단일 해석기로. 슬러그 없이 부르면 신원의 부서다
  const { division } = await resolveTargetDivision(scope);
  const jobId = req.nextUrl.searchParams.get('jobId') ?? '';
  const job = jobId ? await prisma.mergeJob.findUnique({ where: { id: jobId } }) : null;
  if (!job || job.divisionId !== division.id) throw notFound();

  const view = await jobView(job);
  const run = job.mergeRunId
    ? await prisma.mergeRun.findUnique({ where: { id: job.mergeRunId }, select: { id: true, status: true, errorText: true } })
    : null;
  return json({
    jobId: job.id,
    status: view.status,
    position: view.position,
    etaMinutes: view.etaMinutes,
    trigger: job.trigger,
    enqueuedAt: toKstIso(job.enqueuedAt),
    startedAt: job.startedAt ? toKstIso(job.startedAt) : null,
    finishedAt: job.finishedAt ? toKstIso(job.finishedAt) : null,
    errorText: job.errorText,
    run,
  });
});
