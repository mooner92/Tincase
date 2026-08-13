// `/{slug}/manage` — 수합 관리 (lead 전용, member는 404 — AU-06)
import { notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ManageView } from './ManageView';

export const dynamic = 'force-dynamic';

export default async function ManagePage() {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!ps.scope.isLead && !ps.scope.readAll) notFound(); // PG-T08
  return <ManageView scope={ps.scope} />;
}
