// `/ops/monitor` — 옛 「전사」 [현황] 탭 주소. 이제 「전사」는 한 화면(`/org`)이라 그리로 보낸다 (PG-49f).
//
// 지우지 않고 보내는 이유: 즐겨찾기·메신저로 나간 링크·운영 화면의 옛 길이 이 주소를 들고 있다.
// 보던 주차(`?isoKey=`)는 그대로 넘긴다. 문은 `/org`와 같다 — 못 여는 사람에게는 예전처럼 404이고(TACP-5),
// 「이 주소는 어딘가로 이어진다」는 것조차 알려 주지 않는다.
import { notFound, redirect } from 'next/navigation';
import { requirePageScope } from '@/server/page-scope';
import { orgPageView } from '@/server/authz';
import { noticeFor } from '@/components/Notice';

export const dynamic = 'force-dynamic';

export default async function MonitorRedirect({ searchParams }: { searchParams: Promise<{ isoKey?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!(await orgPageView(ps.scope)).open) notFound();
  const { isoKey } = await searchParams;
  redirect(isoKey && /^\d{4}-W\d{2}$/.test(isoKey) ? `/org?isoKey=${isoKey}` : '/org');
}
