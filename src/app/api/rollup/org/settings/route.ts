// RU-51·52 — 3단계 사용 스위치와 단계 시각 (총괄·운영자 — TACP-21). 꺼져 있을 때는 운영자만 연다
import { NextRequest } from 'next/server';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { scheduleInput, setOrgSchedule } from '@/server/rollup/settings';
import { laterSyncCurrentWeek } from '@/server/rollup/auto';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const parsed = scheduleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  const { turnedOn } = await setOrgSchedule(scope, parsed.data);
  // RU-79 — 켜는 순간 이번 주를 맞춘다: 이번 주 승인은 그 불변 사본으로, 부서장 없는 단위는 최종본으로, 그 위로 본부본·전사본.
  // 켠 사람이 「보낸」 것이 아니라 이미 있던 승인이 간 것이다 — 기록은 system + 켠 사람 (TACP-23)
  if (turnedOn) laterSyncCurrentWeek({ cause: 'rollup_enabled', causedBy: scope.user.email });
  return json({ ok: true });
});
