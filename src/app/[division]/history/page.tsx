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
  // TACP-22 — 담당자가 고친 판이면 고친 사람 이름
  const editorIds = [...new Set(subs.map((s) => s.editedById).filter((x): x is string => !!x))];
  const editors = new Map(
    (await prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return (
    <main className="pt-8">
      <h1 className="page-title">내 제출 이력</h1>
      <p className="page-sub">최근 26주. 낸 주는 열어 보거나 받을 수 있습니다.</p>
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
            editedBy: sub?.editedById ? (editors.get(sub.editedById) ?? '담당자') : null,
            // TACP-22 — 제출시각은 내가 낸 시각 그대로, 고친 시각은 따로
            editedAtKst: sub?.editedAt ? toKstIso(sub.editedAt).slice(11, 16) : null,
          };
        })}
      />
    </main>
  );
}
