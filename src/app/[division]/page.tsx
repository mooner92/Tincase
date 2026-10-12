// `/{slug}` — 부서원 홈 (PG-66). 이번 주 카드 + 지난 주차, 두 덩어리뿐이다.
//
// 2026-10-08 (사용자) — 부서원 메뉴 「제출 · 보관함 · 내 이력」 셋을 홈 하나로 합쳤다. 내가 낸 것과 부서 병합본은
// 같은 질문(그 주에 무엇이 나갔나)의 두 답이라 한 줄에 둔다. 부서 제출 명단은 홈에서 뺐다 — 누가 냈는지는
// 담당자가 수합 관리에서 본다(TACP-11 v1.8 · ADR-0016). 카운트다운·설명 상자·hwp 업로드 길도 없다.
//
// 남의 부서를 읽는 사람(총괄·운영자)은 여기서 할 일이 없다 — 그 부서의 수합 관리로 보낸다(PG-70).
import { notFound, redirect } from 'next/navigation';
import { requirePageScope, getDivisionView, type DivisionView } from '@/server/page-scope';
import { HttpError } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { loadMemberHome } from '@/server/my-weeks';
import { ThisWeekCard } from '@/components/ThisWeekCard';
import { PastWeeks } from '@/components/PastWeeks';

export const dynamic = 'force-dynamic';

export default async function MemberHome({ params }: { params: Promise<{ division: string }> }) {
  const ps = await requirePageScope(); // AU-22 · AU-T39
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  let view: DivisionView;
  try {
    // ★ 해석된 부서를 쓴다 — scope.division을 쓰면 헤더와 본문이 어긋난다 (TACP-7)
    view = await getDivisionView((await params).division);
  } catch (e) {
    // 레이아웃과 병렬로 그려지므로 페이지도 스스로 막는다 — 남의 부서·없는 부서는 같은 404 (AU-T17 · TACP-5)
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  if (!view.isOwn) redirect(`/${view.division.slug}/manage`); // PG-70 — 「개요」는 없어졌다

  const { card, groups, showMissing } = await loadMemberHome(view, new Date());
  // PG-66d — 지난 주차가 하나도 없으면(첫 주) 카드만 7칸. 「아직 없습니다」 같은 문장·빈 카드는 두지 않는다
  const paired = groups.recent.length + groups.older.length > 0;
  return (
    <main className="grid grid-cols-1 items-start gap-4 pt-8 lg:grid-cols-12 lg:gap-6">
      <ThisWeekCard {...card} layout={paired ? 'paired' : 'alone'} />
      {paired && <PastWeeks groups={groups} showMissing={showMissing} divisionSlug={view.division.slug} me={card.me} />}
    </main>
  );
}
