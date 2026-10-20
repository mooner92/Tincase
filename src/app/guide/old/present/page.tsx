// `/guide/old/present` — 예전 사용 안내의 발표 모드(PG-100). `/guide/present`와 같은 문 · 같은 무대, 실·팀(5칸 표) 한 가지.
import { requirePageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { GuidePresent } from '@/components/GuidePresent';

export const dynamic = 'force-dynamic';
export const metadata = { title: '사용 안내 · 발표 (예전 판)' };

export default async function GuideOldPresentPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { view } = await searchParams;
  return <GuidePresent view={view === 'notes' ? 'notes' : 'stage'} base="/guide/old/present" />;
}
