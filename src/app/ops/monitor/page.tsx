// `/ops/monitor` — 「전사」 메뉴의 [현황] 탭: 전사 제출 현황. 운영자·총괄 전용 (TACP §3.2 readAll).
//
// PG-50 (2026-10-07) — 본판은 **본부별 팀 막대**다. 원형 조직도는 예쁘지만 「어느 팀이 몇 명 남았나」가
// 안 읽혔다. 원형은 구석의 [조직도 그래프 ↗]로 새 탭에서 연다. 연속 미제출은 뺐다(2026-10-07 — 쓸 일이 없다).
//
// PG-49e — [취합](/org)과 한 메뉴다. 위쪽 탭 막대가 두 화면 사이의 길이고, 감사 로그·CSV 같은 곁가지는
// 막대 오른쪽에 작게 둔다. WS-19l — 마감과 3단계 기한은 이 탭의 「주차 일정」 카드 **하나**에서 정한다.
import { redirect, notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { OrgProgress } from '@/components/OrgProgress';
import { OrgTabs } from '@/components/OrgTabs';
import { WeekSchedule } from '@/components/WeekSchedule';
import { canOpenMonitor, canOperate, canScheduleDeadlines, orgTabs, rollupNav } from '@/server/authz';
import { monitorData } from '@/server/monitor';
import { deadlineStatus } from '@/server/slot-deadline';
import { loadOrgSetting } from '@/server/rollup/tree';
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
  if (!canOpenMonitor(scope)) notFound();

  const data = await monitorData();
  const groups = groupByHq(data.nodes);
  const { slot } = data;
  const [nav, tabs] = await Promise.all([rollupNav(scope), orgTabs(scope)]);
  // WS-19l — 「주차 일정」 카드: 마감 바꾸기는 TACP-20, 3단계 스위치·간격은 TACP-21([취합]과 같은 문)
  const canSchedule = canScheduleDeadlines(scope.user);
  const setting = tabs.org ? await loadOrgSetting() : null;
  // monitorData 뒤에 — 둘 다 이번 주 주차를 만들 수 있어서(upsert) 동시에 돌리면 같은 행을 두 번 만들려 한다
  const schedule = canSchedule || setting ? await deadlineStatus() : null;

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
        notifyEnabled={ps.scope.user.notifyEnabled}
      />
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <h1 className="sr-only">전사 제출 현황</h1>
        <OrgTabs current="monitor" tabs={tabs}>
          {/* 곁가지 — 이 탭에만 있는 것. PG-49c: 총괄에게 `/ops`는 404다 — 누르면 404인 링크는 그리지 않는다 (TACP-9) */}
          {canOperate(scope.user) && (
            <Link href="/ops" className="text-muted underline-offset-2 hover:text-ink hover:underline">
              ← 운영
            </Link>
          )}
          <Link href="/ops/audit" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            감사 로그
          </Link>
          <a href={`/api/ops/report?isoKey=${slot.isoKey}`} className="text-muted underline-offset-2 hover:text-ink hover:underline">
            감사 문서 받기
          </a>
          <a href={`/api/ops/report?isoKey=${slot.isoKey}&format=csv`} className="text-muted underline-offset-2 hover:text-ink hover:underline">
            CSV
          </a>
          {/* PG-50 — 원형 조직도는 구석에서 새 탭으로 */}
          <a href="/ops/monitor/graph" target="_blank" rel="noopener" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            조직도 그래프 ↗
          </a>
        </OrgTabs>

        {/* WS-19l — 바꿀 수 있는 것이 하나라도 있는 사람에게만 그린다. 그 안에서도 할 수 있는 것만 (TACP-9) */}
        {schedule && (
          <WeekSchedule
            weeks={schedule.weeks}
            canSchedule={canSchedule}
            rollup={setting && { enabled: setting.enabled, unitDueMinutes: setting.unitDueMinutes, hqDueMinutes: setting.hqDueMinutes }}
          />
        )}

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
