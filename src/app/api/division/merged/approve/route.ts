// HM-47 — [고칠 것 없음 · 승인]. 부서장(head)이 자기 부서 병합본을 그대로 승인한다 (TACP-16).
// 고쳐 저장하는 경로(`merged/content` PUT)는 저장 자체가 승인이라 이 버튼이 필요 없다.
//
// 2026-10-08(ADR-0015) — 3단계에서는 **이 승인이 곧 위로 가는 제출**이다. 사본은 이 요청 안에서(승인과 한 트랜잭션), 본부본·전사본은
// 응답 뒤(`after()`)에 맞춘다. 스케줄러에 기대지 않는다 — 테스트 서버처럼 스케줄러가 꺼져 있어도 흐름이 돈다(RU-72).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireReviewer, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { readStoredFile, sha256 } from '@/server/storage';
import { alreadyApproved, latestReview, recordReview, requireViewedVersion } from '@/server/merge/review';
import { freeze, supersededSince, syncUnit, withUnitLock } from '@/server/rollup/handoff';
import { laterAfterUnit } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireReviewer(req.headers);
  rateLimit(`merged-approve:${scope.user.email}`, 10, 60_000);
  // runId·sha256 — 화면에서 **본 판**. 승인은 본 판에만 붙는다 (HM-47)
  const body = (await req.json().catch(() => null)) as { isoKey?: string; runId?: string; sha256?: string } | null;
  const division = scope.division; // TACP-6 — 신원의 부서
  const slot = body?.isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey: body.isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  // RU-75 — 같은 (부서, 주차)의 승인·수정 저장·비상구는 줄을 선다. 「본 판 확인 → 불변 사본 → 승인·사본」이 한 덩어리다
  const result = await withUnitLock(division.id, slot.id, async () => {
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run?.outputPath) throw new HttpError(409, 'no_merge', '아직 병합본이 없습니다.');
    const bytes = await readStoredFile(run.outputPath);
    const sha = sha256(bytes);
    // 화면을 연 뒤 다시 병합했거나 누가 고쳤으면 — 보지 않은 판에 승인을 붙이지 않는다
    requireViewedVersion(run, sha, body);
    // 같은 판을 두 번 승인하지 않는다 — 두 번 누르면 담당자에게 알림이 두 번 간다.
    // 단, 그 승인 뒤 비상구로 다른 판이 위에 가 있으면 지금 승인은 승인한 판으로 되돌리는 **새 결정**이다 (RU-T131)
    if ((await alreadyApproved(run, sha)) && !(await supersededSince(division.id, slot.id, 'unit', sha))) return null;
    // RU-73 — **이 메모리의 바이트**를 맨 먼저 불변 파일로. 병합본 파일을 다시 읽지 않는다(그 사이 병합이 새 파일을 쓸 수 있다).
    // 여기서 실패하면 아무것도 바뀌지 않은 채 500이다 — 바이트 없는 승인이 남지 않는다
    const frozen = await freeze(division.slug, slot, 'unit', bytes);
    return recordReview({ scope, run, slot, kind: 'approve', changes: [], frozen });
  });

  if (!result) {
    // HM-T145 — 같은 판 재승인은 승인·사본을 새로 만들지 않는다. 다만 그 판이 아직 안 올라가 있으면(3단계를 켜기 전의 승인) 맞춘다
    const caught = await syncUnit(division.id, slot, { cause: 'catch_up', causedBy: scope.user.email });
    if (caught) laterAfterUnit(division.id, slot, { cause: `unit_handoff:${caught.id}`, causedBy: scope.user.email });
    return json({ ok: true, unchanged: true, notified: 0, handedOff: null, review: await latestReview(division.id, slot.id) });
  }
  if (result.handedOff) {
    laterAfterUnit(division.id, slot, { cause: `unit_handoff:${result.handedOff.submissionId}`, causedBy: scope.user.email });
  }
  // notified — 담당자 몇 명에게 알림이 나갔나. 0이면 화면이 「알렸습니다」라고 하지 않는다
  // handedOff — 3단계면 받는 곳·시각. 화면이 「승인했어요 — 기획경영본부에 올라갔어요」라고 말한다 (RU-80)
  return json({
    ok: true,
    unchanged: false,
    notified: result.notified.sent,
    handedOff: result.handedOff ? { target: result.handedOff.target, at: result.handedOff.at } : null,
    review: await latestReview(division.id, slot.id),
  });
});
