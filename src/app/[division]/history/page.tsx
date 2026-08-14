// `/{slug}/history` — 내 제출 이력 (PG §3, 본인 것만)
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22

  const slots = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: 26 });
  const subs = await prisma.submission.findMany({
    where: { userId: ps.scope.user.id, weekSlotId: { in: slots.map((s) => s.id) }, isLatest: true },
  });
  const byId = new Map(subs.map((s) => [s.weekSlotId, s]));

  return (
    <main className="mt-6">
      <h1 className="text-lg font-bold text-ink">내 제출 이력</h1>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">주차</th>
              <th className="px-4 py-2.5 font-medium">상태</th>
              <th className="px-4 py-2.5 font-medium">버전</th>
              <th className="px-4 py-2.5 font-medium">제출시각</th>
              <th className="px-4 py-2.5 text-right font-medium">받기</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const sub = byId.get(s.id);
              return (
                <tr key={s.id} className={`border-b border-hairline-soft last:border-0 ${!sub ? 'bg-surface-soft/60' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-ink">
                    {s.year}년 {s.label}
                  </td>
                  <td className="px-4 py-2.5">
                    {sub ? <span className="text-success">● 제출</span> : <span className="text-muted-soft">미제출</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-body">{sub ? `v${sub.version}` : '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-body">
                    {sub ? toKstIso(sub.uploadedAt).slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {sub && (
                      <a
                        href={`/api/submissions/${sub.id}/download`}
                        className="rounded border border-hairline px-2.5 py-1 text-xs font-medium text-body hover:bg-surface-soft"
                      >
                        ↓ 받기
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
