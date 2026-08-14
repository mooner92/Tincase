// 부서 스코프 레이아웃 — slug/별칭 해석(PG-01), AppHeader, 격리(404)
import { notFound, redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { resolveDivisionPage, HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';

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

  let division;
  try {
    const r = await resolveDivisionPage(ps.scope, decodeURIComponent(slugParam));
    if (r.redirectTo) redirect(r.redirectTo); // 별칭 → 정식 슬러그
    division = r.division;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound(); // 남의 부서든 없는 부서든 동일 (AU-T17)
    throw e;
  }

  const { user } = ps.scope;
  const isOwn = division.id === ps.scope.division.id;
  const showManage = isOwn && (ps.scope.isLead || ps.scope.readAll);

  return (
    <div className="min-h-screen">
      <AppHeader
        slug={division.slug}
        divisionName={division.nameKo}
        userName={user.name}
        isLead={showManage}
        isOperator={user.isOperator}
        viaCloudflare={ps.scope.source === 'cloudflare'}
      />
      <div className="mx-auto max-w-[1280px] px-5 pb-24">{children}</div>
    </div>
  );
}
