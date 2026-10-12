// RU-80 · RU-77 · RU-84 — 위로 간 사본의 **상태**와 **비상구** (TACP-21 v1.7 · TACP-23).
//   GET    ?level=unit|hq&isoKey=                   내 부서의 「위로」 상태 (행방은 lead·head에게만 — canSeeHandoff)
//   POST   { level, isoKey, withoutApproval: true }  비상구 「승인 없이 올리기」 — 그 단계 lead만, 기한 15분 전부터
//   DELETE                                           없앴다(RU-03) — 모든 역할 404
//
// 2026-10-08(ADR-0015) 전에는 POST가 [본부에 제출]·[총괄에 제출], DELETE가 [제출 취소]였다. 승인이 곧 제출이 되면서
// 사람이 누르는 제출은 비상구 하나로 좁혔다 — 승인할 사람이 자리에 없는 날의 길이다.
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { canSeeHandoff, canUseHandoffEscape, hqNodeOfManager, notFound, requireHandoffEscape, requireScope, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { escapeHq, escapeUnit } from '@/server/rollup/handoff';
import { laterAfterUnit, syncOrg } from '@/server/rollup/auto';
import { later } from '@/server/after';
import { unitHandoffView } from '@/server/rollup/state';
import { hqBoard } from '@/server/rollup/run';
import { stageCells, stageTimes, rollupEnabled } from '@/server/rollup/schedule';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

const levelOf = (v: unknown) => (v === 'hq' ? 'hq' : 'unit');

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const level = levelOf(req.nextUrl.searchParams.get('level'));
  if (!(await rollupEnabled())) throw notFound(); // RU-52 — 꺼져 있으면 3단계의 문이 없다
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  if (level === 'hq') {
    // TACP-21 — 본부본의 상태는 본부 쓰기와 같은 칸이다(lead·head). 본부원(member)에게는 404
    const node = await hqNodeOfManager(scope);
    const [board, t] = await Promise.all([hqBoard(node, slot), stageTimes(slot)]);
    return json({ state: { level: 'hq', target: '총괄', dueKo: stageCells(t.anchor, t).hqDueKo, hqState: board.state } });
  }
  // 내 부서의 상태만 — 대상은 신원의 부서다 (TACP-6·7). 행방(시각)은 lead·head에게만 (TACP-21 v1.7 · RU-T122)
  const trail = canSeeHandoff(scope);
  const view = await unitHandoffView(scope.division, slot, { trail, canEscape: canUseHandoffEscape(scope) });
  // API-58 — 승인한 부서장·비상구로 올린 담당자의 이름은 행방을 보는 사람(lead·head)에게만. member는 상태·시각만 (TACP-21 「제출 상태 보기」)
  const sent = view?.sent && (trail ? view.sent : { ...view.sent, by: null });
  return json({ state: view && { level: 'unit', ...view, sent } });
});

const body = z.object({ level: z.enum(['unit', 'hq']), isoKey: z.string().optional(), withoutApproval: z.literal(true).optional() });

export const POST = handler(async (req: NextRequest) => {
  // 본문부터 본다 — 비상구가 아니면(예전 [제출]) 누구에게나 404다 (RU-T118). 그다음 신원·게이트
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.withoutApproval !== true) {
    await requireScope(req.headers); // 인증 안 된 요청은 401 그대로
    throw notFound();
  }
  const { scope, node } = await requireHandoffEscape(req.headers, parsed.data.level);
  const slot = await rollupSlot(parsed.data.isoKey);
  if (parsed.data.level === 'hq') {
    const r = await escapeHq(scope, node!, slot);
    later('syncOrg', () => syncOrg(slot, { cause: `hq_handoff:${r.submission.id}`, causedBy: scope.user.email }));
    return json({ id: r.submission.id, target: r.target, basis: r.submission.basis });
  }
  const r = await escapeUnit(scope, slot);
  laterAfterUnit(scope.division.id, slot, { cause: `unit_handoff:${r.submission.id}`, causedBy: scope.user.email });
  return json({ id: r.submission.id, target: r.target, basis: r.submission.basis });
});

/** RU-03 · RU-84 — 제출 취소는 없앴다. 다음 승인이 앞의 사본을 대신한다. 있다는 것도 알리지 않는다 (TACP-5) */
export const DELETE = handler(async (req: NextRequest) => {
  await requireScope(req.headers);
  throw new HttpError(404, 'not_found', '요청한 페이지를 찾을 수 없습니다');
});
