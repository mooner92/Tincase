// 부서 스코프 레이아웃 — slug/별칭 해석(PG-01), 헤더(PG-03), 격리(404)
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getPageScope } from '@/server/page-scope';
import { resolveDivisionPage, HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { LogoutButton } from '@/components/LogoutButton';

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
    <div className="mx-auto max-w-[960px] px-4 pb-16">
      <header className="flex items-center justify-between border-b border-slate-200 py-4">
        <Link href={`/${division.slug}`} className="text-base font-bold text-slate-800">
          주간 업무일지 <span className="font-normal text-slate-500">· {division.nameKo}</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          {showManage && (
            <Link href={`/${division.slug}/manage`} className="font-medium text-blue-700 hover:underline">
              수합 관리
            </Link>
          )}
          {user.isOperator && (
            <Link href="/ops" className="font-medium text-purple-700 hover:underline">
              운영
            </Link>
          )}
          <Link href={`/${division.slug}/history`} className="hover:underline">
            내 이력
          </Link>
          <Link href="/password" className="hover:underline">
            비밀번호
          </Link>
          <span className="text-slate-400">|</span>
          <span>{user.name} 님</span>
          <LogoutButton viaCloudflare={ps.scope.source === 'cloudflare'} />
        </nav>
      </header>
      {children}
    </div>
  );
}
