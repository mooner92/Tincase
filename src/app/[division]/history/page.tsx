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
      <h1 className="text-lg font-bold text-slate-900">내 제출 이력</h1>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
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
                <tr key={s.id} className={`border-b border-slate-100 last:border-0 ${!sub ? 'bg-slate-50/60' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {s.year}년 {s.label}
                  </td>
                  <td className="px-4 py-2.5">
                    {sub ? <span className="text-green-700">● 제출</span> : <span className="text-slate-400">미제출</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600">{sub ? `v${sub.version}` : '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600">
                    {sub ? toKstIso(sub.uploadedAt).slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {sub && (
                      <a
                        href={`/api/submissions/${sub.id}/download`}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
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
