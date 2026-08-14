// 부서 스코프 레이아웃 — slug/별칭 해석(PG-01), AppHeader, 격리(404)
import { notFound, redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { ForeignDivisionBanner } from '@/components/ForeignDivisionBanner';

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
    if (ps.code === 'unauthenticated') redirect('/login');
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

  return (
    <div className="min-h-screen">
      <AppHeader
        slug={view.division.slug}
        divisionName={view.division.nameKo}
        userName={view.scope.user.name}
        isLead={view.canManage}
        isOperator={view.scope.user.isOperator}
        viaCloudflare={view.scope.source === 'cloudflare'}
        foreign={!view.isOwn}
      />
      <div className="mx-auto max-w-[1280px] px-5 pb-24">
        {!view.isOwn && (
          <ForeignDivisionBanner divisionName={view.division.nameKo} ownSlug={view.scope.division.slug} />
        )}
        {children}
      </div>
    </div>
  );
}
