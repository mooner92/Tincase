// `/ops` — 운영 (operator 전용, PG §6). 비운영자는 404 (존재 은닉).
import { notFound, redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { OpsClient } from './OpsClient';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';

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
        isLead={ps.scope.isLead || ps.scope.readAll}
        isOperator
        viaCloudflare={ps.scope.source === 'cloudflare'}
        notifyEnabled={ps.scope.user.notifyEnabled}
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-10 pb-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">운영</p>
        <h1 className="display mt-1 mb-6 text-[32px] leading-[1.15]">테넌시 · 인원 배치</h1>
        {/* PG-34는 v2.1에서 개정 — 운영자는 전체 열람 가능 (AU-15) */}
        <OpsClient />
      </main>
      <AppFooter />
    </div>
  );
}
