// GET /api/ops/report?isoKey=&format=html|csv — 주차 감사 문서 (OPS-30).
// 전 부서를 담으므로 readAll(총괄·운영자)만. TACP §3.2.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, notFound } from '@/server/authz';
import { handler } from '@/server/http';
import { audit } from '@/server/audit';
import { contentDisposition } from '@/server/storage';
import { layoutOrg, type DivisionNode } from '@/lib/orgtree';
import { reportCsv, reportHtml } from '@/server/report';
import { effectiveDeadline } from '@/server/worklog';
import { formatDeadlineKo, toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  if (!scope.readAll) throw notFound(); // 존재 은닉 (TACP-5)

  const isoKey = req.nextUrl.searchParams.get('isoKey');
  const csv = req.nextUrl.searchParams.get('format') === 'csv';
  const slot = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });
  if (!slot) throw notFound();

  const [divisions, subs] = await Promise.all([
    prisma.division.findMany({
      orderBy: [{ parentKo: 'asc' }, { nameKo: 'asc' }],
      include: {
        users: {
          where: { isActive: true },
          orderBy: [{ divisionRole: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, divisionRole: true, onRoster: true },
        },
      },
    }),
    prisma.submission.findMany({
      where: { weekSlotId: slot.id, isLatest: true },
      select: { userId: true, uploadedAt: true },
    }),
  ]);
  const byUser = new Map(subs.map((s) => [s.userId, s.uploadedAt]));

  const nodes: DivisionNode[] = divisions.map((d) => ({
    id: d.id,
    name: d.nameKo,
    slug: d.slug,
    parent: d.parentKo,
    isActive: d.isActive,
    people: d.users.map((u) => {
      const at = byUser.get(u.id);
      return {
        id: u.id,
        name: u.name,
        submitted: !!at,
        isLead: u.divisionRole === 'lead',
        onRoster: u.onRoster,
        submittedAtKst: at ? toKstIso(at).slice(5, 16).replace('T', ' ') : null,
      };
    }),
  }));

  const layout = layoutOrg(nodes);
  const now = new Date();
  const meta = {
    weekLabel: slot.label,
    isoKey: slot.isoKey,
    // 부서마다 마감이 다를 수 있으나(DM-10) 현재 전부 동일하므로 대표값을 쓴다
    deadlineKst: formatDeadlineKo(effectiveDeadline(slot, divisions[0])),
    capturedAtKst: toKstIso(now).slice(0, 16).replace('T', ' '),
    capturedBy: scope.user.name,
  };

  await audit(scope.user.email, 'download', null, `report:${slot.isoKey}:${csv ? 'csv' : 'html'}`);

  const base = `${slot.year}_${slot.label.replace(/ /g, '_')}_제출현황`;
  const body = csv ? reportCsv(layout, meta) : reportHtml(layout, meta);
  return new Response(body, {
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Disposition': contentDisposition(`${base}.${csv ? 'csv' : 'html'}`),
      'Cache-Control': 'no-store',
    },
  });
});
