// `/ops/monitor` — 전사 제출 현황. 운영자·총괄 전용 (TACP §3.2 readAll).
//
// PG-50 (2026-10-07) — 본판은 **본부별 팀 막대**다. 원형 조직도는 예쁘지만 「어느 팀이 몇 명 남았나」가
// 안 읽혔다. 원형은 구석의 [조직도 그래프 ↗]로 새 탭에서 연다. 연속 미제출은 접어 둔다 — 매일 볼 것이 아니다.
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
  const { slot, streaks } = data;

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
          {/* PG-50 — 원형 조직도는 구석에서 새 탭으로 */}
          <a href="/ops/monitor/graph" target="_blank" rel="noopener" className="text-sm text-muted underline hover:text-ink">
            조직도 그래프 ↗
          </a>
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

        {/* 연속 미제출 — 매주 볼 것은 아니어서 접어 둔다. 필요할 때 펼친다 */}
        {streaks.length > 0 && (
          <details className="card mt-6 px-6 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              연속 미제출 {streaks.length}명
              <span className="ml-2 text-xs font-normal text-muted">
                마감이 지난 최근 {streaks[0].weeks}주차 기준 · 펼쳐서 보기
              </span>
            </summary>
            <ul className="mt-3 space-y-1.5 text-sm">
              {streaks.slice(0, 30).map((r) => (
                <li key={r.userId} className="flex flex-wrap items-baseline gap-x-3">
                  <span
                    className={`inline-block w-14 shrink-0 text-right font-semibold tabular-nums ${
                      r.streak >= 4 ? 'text-error' : 'text-warning'
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
          </details>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
