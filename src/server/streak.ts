// OPS-31 — 연속 미제출 추적.
//
// 스냅샷은 "이번 주 안 냈다"만 말한다. **"3주 연속 안 냈다"는 성격이 다른 정보**다:
// 전자는 바쁜 한 주일 수 있지만 후자는 제도가 그 사람에게 닿지 않고 있다는 뜻이고,
// 대응도 다르다(전자는 알림, 후자는 대화).
//
// 마감이 지난 주차만 센다. 아직 열려 있는 주차를 미제출로 세면 매주 월요일마다
// 전원이 "연속 미제출"이 되어 숫자가 무의미해진다.

import { prisma } from './db';
import { effectiveDeadline } from './worklog';

export interface StreakRow {
  userId: string;
  name: string;
  divisionName: string;
  divisionSlug: string;
  /** 마감이 지난 주차 기준, 최근부터 연속 몇 주 안 냈는가 */
  streak: number;
  /** 집계 구간에서 낸 횟수 */
  submitted: number;
  /** 집계 구간의 주차 수 */
  weeks: number;
  lastSubmittedLabel: string | null;
}

/**
 * 최근 `weeks`개 주차(마감 지난 것만) 기준 연속 미제출자.
 *
 * 집계 대상 부서(boardStatus=confirmed)의 onRoster 인원만 본다 — 애초에 업무일지를
 * 내지 않는 부서 사람을 "연속 미제출"이라 부르면 그건 사실이 아니라 분류 오류다.
 */
export async function missingStreaks(now = new Date(), weeks = 8, minStreak = 2): Promise<StreakRow[]> {
  const divisions = await prisma.division.findMany({
    where: { boardStatus: 'confirmed' },
    include: {
      users: {
        where: { isActive: true, onRoster: true },
        select: { id: true, name: true },
      },
    },
  });
  if (divisions.length === 0) return [];

  // 마감이 지난 주차만, 최신 순
  const slots = (
    await prisma.weekSlot.findMany({ where: { opensAt: { lte: now } }, orderBy: { opensAt: 'desc' }, take: weeks + 4 })
  )
    .filter((s) => now >= effectiveDeadline(s, divisions[0]))
    .slice(0, weeks);
  if (slots.length === 0) return [];

  const subs = await prisma.submission.findMany({
    where: { weekSlotId: { in: slots.map((s) => s.id) }, isLatest: true },
    select: { userId: true, weekSlotId: true },
  });
  const submittedBy = new Map<string, Set<string>>(); // userId → slotIds
  for (const s of subs) {
    const set = submittedBy.get(s.userId);
    if (set) set.add(s.weekSlotId);
    else submittedBy.set(s.userId, new Set([s.weekSlotId]));
  }

  const rows: StreakRow[] = [];
  for (const d of divisions) {
    for (const u of d.users) {
      const mine = submittedBy.get(u.id) ?? new Set<string>();
      let streak = 0;
      for (const s of slots) {
        if (mine.has(s.id)) break; // 최신부터 세다가 낸 주차를 만나면 끊긴다
        streak++;
      }
      if (streak < minStreak) continue;
      const last = slots.find((s) => mine.has(s.id));
      rows.push({
        userId: u.id,
        name: u.name,
        divisionName: d.nameKo,
        divisionSlug: d.slug,
        streak,
        submitted: slots.filter((s) => mine.has(s.id)).length,
        weeks: slots.length,
        lastSubmittedLabel: last?.label ?? null,
      });
    }
  }

  // 오래 안 낸 사람부터. 같으면 부서·이름 순 (매번 같은 순서라야 비교가 된다)
  return rows.sort(
    (a, b) =>
      b.streak - a.streak ||
      a.divisionName.localeCompare(b.divisionName, 'ko') ||
      a.name.localeCompare(b.name, 'ko'),
  );
}
