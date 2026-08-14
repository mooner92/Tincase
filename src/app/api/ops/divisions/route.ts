// GET /api/ops/divisions · PUT — 테넌시 관리 (operator 전용, API-32/33)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, notFound, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { validateDeadlinePolicy } from '@/lib/week';

export const dynamic = 'force-dynamic';

async function requireOperator(headers: Headers) {
  const scope = await requireScope(headers);
  if (!scope.user.isOperator) throw notFound(); // 존재 은닉
  return scope;
}

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  void scope;
  const divisions = await prisma.division.findMany({
    orderBy: [{ isActive: 'desc' }, { nameKo: 'asc' }],
    include: { _count: { select: { users: { where: { isActive: true } } } } },
  });
  const activeTemplates = await prisma.template.groupBy({
    by: ['divisionId'],
    where: { isActive: true },
    _count: { _all: true },
  });
  const hasTemplate = new Set(activeTemplates.map((t) => t.divisionId));
  return json({
    divisions: divisions.map((d) => ({
      id: d.id,
      slug: d.slug,
      shortSlug: d.shortSlug,
      nameKo: d.nameKo,
      isActive: d.isActive,
      deadlineDow: d.deadlineDow,
      deadlineTime: d.deadlineTime,
      memberCount: d._count.users,
      hasTemplate: hasTemplate.has(d.id),
    })),
  });
});

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    isActive?: boolean;
    deadlineDow?: number;
    deadlineTime?: string;
    shortSlug?: string | null;
  } | null;
  if (!body?.id) throw new HttpError(422, 'invalid_request', 'id가 필요합니다.');

  const div = await prisma.division.findUnique({ where: { id: body.id } });
  if (!div) throw notFound();

  const data: Record<string, unknown> = {};
  if (typeof body.isActive === 'boolean') {
    // 온보딩 활성화는 양식이 있어야 의미가 있다 — 없으면 부서원 업로드가 막힌 채 열림
    if (body.isActive) {
      const tpl = await prisma.template.findFirst({ where: { divisionId: div.id, isActive: true } });
      if (!tpl) {
        throw new HttpError(409, 'no_template', `${div.nameKo}에 등록된 양식이 없습니다. 양식 등록 후 활성화하세요.`);
      }
    }
    data.isActive = body.isActive;
  }
  if (body.deadlineDow !== undefined || body.deadlineTime !== undefined) {
    const policy = {
      deadlineDow: body.deadlineDow ?? div.deadlineDow,
      deadlineTime: body.deadlineTime ?? div.deadlineTime,
    };
    const err = validateDeadlinePolicy(policy); // DM-10
    if (err) throw new HttpError(422, 'invalid_request', err);
    data.deadlineDow = policy.deadlineDow;
    data.deadlineTime = policy.deadlineTime;
  }
  if (body.shortSlug !== undefined) data.shortSlug = body.shortSlug || null;
  if (Object.keys(data).length === 0) throw new HttpError(422, 'invalid_request', '변경할 내용이 없습니다.');

  const updated = await prisma.division.update({ where: { id: div.id }, data });
  await audit(scope.user.email, 'rule_update', div.id, `ops:division:${div.slug}`, { changed: Object.keys(data) });
  return json({ ok: true, division: { id: updated.id, isActive: updated.isActive } });
});
