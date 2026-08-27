// NT-10~14 · NT-41 — 마감 전 미제출자 알림. **두 번 나가고, 두 번 다 이유가 다르다.**
//
//   마감 전날 11:45  «내일이 마감이에요»   — 준비할 시간을 준다   (NT-41)
//   마감 1시간 전    «아직 안 냈어요»      — 마지막으로 손쓸 시점 (NT-10)
//
// **왜 1시간 전인가.** 그때가 아직 손쓸 수 있는 마지막 시점이다. 마감 후 독촉은 늦었다는
// 통보일 뿐이다. AI홍보전략실 기준 목 14:00 마감이니 **목 13:00**에 나간다.
//
// **왜 전날 11:45인가.** 이건 편의가 아니라 «방해하지 않기»가 이유다. 이 회사 메신저는
// 알림이 오면 화면이 번쩍인다 — 업무 중에 받으면 알림 자체가 방해다. 11:45는 점심으로
// 자리를 뜨기 직전이라, 번쩍여도 아무 일도 끊지 않는다. 돌아와서 읽고 오후에 쓰면 된다.
// **한 시간 전 알림만으로는 늦다**는 것도 있다. 13:00에 «아직 안 냈어요»를 받아도
// 회의 중이면 못 쓴다. 전날 알림은 «지금 쓰라»가 아니라 «오늘 중에 시간을 잡으라»다.
//
// 왜 각각 딱 한 번인가: 같은 말을 여러 번 하면 다음부터 안 읽는다.
// 보낸 사실을 `NotifyLog`에 남기고, 같은 (부서, 주차, 종류)로는 다시 보내지 않는다.
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { sendAlert, messengerStatus } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { dayBeforeAt, formatDeadlineKo, slotKind } from '@/lib/week';

/** 마감 몇 분 전에 보낼 것인가 */
const LEAD_MINUTES = 60;
/** NT-41 — 마감 전날 이 시각(KST)에. 점심으로 자리를 뜨기 직전이라 아무것도 끊지 않는다 */
const DAY_BEFORE_TIME = '11:45';
/** 스케줄러가 5분마다 도니 창을 그보다 넓게 잡는다 — 반드시 한 번은 이 창을 지난다 */
const WINDOW_MINUTES = 12;

export type ReminderKind = 'deadline_1d' | 'deadline_1h';

/**
 * 단계 표. **시각 계산을 한곳에 모은다** — 예전에는 «1시간 전»이 조건문 안에 숫자로
 * 흩어져 있었고, 그래서 두 번째 단계를 붙이려면 그 조건문을 헤집어야 했다.
 */
const STAGES: { kind: ReminderKind; at: (deadline: Date) => Date }[] = [
  { kind: 'deadline_1d', at: (d) => dayBeforeAt(d, DAY_BEFORE_TIME) },
  { kind: 'deadline_1h', at: (d) => new Date(d.getTime() - LEAD_MINUTES * 60_000) },
];

export interface ReminderOutcome {
  division: string;
  isoKey: string;
  kind: ReminderKind;
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
  kind: ReminderKind,
  user: { name: string; employeeNo: string },
  slotLabel: string,
  monthly: boolean,
  deadline: Date,
) {
  const 종류 = monthly ? '월간' : '주간';
  const 월간줄 = monthly ? '이번 주는 한 달치를 정리하는 월간이에요.' : '';

  /*
   * NT-41 — **전날 알림은 독촉이 아니다.** «아직 제출되지 않았어요»로 시작하면
   * 하루 전인데도 늦은 것처럼 읽힌다. 이 알림의 목적은 오늘 안에 쓸 시간을 잡게 하는 것이라,
   * 사실(내일 마감)만 알리고 재촉하지 않는다. 재촉은 한 시간 전 알림의 몫이다.
   */
  if (kind === 'deadline_1d') {
    return {
      subject: `[Tincase] ${slotLabel} ${종류} 업무일지 마감이 내일이에요`,
      contents: [
        `[${user.employeeNo}]${user.name}님 업무일지 마감이 내일이에요.`,
        '',
        `${formatDeadlineKo(deadline)}까지 Tincase에서 제출해주세요.`,
        월간줄,
        '',
        '미리 알려드려요. 마감 1시간 전에 한 번 더 알려드릴게요.',
      ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n'),
    };
  }

  return {
    subject: `[Tincase] ${slotLabel} ${종류} 업무일지 마감 1시간 전이에요`,
    contents: [
      `[${user.employeeNo}]${user.name}님 아직 업무일지가 제출되지 않았어요.`,
      '',
      `Tincase에서 ${formatDeadlineKo(deadline)} 전에 제출해주세요.`,
      월간줄,
    ]
      .filter((l) => l !== '')
      .join('\n'),
  };
}

/**
 * NT-10 · NT-41 — 발송 창에 든 부서에 대해 **미제출자에게만** 보낸다.
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
  // NT-30 — 부서별 기능 플래그. 켜진 부서에만 나간다 (기본값 false).
  // 이 층이 있어야 «우리 부서에서 먼저 써 보고 하나씩 확대»가 가능하다
  const divisions = await prisma.division.findMany({ where: { isActive: true, notifyEnabled: true } });

  for (const division of divisions) {
    const deadline = effectiveDeadline(slot, division);

    for (const stage of STAGES) {
      /*
       * 창은 `[발송시각, 발송시각+12분]`이다. 5분 주기 스케줄러가 이 창을 반드시 한 번은
       * 지난다. **창이 지나가 버린 경우 보내지 않는다** — 컨테이너가 그 시간에 꺼져 있었다면
       * 14:30에 «내일이 마감이에요»가 오는 것보다 안 오는 편이 낫다.
       */
      const passed = (now.getTime() - stage.at(deadline).getTime()) / 60_000;
      if (passed < 0 || passed > WINDOW_MINUTES) continue;

      // NT-12 — 같은 (부서, 주차, 종류)로는 한 번만. 유니크 제약이 중복 발송을 구조적으로 막는다
      const already = await prisma.notifyLog.findFirst({
        where: { divisionId: division.id, weekSlotId: slot.id, kind: stage.kind },
      });
      if (already) continue;

      const missing = await prisma.user.findMany({
        where: {
          divisionId: division.id,
          isActive: true,
          onRoster: true, // DM-16 — 집계 대상만. 부서장·휴직자에게 독촉하지 않는다
          notifyEnabled: true, // NT-20 — 알림을 끈 사람은 뺀다 (제출 의무와는 별개다)
          submissions: { none: { weekSlotId: slot.id } },
        },
        select: { id: true, name: true, employeeNo: true },
      });
      if (missing.length === 0) continue;

      const withNo = missing.filter((u) => u.employeeNo);
      if (withNo.length === 0) {
        logger.info(
          { division: division.nameKo, kind: stage.kind, missing: missing.length },
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
          ...buildMessage(
            stage.kind,
            { name: u.name, employeeNo: u.employeeNo! },
            slot.label,
            monthly,
            deadline,
          ),
          url,
        });
        sent.push(...r.sent);
        blocked.push(...r.blocked);
        errors.push(...r.errors);
      }

      // 보낸 뒤에 기록한다 — 실패했는데 «보냈음»으로 남으면 다음 주기에 재시도할 길이 막힌다.
      // 반대로 한 명이라도 나갔으면 기록한다: 재시도가 그 사람에게 두 번 가는 것보다 낫다
      if (sent.length > 0) {
        await prisma.notifyLog.create({
          data: {
            divisionId: division.id,
            weekSlotId: slot.id,
            kind: stage.kind,
            recipients: JSON.stringify(sent),
            detail: JSON.stringify({ blocked, errors, targets: withNo.length }),
          },
        });
      }

      out.push({
        division: division.nameKo,
        isoKey: slot.isoKey,
        kind: stage.kind,
        targets: withNo.length,
        sent: sent.length,
        blocked: blocked.length,
      });
    }
  }
  return out;
}
