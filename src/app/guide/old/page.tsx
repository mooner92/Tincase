// `/guide/old` — 예전 사용 안내(PG-100, 2026-10-20). 갈래(실형 · 연구 본부 · 평가본부)로 나누기 전의 안내 그대로 — 실·팀(5칸 표) 한 가지다.
// 새 안내(`/guide`)가 부서 방식별로 갈라지면서, 이미 이 안내로 익힌 분들이 그대로 볼 수 있게 남긴다. 문은 `/guide`와 같다(로그인한 사람 누구나).
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { guideCaps, rollupNav } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import { GuideSelf } from '@/components/GuideSelf';
import { getTour } from '@/server/tour';

export const dynamic = 'force-dynamic';
export const metadata = { title: '사용 안내 (예전 판)' };

export default async function GuideOldPage() {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  const { scope } = ps;
  const [caps, rnav, tour] = await Promise.all([guideCaps(scope), rollupNav(scope), getTour(scope, false)]);
  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <AppHeader
          slug={scope.division.slug}
          divisionName={scope.division.nameKo}
          userName={scope.user.name}
          isLead={scope.isManager || scope.readAll}
          isOperator={scope.user.isOperator}
          readAll={scope.readAll}
          {...rnav}
          viaCloudflare={scope.source === 'cloudflare'}
          tour={tour}
        />
      </div>
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8 print:max-w-none print:p-0">
        <div className="page-head print:hidden">
          <div className="min-w-0">
            <h1 className="page-title">사용 안내 · 예전 판</h1>
            <p className="mt-1 text-sm text-muted">
              부서 방식별로 나누기 전의 안내예요(실·팀 5칸 표).{' '}
              <Link href="/guide" className="underline underline-offset-2 hover:text-ink">
                새 안내 보기
              </Link>
            </p>
          </div>
          <Link href="/guide/old/present" target="_blank" className="btn-ghost hidden sm:inline-flex">
            발표 모드로 보기 <span aria-hidden>↗</span>
          </Link>
        </div>
        <GuideSelf caps={caps} tour={{ slug: tour.slug, chapters: tour.chapters }} />
      </main>
      <div className="print:hidden">
        <AppFooter />
      </div>
    </div>
  );
}
