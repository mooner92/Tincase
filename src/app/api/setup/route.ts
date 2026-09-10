// POST /api/setup — 링크로 **본인이** 비밀번호를 설정한다 (AU-30).
//
// **인증 없이 열리는 유일한 쓰기 경로다.** 그래서 할 수 있는 일이 하나뿐이어야 한다:
// 그 토큰이 가리키는 사람의 비밀번호를 정하는 것. `userId`는 요청이 정하지 않는다 —
// 토큰에서 나온다 (TACP-6의 「대상은 요청이 정하지 않는다」와 같은 결).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { hashPassword, validatePasswordPolicy } from '@/server/password';
import { destroyAllSessions } from '@/server/session';
import { consumeSetupToken, readSetupToken } from '@/server/setup-token';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!token || !password) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');

  // 인증이 없으므로 IP 기준으로 막는다. 토큰이 32바이트 난수라 추측은 애초에 불가능하지만,
  // 인증 밖 경로를 무제한으로 열어 두지는 않는다
  rateLimit(`setup:${req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'}`, 20, 10 * 60_000);

  const state = await readSetupToken(token);
  if (!state.ok) {
    const msg = {
      unknown: '쓸 수 없는 링크입니다. 운영자에게 다시 요청해 주세요.',
      used: '이미 사용한 링크입니다. 로그인 화면에서 들어가 주세요.',
      expired: '기한이 지난 링크입니다. 운영자에게 다시 요청해 주세요.',
    }[state.reason];
    throw new HttpError(410, `token_${state.reason}`, msg);
  }

  const bad = validatePasswordPolicy(password, { email: state.user.email, name: state.user.name });
  if (bad) throw new HttpError(422, 'weak_password', bad);

  /*
   * **토큰을 먼저 태운다.** 비밀번호를 먼저 바꾸면, 같은 링크로 동시에 두 번 들어온 요청이
   * 둘 다 성공해 뒤엣것이 이긴다 — 누가 정한 비밀번호인지 아무도 모르는 상태가 된다.
   * `updateMany`의 `usedAt: null` 조건이 딱 하나만 통과시킨다.
   */
  if (!(await consumeSetupToken(token))) {
    throw new HttpError(410, 'token_used', '이미 사용한 링크입니다.');
  }

  const user = await prisma.user.update({
    where: { id: state.user.id },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: false, // 본인이 정했으므로 다시 바꾸게 하지 않는다
      failedLoginCount: 0,
      lockedUntil: null,
    },
    select: { id: true, divisionId: true, email: true },
  });
  // AU-25 — 혹시 남아 있던 세션은 전부 끊는다
  await destroyAllSessions(user.id);

  await audit(user.email, 'setup_done', user.divisionId, `user:${user.id}`);
  logger.info({ action: 'setup_done', target: user.email }, 'password set via setup link');

  return json({ ok: true });
});
