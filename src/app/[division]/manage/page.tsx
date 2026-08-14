// `/{slug}/manage` — 수합 관리 (lead 전용, member는 404 — AU-06)
import { notFound, redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ManageView } from './ManageView';

export const dynamic = 'force-dynamic';

export default async function ManagePage({ params }: { params: Promise<{ division: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam } = await params;
  const view = await getDivisionView(slugParam);
  if (!view.canManage) notFound(); // PG-T08
  return <ManageView division={view.division} isOwn={view.isOwn} />;
}
