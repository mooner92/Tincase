// `/ops` — 운영 (operator 전용, PG §6). 비운영자는 404 (존재 은닉).
import { notFound, redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { OpsClient } from './OpsClient';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  if (!ps.scope.user.isOperator) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        slug={ps.scope.division.slug}
        divisionName={ps.scope.division.nameKo}
        userName={ps.scope.user.name}
        isLead={ps.scope.isManager || ps.scope.readAll}
        isOperator
        readAll
        viaCloudflare={ps.scope.source === 'cloudflare'}
        notifyEnabled={ps.scope.user.notifyEnabled}
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <div className="page-head">
          <div>
            {/* 「테넌시 · 인원 배치」는 개발자 말이었다 — 이 화면에서 하는 일 그대로 (PG-55) */}
            <h1 className="page-title">부서 · 인원</h1>
            <p className="page-sub">부서 마감·활성과 인원 명단을 관리합니다. 바꾸면 바로 저장됩니다.</p>
          </div>
          {/* 전사 화면으로 가는 길 — 없으면 만들어도 아무도 못 간다. 이름은 상단 메뉴와 같게 (PG-49f — 「전사」 한 화면).
              「조직도」는 뺐다 — 원형 조직도 그래프는 걷어 냈다(2026-10-07, PG-50e) */}
          <div className="flex shrink-0 gap-2">
            <Link href="/org" className="btn-secondary btn-sm">
              전사
            </Link>
            <Link href="/ops/audit" className="btn-secondary btn-sm">
              감사 로그
            </Link>
          </div>
        </div>
        {/* PG-34는 v2.1에서 개정 — 운영자는 전체 열람 가능 (AU-15) */}
        <div className="mt-6">
          <OpsClient />
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
