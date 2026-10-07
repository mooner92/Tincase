// `/ops/monitor` — 전사 제출 현황. 운영자·총괄 전용 (TACP §3.2 readAll).
//
// PG-50 (2026-10-07) — 본판은 **본부별 팀 막대**다. 원형 조직도는 예쁘지만 「어느 팀이 몇 명 남았나」가
// 안 읽혔다. 연속 미제출은 뺐다(2026-10-07 — 쓸 일이 없다).
// 새 탭으로 열던 원형 조직도 그래프(/ops/monitor/graph)도 걷어 냈다(2026-10-07 — 겹치는 기능 정리, PG-50e).
// 같은 숫자를 다른 그림으로 한 번 더 보여 줄 뿐이었고, 화면이 둘이면 숫자가 갈라질 자리도 둘이 된다.
import { redirect, notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { OrgProgress } from '@/components/OrgProgress';
import { DeadlineScheduler } from '@/components/DeadlineScheduler';
import { canScheduleDeadlines } from '@/server/authz';
import { monitorData } from '@/server/monitor';
import { groupByHq } from '@/lib/org-groups';
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

  const data = await monitorData();
  const groups = groupByHq(data.nodes);
  const { slot } = data;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={scope.division.slug}
        divisionName={scope.division.nameKo}
        userName={scope.user.name}
        isLead={scope.isManager || scope.readAll}
        isOperator={scope.user.isOperator}
        readAll={scope.readAll}
        viaCloudflare={scope.source === 'cloudflare'}
        notifyEnabled={ps.scope.user.notifyEnabled}
      />
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="sr-only">전사 제출 현황</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            {/* PG-49c — 총괄에게 `/ops`는 404다. 누르면 404가 나는 링크는 그리지 않는다 (TACP-9) */}
            {scope.user.isOperator && (
              <Link href="/ops" className="tab-pill">
                ← 운영
              </Link>
            )}
            <Link href="/ops/audit" className="tab-pill">
              감사 로그
            </Link>
            <a href={`/api/ops/report?isoKey=${slot.isoKey}`} className="tab-pill">
              감사 문서 받기
            </a>
            <a href={`/api/ops/report?isoKey=${slot.isoKey}&format=csv`} className="tab-pill">
              CSV
            </a>
          </div>
        </div>

        {/* WS-19 · TACP-20 — 주차 마감은 총괄이 정한다. 바꿀 수 있는 사람에게만 그린다 (TACP-9) */}
        {canScheduleDeadlines(scope.user) && <DeadlineScheduler />}

        <OrgProgress
          groups={groups}
          weekLabel={slot.label}
          deadlineText={data.deadlineText}
          capturedAtKst={data.capturedAtKst}
          excludedNote={data.excludedNote}
        />

      </div>
      <AppFooter />
    </div>
  );
}
