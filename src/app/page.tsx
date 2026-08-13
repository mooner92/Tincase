// `/` — 자기 부서 페이지로 이동 (PG 라우트 지도)
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  redirect(`/${ps.scope.division.slug}`);
}
