// `/ops` — 운영 (operator 전용, PG §6). 비운영자는 404 (존재 은닉).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { OpsClient } from './OpsClient';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const ps = await getPageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!ps.scope.user.isOperator) notFound();

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-16">
      <header className="flex items-center justify-between border-b border-slate-200 py-4">
        <h1 className="text-base font-bold text-slate-800">
          운영 <span className="font-normal text-slate-500">· 테넌시 · 인원 배치</span>
        </h1>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href={`/${ps.scope.division.slug}`} className="text-blue-700 hover:underline">
            내 부서 페이지
          </Link>
          <span>{ps.scope.user.name} 님</span>
        </nav>
      </header>
      <main className="mt-6">
        {/* PG-34는 v2.1에서 개정 — 운영자는 전체 열람 가능 (AU-15). 현황은 각 부서 manage로 */}
        <OpsClient />
      </main>
    </div>
  );
}
