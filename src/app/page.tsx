// `/` — 자기 부서 페이지로 이동 (PG 라우트 지도)
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  redirect(`/${ps.scope.division.slug}`);
}
