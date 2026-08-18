// `/{slug}/history` — 내 제출 이력 (PG §3, 본인 것만)
import { prisma } from '@/server/db';
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { HistoryTable } from '@/components/HistoryTable';
import { toKstIso, slotKind } from '@/lib/week';

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
      <HistoryTable
        userId={ps.scope.user.id}
        userName={ps.scope.user.name}
        rows={slots.map((s) => {
          const sub = byId.get(s.id);
          return {
            slotId: s.id,
            label: `${s.year}년 ${s.label}`,
            submissionId: sub?.id ?? null,
            version: sub?.version ?? null,
            uploadedAtKst: sub ? toKstIso(sub.uploadedAt).slice(0, 16).replace('T', ' ') : null,
            monthly: slotKind(s) === 'monthly',
          };
        })}
      />
    </main>
  );
}
