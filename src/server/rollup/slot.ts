// 취합 화면·API가 쓰는 주차 — 지정이 없으면 이번 주 (수합 관리와 같은 기준)
import type { WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../authz';
import { ensureCurrentSlot } from '../worklog';
import { currentWeek } from '@/lib/week';

export async function rollupSlot(isoKey?: string | null, now = new Date()): Promise<WeekSlot> {
  await ensureCurrentSlot(now);
  const key = isoKey && /^\d{4}-W\d{2}$/.test(isoKey) ? isoKey : currentWeek(now).isoKey;
  const slot = await prisma.weekSlot.findUnique({ where: { isoKey: key } });
  if (!slot) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');
  return slot;
}
