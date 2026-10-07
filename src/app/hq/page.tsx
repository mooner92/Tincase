// `/hq` — 본부 취합 (RU-31 · TACP-21 · PG-54). 본부 단계가 있는 본부의 담당자·본부장, 그리고 readAll(읽기만).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { HttpError, resolveHqView, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { OrderList, RunCard } from '@/components/RollupDesk';
import { ReportSubmitCard } from '@/components/ReportSubmitCard';
import { WeekPicker } from '@/components/WeekPicker';
import { hqBoard } from '@/server/rollup/run';
import { reportState } from '@/server/rollup/report';
import { rollupSlot } from '@/server/rollup/slot';
import { kst, runView, unitRow, weekOptions } from '@/server/rollup/view';
import { hqApproval, stageLabels } from '@/server/rollup/notices';
import { HqApprovalCard } from '@/components/HqApprovalCard';
import { isReviewer } from '@/server/authz';
import { STAGE_HQ, STAGE_UNIT } from '@/lib/rollup-stages';

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
  const [board, weeks, nav, stages, approval] = await Promise.all([
    hqBoard(node, slot),
    weekOptions(slot),
    rollupNav(scope),
    stageLabels(slot),
    hqApproval(node.node.id, slot),
  ]);
  const hqReport = canWrite ? await reportState(node.node.id, slot, 'hq') : null;
  const sent = board.units.filter((u) => u.report).length;
  const baseHref = canWrite ? '/hq' : `/hq?node=${encodeURIComponent(node.node.slug)}`;
  // RU-55 · CP-99 — 본부장에게 승인할 본부본이 있으면 그것이 주 버튼이고, [총괄에 제출]은 승인 뒤에 주 버튼이 된다
  const canApprove = canWrite && isReviewer(scope);
  const awaitingApproval =
    canApprove && board.lastRun?.status === 'succeeded' && (!approval || approval.changedAfter);

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
        notifyEnabled={scope.user.notifyEnabled}
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
              {' · '}산하 {board.units.length}곳 중 <strong className="font-semibold text-ink">{sent}곳 제출</strong>
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

        {/* PG-54 — 카드 둘: 산하 제출·순서 / 본부본(결과 · 본부장 승인 · 총괄에 제출) */}
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
          />
          <RunCard
            run={runView(board.lastRun)}
            canWrite={canWrite}
            runUrl="/api/rollup/hq"
            isoKey={slot.isoKey}
            ready={sent}
            title="아직 이어 붙이지 않았습니다"
            resultWord="본부본"
          >
            {/* RU-55 — 본부장 승인. 버튼은 본부의 head에게만 (HM-47과 같은 규칙) */}
            {board.lastRun?.status === 'succeeded' && (
              <HqApprovalCard isoKey={slot.isoKey} approval={approval} canApprove={canApprove} />
            )}
            {hqReport && (
              <ReportSubmitCard
                bare
                isoKey={slot.isoKey}
                primary={!awaitingApproval}
                state={{
                  ...hqReport,
                  current: hqReport.current && { ...hqReport.current, submittedAtKst: kst(hqReport.current.submittedAt)! },
                }}
              />
            )}
            {!canWrite && board.hqReport && (
              <p className="card-section text-sm text-body">
                총괄에 제출됨 · {kst(board.hqReport.submittedAt)} · {board.hqReport.submittedBy}
              </p>
            )}
          </RunCard>
          <p className="px-1 text-xs leading-5 text-muted">
            본부본은 여기서 고치지 않습니다 — 단위 안의 내용은 그 실·팀의 것입니다. 고칠 곳이 있으면 그 실·팀이 고쳐 다시
            제출하고, 여기서 다시 이어 붙이세요.
          </p>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
