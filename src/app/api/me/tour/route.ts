// API-60 — `POST /api/me/tour` — 화면 둘러보기(PG-84)에서 사람이 고른 것을 기록한다.
//
// 권한: **자기 것만**(TACP v1.10 노트 — 새 권한 없음). 쓰는 대상은 세션의 사람이고, 본문은 사람을 고르지 못한다
// (`userId` 같은 칸은 읽지 않는다 — 스키마가 아예 받지 않는다). GET은 없다 — 제안은 페이지가 그릴 때 계산한다(`getTour`).
// 같은 출처 검사(AU-33)는 `handler`가 본문보다 먼저 한다.
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireScope, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { recordTour } from '@/server/tour';
import { ROLE_CHAPTERS } from '@/lib/guide/deck';
import { TOUR_OUTCOMES } from '@/lib/guide/tour';

export const dynamic = 'force-dynamic';

const Body = z.object({
  chapters: z.array(z.enum(ROLE_CHAPTERS as unknown as [string, ...string[]])).min(1).max(ROLE_CHAPTERS.length),
  outcome: z.enum(TOUR_OUTCOMES),
});

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  rateLimit(`me-tour:${scope.user.email}`, 60, 60_000);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_tour', '둘러보기 기록을 읽지 못했습니다.');
  const seen = await recordTour(scope, parsed.data.chapters as never, parsed.data.outcome);
  return json({ ok: true, seen });
});
