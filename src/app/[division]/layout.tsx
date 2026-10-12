// 부서 스코프 레이아웃 — slug/별칭 해석(PG-01), AppHeader, 격리(404)
import { notFound, redirect } from 'next/navigation';
import { getPageScope, getDivisionView, loginPath } from '@/server/page-scope';
import { HttpError, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { getTour } from '@/server/tour';

export const dynamic = 'force-dynamic';

export default async function DivisionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ division: string }>;
}) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect(await loginPath());
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam } = await params;

  let view;
  try {
    view = await getDivisionView(slugParam);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound(); // 남의 부서든 없는 부서든 동일 (AU-T17)
    throw e;
  }
  if (view.redirectTo) redirect(view.redirectTo); // 별칭 → 정식 슬러그
  const nav = await rollupNav(view.scope); // RU-31·32 — 취합 메뉴 (TACP-21)
  // PG-84 — 둘러보기. 남의 부서를 보는 중이면 권하지 않는다(장 목록만 — 메뉴로 내 화면을 연다)
  const tour = await getTour(view.scope, !view.isOwn);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={view.division.slug}
        divisionName={view.division.nameKo}
        userName={view.scope.user.name}
        isLead={view.canManage}
        isOperator={view.scope.user.isOperator}
        readAll={view.scope.readAll}
        {...nav}
        viaCloudflare={view.scope.source === 'cloudflare'}
        foreign={!view.isOwn}
        // [내 부서로]의 행선지 — 읽을 대상이 아니라 「돌아갈 곳」이라 신원의 부서다 (TACP-7의 읽기 해석과 무관)
        ownSlug={view.scope.division.slug}
        tour={tour}
      />
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-5 pb-8">
        {children}
      </div>
      <AppFooter />
    </div>
  );
}
