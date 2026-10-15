// POST /api/division/merged/append — 늦게 낸 사람을 병합본 **맨 뒤에** 붙인다 (API-69 · LE-20~34). 다시 병합하지 않는다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireOwnManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { appendLate, NothingToAppend } from '@/server/merge/append';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // API-50a — 인증·역할이 본문보다 먼저. 쓰기는 신원의 부서에만(TACP-6)
  const scope = await requireOwnManager(req.headers);
  rateLimit(`merged-append:${scope.user.email}`, 20, 60_000);

  const body = (await req.json().catch(() => null)) as { isoKey?: unknown; runId?: unknown; sha256?: unknown } | null;
  if (!body || typeof body.isoKey !== 'string' || !body.isoKey) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');
  const slot = await prisma.weekSlot.findUnique({ where: { isoKey: body.isoKey } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  try {
    const r = await appendLate(scope, slot, body);
    return json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof NothingToAppend) return json({ error: e.code, message: e.message, detail: e.detail }, { status: 409 });
    throw e;
  }
});
