// /api/schedule/deadline — 주차 마감 예외 (WS-19 · TACP-20). 총괄·운영자 전용.
//
//   GET                          이번 주·다음 주 마감 상태
//   POST {mode:'preview', …}     미리보기 — 쓰지 않는다
//   POST {mode:'apply', …}       적용 — 서버가 다시 계산해서 쓴다
//   DELETE ?isoKey=              해제 — 평소 마감으로
//
// 입력은 공지 원문(noticeText) 또는 대외 마감 직접 입력(external, `YYYY-MM-DDTHH:mm` KST).
import { NextRequest } from 'next/server';
import { requireScheduler, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { applyDeadline, clearDeadline, deadlineStatus, planDeadline } from '@/server/slot-deadline';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  await requireScheduler(req.headers);
  return json(await deadlineStatus());
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireScheduler(req.headers);
  rateLimit(`schedule:${scope.user.email}`, 30, 60_000);
  const body = (await req.json().catch(() => null)) as {
    mode?: unknown;
    noticeText?: unknown;
    external?: unknown;
  } | null;
  const input = {
    noticeText: typeof body?.noticeText === 'string' ? body.noticeText.slice(0, 5000) : undefined,
    external: typeof body?.external === 'string' ? body.external : undefined,
  };
  if (body?.mode === 'apply') return json({ applied: true, plan: await applyDeadline(scope, input) });
  if (body?.mode === 'preview') return json({ applied: false, plan: await planDeadline(input) });
  throw new HttpError(422, 'invalid_request', 'mode는 preview 또는 apply여야 합니다.');
});

export const DELETE = handler(async (req: NextRequest) => {
  const scope = await requireScheduler(req.headers);
  const isoKey = req.nextUrl.searchParams.get('isoKey') ?? '';
  if (!/^\d{4}-W\d{2}$/.test(isoKey)) throw new HttpError(422, 'invalid_request', '주차가 올바르지 않습니다.');
  return json({ cleared: true, ...(await clearDeadline(scope, isoKey)) });
});
