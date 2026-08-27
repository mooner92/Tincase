// NT-40~48 — 마감 뒤 알림. **받는 사람마다 할 일이 다르고, 그래서 시각도 다르다.**
//
//   마감 +1분  →  자동 병합 시작 (HM-25·HM-35)
//   마감 +10분 →  부서장(head): «병합본 준비됐어요, 검토 부탁드려요»   [성공했을 때만]
//   마감 +10분 →  담당자(lead): «병합본이 아직 없어요»                [실패했을 때만]
//   마감 +30분 →  담당자(lead): «최종 확인하고 제출해주세요»          [성공/실패 모두]
//
// **왜 실패는 부서장에게 보내지 않는가.** 부서장은 병합 실패를 고칠 수 없다 —
// [지금 병합]을 누르는 사람은 담당자다. 고칠 수 없는 사람에게 가는 실패 통지는 소음이고,
// 소음이 쌓이면 정작 중요한 알림도 안 읽힌다. 대신 **고칠 수 있는 사람에게 20분 더 일찍** 보낸다.
// 예외가 조용해지는 게 아니라, 예외를 받는 사람이 바뀌는 것이다.
//
// **왜 +10분 / +30분인가.** 대외업무 마감이 15:00이고 부서 마감이 14:00이다.
// 그 한 시간이 검토에 쓸 수 있는 전부다:
//   14:10 부서장이 본다 → 20분 검토 → 14:30 담당자가 반영해 제출 → 15:00까지 30분 여유.
// 병합 자체가 모델 호출까지 수십 초~수 분 걸리므로 10분보다 이르면 «아직 병합 중»에 걸린다.
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { sendAlert, messengerStatus } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { slotKind } from '@/lib/week';
import { describeFlagged, type FlaggedRow } from '@/lib/empty-content';

/** 스케줄러가 5분 주기이므로 창은 그보다 넉넉해야 반드시 한 번 걸린다 */
const WINDOW_MINUTES = 12;
/** 부서장 검토 요청 */
export const REVIEW_MINUTES = 10;
/** 담당자 최종 제출 안내 */
export const SUBMIT_MINUTES = 30;

export type NoticeKind = 'merge_review' | 'merge_missing' | 'merge_done';

export interface NoticeOutcome {
  division: string;
  isoKey: string;
  kind: NoticeKind;
  status: 'succeeded' | 'missing';
  targets: number;
  sent: number;
  blocked: number;
}

interface Person {
  name: string;
  employeeNo: string;
}
interface MergeFacts {
  ok: boolean;
  sources: number;
  counts: { achievements: number; plans: number; notes: number } | null;
  /** HM-33 — 확인이 필요한 행 (「없음」 등). 지우지 않고 알린다 */
  flagged: FlaggedRow[];
  /**
   * HM-34 — 병합본이 만들어진 **뒤에** 낸 사람 수.
   *
   * 0이 아니면 이 병합본은 낡았다. 그런데도 알림은 «준비됐어요»라고 말한다 —
   * 2026-08-27에 실장이 세 명 빠진 문서를 온전한 것으로 알고 받은 게 그것이다.
   * 병합 스케줄러 쪽은 고쳤지만(마감 전 실행은 미리보기로 친다), 담당자가 마감 후에
   * 손으로 병합한 뒤 누가 늦게 내는 길은 남는다. **그때는 알림이 말해야 한다.**
   */
  stale: number;
}

/** 알림에 몇 줄까지 적을 것인가. 팝업이라 길면 안 읽힌다 */
const FLAG_LINES = 3;

/**
 * HM-33 — 「확인해 주세요」 문단. 걸린 게 없으면 **아무 줄도 넣지 않는다** —
 * 「0건입니다」는 매주 오면 소음이고, 소음이 쌓이면 정작 있을 때도 안 읽힌다.
 */
function flagBlock(flagged: FlaggedRow[]): string[] {
  if (flagged.length === 0) return [];
  const head = `확인이 필요한 내용이 ${flagged.length}건 있어요.`;
  const lines = flagged.slice(0, FLAG_LINES).map((f) => `· ${describeFlagged(f)}`);
  if (flagged.length > FLAG_LINES) lines.push(`· 외 ${flagged.length - FLAG_LINES}건`);
  return ['', head, ...lines];
}

/**
 * HM-34 — 「낡음」 한 줄. 0이면 아무 줄도 넣지 않는다 (flagBlock과 같은 이유).
 * 문구가 «확인해보세요»가 아니라 **누를 버튼 이름**인 것은 의도다 — 읽고 나서
 * 무엇을 해야 하는지 한 번 더 생각하게 만들면 그 알림은 대체로 안 눌린다.
 */
function staleBlock(stale: number, action: string): string[] {
  if (stale === 0) return [];
  return ['', `병합한 뒤에 ${stale}명이 더 냈어요 — 이 병합본에는 빠져 있어요.`, action];
}

/** 창 안에 들어왔는가. `[+n, +n+12분]`을 한 번 지나면 참 */
function inWindow(passedMinutes: number, at: number): boolean {
  return passedMinutes >= at && passedMinutes <= at + WINDOW_MINUTES;
}

function rowsLine(f: MergeFacts): string {
  if (!f.counts) return '';
  const { achievements, plans, notes } = f.counts;
  return `제출 ${f.sources}건 → 실적 ${achievements} · 계획 ${plans}${notes ? ` · 특이 ${notes}` : ''}`;
}

/**
 * NT-44~46 — 문구. **한 사람씩 보낸다** (이름이 들어가므로 콤마로 묶으면 남의 이름이 보인다).
 *
 * 토스 말투를 따른다: 사실 한 줄 → 빈 줄 → 다음에 할 일 한 줄.
 * 「~해야 합니다」가 아니라 「~해주세요」다. 매주 오는 알림이라 명령조는 금방 피로해진다.
 */
function compose(kind: NoticeKind, who: Person, slotLabel: string, monthly: boolean, f: MergeFacts) {
  const label = `${slotLabel} ${monthly ? '월간' : '주간'}`;
  const head = `[${who.employeeNo}]${who.name}님`;

  if (kind === 'merge_review') {
    return {
      subject: `[Tincase] ${label} 병합본 검토 부탁드려요`,
      contents: [
        `${head} ${label} 업무일지 병합본이 준비됐어요.`,
        '',
        rowsLine(f),
        ...staleBlock(f.stale, '담당자에게 다시 병합을 요청해주세요.'),
        '',
        ...flagBlock(f.flagged),
        '',
        'Tincase에서 내용을 확인하고 고칠 부분을 알려주세요.',
        '각 항목을 누가 냈는지도 함께 보입니다.',
      ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n'),
    };
  }

  if (kind === 'merge_missing') {
    return {
      subject: `[Tincase] ${slotLabel} 병합본이 아직 없어요`,
      contents: [
        `${head} ${slotLabel} 병합본이 만들어지지 않았어요.`,
        '',
        '제출된 파일이 없거나 병합에 실패했을 수 있어요.',
        'Tincase 수합 관리에서 확인하고 [지금 병합]을 눌러주세요.',
      ].join('\n'),
    };
  }

  // merge_done — 담당자의 마지막 단계
  if (!f.ok) {
    return {
      subject: `[Tincase] ${slotLabel} 병합본을 확인해주세요`,
      contents: [
        `${head} ${slotLabel} 병합본이 아직 없어요.`,
        '',
        '대외업무 마감이 얼마 남지 않았어요.',
        'Tincase 수합 관리에서 [지금 병합]을 눌러주세요.',
      ].join('\n'),
    };
  }
  return {
    subject: `[Tincase] ${label} 병합본 제출해주세요`,
    contents: [
      `${head} ${label} 병합본이 준비됐어요.`,
      '',
      rowsLine(f),
      ...staleBlock(f.stale, 'Tincase 수합 관리에서 [다시 병합]을 눌러주세요.'),
      ...flagBlock(f.flagged),
      '',
      'Tincase에서 hwp로 받아 취합게시판에 올리고',
      '웹디스크에 업로드해주세요.',
    ]
      .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      .join('\n'),
  };
}

/** 사번이 있고 알림을 켠 사람만. 사번이 없으면 메신저가 사람을 못 찾는다 (NT-01) */
async function recipients(divisionId: string, role: 'lead' | 'head'): Promise<Person[]> {
  const us = await prisma.user.findMany({
    where: { divisionId, isActive: true, divisionRole: role, notifyEnabled: true, employeeNo: { not: null } },
    select: { name: true, employeeNo: true },
  });
  return us.map((u) => ({ name: u.name, employeeNo: u.employeeNo! }));
}

/**
 * NT-42 — 한 주차·한 종류당 **한 번**. `NotifyLog`의 `(부서, 주차, 종류)` 유니크가
 * 중복을 구조적으로 막지만, 보내기 전에도 확인해 불필요한 발송을 아예 안 한다.
 */
async function alreadySent(divisionId: string, weekSlotId: string, kind: NoticeKind): Promise<boolean> {
  return !!(await prisma.notifyLog.findFirst({ where: { divisionId, weekSlotId, kind } }));
}

async function deliver(
  divisionId: string,
  weekSlotId: string,
  kind: NoticeKind,
  people: Person[],
  slotLabel: string,
  monthly: boolean,
  facts: MergeFacts,
  url: string | undefined,
  divisionName: string,
  isoKey: string,
): Promise<NoticeOutcome | null> {
  if (people.length === 0) {
    logger.info({ division: divisionName, kind }, '[알림] 받을 사람이 없어 건너뜀 (사번·알림설정 확인)');
    return null;
  }
  const sent: string[] = [];
  const blocked: string[] = [];
  for (const p of people) {
    const r = await sendAlert({ recvIds: [p.employeeNo], ...compose(kind, p, slotLabel, monthly, facts), url });
    sent.push(...r.sent);
    blocked.push(...r.blocked);
  }
  if (sent.length > 0) {
    await prisma.notifyLog.create({
      data: {
        divisionId,
        weekSlotId,
        kind,
        recipients: JSON.stringify(sent),
        detail: JSON.stringify({ status: facts.ok ? 'succeeded' : 'missing', blocked, targets: people.length }),
      },
    });
  }
  return {
    division: divisionName,
    isoKey,
    kind,
    status: facts.ok ? 'succeeded' : 'missing',
    targets: people.length,
    sent: sent.length,
    blocked: blocked.length,
  };
}

/**
 * NT-40 — 마감 뒤 알림 전부. 스케줄러가 5분마다 부른다.
 *
 * 던지지 않는 것이 아니라 **부서 하나가 실패해도 나머지는 계속 간다** —
 * 한 부서의 사번 오류로 30개 부서 알림이 통째로 멈추면 안 된다.
 */
export async function runDueMergeNotices(now = new Date()): Promise<NoticeOutcome[]> {
  if (!messengerStatus().enabled) return [];

  const slot = await ensureCurrentSlot(now); // NT-13 — «가장 최근 슬롯»이면 지난 주차를 잡는다
  const monthly = slotKind(slot) === 'monthly';
  const out: NoticeOutcome[] = [];
  const divisions = await prisma.division.findMany({ where: { isActive: true, notifyEnabled: true } });

  for (const division of divisions) {
    try {
      const deadline = effectiveDeadline(slot, division);
      const passed = (now.getTime() - deadline.getTime()) / 60_000;
      // 창 밖이면 아무것도 조회하지 않고 빠져나온다 — 1분마다 도는 루프다 (HM-35)
      const atReview = inWindow(passed, REVIEW_MINUTES);
      const atSubmit = inWindow(passed, SUBMIT_MINUTES);
      if (!atReview && !atSubmit) continue;

      /*
       * HM-34 — **최종본만 본다.** `startedAt >= 마감`이 그 조건이다.
       *
       * 예전에는 성공한 실행 중 가장 최근 것을 그냥 집어 왔다. 그러면 마감 전에 담당자가
       * 돌려본 미리보기가 «병합본 준비됐어요»로 나간다 — 2026-08-27에 실장이 세 명 빠진
       * 문서를 받은 게 정확히 그것이다. 미리보기는 최종본이 아니므로 여기서도 세지 않는다.
       */
      const run = await prisma.mergeRun.findFirst({
        where: {
          divisionId: division.id,
          weekSlotId: slot.id,
          status: 'succeeded',
          outputPath: { not: null },
          startedAt: { gte: deadline },
        },
        orderBy: { startedAt: 'desc' },
      });

      /*
       * HM-35 — **아직 돌고 있으면 기다린다.**
       *
       * 병합은 모델 호출까지 수 분이 걸릴 수 있다. 14:10에 아직 running인데 «병합본이
       * 아직 없어요»를 보내면, 담당자는 멀쩡히 되고 있는 걸 다시 누르러 간다 —
       * 그리고 그 알림은 `NotifyLog`에 «보냄»으로 박혀서 진짜 검토 요청이 못 나간다.
       * 창이 12분이므로 1분 주기로 최대 열두 번 다시 본다. 창을 넘기면 그때는 실패로 친다.
       */
      if (!run) {
        const inFlight = await prisma.mergeRun.findFirst({
          where: {
            divisionId: division.id,
            weekSlotId: slot.id,
            status: 'running',
            startedAt: { gte: deadline },
          },
          select: { id: true },
        });
        if (inFlight) continue;
      }
      // HM-33 — 병합이 남긴 것을 그대로 읽는다. 여기서 다시 계산하면 화면과 갈라진다
      let flagged: FlaggedRow[] = [];
      try {
        flagged = run?.reviewJson ? ((JSON.parse(run.reviewJson).flagged ?? []) as FlaggedRow[]) : [];
      } catch {
        flagged = []; // 옛 실행에는 없다 — 알림이 그것 때문에 멈추면 안 된다
      }
      // HM-34 — 병합본에 안 들어간 최신 제출이 몇 건인가. 병합이 남긴 sourceIds와 대조한다
      const used = new Set<string>(run ? (JSON.parse(run.sourceIds) as string[]) : []);
      const stale = run
        ? (
            await prisma.submission.findMany({
              where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true },
              select: { id: true },
            })
          ).filter((s) => !used.has(s.id)).length
        : 0;

      const facts: MergeFacts = {
        flagged,
        stale,
        ok: !!run,
        sources: used.size,
        counts: run?.rowCounts ? JSON.parse(run.rowCounts) : null,
      };
      const base = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}` : undefined;

      const jobs: { kind: NoticeKind; role: 'lead' | 'head'; url?: string }[] = [];
      if (atReview) {
        // 성공 → 부서장에게 검토 / 실패 → 담당자에게 경보. 둘은 배타적이다
        if (facts.ok) jobs.push({ kind: 'merge_review', role: 'head', url: base ? `${base}/archive` : undefined });
        else jobs.push({ kind: 'merge_missing', role: 'lead', url: base ? `${base}/manage` : undefined });
      }
      if (atSubmit) jobs.push({ kind: 'merge_done', role: 'lead', url: base ? `${base}/manage` : undefined });

      for (const j of jobs) {
        if (await alreadySent(division.id, slot.id, j.kind)) continue;
        const r = await deliver(
          division.id,
          slot.id,
          j.kind,
          await recipients(division.id, j.role),
          slot.label,
          monthly,
          facts,
          j.url,
          division.nameKo,
          slot.isoKey,
        );
        if (r) out.push(r);
      }
    } catch (e) {
      // 한 부서의 실패가 나머지를 막지 않는다
      logger.error({ division: division.nameKo, err: (e as Error).message }, '[알림] 병합 안내 실패');
    }
  }
  return out;
}
