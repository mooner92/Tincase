// RU-51·52 — 3단계 사용 스위치와 단계 시각 (총괄·운영자 — TACP-21). 꺼져 있을 때는 운영자만 연다
import { NextRequest } from 'next/server';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { scheduleInput, setOrgSchedule } from '@/server/rollup/settings';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = scheduleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  await setOrgSchedule(scope, parsed.data);
  return json({ ok: true });
});
