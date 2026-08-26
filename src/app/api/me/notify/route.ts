// PUT /api/me/notify — 내 알림 받기 켜고 끄기 (NT-21).
//
// 본인 것만 바꾼다. 남의 설정은 운영자가 명단 화면에서 바꾼다 (NT-22) —
// 같은 일을 두 경로로 열면 "누가 껐나"가 흐려진다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') {
    throw new HttpError(422, 'invalid_request', 'enabled(true/false)가 필요합니다.');
  }

  // TACP-1 — 대상은 신원에서 나온다. 본문의 userId 같은 건 읽지도 않는다
  await prisma.user.update({ where: { id: scope.user.id }, data: { notifyEnabled: body.enabled } });
  await audit(scope.user.email, 'notify_pref', scope.division.id, `user:${scope.user.id}`, {
    enabled: body.enabled,
    by: 'self',
  });

  return json({ ok: true, enabled: body.enabled });
});
