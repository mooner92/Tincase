// POST /api/division/merge — 자동 병합 실행 (API-30). lead 전용.
// 마감이 지나면 스케줄러가 알아서 돌리므로(HM-25) 이 경로는 **재실행**이 주 용도다:
// 설정을 고쳤거나, 자동 실행이 실패했거나, 늦게 낸 사람을 반영할 때.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { runMergeRecorded } from '@/server/merge/run';
import { editedMessage, latestEdits } from '@/server/merge/edits';
import { mergeInFlight, MERGING_TEXT } from '@/server/merge/inflight';
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
   * HM-58 · API-31 — 같은 부서·주차 병합이 이미 돌고 있으면 **시작하지 않는다** (409 `merging`).
   * 겹치면 늦게 끝난 쪽이 그 사이 사람이 고친 판을 덮는다. 요청이 100초를 넘겨 Cloudflare가 524를 내면 사람은
   * 한 번 더 누른다 — 그 두 번째가 여기서 멈춘다. 고친 병합본 확인(아래 `edited`)보다 먼저 본다: 돌고 있는 동안
   * 「고친 내용이 사라져요」를 묻고 확인까지 받아 봐야 결국 시작하지 못한다.
   * 멈춘 실행(HM-55, 기본 10분 넘은 running)은 돌고 있는 것으로 치지 않는다.
   */
  const busy = await mergeInFlight(scope.division.id, slot.id);
  if (busy) {
    return json(
      { error: 'merging', message: MERGING_TEXT, detail: { runId: busy.runId, startedAt: toKstIso(busy.startedAt) } },
      { status: 409 },
    );
  }

  /*
   * HM-49 · API-55 — 사람이 고친 병합본이면 **묻기 전에는 덮지 않는다.**
   * 다시 병합은 같은 경로에 새로 쓰므로 고친 내용이 어디에도 남지 않는다. 화면이 `detail.edits`로
   * 「누가 몇 곳」을 보여 주고, 확인하면 `overwriteEdits: true`를 붙여 다시 보낸다. 참(true)만 확인으로 친다.
   */
  const latest = await latestEdits(scope.division.id, slot.id);
  const edits = latest?.edits ?? null;
  if (edits && body.overwriteEdits !== true) {
    return json({ error: 'edited', message: editedMessage(edits), detail: { edits, runId: latest!.run.id } }, { status: 409 });
  }

  const result = await runMergeRecorded(scope.division.id, slot.id, 'manual');
  // 위 확인과 시작 사이에 누가 먼저 시작했다 — 같은 409. 시작하지 않았으므로 감사 로그도 남기지 않는다.
  // 응답 모양은 위의 409와 같게 둔다(API-31 `detail: { runId, startedAt }`) — 화면이 어느 쪽 409인지 가리지 않아도 되게
  if (result.status === 'busy') {
    const now = await mergeInFlight(scope.division.id, slot.id);
    return json(
      {
        error: 'merging',
        message: MERGING_TEXT,
        detail: { runId: now?.runId ?? (result.runId || null), startedAt: now ? toKstIso(now.startedAt) : null },
      },
      { status: 409 },
    );
  }
  await audit(scope.user.email, 'merge', scope.division.id, `slot:${slot.isoKey}`, {
    status: result.status,
    // 덮은 수고가 기록에 남아야 「실장 수정이 왜 사라졌나」에 답할 수 있다
    ...(edits && { overwroteEdits: { places: edits.places, by: edits.by, runId: latest!.run.id } }),
  });

  if (result.status === 'failed') {
    throw new HttpError(422, 'merge_failed', result.errorText ?? '병합에 실패했습니다.');
  }
  return json(result);
});
