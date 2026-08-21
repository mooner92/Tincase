// `/{slug}/manage/{isoKey}` — 과거 주차 (PG-24)
import { notFound, redirect } from 'next/navigation';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ManageView } from '../ManageView';

export const dynamic = 'force-dynamic';

export default async function ManageWeekPage({ params }: { params: Promise<{ division: string; isoKey: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam, isoKey } = await params;
  const view = await getDivisionView(slugParam);
  if (!view.canManage) notFound();
  if (!/^\d{4}-W\d{2}$/.test(isoKey)) notFound();
  return <ManageView
      division={view.division}
      isoKey={isoKey}
      canMerge={view.isOwn && view.canManage}
      canDownloadMerged={view.canManage}
      canDeleteAny={view.canDeleteAny}
      canEditMerged={view.canEditMerged}
    />;
}
