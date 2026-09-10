// POST /api/ops/setup-link — 비밀번호 **설정 링크**를 메신저로 보낸다 (AU-30).
//
// **보내는 것만으로는 아무것도 안 바뀐다.** 기존 비밀번호는 그 사람이 링크를 *쓸 때*만
// 바뀐다 — 그래서 이미 잘 쓰고 있는 사람에게 잘못 보내도 그 사람은 영향을 받지 않는다.
// 이 성질이 「전원에게 보내기」를 안심하고 누를 수 있게 하는 유일한 근거다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, requireOperator } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { sendAlert, messengerStatus } from '@/server/messenger';
import { issueSetupToken, SETUP_TOKEN_DAYS } from '@/server/setup-token';
import { env } from '@/server/env';

export const dynamic = 'force-dynamic';

/** 한 번에 보낼 수 있는 최대 인원 — 실수로 전사에 뿌리는 일을 막는다 */
const MAX_BATCH = 60;

interface Body {
  userIds?: unknown;
}

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  rateLimit(`setup-link:${scope.user.email}`, 10, 60_000);

  const body = (await req.json().catch(() => null)) as Body | null;
  const ids = Array.isArray(body?.userIds) ? body.userIds.filter((v): v is string => typeof v === 'string') : [];
  if (ids.length === 0) throw new HttpError(422, 'invalid_request', '보낼 사람을 고르세요.');
  if (ids.length > MAX_BATCH) {
    throw new HttpError(422, 'too_many', `한 번에 ${MAX_BATCH}명까지 보낼 수 있습니다.`);
  }

  const st = messengerStatus();
  if (!st.enabled) throw new HttpError(409, 'messenger_off', `메신저가 꺼져 있습니다 — ${st.reason}`);
  if (!env.MESSENGER_LINK_BASE) {
    throw new HttpError(409, 'no_link_base', '링크 주소(MESSENGER_LINK_BASE)가 설정되지 않았습니다.');
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true, email: true, employeeNo: true, divisionId: true },
  });

  const sent: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const u of users) {
    // 사번이 없으면 메신저가 사람을 못 찾는다 (NT-01). 조용히 빠지면 안 되므로 이유를 남긴다
    if (!u.employeeNo) {
      failed.push({ name: u.name, reason: '사번 없음' });
      continue;
    }

    const { token, expiresAt } = await issueSetupToken(u.id, scope.user.email);
    const url = `${env.MESSENGER_LINK_BASE}/setup/${token}`;

    /*
     * 문구에 **비밀번호는 없다.** 링크뿐이다.
     * 「누가 보냈는지」와 「언제까지인지」를 넣는 이유: 낯선 링크를 받으면 사람은
     * 누르지 않는다. 그게 옳은 반응이라 링크가 무엇인지 먼저 말해 준다.
     */
    const r = await sendAlert({
      recvIds: [u.employeeNo],
      subject: '[Tincase] 비밀번호를 설정해 주세요',
      contents: [
        `${u.name}님, Tincase 비밀번호를 직접 정해 주세요.`,
        '',
        '아래 주소를 눌러 새 비밀번호를 입력하면 됩니다.',
        url,
        '',
        `${SETUP_TOKEN_DAYS}일 안에 설정해 주세요. 한 번 쓰면 이 링크는 사라집니다.`,
        '설정한 뒤에는 이 쪽지를 지워 주세요.',
      ].join('\n'),
    });

    if (r.sent.length > 0) sent.push(u.name);
    else failed.push({ name: u.name, reason: r.blocked.length ? '수신 허용 목록 밖' : '전송 실패' });

    await audit(scope.user.email, 'setup_link', u.divisionId, `user:${u.id}`, {
      expiresAt: expiresAt.toISOString(),
    });
  }

  const missing = ids.length - users.length;
  return json({ ok: true, sent, failed, skippedInactive: missing });
});
