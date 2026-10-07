// `/hq` — 본부 취합 (RU-31 · TACP-21). 본부 단계가 있는 본부의 담당자·본부장, 그리고 readAll(읽기만).
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">본부 취합</p>
            <h1 className="display text-2xl">
              {node.node.nameKo} <span className="text-muted">·</span> {slot.label}
            </h1>
            <p className="mt-1 text-sm text-body">
              실·팀 제출 기한 {stages.unitDueKo} · 총괄 제출 기한 <strong className="text-ink">{stages.hqDueKo}</strong>
            </p>
            <p className="mt-0.5 text-sm text-body">
              산하 {board.units.length}개 단위 중 <strong className="text-ink">{sent}개 제출</strong>
              {!canWrite && <span className="ml-2 text-muted">— 읽기 전용 (총괄·운영자)</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {scope.readAll && (
              <Link href="/org" className="tab-pill">
                ← 전사 취합
              </Link>
            )}
            <WeekPicker weeks={weeks} selected={slot.isoKey} baseHref={baseHref} />
          </div>
        </div>

        <div className="mt-6 space-y-6">
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
          />
          {/* RU-55 — 본부장 승인. 버튼은 본부의 head에게만 (HM-47과 같은 규칙) */}
          {board.lastRun?.status === 'succeeded' && (
            <HqApprovalCard isoKey={slot.isoKey} approval={approval} canApprove={canWrite && isReviewer(scope)} />
          )}
          {hqReport && (
            <ReportSubmitCard
              isoKey={slot.isoKey}
              state={{
                ...hqReport,
                current: hqReport.current && { ...hqReport.current, submittedAtKst: kst(hqReport.current.submittedAt)! },
              }}
            />
          )}
          {!canWrite && board.hqReport && (
            <p className="text-sm text-body">
              총괄에 제출됨 · {kst(board.hqReport.submittedAt)} · {board.hqReport.submittedBy}
            </p>
          )}
          <p className="px-1 text-xs text-muted-soft">
            본부본은 여기서 고치지 않습니다 — 단위 안의 내용은 그 실·팀의 것입니다. 고칠 곳이 있으면 그 실·팀이 고쳐 다시
            제출하고, 여기서 다시 이어 붙이세요.
          </p>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
