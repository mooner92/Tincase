// `/guide/present` — 사용 안내, 발표 모드 (PG-59) · `?view=notes` 발표자 창 (PG-60).
//
// 문은 `/guide`와 같다 — 로그인한 사람 누구나. 그리는 것은 **모든 장**이다: 11/2 운영회의에서 강당 프로젝터로
// 회사 전체에 흐름 전체를 보여 주는 화면이라, 보는 사람의 역할로 거르지 않는다(혼자 보기는 거른다 — PG-61).
// 버튼·링크가 아니라 그림과 글이므로 TACP-9(할 수 없는 행동은 그리지 않는다)와 부딪히지 않는다.
//
// 머리·바닥(AppHeader)이 없다 — 무대 하나가 화면 전체다(2026-10-08 v2 — 흰 무대, PG-82). 둘러보기 카드도 여기에는 뜨지 않는다(PG-84).
import { requirePageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { GuidePresent } from '@/components/GuidePresent';

export const dynamic = 'force-dynamic';
export const metadata = { title: '사용 안내 · 발표' };

export default async function GuidePresentPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { view } = await searchParams;
  return <GuidePresent view={view === 'notes' ? 'notes' : 'stage'} />;
}
