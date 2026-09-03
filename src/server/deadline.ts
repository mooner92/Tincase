// DM-20 서버 층 — 열림 기록 읽기·쓰기 (TACP-18).
import { prisma } from './db';
import { audit } from './audit';
import { OPEN_MINUTES, isSubmissionLocked, mergeGate, type SlotOpen } from '@/lib/deadline';
import { deadlineFor } from '@/lib/week';
import type { Division, WeekSlot } from '@prisma/client';

export { OPEN_MINUTES };

export async function openingOf(divisionId: string, weekSlotId: string): Promise<SlotOpen | null> {
  const row = await prisma.slotOpening.findUnique({
    where: { divisionId_weekSlotId: { divisionId, weekSlotId } },
    select: { openUntil: true, openedBy: true },
  });
  return row;
}

/** 여러 주차를 한 번에 — 목록 화면이 주차 수만큼 질의하지 않게 */
export async function openingsOf(
  divisionId: string,
  weekSlotIds: readonly string[],
): Promise<Map<string, SlotOpen>> {
  if (weekSlotIds.length === 0) return new Map();
  const rows = await prisma.slotOpening.findMany({
    where: { divisionId, weekSlotId: { in: [...weekSlotIds] } },
    select: { weekSlotId: true, openUntil: true, openedBy: true },
  });
  return new Map(rows.map((r) => [r.weekSlotId, { openUntil: r.openUntil, openedBy: r.openedBy }]));
}

/** 제출이 막혀 있는가 — 열림 기록까지 본 최종 판정 */
export async function submissionLocked(
  division: Division,
  slot: WeekSlot,
  now = new Date(),
): Promise<boolean> {
  const open = await openingOf(division.id, slot.id);
  return isSubmissionLocked({ opensAt: slot.opensAt }, division, open, now);
}

/** HM-34 — 자동 병합이 기준으로 삼는 시각 (열었다 닫으면 그때가 새 마감이다) */
export async function mergeGateOf(division: Division, slot: WeekSlot): Promise<Date> {
  const open = await openingOf(division.id, slot.id);
  return mergeGate(deadlineFor({ opensAt: slot.opensAt }, division), open);
}

/**
 * TACP-18 — 마감을 `OPEN_MINUTES`만큼 연다. 이미 열려 있으면 그만큼 **다시 연장**한다.
 * 예외에는 언제나 이름이 붙는다 — 누가 열었는지 기록에 남고 화면에도 보인다.
 */
export async function openSlot(
  division: Division,
  slot: WeekSlot,
  by: { email: string; name: string },
  now = new Date(),
): Promise<SlotOpen> {
  const openUntil = new Date(now.getTime() + OPEN_MINUTES * 60_000);
  const row = await prisma.slotOpening.upsert({
    where: { divisionId_weekSlotId: { divisionId: division.id, weekSlotId: slot.id } },
    update: { openUntil, openedBy: by.name, openedAt: now },
    create: { divisionId: division.id, weekSlotId: slot.id, openUntil, openedBy: by.name, openedAt: now },
    select: { openUntil: true, openedBy: true },
  });
  await audit(by.email, 'deadline_open', division.id, `slot:${slot.isoKey}`, {
    openUntil: openUntil.toISOString(),
    minutes: OPEN_MINUTES,
  });
  return row;
}

/** 지금 닫는다 — `openUntil`을 현재로 당긴다. 기록은 지우지 않는다 (열었던 사실이 남아야 한다) */
export async function closeSlot(
  division: Division,
  slot: WeekSlot,
  by: { email: string },
  now = new Date(),
): Promise<void> {
  await prisma.slotOpening.updateMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
    data: { openUntil: now },
  });
  await audit(by.email, 'deadline_close', division.id, `slot:${slot.isoKey}`);
}
