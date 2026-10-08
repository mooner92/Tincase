// NT-56 — 가짜 알림 수신함. 메신저 클라이언트(src/server/messenger.ts)가 사내 메신저에 보내는 것과 **똑같은** 요청을 받는다:
// `POST`, `application/x-www-form-urlencoded`, 필드 16개(messenger.md §6), 성공이면 평문 `send ok`(2026-09-23 실측 응답).
// 그래서 클라이언트는 이곳과 진짜 메신저를 구별하지 않는다 — 시험 서버는 주소 하나(MESSENGER_URL)만 바꿔 끼운다.
//
// 신원을 묻지 않는 경로다(TACP §6 — 시험·시연 서버 전용 예외). 부르는 쪽이 앱 자신이고, 진짜 메신저도 신원을 받지 않는다.
// 대신 **쓰기만** 한다 — 받은 것을 돌려주지 않는다(GET은 「열려 있다」만). 본문은 64KB까지. 읽기는 운영자 화면(/ops/notify-sink)뿐이다.
// 운영(시험·시연 아님)이나 `MESSENGER_SINK=on`이 없으면 어느 방법이든 404 — 있다는 것도 알리지 않는다(TACP-5).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, notFound } from '@/server/authz';
import { handler, json } from '@/server/http';
import { appendSinkEntry, messengerSinkOpen } from '@/server/messenger-sink';
import { SINK_KIND_HEADER } from '@/lib/messenger-sink';

export const dynamic = 'force-dynamic';

/** 알림 한 통은 1~2KB다. 넉넉히 두되, 열린 경로라 끝은 둔다 */
const MAX_BODY = 64 * 1024;

/**
 * 본문을 MAX_BODY까지만 읽는다. `req.text()`는 길이 머리 없이(chunked) 오는 본문을 끝까지 메모리에 올린다 — 신원 없이 열린
 * 경로라 시험 서버 하나를 큰 요청 하나로 눕힐 수 있었다(2026-10-08 검증). 넘으면 그 자리에서 끊고 null
 */
async function readCapped(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const POST = handler(async (req: NextRequest) => {
  if (!messengerSinkOpen()) throw notFound();
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw new HttpError(413, 'too_large', '본문이 너무 큽니다.');
  const text = await readCapped(req);
  if (text === null) throw new HttpError(413, 'too_large', '본문이 너무 큽니다.');
  const form = new URLSearchParams(text);
  // 클라이언트가 규격을 어기면 받지 않는다 — 진짜 메신저에서 조용히 무시될 요청을 여기서 먼저 드러낸다
  const recvIds = (form.get('RecvId') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (form.get('CMD') !== 'ALERT' || recvIds.length === 0) throw new HttpError(422, 'invalid_request', 'CMD=ALERT와 RecvId가 필요합니다.');

  // 사번 → 그 사람(가짜 인원이면 @example.invalid). 모르는 사번은 빈 칸으로 남긴다 — 「누구에게 갔어야 했나」를 화면이 말하게
  const users = await prisma.user.findMany({ where: { employeeNo: { in: recvIds } }, select: { employeeNo: true, email: true, name: true } });
  const byNo = new Map(users.map((u) => [u.employeeNo, u]));
  await appendSinkEntry({
    kind: (req.headers.get(SINK_KIND_HEADER) ?? '').slice(0, 200),
    recipients: recvIds.map((id) => ({ employeeNo: id, email: byNo.get(id)?.email ?? '', name: byNo.get(id)?.name ?? '' })),
    subject: form.get('Subject') ?? '',
    contents: form.get('Contents') ?? '',
    url: form.get('URL') ?? '',
    form: Object.fromEntries(form),
  });
  return new Response('send ok\n', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
});

/** 리허설 스크립트가 「이 서버의 수신함이 열려 있나」를 묻는다. 기록은 주지 않는다 */
export const GET = handler(async () => {
  if (!messengerSinkOpen()) throw notFound();
  return json({ sink: 'on' });
});
