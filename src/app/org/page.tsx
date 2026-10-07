// `/org` — 전사 취합 (RU-32 · TACP-21). 총괄·운영자.
//
// 총괄의 「딸깍」 화면이다: 본부·단위가 보낸 것을 정한 순서대로 이어 붙여 최종본을 받는다.
// 본부 단계가 있는 본부는 그 아래 실·팀의 상태도 같이 보여 준다 — 「왜 아직 안 왔나」를 여기서 안다.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { canOpenOrgDesk, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { OrderList, RunCard, type DeskRow } from '@/components/RollupDesk';
import { WeekPicker } from '@/components/WeekPicker';
import { orgBoard } from '@/server/rollup/run';
import { rollupSlot } from '@/server/rollup/slot';
import { chipOf, kst, runView, weekOptions } from '@/server/rollup/view';
import { stageLabels } from '@/server/rollup/notices';
import { OrgSchedulePanel } from '@/components/OrgSchedulePanel';

export const dynamic = 'force-dynamic';

export default async function OrgPage({ searchParams }: { searchParams: Promise<{ isoKey?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const scope = ps.scope;
  if (!(await canOpenOrgDesk(scope))) notFound(); // TACP-5 — 존재 은닉 · RU-52 스위치도 같은 게이트가 본다
  const sp = await searchParams;
  const slot = await rollupSlot(sp.isoKey ?? null);
  const [board, weeks, nav, stages] = await Promise.all([orgBoard(slot), weekOptions(slot), rollupNav(scope), stageLabels(slot)]);

  const rows: DeskRow[] = board.nodes.map((n) => {
    if (!n.hasHqStep) {
      const u = n.units[0];
      return {
        id: n.node.id,
        // 본부 밖 단위·산하 하나만 쓰는 본부 — 그 단위가 바로 낸다 (RU-07)
        name: u.division.id === n.node.id ? n.node.nameKo : `${n.node.nameKo} · ${u.division.nameKo}`,
        chip: chipOf(u),
        direct: u.division.id !== n.node.id,
      };
    }
    return {
      id: n.node.id,
      name: n.node.nameKo,
      chip: n.hqReport
        ? {
            kind: 'sent' as const,
            label: `본부 제출 ${kst(n.hqReport.submittedAt)} · ${n.hqReport.submittedBy}`,
            href: `/api/rollup/report/${n.hqReport.id}`,
          }
        : {
            kind: n.units.some((u) => u.report) ? ('merged' as const) : ('waiting' as const),
            label: `본부 취합 중 · 실·팀 ${n.units.filter((u) => u.report).length}/${n.units.length} 제출`,
          },
      children: n.units.map((u) => ({ name: u.division.nameKo, chip: chipOf(u) })),
    };
  });
  const ready = board.nodes.filter((n) => n.ready).length;
  const query = slot.isoKey === weeks.find((w) => w.isCurrent)?.isoKey ? '' : `?isoKey=${slot.isoKey}`;

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
            <p className="text-sm text-muted">전사 취합</p>
            <h1 className="display text-2xl">{slot.label} 주간업무</h1>
            <p className="mt-1 text-sm text-body">
              본부 제출 기한 <strong className="text-ink">{stages.hqDueKo}</strong> ·{' '}
              {board.nodes.length}곳 중 <strong className="text-ink">{ready}곳 도착</strong>
              {board.offline.length > 0 && <span className="text-muted"> · Tincase 밖 {board.offline.length}곳</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/org/board${query}`} className="tab-pill">
              큰 화면
            </Link>
            <WeekPicker weeks={weeks} selected={slot.isoKey} baseHref="/org" />
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <OrgSchedulePanel {...stages} weekLabel={slot.label} />
          <OrderList
            key={rows.map((r) => r.id).join()}
            rows={rows}
            canWrite
            saveUrl="/api/rollup/org/order"
            note={board.note}
            pageBreak={board.pageBreak}
            unitWord="부서"
          />
          <RunCard
            run={runView(board.lastRun)}
            canWrite
            runUrl="/api/rollup/org"
            isoKey={slot.isoKey}
            ready={ready}
            title="아직 이어 붙이지 않았습니다"
            resultWord="전사본"
          />
          {board.offline.length > 0 && (
            <section className="card px-6 py-5">
              <h2 className="text-base font-semibold text-ink">
                Tincase 밖에서 내는 곳
                <span className="ml-2 text-xs font-normal text-muted">취합게시판으로 받아 전사본에 직접 넣어야 합니다</span>
              </h2>
              <p className="mt-2 text-sm text-body">{board.offline.map((d) => d.nameKo).join(' · ')}</p>
            </section>
          )}
          {board.nodes
            .filter((n) => n.hasHqStep)
            .map((n) => (
              <p key={n.node.id} className="px-1 text-sm">
                <Link href={`/hq?node=${encodeURIComponent(n.node.slug)}${query ? `&isoKey=${slot.isoKey}` : ''}`} className="text-brand underline">
                  {n.node.nameKo} 본부 취합 화면 보기
                </Link>
              </p>
            ))}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
