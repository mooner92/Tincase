// POST /api/forgot — 비밀번호를 잊었을 때 **본인이** 재설정 링크를 요청한다 (AU-32).
//
// 예전에는 운영자에게 말해야 했다. 그러면 운영자가 매번 불려 다니고, 급할 때
// 자리에 없으면 그날은 못 들어온다. 링크가 그 사람 메신저로만 가므로 운영자를
// 거칠 이유가 없다 — 사람이 하던 확인을 메신저 계정이 대신한다.
//
// ── 조용히 실패한다 ★ ──────────────────────────────────────
// **어떤 경우에도 같은 응답을 준다.** 없는 메일이라고 알려 주면 그것만으로
// 「누가 이 시스템을 쓰는가」를 캐낼 수 있다 (사내망이라도 명단은 명단이다).
// 사번이 없어 메신저를 못 받는 경우도 마찬가지다 — 화면은 「보냈습니다」라고 하고,
// 운영자만 로그에서 «못 보냈다»를 본다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { handler, json, rateLimit } from '@/server/http';
import { HttpError } from '@/server/authz';
import { sendAlert, messengerStatus } from '@/server/messenger';
import { issueSetupToken, forgotMessage } from '@/server/setup-token';
import { audit } from '@/server/audit';
import { env } from '@/server/env';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

/** 언제나 이것만 돌려준다 — 있는 메일인지 없는 메일인지 화면이 알 수 없게 */
const SAME = { ok: true } as const;

export const POST = handler(async (req: NextRequest) => {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  // 남의 메신저로 링크를 계속 쏘는 것을 막는다. 링크 자체는 본인에게만 가지만,
  // 쪽지가 쌓이는 것도 괴롭힘이다
  rateLimit(`forgot-ip:${ip}`, 10, 10 * 60_000);

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new HttpError(422, 'invalid_request', '메일 주소를 입력해 주세요.');
  rateLimit(`forgot-mail:${email}`, 3, 30 * 60_000);

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, name: true, employeeNo: true, divisionId: true, passwordHash: true },
  });

  // 여기서부터 실패해도 화면에는 똑같이 말한다
  if (!user || !user.employeeNo || !messengerStatus().enabled || !env.MESSENGER_LINK_BASE) {
    logger.info(
      { action: 'forgot', email, found: !!user, hasEmployeeNo: !!user?.employeeNo },
      '[비밀번호] 재설정 요청 — 보내지 못함',
    );
    return json(SAME);
  }

  const { token } = await issueSetupToken(user.id, `self:${email}`);
  const 처음 = !user.passwordHash;

  // 링크는 `URL` 필드에도 실린다 — 본문의 주소는 메신저에서 눌리지 않는다(forgotMessage)
  await sendAlert({
    recvIds: [user.employeeNo],
    ...forgotMessage(user.name, `${env.MESSENGER_LINK_BASE}/setup/${token}`, 처음),
    kind: 'forgot', // NT-56 — 가짜 수신함이 종류를 안다 (NotifyLog에는 남지 않는 알림)
  });

  await audit(email, 'setup_link', user.divisionId, `user:${user.id}`, { self: true });
  return json(SAME);
});
