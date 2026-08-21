// `/{slug}/archive` — 주간업무 보관함 (PG-45, TACP-15).
//
// 목요일 14시에 자동으로 병합된 결과를 **부서원 모두**가 본다.
// 그동안 병합본은 담당자만 봤는데, 그 문서는 취합게시판에 올라가 전사가 읽는다 —
// 정작 그 글을 쓴 사람만 못 보고 있었다. 결과를 보면 다음 주에 뭘 어떻게 쓸지 감이 잡히고,
// 잘못 들어간 것도 본인이 먼저 발견한다.
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getPageScope, getDivisionView } from '@/server/page-scope';
import { noticeFor } from '@/components/Notice';
import { ArchiveList } from '@/components/ArchiveList';
import { toKstIso, slotKind } from '@/lib/week';

export const dynamic = 'force-dynamic';

export default async function ArchivePage({ params }: { params: Promise<{ division: string }> }) {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return noticeFor(ps.code, ps.message);
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1'); // AU-22
  const { division: slugParam } = await params;
  const view = await getDivisionView(slugParam); // TACP-7 — 대상 부서는 단일 해석기로

  const runs = await prisma.mergeRun.findMany({
    where: { divisionId: view.division.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
    include: { weekSlot: true },
    take: 60,
  });

  // 주차당 마지막 성공본만 — 다시 병합하면 같은 주차에 여러 건이 쌓인다
  const seen = new Set<string>();
  const items = runs
    .filter((r) => !seen.has(r.weekSlotId) && seen.add(r.weekSlotId))
    .map((r) => {
      const counts = r.rowCounts ? (JSON.parse(r.rowCounts) as Record<string, number>) : null;
      return {
        isoKey: r.weekSlot.isoKey,
        label: `${r.weekSlot.year}년 ${r.weekSlot.label}`,
        monthly: slotKind(r.weekSlot) === 'monthly',
        madeAtKst: toKstIso(r.finishedAt ?? r.startedAt).slice(5, 16).replace('T', ' '),
        sources: (JSON.parse(r.sourceIds) as string[]).length,
        counts,
      };
    });

  return (
    <main className="pt-10">
      <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">보관함</p>
      <h1 className="display mt-1 text-[32px] leading-[1.15]">{view.division.nameKo} 주간업무</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-body">
        마감 후 자동으로 합쳐진 부서 업무일지입니다. 취합게시판에 올라가는 그 문서이고,
        <strong className="font-semibold text-ink"> 부서원 누구나 열어볼 수 있습니다.</strong>{' '}
        고칠 부분이 보이면 담당자에게 알려주세요.
      </p>

      <div className="mt-7">
        <ArchiveList items={items} divisionSlug={view.division.slug} canEdit={view.canEditMerged} />
      </div>
    </main>
  );
}
