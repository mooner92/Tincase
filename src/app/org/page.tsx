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
import { WeekPicker } from '@/components/WeekPicker';
import { prisma } from '@/server/db';
import { SectionBoard } from '@/components/SectionBoard';
import { OrgRunCard } from '@/components/OrgRunCard';
import { resolveSections } from '@/server/rollup/sections';
import { lastOrgRun } from '@/server/rollup/orgrun';
import { loadTree } from '@/server/rollup/tree';
import { rollupSlot } from '@/server/rollup/slot';
import { kst, weekOptions } from '@/server/rollup/view';
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
  const tree = await loadTree();
  const [sources, weeks, nav, stages, divisions] = await Promise.all([
    resolveSections(slot, tree),
    weekOptions(slot),
    rollupNav(scope),
    stageLabels(slot),
    prisma.division.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nameKo: true, isActive: true } }),
  ]);
  const run = await lastOrgRun(slot, sources);
  const ready = sources.filter((x) => x.kind === 'tincase' || x.kind === 'upload').length;
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
              본부 제출 기한 <strong className="text-ink">{stages.hqDueKo}</strong> · {sources.length}개 섹션 중{' '}
              <strong className="text-ink">{ready}개 들어옴</strong>
              {sources.some((x) => x.offline) && <span className="text-muted"> · Tincase 밖 {sources.filter((x) => x.offline).length}곳</span>}
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
          <SectionBoard
            key={sources.map((x) => `${x.section.id}:${x.kind}:${x.refId ?? ''}`).join()}
            isoKey={slot.isoKey}
            sections={sources.map((x) => ({
              id: x.section.id,
              title: x.section.title,
              divisionId: x.section.divisionId,
              kind: x.section.kind,
              source: x.kind,
              label: x.label,
              refId: x.refId ?? null,
              offline: x.offline,
            }))}
            divisions={divisions}
          />
          <OrgRunCard
            isoKey={slot.isoKey}
            ready={ready}
            run={run && { ...run, finishedAtKst: kst(run.finishedAt) }}
          />
          {tree.nodes
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
