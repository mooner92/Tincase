// NT-50 — 「지금 보내면 누구에게 가는가」를 **보내지 않고** 계산한다.
//
// 알림은 잘못 나가면 되돌릴 수 없다. 그런데 대상이 맞는지 확인할 방법이 실제로 보내 보는 것뿐이면,
// **확인하려다 알림을 보내게 된다.** 그래서 발송 경로와 같은 조건식을 쓰되 전송만 하지 않는
// 읽기 전용 경로를 따로 둔다.
//
// 같은 조건을 두 번 적는 위험은 있다. 그래서 조건의 출처를 한 곳으로 묶어 두었다 —
// `deadline-reminder`·`merge-notices`가 쓰는 필드(onRoster·notifyEnabled·employeeNo)와
// 여기서 보는 필드가 **같은 이름으로 같은 자리에** 있어야 한다.
import { prisma } from '../db';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { toKstIso } from '@/lib/week';
import { REVIEW_MINUTES, SUBMIT_MINUTES } from './merge-notices';

/** 마감 몇 분 전에 미제출 독촉이 나가는가 (deadline-reminder와 같은 값) */
const LEAD_MINUTES = 60;

export interface NotifyPreview {
  division: string;
  isoKey: string;
  deadlineKst: string;
  reminderKst: string;
  reviewKst: string;
  submitKst: string;
  mergeStatus: '성공' | '없음';
  /** 마감 1시간 전 독촉 대상 (집계 대상 · 알림 켬 · 사번 있음 · 아직 미제출) */
  reminder: string[];
  /** +10분 검토 요청 대상 */
  heads: string[];
  /** +30분 제출 안내 대상 */
  leads: string[];
  /** 사번이 없어 **어떤 알림도 못 받는** 사람 — 조용히 빠지면 안 된다 */
  noEmployeeNo: string[];
  /** 본인이 알림을 끈 사람 */
  notifyOff: string[];
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);

export async function previewNotifyTargets(now = new Date()): Promise<NotifyPreview[]> {
  const slot = await ensureCurrentSlot(now);
  const divisions = await prisma.division.findMany({
    where: { isActive: true, notifyEnabled: true },
    orderBy: { nameKo: 'asc' },
  });

  const out: NotifyPreview[] = [];
  for (const d of divisions) {
    const deadline = effectiveDeadline(slot, d);
    const users = await prisma.user.findMany({
      where: { divisionId: d.id, isActive: true },
      select: { id: true, name: true, divisionRole: true, onRoster: true, notifyEnabled: true, employeeNo: true },
      orderBy: { sortOrder: 'asc' },
    });
    const submitted = new Set(
      (await prisma.submission.findMany({ where: { divisionId: d.id, weekSlotId: slot.id }, select: { userId: true } }))
        .map((s) => s.userId),
    );
    const run = await prisma.mergeRun.findFirst({
      where: { divisionId: d.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    });

    const sendable = (u: (typeof users)[number]) => u.notifyEnabled && !!u.employeeNo;

    out.push({
      division: d.nameKo,
      isoKey: slot.isoKey,
      deadlineKst: hhmm(deadline),
      reminderKst: hhmm(new Date(deadline.getTime() - LEAD_MINUTES * 60_000)),
      reviewKst: hhmm(new Date(deadline.getTime() + REVIEW_MINUTES * 60_000)),
      submitKst: hhmm(new Date(deadline.getTime() + SUBMIT_MINUTES * 60_000)),
      mergeStatus: run ? '성공' : '없음',
      reminder: users.filter((u) => u.onRoster && sendable(u) && !submitted.has(u.id)).map((u) => u.name),
      heads: users.filter((u) => u.divisionRole === 'head' && sendable(u)).map((u) => u.name),
      leads: users.filter((u) => u.divisionRole === 'lead' && sendable(u)).map((u) => u.name),
      noEmployeeNo: users.filter((u) => !u.employeeNo).map((u) => u.name),
      notifyOff: users.filter((u) => !u.notifyEnabled).map((u) => u.name),
    });
  }
  return out;
}
