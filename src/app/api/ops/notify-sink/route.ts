// NT-56 · TACP-26 — 가짜 알림 수신함 「비우기」. 운영자만, 시험·시연 서버에서만.
// 문 순서: 수신함이 닫힌 서버(운영)면 누구에게나 404 → 운영자가 아니면 404 (TACP-5 — 어느 쪽이든 같은 답).
// 감사 기록은 남기지 않는다 — 부서 경계를 넘는 일이 아니고(TACP-10), 지우는 것은 시험 서버의 가짜 알림뿐이다. 로그 한 줄은 남긴다.
import { NextRequest } from 'next/server';
import { notFound, requireOperator } from '@/server/authz';
import { handler, json } from '@/server/http';
import { logger } from '@/server/logger';
import { clearSink, messengerSinkOpen } from '@/server/messenger-sink';

export const dynamic = 'force-dynamic';

export const DELETE = handler(async (req: NextRequest) => {
  if (!messengerSinkOpen()) throw notFound();
  const scope = await requireOperator(req.headers);
  const removed = await clearSink();
  logger.info({ by: scope.user.email, removed }, '[알림 수신함] 비움');
  return json({ ok: true, removed });
});
