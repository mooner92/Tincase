// `/{slug}/manage/{isoKey}` — 과거 주차 (PG-24)
import { notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ManageView } from '../ManageView';

export const dynamic = 'force-dynamic';

export default async function ManageWeekPage({ params }: { params: Promise<{ isoKey: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!ps.scope.isLead && !ps.scope.readAll) notFound();
  const { isoKey } = await params;
  if (!/^\d{4}-W\d{2}$/.test(isoKey)) notFound();
  return <ManageView scope={ps.scope} isoKey={isoKey} />;
}
