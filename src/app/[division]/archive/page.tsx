// `/{slug}/archive` — 옛 주소. 「보관함」은 홈의 지난 주차 [병합본]으로 합쳤다 (PG-70).
// 담당자·부서장은 수합 관리로 보낸다 — 이미 나간 `merge_review` 알림 링크가 이 주소이고, 승인은 수합 관리에서 한다(D19).
// 2026-12-31까지 남긴다. 2027년 첫 정리 때 시험과 함께 지운다.
import { notFound, redirect } from 'next/navigation';
import { requirePageScope, getDivisionView, type DivisionView } from '@/server/page-scope';
import { HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';

export const dynamic = 'force-dynamic';

export default async function ArchiveRedirect({ params }: { params: Promise<{ division: string }> }) {
  const ps = await requirePageScope(); // AU-22 — 보내기만 하는 페이지도 거친다 (AU-T39)
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  let view: DivisionView;
  try {
    view = await getDivisionView((await params).division);
  } catch (e) {
    // 남의 부서·없는 부서는 어디로도 보내지 않고 404 — 주소가 어딘가로 이어진다는 것도 알리지 않는다 (TACP-5)
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const slug = view.division.slug;
  // canManage = 내 부서 lead·head 또는 readAll (getDivisionView — TACP-12)
  redirect(view.canManage ? `/${slug}/manage` : `/${slug}`);
}
