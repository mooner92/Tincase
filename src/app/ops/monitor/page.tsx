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
      </div>
    </div>
  );
}
