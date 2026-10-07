// `/ops/monitor/graph` — 원형 조직도 (PG-50). 「전사」 [현황] 탭 구석의 [조직도 그래프 ↗]에서 새 탭으로 연다.
// 본판(팀 막대)과 **같은 데이터**를 쓴다(`monitorData`) — 두 화면의 숫자가 갈라지지 않게.
import { redirect, notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { OrgMonitor } from '@/components/OrgMonitor';
import { monitorData } from '@/server/monitor';
import { layoutOrg } from '@/lib/orgtree';
import { canOpenMonitor } from '@/server/authz';

export const dynamic = 'force-dynamic';

export default async function MonitorGraphPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1');
  if (!canOpenMonitor(ps.scope)) notFound(); // TACP-5 — [현황] 탭과 같은 문

  const data = await monitorData();
  // 트리에는 **실제로 업무일지를 내는 부서만** 그린다 — 30개 전부 그리면 회색 점이 원 둘레를 채운다
  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 py-8">
      <OrgMonitor
        layout={layoutOrg(data.counted)}
        weekLabel={data.slot.label}
        capturedAtKst={data.capturedAtKst}
        deadlineText={data.deadlineText}
        excludedNote={data.excludedNote}
      />
    </main>
  );
}
