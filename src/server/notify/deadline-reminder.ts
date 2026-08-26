// NT-10~14 — 마감 **1시간 전** 미제출자에게 알림 한 번.
//
// 왜 한 시간 전인가: 그때가 아직 손쓸 수 있는 마지막 시점이다. 마감 후 독촉은
// 늦었다는 통보일 뿐이고, 이틀 전 알림은 잊힌다. AI홍보전략실 기준 목 14:00 마감이니
// **목 13:00**에 나간다.
//
// 왜 딱 한 번인가: 같은 말을 여러 번 하면 다음부터 안 읽는다.
// 보낸 사실을 `NotifyLog`에 남기고, 같은 (부서, 주차, 종류)로는 다시 보내지 않는다.
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { sendAlert, messengerStatus } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { formatDeadlineKo, slotKind } from '@/lib/week';

/** 마감 몇 분 전부터 보낼 것인가 — 스케줄러가 5분마다 도니 창을 그보다 넓게 잡는다 */
const LEAD_MINUTES = 60;
const WINDOW_MINUTES = 12;

export interface ReminderOutcome {
  division: string;
  isoKey: string;
  targets: number;
  sent: number;
  blocked: number;
  skipped?: string;
}

/**
 * NT-14 — 알림 문구. **한 사람에게 하는 말투**로 쓴다.
 *
 * 「제출되지 않았습니다」 같은 공지문은 읽는 사람이 자기 얘기로 안 받는다.
 * 이름을 부르고, 무엇을 언제까지 하면 되는지만 남긴다 — 그게 행동으로 이어진다.
 *
 * 사번을 앞에 붙이는 이유: 메신저 알림함에 여러 시스템 알림이 섞이는데,
 * 자기 사번이 보이면 «나한테 온 것»이 한눈에 들어온다.
 *
 * ★ **본문은 평문이다.** 「Tincase」에 링크를 걸어 보려고 두 가지를 실측했는데 둘 다 실패했다:
 *   `<a href=…>Tincase</a>` → 태그가 **글자 그대로** 보인다 (본문 HTML 미지원)
 *   `Tincase(http://…)`     → 주소만 길게 늘어지고 **클릭도 안 된다**
 * 링크는 `URL` 필드 하나뿐이고, 그건 **제목**에 걸려 알림을 누르면 열린다.
 * 그래서 본문에는 아무 표식도 넣지 않는다 — 억지로 넣으면 더 지저분해질 뿐이다.
 */
function buildMessage(
  user: { name: string; employeeNo: string },
  slotLabel: string,
  monthly: boolean,
  deadline: Date,
) {
  const kind = monthly ? '월간' : '주간';
  return {
    subject: `[Tincase] ${slotLabel} ${kind} 업무일지 마감 1시간 전이에요`,
    contents: [
      `[${user.employeeNo}]${user.name}님 아직 업무일지가 제출되지 않았어요.`,
      '',
      `Tincase에서 ${formatDeadlineKo(deadline)} 전에 제출해주세요.`,
      monthly ? '이번 주는 한 달치를 정리하는 월간이에요.' : '',
    ]
      .filter((l) => l !== '')
      .join('\n'),
  };
}

/**
 * NT-10 — 마감 1시간 전 창에 든 부서에 대해 **미제출자에게만** 보낸다.
 *
 * 조용히 건너뛰는 경우: 창 밖 · 이미 보냄 · 미제출자 없음 · 사번 없는 사람.
 * 그런 상황에 로그를 남기면 정작 봐야 할 로그가 묻힌다.
 */
export async function runDueReminders(now = new Date()): Promise<ReminderOutcome[]> {
  const status = messengerStatus();
  if (!status.enabled) return [];

  /*
   * NT-13 — **이번 주 슬롯을 보장한다.**
   *
   * 슬롯은 누가 화면을 열 때 만들어진다(WS-11 지연 생성). 그래서 «가장 최근 슬롯»을
   * 그냥 집어 오면, 그 주에 아무도 접속하지 않은 경우 **지난 주차**를 붙잡는다 —
   * 마감까지 남은 시간이 음수로 나와 알림이 영영 안 나간다 (실제로 여기서 그랬다).
   *
   * 알림은 «이번 주»에 대한 것이므로 없으면 만든다. upsert라 겹쳐 돌아도 안전하다.
   */
  const slot = await ensureCurrentSlot(now);

  const out: ReminderOutcome[] = [];
  const divisions = await prisma.division.findMany({ where: { isActive: true } });

  for (const division of divisions) {
    const deadline = effectiveDeadline(slot, division);
    const minutesLeft = (deadline.getTime() - now.getTime()) / 60_000;
    // [48분, 60분] 남았을 때만 — 5분 주기 스케줄러가 이 창을 반드시 한 번은 지난다
    if (minutesLeft > LEAD_MINUTES || minutesLeft < LEAD_MINUTES - WINDOW_MINUTES) continue;

    // NT-12 — 같은 (부서, 주차, 종류)로는 한 번만. 유니크 제약이 중복 발송을 구조적으로 막는다
    const already = await prisma.notifyLog.findFirst({
      where: { divisionId: division.id, weekSlotId: slot.id, kind: 'deadline_1h' },
    });
    if (already) continue;

    const missing = await prisma.user.findMany({
      where: {
        divisionId: division.id,
        isActive: true,
        onRoster: true, // DM-16 — 집계 대상만. 부서장·휴직자에게 독촉하지 않는다
        submissions: { none: { weekSlotId: slot.id } },
      },
      select: { id: true, name: true, employeeNo: true },
    });
    if (missing.length === 0) continue;

    const withNo = missing.filter((u) => u.employeeNo);
    if (withNo.length === 0) {
      logger.info(
        { division: division.nameKo, missing: missing.length },
        '[알림] 미제출자에게 사번이 없어 보내지 못함',
      );
      continue;
    }

    const monthly = slotKind(slot) === 'monthly';
    const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}` : undefined;

    /*
     * 문구에 **이름이 들어가므로 한 사람씩 보낸다.** 여러 명을 콤마로 묶으면
     * 한 통을 여러 명이 받아 남의 이름이 보인다 — 그건 알림이 아니라 명단 공개다.
     * 미제출자는 많아야 부서당 수십 명이라 요청 수는 문제되지 않는다.
     */
    const sent: string[] = [];
    const blocked: string[] = [];
    const errors: string[] = [];
    for (const u of withNo) {
      const r = await sendAlert({
        recvIds: [u.employeeNo!],
        ...buildMessage({ name: u.name, employeeNo: u.employeeNo! }, slot.label, monthly, deadline),
        url,
      });
      sent.push(...r.sent);
      blocked.push(...r.blocked);
      errors.push(...r.errors);
    }
    const res = { sent, blocked, errors };

    // 보낸 뒤에 기록한다 — 실패했는데 «보냈음»으로 남으면 다음 주기에 재시도할 길이 막힌다.
    // 반대로 한 명이라도 나갔으면 기록한다: 재시도가 그 사람에게 두 번 가는 것보다 낫다
    if (res.sent.length > 0) {
      await prisma.notifyLog.create({
        data: {
          divisionId: division.id,
          weekSlotId: slot.id,
          kind: 'deadline_1h',
          recipients: JSON.stringify(res.sent),
          detail: JSON.stringify({ blocked: res.blocked, errors: res.errors, targets: withNo.length }),
        },
      });
    }

    out.push({
      division: division.nameKo,
      isoKey: slot.isoKey,
      targets: withNo.length,
      sent: res.sent.length,
      blocked: res.blocked.length,
    });
  }
  return out;
}
