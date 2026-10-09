// POST /api/forgot — 비밀번호를 잊었을 때 **본인이** 재설정 링크를 요청한다 (AU-32). 로그인 없이 열리는 길이다 — TACP §6 (v1.14).
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
//
// ── 2026-10-10 출시 전 점검 (ADR-0020) ─────────────────────
// AU-32a 꺼진 부서 사람에게도 실제 쪽지가 나갔다 — 그 사람은 링크로 정해도 로그인할 수 없다. 이제 `canSignIn`(requireScope와 같은 식)인 사람에게만.
// AU-32b IP 한도는 `cf-connecting-ip`·`x-forwarded-for`로 셌다 — 보내는 쪽이 고르는 값이라 바꿔 가며 보내면 한도가 없었다.
//        이제 바탕은 전체 한도와 사람마다 한도(DB에 남은 링크로 센다)이고, IP 한도는 거들 뿐이다.
// AU-30a 새 링크가 운영자의 링크를 「이미 사용한 링크」로 바꿔 보이게 했다 — 밀린 링크는 따로 적는다(setup-token.ts).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { handler, json, rateLimit } from '@/server/http';
import { HttpError, canSignIn } from '@/server/authz';
import { sendAlert, messengerStatus, canReach } from '@/server/messenger';
import {
  FORGOT_GLOBAL_LIMIT,
  FORGOT_WINDOW_MS,
  SELF_LINKS_PER_DAY,
  forgotMessage,
  issueSetupToken,
  selfLinksSince,
} from '@/server/setup-token';
import { audit } from '@/server/audit';
import { env } from '@/server/env';
import { logger } from '@/server/logger';

export const dynamic = 'force-dynamic';

/** 언제나 이것만 돌려준다 — 있는 메일인지 없는 메일인지 화면이 알 수 없게 */
const SAME = { ok: true } as const;

export const POST = handler(async (req: NextRequest) => {
  /*
   * AU-32b — 한도. 순서가 뜻이다:
   *   IP        거드는 신호 — 한 곳에서 몰아 보내는 흔한 경우를 전체 한도에 닿기 전에 걸러, 다른 사람의 몫을 지킨다.
   *             머리 값은 보내는 쪽이 고르므로 이것만으로는 아무것도 막지 못한다
   *   전체      머리를 바꿔 가며 보내도 여기서 멈춘다 — 누가 보냈든 같은 바구니
   *   메일 주소  같은 주소를 거듭 넣는 것 (아직 사람을 찾기 전이라 있는 메일·없는 메일이 같게 걸린다)
   * 셋 다 사람을 찾기 **전**이라 429가 있는 사람인지 드러내지 않는다. 사람마다 한도는 찾은 뒤라 같은 응답으로 조용히 멈춘다(아래).
   */
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  rateLimit(`forgot-ip:${ip}`, 10, 10 * 60_000);
  rateLimit('forgot-all', FORGOT_GLOBAL_LIMIT, FORGOT_WINDOW_MS);

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new HttpError(422, 'invalid_request', '메일 주소를 입력해 주세요.');
  rateLimit(`forgot-mail:${email}`, 3, 30 * 60_000);

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: {
      id: true,
      name: true,
      employeeNo: true,
      divisionId: true,
      passwordHash: true,
      isActive: true,
      isOperator: true,
      division: { select: { isActive: true } },
    },
  });

  // 여기서부터 보내지 못해도 화면에는 똑같이 말한다. 왜 못 보냈는지는 운영 로그에만
  const skip = (why: string) => {
    logger.info({ action: 'forgot', email, found: !!user, why }, '[비밀번호] 재설정 요청 — 보내지 못함');
    return json(SAME);
  };
  if (!user) return skip('no_user');
  // AU-32a — 로그인할 수 있는 사람에게만. 꺼진 부서 사람은 링크로 정해도 들어오지 못한다 — 토큰도 쪽지도 기록도 만들지 않는다
  if (!canSignIn(user, user.division)) return skip('division_off');
  /*
   * 쪽지가 갈 수 없으면 **토큰을 만들지 않는다.** 새 토큰은 그 사람의 옛 링크(운영자가 보낸 것)를 죽인다 —
   * 못 가는 쪽지 때문에 이미 간 링크만 쪽지 없이 죽는다
   */
  if (!user.employeeNo || !messengerStatus().enabled || !env.MESSENGER_LINK_BASE || !canReach(user.employeeNo)) {
    return skip(user.employeeNo ? 'cannot_reach' : 'no_employee_no');
  }
  // AU-32b — 사람마다 하루 3통. DB에 남은 링크로 세므로 재시작·머리 바꾸기와 상관없다. 429로 답하면 있는 사람이라는 뜻이 된다 — 같은 응답
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  if ((await selfLinksSince(user.id, since)) >= SELF_LINKS_PER_DAY) return skip('per_person_limit');

  const { token, expiresAt } = await issueSetupToken(user.id, `self:${email}`);
  const 처음 = !user.passwordHash;

  // 링크는 `URL` 필드에도 실린다 — 본문의 주소는 메신저에서 눌리지 않는다(forgotMessage)
  const r = await sendAlert({
    recvIds: [user.employeeNo],
    ...forgotMessage(user.name, `${env.MESSENGER_LINK_BASE}/setup/${token}`, 처음, expiresAt),
    kind: 'forgot', // NT-56 — 가짜 수신함이 종류를 안다 (NotifyLog에는 남지 않는 알림)
  });

  // 감사 기록은 **실제로 나간 쪽지에만** — 「보냈다」는 기록이 거짓이면 운영자가 「받았을 텐데」로 잘못 짚는다
  if (r.sent.length > 0) {
    await audit(email, 'setup_link', user.divisionId, `user:${user.id}`, { self: true });
  } else {
    logger.warn({ action: 'forgot', email, errors: r.errors }, '[비밀번호] 재설정 링크 전송 실패');
  }
  return json(SAME);
});
