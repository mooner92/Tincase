// `/hq` — 본부 취합 (RU-31 · TACP-21 · PG-54). 본부 단계가 있는 본부의 담당자·본부장, 그리고 readAll(읽기만).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { canUseHandoffEscape, HttpError, isReviewer, resolveHqView, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { OrderList, RunCard } from '@/components/RollupDesk';
import { WeekPicker } from '@/components/WeekPicker';
import { HqApprovalCard } from '@/components/HqApprovalCard';
import { hqBoard } from '@/server/rollup/run';
import { readRepairHq } from '@/server/rollup/auto';
import { escapeClosesAt, escapeOpensAt } from '@/server/rollup/handoff';
import { rollupSlot } from '@/server/rollup/slot';
import { stageTimes } from '@/server/rollup/schedule';
import { kst, runView, unitRow, weekOptions } from '@/server/rollup/view';
import { stageLabels } from '@/server/rollup/notices';
import { STAGE_HQ, STAGE_UNIT } from '@/lib/rollup-stages';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export default async function HqPage({ searchParams }: { searchParams: Promise<{ node?: string; isoKey?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const scope = ps.scope;
  const sp = await searchParams;

  let view;
  try {
    view = await resolveHqView(scope, sp.node ?? null); // TACP-7의 본부판 — 이 함수가 돌려준 본부만 그린다
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { node, canWrite } = view;
  const slot = await rollupSlot(sp.isoKey ?? null);
  // RU-72 — 그리기 **전에** 맞춘다(읽기 수리). 스케줄러가 꺼진 테스트 서버에서도 본부장은 연 순간 지금까지 온 것이 이어 붙은 판을 본다
  await readRepairHq(node, slot);
  const [board, weeks, nav, stages, times] = await Promise.all([hqBoard(node, slot), weekOptions(slot), rollupNav(scope), stageLabels(slot), stageTimes(slot)]);
  const sent = board.units.filter((u) => u.report).length;
  const missing = board.units.filter((u) => !u.report).map((u) => u.division.nameKo);
  const baseHref = canWrite ? '/hq' : `/hq?node=${encodeURIComponent(node.node.slug)}`;
  // RU-55 — [검토 완료 · 승인]은 본부의 head에게만 (requireHqReviewer와 같은 판정 — TACP-9)
  const canApprove = canWrite && isReviewer(scope);
  // RU-77 — 본부 lead의 비상구. 「본부 → 총괄」 기한 15분 전부터 그 기한 + 24시간까지만 그린다 (닫힌 뒤·지난 주차는 없음 — 결정 a)
  const opens = escapeOpensAt(times.hqDue);
  const now = new Date();
  const escape =
    canWrite && canUseHandoffEscape(scope) && board.hasHead && now <= escapeClosesAt(times)
      ? { open: now >= opens, opensAtKst: toKstIso(opens).slice(11, 16) }
      : null;
  const current = runView(board.current);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isManager || scope.readAll}
        isOperator={scope.user.isOperator}
        readAll={scope.readAll}
        {...nav}
        viaCloudflare={scope.source === 'cloudflare'}
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-10">
        <div className="page-head">
          <div className="min-w-0">
            <h1 className="page-title">
              {node.node.nameKo} <span className="text-muted">·</span> {slot.label}
            </h1>
            {/* 머리 밑은 한 줄 — 기한 둘과 진행. 읽기 전용이면 그 사실도 같은 줄에 */}
            <p className="page-sub">
              {/* RU-59 — 「전사」 머리글·일정 카드와 같은 이름 한 쌍 */}
              {STAGE_UNIT} {stages.unitDueKo} · {STAGE_HQ} <strong className="font-semibold text-ink">{stages.hqDueKo}</strong>
              {' · '}산하 {board.units.length}곳 중 <strong className="font-semibold text-ink">{sent}곳 올라옴</strong>
              {!canWrite && <span> · 읽기 전용</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* PG-49f — 「전사」 화면으로 돌아가는 길. 그 화면의 취합 부분과 같은 문(canOpenOrgDesk)으로만 그린다 (TACP-9) —
                이 화면을 읽기로 여는 총괄·운영자는 그 문을 이미 지나왔다(RU-52) */}
            {nav.orgDesk && (
              <Link href={`/org${sp.isoKey ? `?isoKey=${slot.isoKey}` : ''}`} className="btn-ghost">
                ← 전사
              </Link>
            )}
            <WeekPicker weeks={weeks} selected={slot.isoKey} baseHref={baseHref} />
          </div>
        </div>

        {/* PG-54 · RU-82 — 카드 둘: 산하 현황·순서 / 본부본(저절로 이어 붙음 · 본부장 승인 = 총괄로) */}
        <div className="mt-6 space-y-4 lg:space-y-6">
          <OrderList
            key={board.units.map((u) => u.division.id).join()}
            rows={board.units.map(unitRow)}
            canWrite={canWrite}
            saveUrl="/api/rollup/hq/order"
            note={board.node.note}
            pageBreak={board.node.pageBreak}
            self={{ value: board.node.self, nodeId: node.node.id, nodeName: node.node.nameKo }}
            unitWord="실·팀"
            approved={!!board.approval && !board.approval.changedAfter}
          />
          <RunCard
            current={current}
            failed={board.lastRun?.status === 'failed' ? runView(board.lastRun) : null}
            arrived={{ n: sent, of: board.units.length, missing }}
            canRetry={canWrite}
            isoKey={slot.isoKey}
          >
            {current && (
              <HqApprovalCard
                isoKey={slot.isoKey}
                state={board.state}
                lastGood={board.lastGood}
                approval={board.approval}
                viewed={current.sha256 ? { runId: current.id, sha256: current.sha256 } : null}
                canApprove={canApprove}
                hasHead={board.hasHead}
                missing={missing}
                hqReport={
                  board.hqReport && { atKst: kst(board.hqReport.submittedAt)!, basis: board.hqReport.basis, by: board.hqReport.submittedBy }
                }
                escape={escape}
              />
            )}
          </RunCard>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
