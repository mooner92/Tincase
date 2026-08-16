// `/ops/monitor` — 전사 제출 현황 조직도. 운영자·총괄 전용 (TACP §3.2 readAll).
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { OrgMonitor } from '@/components/OrgMonitor';
import { layoutOrg, type DivisionNode } from '@/lib/orgtree';
import { ensureCurrentSlot } from '@/server/worklog';
import { toKstIso } from '@/lib/week';
import { missingStreaks } from '@/server/streak';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  const scope = ps.scope;
  if (scope.user.mustChangePassword) redirect('/password?first=1');
  // 전 부서를 보는 화면이므로 readAll만 (총괄·운영자). 그 외에는 존재 은닉 (TACP-5)
  if (!scope.readAll) notFound();

  const now = new Date();
  const slot = await ensureCurrentSlot(now);

  const divisions = await prisma.division.findMany({
    orderBy: [{ parentKo: 'asc' }, { nameKo: 'asc' }],
    include: {
      users: {
        where: { isActive: true },
        orderBy: [{ divisionRole: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, divisionRole: true, onRoster: true },
      },
    },
  });
  const subs = await prisma.submission.findMany({
    where: { weekSlotId: slot.id, isLatest: true },
    select: { userId: true, uploadedAt: true },
  });
  const byUser = new Map(subs.map((s) => [s.userId, s.uploadedAt]));

  const nodes: DivisionNode[] = divisions.map((d) => ({
    id: d.id,
    name: d.nameKo,
    slug: d.slug,
    parent: d.parentKo,
    isActive: d.isActive,
    // R-002 실측 — 취합게시판 제출 이력이 있는 부서만 집계한다.
    // 연구부서 17개(232명)는 애초에 주간 업무일지를 내지 않는다.
    counted: d.boardStatus === 'confirmed',
    people: d.users.map((u) => {
      const at = byUser.get(u.id);
      return {
        id: u.id,
        name: u.name,
        submitted: !!at,
        isLead: u.divisionRole === 'lead',
        onRoster: u.onRoster,
        submittedAtKst: at ? toKstIso(at).slice(5, 16).replace('T', ' ') : null,
      };
    }),
  }));

  const layout = layoutOrg(nodes);
  // 스냅샷이 못 보여주는 것 — "이번 주 안 냄"과 "3주 연속 안 냄"은 다른 얘기다
  const streaks = await missingStreaks(now);

  return (
    <div className="min-h-screen">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isLead || scope.readAll}
        isOperator={scope.user.isOperator}
        viaCloudflare={scope.source === 'cloudflare'}
      />
      <div className="mx-auto max-w-[1280px] px-5 pt-8 pb-24">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="sr-only">전사 제출 현황</h1>
          <div className="flex gap-2 text-sm">
            <Link href="/ops" className="tab-pill">
              ← 운영
            </Link>
            <a href={`/api/ops/report?isoKey=${slot.isoKey}`} className="tab-pill">
              감사 문서 받기
            </a>
            <a href={`/api/ops/report?isoKey=${slot.isoKey}&format=csv`} className="tab-pill">
              CSV
            </a>
          </div>
        </div>
        <OrgMonitor
          layout={layout}
          weekLabel={slot.label}
          capturedAtKst={toKstIso(now).slice(5, 16).replace('T', ' ') + ' 기준'}
        />

        {streaks.length > 0 && (
          <section className="card mt-6 px-6 py-5">
            <h2 className="text-sm font-semibold text-ink">
              연속 미제출 {streaks.length}명
              <span className="ml-2 text-xs font-normal text-muted">
                마감이 지난 최근 {streaks[0].weeks}주차 기준 · 한 주 거른 것과 계속 안 내는 것은 다른 얘기입니다
              </span>
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {streaks.slice(0, 30).map((r) => (
                <li key={r.userId} className="flex flex-wrap items-baseline gap-x-3">
                  <span
                    className={`inline-block w-14 shrink-0 text-right font-semibold tabular-nums ${
                      r.streak >= 4 ? 'text-error' : 'text-brand-ochre'
                    }`}
                  >
                    {r.streak}주 연속
                  </span>
                  <span className="min-w-36 text-muted">{r.divisionName}</span>
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-xs text-muted-soft">
                    {r.lastSubmittedLabel ? `마지막 제출 ${r.lastSubmittedLabel}` : `${r.weeks}주 동안 제출 없음`}
                  </span>
                </li>
              ))}
            </ul>
            {streaks.length > 30 && (
              <p className="mt-2 text-xs text-muted-soft">… 외 {streaks.length - 30}명. 전체는 CSV로 받으세요.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
