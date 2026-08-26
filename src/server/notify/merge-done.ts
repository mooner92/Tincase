// NT-40~44 — 마감 **20분 후** 담당자에게 «병합 끝났습니다».
//
// 담당자의 다음 일은 화면 밖에 있다: 병합본을 받아 **취합게시판에 올리고 웹디스크에 올린다.**
// 그 일은 «병합이 끝났다»는 걸 알아야 시작되는데, 지금은 화면을 열어봐야만 안다.
// 그래서 마감 뒤 한 번 찔러 준다 — 알림은 **행동을 바꿀 수 있을 때만** 보낸다는 원칙에 맞는다.
//
// 왜 20분인가: 마감 직후 스케줄러가 병합을 돌리는데 모델 호출까지 수십 초~수 분이 걸린다.
// 여유를 두지 않으면 «아직 병합 중»인 상태로 알림이 나간다.
//
// **실패도 알린다.** 마감일에 병합 실패를 놓치면 그 주가 통째로 빈다 —
// 조용한 실패가 이 시스템에서 제일 위험하다.
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { sendAlert, messengerStatus } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { slotKind } from '@/lib/week';

/** 마감 후 몇 분 뒤에 보낼 것인가. 창은 5분 주기 스케줄러가 반드시 한 번 지나도록 넓게 */
const AFTER_MINUTES = 20;
const WINDOW_MINUTES = 12;

export interface MergeDoneOutcome {
  division: string;
  isoKey: string;
  status: 'succeeded' | 'missing';
  targets: number;
  sent: number;
  blocked: number;
}

function buildMessage(
  user: { name: string; employeeNo: string },
  divisionName: string,
  slotLabel: string,
  monthly: boolean,
  ok: boolean,
  counts: { achievements: number; plans: number; notes: number } | null,
  sources: number,
) {
  const kind = monthly ? '월간' : '주간';
  if (!ok) {
    return {
      subject: `[Tincase] ${slotLabel} 병합본이 아직 없어요`,
      contents: [
        `[${user.employeeNo}]${user.name}님 ${divisionName} ${slotLabel} 병합본이 만들어지지 않았어요.`,
        '',
        '제출된 파일이 없거나 병합에 실패했을 수 있어요.',
        'Tincase 수합 관리에서 확인하고 [지금 병합]을 눌러주세요.',
      ].join('\n'),
    };
  }
  const rows = counts ? `실적 ${counts.achievements} · 계획 ${counts.plans}${counts.notes ? ` · 특이 ${counts.notes}` : ''}` : '';
  return {
    subject: `[Tincase] ${slotLabel} ${kind} 병합본이 준비됐어요`,
    contents: [
      `[${user.employeeNo}]${user.name}님 ${slotLabel} ${kind} 병합본이 준비됐어요.`,
      '',
      `제출 ${sources}건${rows ? ` → ${rows}` : ''}`,
      '',
      'Tincase에서 내용을 확인하고 hwp로 받아주세요.',
      '취합게시판 제출과 웹디스크 업로드가 남아 있어요.',
    ].join('\n'),
  };
}

/**
 * NT-40 — 마감 20분 후 창에 든 부서의 **담당자**에게 병합 결과를 알린다.
 *
 * 받는 사람이 부서원 전체가 아니라 담당자인 이유: 그다음 행동(게시판 제출·웹디스크 업로드)을
 * 하는 사람이 담당자다. 나머지 부서원에게는 알릴 이유가 없다 — 할 일이 없다.
 */
export async function runDueMergeNotices(now = new Date()): Promise<MergeDoneOutcome[]> {
  if (!messengerStatus().enabled) return [];

  const slot = await ensureCurrentSlot(now); // NT-13과 같은 이유 — 이번 주 슬롯을 보장한다
  const out: MergeDoneOutcome[] = [];
  const divisions = await prisma.division.findMany({ where: { isActive: true, notifyEnabled: true } });

  for (const division of divisions) {
    const passed = (now.getTime() - effectiveDeadline(slot, division).getTime()) / 60_000;
    if (passed < AFTER_MINUTES || passed > AFTER_MINUTES + WINDOW_MINUTES) continue;

    // NT-42 — 한 주차에 한 번 (유니크 제약이 중복을 구조적으로 막는다)
    const already = await prisma.notifyLog.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, kind: 'merge_done' },
    });
    if (already) continue;

    // 담당자 = 그 부서 lead. 사번이 있고 알림을 켠 사람만
    const leads = await prisma.user.findMany({
      where: {
        divisionId: division.id,
        isActive: true,
        divisionRole: 'lead',
        notifyEnabled: true,
        employeeNo: { not: null },
      },
      select: { name: true, employeeNo: true },
    });
    if (leads.length === 0) {
      logger.info({ division: division.nameKo }, '[알림] 병합 안내 — 사번 있는 담당자가 없어 건너뜀');
      continue;
    }

    const run = await prisma.mergeRun.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    const ok = !!run;
    const counts = run?.rowCounts
      ? (JSON.parse(run.rowCounts) as { achievements: number; plans: number; notes: number })
      : null;
    const sources = run ? (JSON.parse(run.sourceIds) as string[]).length : 0;
    const monthly = slotKind(slot) === 'monthly';
    const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}/manage` : undefined;

    // 문구에 이름이 들어가므로 한 사람씩 (NT-14와 같은 이유)
    const sent: string[] = [];
    const blocked: string[] = [];
    for (const u of leads) {
      const r = await sendAlert({
        recvIds: [u.employeeNo!],
        ...buildMessage({ name: u.name, employeeNo: u.employeeNo! }, division.nameKo, slot.label, monthly, ok, counts, sources),
        url,
      });
      sent.push(...r.sent);
      blocked.push(...r.blocked);
    }

    if (sent.length > 0) {
      await prisma.notifyLog.create({
        data: {
          divisionId: division.id,
          weekSlotId: slot.id,
          kind: 'merge_done',
          recipients: JSON.stringify(sent),
          detail: JSON.stringify({ status: ok ? 'succeeded' : 'missing', blocked, targets: leads.length }),
        },
      });
    }

    out.push({
      division: division.nameKo,
      isoKey: slot.isoKey,
      status: ok ? 'succeeded' : 'missing',
      targets: leads.length,
      sent: sent.length,
      blocked: blocked.length,
    });
  }
  return out;
}
