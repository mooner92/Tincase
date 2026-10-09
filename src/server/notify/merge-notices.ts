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
//
// **3단계에서는(RU-52 켜짐) +30분 안내가 바뀐다 (NT-47′ · 2026-10-08 · ADR-0015).** 부서장의 승인이 곧 위로 가는 제출이라
// 담당자가 누를 [제출]이 없다. 승인돼 올라갔으면 보내지 않고(승인 순간 NT-46′이 이미 말했다), 승인 전·승인 뒤 바뀜이면
// 「승인되면 저절로 ○○에 올라갑니다(기한)」, 부서장이 없는 부서면 「올라갔어요 — 고치면 다시 올라갑니다」 (submitLines).
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { sendAlert, messengerStatus } from '../messenger';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { slotKind } from '@/lib/week';
import { describeFlagged, type FlaggedRow } from '@/lib/empty-content';
import { approvalOf, reapproveKind } from '../merge/review';
import { NEWEST_FIRST, UNIT_REVIEW } from '../merge/review-scope';
import { loadOrgSetting, loadTree, submitTarget } from '../rollup/tree';
import { mergeStaleBefore } from '../merge/budget';
import type { MergeEdits } from '../merge/edits';
import { toKstIso } from '@/lib/week';
import type { Division, WeekSlot } from '@prisma/client';

/** 스케줄러가 5분 주기이므로 창은 그보다 넉넉해야 반드시 한 번 걸린다 */
const WINDOW_MINUTES = 12;
/** 부서장 검토 요청 */
export const REVIEW_MINUTES = 10;
/** 담당자 최종 제출 안내 */
export const SUBMIT_MINUTES = 30;
/**
 * HM-50 — 대외업무 마감(15:00 = 부서 마감 +60분). 병합이 이보다 늦게 끝나면 안내를 보내지 않는다 —
 * 대외 마감이 지난 뒤의 「검토해 주세요」는 할 수 있는 일이 없는 소음이다.
 */
export const LATE_LIMIT_MINUTES = 60;

export type NoticeKind = 'merge_review' | 'merge_missing' | 'merge_done' | 'merge_held';

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
export interface MergeFacts {
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
  /**
   * NT-47 · HM-47 — 이 최종본을 부서장이 승인했나. 담당자의 마지막 알림이 이것을 한 줄로 말한다.
   * `hasHead`가 거짓이면(부서장 계정이 없는 부서) 아무 줄도 넣지 않는다 — 올 수 없는 승인을 기다리게 하지 않는다
   */
  approval: { by: string; at: Date; summary: string; changedAfter: boolean } | null;
  hasHead: boolean;
  /** RU-53 — 3단계를 쓰면 올라가는 곳(「기획경영본부」·「총괄」). 안 쓰면 null — 게시판 문구 그대로 */
  submitTo?: string | null;
  /** RU-53 · RU-80 — 그 단위의 기한 (「15:00」 — 수합 관리 「위로」 카드와 같은 값). 3단계를 안 쓰면 null */
  submitDue?: string | null;
  /** HM-49 — 자동 재병합을 멈추게 한 사람 수정 (NT-51 `merge_held`에서만) */
  edits?: MergeEdits | null;
  /**
   * NT-44a (2026-10-10) — 이 주에 낸 사람 수(각자 최신 판). 병합본이 없을 때 **왜 없는지** 가른다: 0이면 만들 것이 없었던 것이라
   * [지금 병합]을 누를 일이 없다 — 예전 쪽지는 그래도 「[지금 병합]을 눌러주세요」라고 했다. 모르면(옛 호출) 두 경우를 함께 말한다
   */
  submitted?: number;
}

/**
 * RU-53 · NT-47′ (2026-10-08 개정) — 담당자 마지막 알림의 끝 줄. 3단계를 쓰면 **누를 버튼이 없다** — 부서장의 승인이 곧 제출이다(ADR-0015).
 * 그래서 「무엇을 기다리나」를 기한과 함께 말한다. 안 쓰면 게시판 문구 그대로.
 *   승인 전           「아직 부서장 승인 전이에요 — 승인되면 저절로 ○○에 올라갑니다(기한 15:00).」
 *   승인 뒤 바뀜      「부서장이 승인한 뒤 병합본이 바뀌었어요 — 다시 승인되면 저절로 ○○에 올라갑니다(기한 15:00).」
 *   부서장 없는 부서  「병합본이 ○○에 올라갔어요 — 고칠 곳은 고쳐 저장하면 다시 올라갑니다.」
 * (승인돼 올라갔으면 이 알림 자체를 보내지 않는다 — pickJobs)
 */
export function submitLines(f: Pick<MergeFacts, 'submitTo' | 'submitDue'> & Partial<Pick<MergeFacts, 'hasHead' | 'approval'>>): string[] {
  if (!f.submitTo) return ['Tincase에서 hwp로 받아 취합게시판에 올리고', '웹디스크에 업로드해주세요.'];
  const due = f.submitDue ? `(기한 ${f.submitDue})` : '';
  if (f.hasHead === false) return [`병합본이 ${f.submitTo}에 올라갔어요 — 고칠 곳은 고쳐 저장하면 다시 올라갑니다.`];
  if (f.approval && !f.approval.changedAfter) return [`부서장이 승인해 ${f.submitTo}에 올라갔어요.`];
  if (f.approval?.changedAfter) return [`부서장이 승인한 뒤 병합본이 바뀌었어요 — 다시 승인되면 저절로 ${f.submitTo}에 올라갑니다${due}.`];
  return [`아직 부서장 승인 전이에요 — 승인되면 저절로 ${f.submitTo}에 올라갑니다${due}.`];
}

/** NT-47 — 승인 한 줄 */
function approvalBlock(f: MergeFacts): string[] {
  // 승인한 뒤 병합본이 바뀌었으면 「승인 완료」라고 말하지 않는다 — 화면의 「승인 뒤 바뀜」과 같은 말을 한다
  if (f.approval?.changedAfter) {
    /*
     * NT-47a (2026-10-10) — 이 줄은 3단계가 꺼졌을 때만 나간다(compose: `staged`면 submitLines가 대신 말한다). 꺼져 있으면 부서장에게
     * 「다시 승인해 주세요」(NT-52)가 가지 않는다 — 담당자가 기다리면 아무도 부서장에게 말하지 않는다. 그래서 할 일을 적는다
     */
    return ['', `${f.approval.by}님이 승인한 뒤 병합본이 바뀌었어요 — 다시 확인을 받아주세요.`, '부서장에게는 쪽지가 가지 않으니 직접 부탁해 주세요.'];
  }
  if (f.approval) return ['', `${f.approval.by}님 승인 완료 (${toKstIso(f.approval.at).slice(11, 16)} · ${f.approval.summary})`];
  if (f.hasHead) return ['', '아직 부서장 승인 전이에요 — 확인한 뒤 제출해주세요.'];
  return [];
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

/**
 * NT-40·47 — 이 창에서 무엇을 누구에게 보내나. 순수 함수다 (시험할 수 있게).
 *
 *   +10  성공 → 부서장에게 검토 요청 (이미 승인했고 그 뒤 안 바뀌었으면 생략)
 *        실패 → 담당자에게 경보
 *   +30  담당자에게 최종 안내 (성공·실패 모두)
 *
 * ★ 성공·실패를 한 조건으로 묶지 않는다 — 「성공 + 이미 승인」이 실패 쪽으로 떨어져
 * 담당자에게 「병합본이 없어요」가 갔던 결함이 그것이었다 (2026-10-07 리뷰).
 */
export function pickJobs(
  atReview: boolean,
  atSubmit: boolean,
  facts: Pick<MergeFacts, 'ok' | 'approval'> & Partial<Pick<MergeFacts, 'submitTo' | 'hasHead'>>,
): { kind: NoticeKind; role: 'lead' | 'head' }[] {
  const jobs: { kind: NoticeKind; role: 'lead' | 'head' }[] = [];
  if (atReview) {
    if (facts.ok) {
      if (!facts.approval || facts.approval.changedAfter) jobs.push({ kind: 'merge_review', role: 'head' });
    } else jobs.push({ kind: 'merge_missing', role: 'lead' });
  }
  // NT-47′ · RU-53 — 3단계에서 부서장이 승인해 이미 올라갔으면 담당자에게 할 일이 없다 — NT-46′이 그 순간 이미 말했다
  const handedOff = !!facts.submitTo && facts.hasHead === true && facts.ok && !!facts.approval && !facts.approval.changedAfter;
  if (atSubmit && !handedOff) jobs.push({ kind: 'merge_done', role: 'lead' });
  return jobs;
}

/**
 * HM-50 — 마감 +`at`분 안내를 지금 보낼 때인가. 순수 함수다 (시험할 수 있게).
 *
 * 창은 `max(마감 + at, 병합이 끝난 시각)`에 열려 12분 간다. 예전에는 `[+at, +at+12]`로 못 박혀 있어서,
 * 부서가 많아 병합이 14:23에 끝나면 검토 요청 창(14:10~14:22)이 이미 지나 있었다 — 그 주에는 한 통도 안 나간다.
 * `settledMin`은 마감 뒤 마지막 병합 시도가 끝난(또는 병합본이 저장된) 시각 — 마감부터 센 분. 없으면 null.
 */
export function noticeDue(passedMin: number, atMin: number, settledMin: number | null): boolean {
  const start = Math.max(atMin, settledMin ?? atMin);
  if (start > LATE_LIMIT_MINUTES) return false;
  return passedMin >= start && passedMin <= start + WINDOW_MINUTES;
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
 * 순수 함수다 — 문구를 시험이 직접 본다(NT-T86).
 */
export function composeNotice(kind: NoticeKind, who: Person, slotLabel: string, monthly: boolean, f: MergeFacts) {
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
        /*
         * NT-44b (2026-10-10) — 할 일을 단추 이름으로. 예전 「Tincase에서 내용을 확인하고 고칠 부분을 알려주세요」는 담당자에게 말하라는 뜻으로 읽혔다 —
         * 부서장은 직접 고쳐 저장하거나(그것이 승인 — HM-47) [고칠 것 없음 · 승인]을 누른다. 단추 이름은 화면(MergePanel·MergedDrawer)과 글자까지 같다
         */
        'Tincase 수합 관리에서 확인하고, 고칠 것이 없으면 [고칠 것 없음 · 승인]을 눌러 주세요.',
        '고칠 곳은 직접 고쳐 저장하면 그것이 승인입니다 — 담당자에게 바로 알려집니다.',
        '각 항목을 누가 냈는지도 함께 보입니다.',
      ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n'),
    };
  }

  if (kind === 'merge_held') {
    // NT-51 · HM-49 — 사실 두 줄(빠진 사람 · 멈춘 이유) → 할 일 → 그 대가. 대가를 빼면 누르고 나서야 안다
    const who = f.edits?.by.length ? `${f.edits.by.join(', ')}님이` : '누군가';
    return {
      subject: `[Tincase] ${label} 병합본에 늦게 낸 ${f.stale}명이 빠져 있어요`,
      contents: [
        `${head} 마감 열기가 끝났어요. 병합본을 만든 뒤에 ${f.stale}명이 더 냈는데 지금 병합본에는 빠져 있어요.`,
        `${who} 병합본을 ${f.edits?.places ?? 0}곳 고쳐서 자동으로 다시 병합하지 않았어요.`,
        '',
        '넣으려면 Tincase 수합 관리에서 [다시 병합]을 눌러주세요.',
        '다시 병합하면 고친 내용은 사라져요.',
      ].join('\n'),
    };
  }

  /*
   * NT-44a (2026-10-10) — 병합본이 없는 **이유**에 따라 할 일이 다르다. 낸 사람이 없으면 만들 것이 없었던 것이라 [지금 병합]을 누를 일이 없다 —
   * 예전 쪽지는 그때도 「[지금 병합]을 눌러주세요」였다. 「제출된 파일」은 v1 낱말이다(이제 파일을 올리지 않는다 — 웹 작성, WA-39)
   */
  const noneSubmitted = f.submitted === 0;
  const why = noneSubmitted
    ? ['이번 주 제출이 한 건도 없어 병합본을 만들지 않았어요.']
    : [f.submitted === undefined ? '제출이 없거나 병합에 실패했을 수 있어요.' : '병합에 실패했어요.'];

  if (kind === 'merge_missing') {
    return {
      subject: `[Tincase] ${slotLabel} 병합본이 아직 없어요`,
      contents: [
        `${head} ${slotLabel} 병합본이 만들어지지 않았어요.`,
        '',
        ...why,
        ...(noneSubmitted ? [] : ['Tincase 수합 관리에서 확인하고 [지금 병합]을 눌러주세요.']),
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
        ...(noneSubmitted ? why : ['대외업무 마감이 얼마 남지 않았어요.', 'Tincase 수합 관리에서 [지금 병합]을 눌러주세요.']),
      ].join('\n'),
    };
  }
  // NT-47′ — 3단계에서는 누를 버튼이 없다. 승인 줄(approvalBlock)은 끝 줄(submitLines)이 대신 말한다 — 두 줄이 서로 다른 말을 하지 않게
  const staged = !!f.submitTo;
  return {
    subject: staged
      ? f.hasHead
        ? `[Tincase] ${label} 병합본 — 부서장 승인을 기다려요`
        : `[Tincase] ${label} 병합본이 ${f.submitTo}에 올라갔어요`
      : `[Tincase] ${label} 병합본 제출해주세요`,
    contents: [
      `${head} ${label} 병합본이 준비됐어요.`,
      '',
      rowsLine(f),
      ...(staged ? [] : approvalBlock(f)),
      ...staleBlock(f.stale, 'Tincase 수합 관리에서 [다시 병합]을 눌러주세요.'),
      ...flagBlock(f.flagged),
      '',
      ...submitLines(f),
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
    const r = await sendAlert({ recvIds: [p.employeeNo], ...composeNotice(kind, p, slotLabel, monthly, facts), url, kind });
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
  // RU-53 — 3단계를 쓰면 마지막 알림의 할 일이 「게시판」이 아니라 「Tincase에서 제출」이다 — 그 단위의 기한과 함께.
  // 단계 시각은 동적으로 읽는다: schedule → slot-deadline이 이 파일의 상수를 읽어 정적으로 이으면 고리가 된다
  const tree = (await loadOrgSetting()).enabled ? await loadTree() : null;
  const stages = tree
    ? await (async () => {
        const { stageTimes, stageCells } = await import('../rollup/schedule');
        const t = await stageTimes(slot);
        return stageCells(t.anchor, t);
      })()
    : null;

  for (const division of divisions) {
    try {
      const deadline = effectiveDeadline(slot, division);
      const passed = (now.getTime() - deadline.getTime()) / 60_000;
      // 창 밖이면 아무것도 조회하지 않고 빠져나온다 — 1분마다 도는 루프다 (HM-35).
      // 창은 병합이 늦게 끝나면 뒤로 밀리지만(HM-50) 대외 마감 + 12분을 넘지는 않는다
      if (passed < REVIEW_MINUTES || passed > LATE_LIMIT_MINUTES + WINDOW_MINUTES) continue;

      /*
       * HM-50 — 창은 **병합이 끝난 시각**부터 연다. `finishedAt`은 병합이 끝났거나 병합본이 저장된 시각이다 —
       * 승인 뒤 병합본이 바뀌어 부서장에게 다시 묻는 것도(pickJobs) 같은 창을 따른다. 대외 마감 전까지만.
       */
      const settled = await prisma.mergeRun.findFirst({
        where: {
          divisionId: division.id,
          weekSlotId: slot.id,
          status: { in: ['succeeded', 'failed'] },
          startedAt: { gte: deadline },
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      });
      const settledMin = settled?.finishedAt ? (settled.finishedAt.getTime() - deadline.getTime()) / 60_000 : null;
      const atReview = noticeDue(passed, REVIEW_MINUTES, settledMin);
      const atSubmit = noticeDue(passed, SUBMIT_MINUTES, settledMin);
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
       *
       * HM-55 — 단, **멈춘 running은 기다리지 않는다.** 예산 + 여유(기본 10분)보다 오래된 running은 재시작 등으로 끊긴
       * 기록이다. 그걸 「돌고 있음」으로 보면 이 부서는 「병합본이 아직 없어요」도 +30분 안내도 영영 못 받는다
       * (운영 DB의 2026-09-03 14:18:50 행). 스케줄러가 곧 실패로 회수하지만, 회수 전에도 여기서는 기다리지 않는다.
       */
      if (!run) {
        const staleBefore = mergeStaleBefore(now);
        const inFlight = await prisma.mergeRun.findFirst({
          where: {
            divisionId: division.id,
            weekSlotId: slot.id,
            status: 'running',
            startedAt: { gte: staleBefore > deadline ? staleBefore : deadline },
          },
          select: { id: true },
        });
        if (inFlight) continue;
        /*
         * HM-59 · HM-60 (2026-10-08 2단계) — **줄에 선 부서**도 기다린다. 줄에 넣었지만 차례가 오지 않은 부서, 실패 뒤 다시 줄에 선 부서는
         * 「병합본이 아직 없어요 — [지금 병합]」이 아니다 — 누를 것이 없다. 끝나면 창이 그 시각부터 열린다(HM-50).
         * queue.ts를 잇지 않고 표를 직접 본다 — queue → run → 이 파일 고리가 된다
         */
        const queued = await prisma.mergeJob.count({
          where: { divisionId: division.id, weekSlotId: slot.id, status: { in: ['queued', 'running'] } },
        });
        if (queued > 0) continue;
        /*
         * HM-50 — 아직 **차례가 오지 않은** 부서도 기다린다. 스케줄러는 부서를 차례로 병합하고 하나 끝날 때마다
         * 여기를 부른다 — 뒤 부서는 아직 시도조차 안 됐다. 그것을 「병합본이 아직 없어요 — [지금 병합]」으로 보내면
         * 줄 서 있는 것을 실패라고 부르는 셈이다(13개 부서를 흉내 낸 시험에서 일곱 통이 그렇게 나갔다).
         * 낸 사람이 있는데 마감 뒤 시도가 없으면 기다린다 — 병합이 끝나면 창이 그 시각부터 열린다.
         * 낸 사람이 없으면 병합은 영영 돌지 않으므로 지금처럼 바로 알린다.
         */
        const attempted = await prisma.mergeRun.count({
          where: { divisionId: division.id, weekSlotId: slot.id, startedAt: { gte: deadline } },
        });
        if (attempted === 0) {
          const submitted = await prisma.submission.count({
            where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true },
          });
          if (submitted > 0) continue;
        }
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
        approval: run ? await approvalOf(run) : null,
        ...(() => {
          const t = tree ? submitTarget(tree, division.id) : null;
          if (!t || !stages) return { submitTo: null, submitDue: null };
          // 본부로 가면 실·팀 → 본부 기한, 본부 단계 없이 총괄로 가면 본부 → 총괄 기한 (「위로」 카드와 같은 규칙 — RU-80)
          return t.kind === 'hq' ? { submitTo: t.node.node.nameKo, submitDue: stages.unitDueKo } : { submitTo: '총괄', submitDue: stages.hqDueKo };
        })(),
        hasHead: (await prisma.user.count({ where: { divisionId: division.id, isActive: true, divisionRole: 'head' } })) > 0,
        ok: !!run,
        sources: used.size,
        // NT-44a — 병합본이 없을 때 「낸 사람이 없어서」인지 가른다
        submitted: await prisma.submission.count({ where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true } }),
        counts: run?.rowCounts ? JSON.parse(run.rowCounts) : null,
      };
      const base = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}` : undefined;

      const jobs = pickJobs(atReview, atSubmit, facts).map((j) => ({
        ...j,
        // NT-53 — 알림 종류와 상관없이 수합 관리로. 부서장의 검토·승인도 수합 관리에서 한다(이미 나간 옛 보관함 주소는 PG-70이 받는다)
        url: base ? `${base}/manage` : undefined,
      }));

      for (const j of jobs) {
        if (await alreadySent(division.id, slot.id, j.kind)) continue;
        /*
         * NT-52 ↔ NT-40 — 부서장의 **가장 최근 승인**에 대해 이미 「다시 승인해 주세요」(NT-52, 바뀐 순간)를 보냈으면 +10분 검토 요청을
         * 또 보내지 않는다 — 실장이 14:03에 승인하고 담당자가 14:06에 고치면 같은 할 일이 4분 사이에 두 번 가던 틈 (2026-10-08 검증).
         * NT-52가 승인마다 한 번이 되면서(결정 e) 판(sha)이 아니라 그 승인으로 본다 — 그 뒤 또 바뀌어도 할 일은 같다(다시 승인).
         * 기록을 남기지 않고 건너뛴다.
         */
        if (j.kind === 'merge_review') {
          const last = await prisma.mergeReview.findFirst({
            where: { divisionId: division.id, weekSlotId: slot.id, ...UNIT_REVIEW },
            orderBy: NEWEST_FIRST,
            select: { id: true },
          });
          if (last && (await prisma.notifyLog.findFirst({ where: { divisionId: division.id, weekSlotId: slot.id, kind: reapproveKind(last.id) } }))) continue;
        }
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

/**
 * NT-51 · HM-49 — 사람이 고친 최종본이라 **자동 재병합을 멈췄다**고 담당자에게 한 번 알린다.
 *
 * 마감 열기가 닫히면 그 시각이 새 마감 이벤트라 병합이 다시 돈다(DM-20). 그런데 최종본을 부서장·담당자가 고쳤으면
 * 다시 병합이 그 수정을 통째로 지운다. 그래서 스케줄러는 멈추고, 늦게 낸 사람을 넣을지는 담당자가 고르게 한다 —
 * 그러려면 「늦게 낸 사람이 빠져 있다」와 「누르면 무엇이 사라진다」를 같이 알아야 한다.
 *
 * 닫힘마다 한 번이다: 종류에 닫힌 시각을 붙여 `(부서, 주차, 종류)` 유니크를 피한다 (승인 알림과 같은 방식).
 * 보내지 않았으면 null — 메신저가 꺼졌거나, 부서 알림이 꺼졌거나, 이미 보냈거나, 받을 사람이 없다.
 */
export async function noticeMergeHeld(opts: {
  division: Division;
  slot: WeekSlot;
  /** 이번에 닫힌 시각 (자동 병합 기준 `mergeGate`) */
  gate: Date;
  late: number;
  edits: MergeEdits;
}): Promise<NoticeOutcome | null> {
  const { division, slot, gate, late, edits } = opts;
  if (!messengerStatus().enabled || !division.notifyEnabled) return null;
  const logKind = `merge_held:${gate.getTime()}`;
  if (await prisma.notifyLog.findFirst({ where: { divisionId: division.id, weekSlotId: slot.id, kind: logKind } })) return null;

  const people = await recipients(division.id, 'lead');
  if (people.length === 0) {
    logger.info({ division: division.nameKo, kind: 'merge_held' }, '[알림] 받을 사람이 없어 건너뜀 (사번·알림설정 확인)');
    return null;
  }
  const facts: MergeFacts = { ok: true, sources: 0, counts: null, flagged: [], stale: late, approval: null, hasHead: false, edits };
  const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/${division.slug}/manage` : undefined;
  const monthly = slotKind(slot) === 'monthly';
  const sent: string[] = [];
  const blocked: string[] = [];
  for (const p of people) {
    const r = await sendAlert({ recvIds: [p.employeeNo], ...composeNotice('merge_held', p, slot.label, monthly, facts), url, kind: logKind });
    sent.push(...r.sent);
    blocked.push(...r.blocked);
  }
  if (sent.length > 0) {
    await prisma.notifyLog.create({
      data: {
        divisionId: division.id,
        weekSlotId: slot.id,
        kind: logKind,
        recipients: JSON.stringify(sent),
        detail: JSON.stringify({ late, places: edits.places, by: edits.by, blocked, targets: people.length }),
      },
    });
  }
  return {
    division: division.nameKo,
    isoKey: slot.isoKey,
    kind: 'merge_held',
    status: 'succeeded',
    targets: people.length,
    sent: sent.length,
    blocked: blocked.length,
  };
}
