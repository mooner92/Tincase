// `/ops` — 운영 (operator 전용, PG §6). 비운영자는 404 (존재 은닉).
import { notFound, redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { OpsClient } from './OpsClient';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import Link from 'next/link';
import { messengerSinkOpen } from '@/server/messenger-sink';

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
      />
      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 pt-8 pb-8">
        <div className="page-head">
          <div>
            {/* 「테넌시 · 인원 배치」는 개발자 말이었다 — 이 화면에서 하는 일 그대로 (PG-55) */}
            <h1 className="page-title">부서 · 인원</h1>
          </div>
          {/* [감사 로그]는 운영자가 감사 기록으로 가는 유일한 길이라 둔다. [전사]는 걷었다 — 상단 메뉴 `전사`와 같은 곳이다
              (2026-10-08, R17) */}
          <div className="flex shrink-0 gap-1.5">
            {/* NT-56 — 시험·시연 서버에만 있는 화면. 운영에서는 그 화면이 404라 길도 그리지 않는다 (TACP-9) */}
            {messengerSinkOpen() && (
              <Link href="/ops/notify-sink" className="btn-secondary btn-sm">
                알림 수신함
              </Link>
            )}
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
