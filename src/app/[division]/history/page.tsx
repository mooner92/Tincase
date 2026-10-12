// `/{slug}/history` — 옛 주소. 「내 이력」은 홈의 지난 주차로 합쳤다 (PG-70).
// 2026-12-31까지 남긴다 — 메신저·즐겨찾기에 남은 옛 링크가 대개 며칠 안에 눌린다. 2027년 첫 정리 때 시험과 함께 지운다.
import { notFound, redirect } from 'next/navigation';
import { requirePageScope, getDivisionView, type DivisionView } from '@/server/page-scope';
import { HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';

export const dynamic = 'force-dynamic';

export default async function HistoryRedirect({ params }: { params: Promise<{ division: string }> }) {
  const ps = await requirePageScope(); // AU-22 — 보내기만 하는 페이지도 거친다 (AU-T39)
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  let view: DivisionView;
  try {
    view = await getDivisionView((await params).division);
  } catch (e) {
    // 레이아웃과 병렬로 그려지므로 페이지가 스스로 막는다 — 남의 부서·없는 부서는 어디로도 보내지 않고 404 (TACP-5)
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const slug = view.division.slug; // 별칭이어도 정식 슬러그로 한 번에
  // 역할은 getDivisionView가 계산한 값만 본다 (TACP-12). 307 — 이 주소가 나중에 다른 뜻으로 쓰일 수 있다
  redirect(view.isOwn ? `/${slug}` : `/${slug}/manage`);
}
