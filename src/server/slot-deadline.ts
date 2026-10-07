// WS-19 · TACP-20 — 주차 마감 예외를 **미리 보고, 적용하고, 해제한다.**
//
// 예외 자체는 WS-18이다(주차에 싣는다). 여기는 그걸 사람이 안전하게 다루는 층이다:
// 바로 바꾸지 않고 먼저 무엇이 언제로 바뀌는지, 어떤 알림이 이미 지나 안 나가는지를 보여 준다.
import type { Scope } from './authz';
import { HttpError } from './authz';
import { prisma } from './db';
import { audit } from './audit';
import { ensureCurrentSlot } from './worklog';
import { reminderTimes, REMINDER_LABEL } from './notify/deadline-reminder';
import { MERGE_DELAY_MINUTES } from './merge/run';
import { REVIEW_MINUTES, SUBMIT_MINUTES } from './notify/merge-notices';
import { deadlineFor, formatDeadlineKo, KST, toKstIso, type DeadlinePolicy } from '@/lib/week';
import { DEPARTMENT_LEAD_MINUTES, parseDeadlineNotice } from '@/lib/deadline-notice';
import { TZDate } from '@date-fns/tz';
import type { WeekSlot } from '@prisma/client';

/** 켜진 부서가 없을 때 쓰는 평소 마감 — 전 부서 양식의 기본값과 같다 (DM-10) */
const FALLBACK: DeadlinePolicy = { deadlineDow: 4, deadlineTime: '14:00' };

export interface ScheduleRow {
  label: string;
  at: string; // KST ISO
  atKo: string;
  /** 지금보다 앞이면 이미 지나 나가지 않는다 (알림은 소급하지 않는다 — NT-43) */
  passed: boolean;
}

export interface DeadlinePlan {
  isoKey: string;
  weekLabel: string;
  external: string;
  externalKo: string;
  department: string;
  departmentKo: string;
  before: string;
  beforeKo: string;
  reason: string;
  matched: string | null;
  assumedPm: boolean;
  note: string;
  schedule: ScheduleRow[];
  /** 적용할 수 없는 이유. 있으면 화면은 [적용]을 그리지 않는다 */
  blocked: string | null;
  warnings: string[];
}

/**
 * 평소 마감 정책. 부서마다 다를 수 있지만(DM-10) 예외는 주차에 하나라서 기준이 하나 필요하다 —
 * **가장 이른** 부서 마감을 쓴다. 「이미 지났나」를 볼 때 가장 먼저 닫히는 부서가 기준이어야 한다.
 */
async function policies(): Promise<DeadlinePolicy[]> {
  const ds = await prisma.division.findMany({
    where: { isActive: true },
    select: { deadlineDow: true, deadlineTime: true },
  });
  return ds.length ? ds : [FALLBACK];
}

function earliest(slot: Pick<WeekSlot, 'opensAt' | 'deadlineDowOverride' | 'deadlineTimeOverride'>, ps: DeadlinePolicy[]): Date {
  return ps.map((p) => deadlineFor(slot, p)).reduce((a, b) => (a < b ? a : b));
}

/**
 * RU-50 — 그 주의 **기준 시각**: 켜진 부서들의 부서 마감 중 가장 이른 것(WS-18 예외 반영).
 * 3단계 기한·알림이 전부 여기서 계산되므로, 총괄이 마감을 옮기면 한꺼번에 따라 움직인다.
 */
export async function weekAnchor(slot: Pick<WeekSlot, 'opensAt' | 'deadlineDowOverride' | 'deadlineTimeOverride'>): Promise<Date> {
  return earliest(slot, await policies());
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);
const ko = (d: Date) => formatDeadlineKo(d);

/** RU-58 — 미리보기에 넣을 3단계 기한·알림. 3단계를 안 쓰면 빈 목록 */
async function rollupRows(department: Date): Promise<{ label: string; at: Date }[]> {
  const { loadOrgSetting } = await import('./rollup/tree');
  const { stagesFrom } = await import('./rollup/schedule');
  const { HQ_DUE_SOON_MINUTES } = await import('./rollup/notices');
  const s = await loadOrgSetting();
  if (!s.enabled) return [];
  const t = stagesFrom(department, s);
  return [
    { label: '실·팀 → 위로 제출 기한 · 본부 담당자 알림', at: t.unitDue },
    { label: '본부 → 총괄 제출 15분 전 알림', at: new Date(t.hqDue.getTime() - HQ_DUE_SOON_MINUTES * 60_000) },
    { label: '본부 → 총괄 제출 기한 · 총괄 도착 알림', at: t.hqDue },
  ];
}

/** 대외 마감(직접 입력) `YYYY-MM-DDTHH:mm` (KST) → Date */
export function parseExternalInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return null;
  const t = new TZDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0, KST);
  if (t.getDate() !== +m[3]) return null;
  return new Date(t.getTime());
}

/**
 * WS-19g — 미리보기. **쓰지 않는다.** 공지 원문이나 직접 입력한 대외 마감에서 출발한다.
 */
export async function planDeadline(
  input: { noticeText?: string; external?: string },
  now: Date = new Date(),
): Promise<DeadlinePlan> {
  let external: Date;
  let reason = '기획조정실 공지에 따라';
  let matched: string | null = null;
  let assumedPm = false;

  if (input.noticeText && input.noticeText.trim()) {
    const r = parseDeadlineNotice(input.noticeText, now);
    if (!r.ok) throw new HttpError(422, 'unparsable', r.error);
    ({ external, reason, matched, assumedPm } = r);
  } else if (input.external) {
    const d = parseExternalInput(input.external);
    if (!d) throw new HttpError(422, 'invalid_time', '대외 마감 날짜·시각 형식이 맞지 않습니다.');
    external = d;
  } else {
    throw new HttpError(422, 'invalid_request', '공지를 붙여넣거나 대외 마감을 입력해 주세요.');
  }

  const department = new Date(external.getTime() - DEPARTMENT_LEAD_MINUTES * 60_000);
  // 그 날이 든 주의 주차 — 다음 주 공지가 미리 오면 다음 주 주차가 잡힌다 (WS-11 지연 생성)
  const slot = await ensureCurrentSlot(department);
  const ps = await policies();
  const before = earliest(slot, ps);

  const k = new TZDate(department.getTime(), KST);
  const dowKo = '일월화수목금토'[k.getDay()];
  const note = `${reason} 이번 주만 ${dowKo}요일 ${hhmm(department)} 마감입니다 (대외 마감 ${hhmm(external)}). 다음 주부터는 평소대로입니다.`;

  const schedule: ScheduleRow[] = [
    ...reminderTimes(department).map((r) => ({ label: REMINDER_LABEL[r.kind], at: r.at })),
    { label: '부서 마감', at: department },
    { label: '자동 병합', at: new Date(department.getTime() + MERGE_DELAY_MINUTES * 60_000) },
    // NT-47 — 이미 승인했으면 검토 요청은 안 나가고, 제출 요청에는 승인 상태가 한 줄 붙는다
    { label: '부서장 검토 요청 (승인 전일 때만)', at: new Date(department.getTime() + REVIEW_MINUTES * 60_000) },
    { label: '담당자 제출 요청 (승인 상태 포함)', at: new Date(department.getTime() + SUBMIT_MINUTES * 60_000) },
    { label: '대외 마감', at: external },
    // RU-58 — 3단계를 쓰면 본부·총괄 기한도 같은 기준에서 따라 움직인다
    ...(await rollupRows(department)),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((r) => ({ label: r.label, at: toKstIso(r.at), atKo: ko(r.at), passed: r.at.getTime() <= now.getTime() }));

  // WS-19j — 지금 마감과 새 마감이 둘 다 아직 오지 않았을 때만 (TACP-20)
  let blocked: string | null = null;
  if (department.getTime() <= now.getTime()) blocked = `새 부서 마감(${ko(department)})이 이미 지났습니다.`;
  else if (before.getTime() <= now.getTime()) {
    blocked = `${slot.label}의 지금 마감(${ko(before)})이 이미 지났습니다 — 지난 마감은 옮길 수 없습니다.`;
  }

  const warnings: string[] = [];
  if (assumedPm) warnings.push(`「오전/오후」가 없어 ${hhmm(external)}(오후)로 읽었습니다.`);
  const missed = schedule.filter((r) => r.passed && r.label.endsWith('알림'));
  if (!blocked && missed.length) {
    warnings.push(`이미 지나서 나가지 않는 알림: ${missed.map((r) => r.label).join(' · ')} — 알림은 소급하지 않습니다.`);
  }
  if (before.getTime() === department.getTime()) warnings.push('지금 마감과 같습니다 — 바뀌는 것이 없습니다.');

  return {
    isoKey: slot.isoKey,
    weekLabel: slot.label,
    external: toKstIso(external),
    externalKo: ko(external),
    department: toKstIso(department),
    departmentKo: ko(department),
    before: toKstIso(before),
    beforeKo: ko(before),
    reason,
    matched,
    assumedPm,
    note,
    schedule,
    blocked,
    warnings,
  };
}

/** WS-19 — 적용. 미리보기를 **서버에서 다시 계산**한다 — 화면이 보낸 결과를 믿지 않는다 */
export async function applyDeadline(
  scope: Scope,
  input: { noticeText?: string; external?: string },
  now: Date = new Date(),
): Promise<DeadlinePlan> {
  const plan = await planDeadline(input, now);
  if (plan.blocked) throw new HttpError(409, 'deadline_passed', plan.blocked);

  const department = new Date(plan.department);
  const k = new TZDate(department.getTime(), KST);
  const dow = k.getDay() === 0 ? 7 : k.getDay(); // DM-10: 1=월 … 7=일
  const slot = await prisma.weekSlot.update({
    where: { isoKey: plan.isoKey },
    data: { deadlineDowOverride: dow, deadlineTimeOverride: hhmm(department), deadlineNote: plan.note },
  });
  // 계산한 마감과 저장한 예외가 같은 시각을 가리키는지 — 주가 어긋나면 여기서 드러난다
  const check = earliest(slot, [FALLBACK]);
  if (check.getTime() !== department.getTime()) {
    throw new HttpError(500, 'internal', '마감 예외를 저장했지만 계산이 맞지 않습니다. 운영자에게 알려 주세요.');
  }

  await audit(scope.user.email, 'deadline_override', null, `slot:${plan.isoKey}`, {
    before: plan.before,
    after: plan.department,
    external: plan.external,
    reason: plan.reason,
    matched: plan.matched,
  });
  return plan;
}

/** WS-19i — 해제. 평소 마감으로 돌아간다. 같은 시점 규칙(WS-19j)을 따른다 */
export async function clearDeadline(scope: Scope, isoKey: string, now: Date = new Date()) {
  const slot = await prisma.weekSlot.findUnique({ where: { isoKey } });
  if (!slot || slot.deadlineDowOverride === null) throw new HttpError(404, 'not_found', '이 주차에는 마감 예외가 없습니다.');
  const ps = await policies();
  const current = earliest(slot, ps);
  const normal = earliest({ ...slot, deadlineDowOverride: null, deadlineTimeOverride: null }, ps);
  if (current.getTime() <= now.getTime() || normal.getTime() <= now.getTime()) {
    throw new HttpError(409, 'deadline_passed', '이미 지난 마감은 되돌릴 수 없습니다.');
  }
  await prisma.weekSlot.update({
    where: { id: slot.id },
    data: { deadlineDowOverride: null, deadlineTimeOverride: null, deadlineNote: null },
  });
  await audit(scope.user.email, 'deadline_override', null, `slot:${isoKey}`, {
    before: toKstIso(current),
    after: toKstIso(normal),
    cleared: true,
  });
  return { isoKey, label: slot.label, normal: toKstIso(normal), normalKo: ko(normal) };
}

/** 화면 첫 상태 — 이번 주와 다음 주 */
export async function deadlineStatus(now: Date = new Date()) {
  const ps = await policies();
  const thisWeek = await ensureCurrentSlot(now);
  const next = await ensureCurrentSlot(new Date(now.getTime() + 7 * 86400_000));
  const row = (s: WeekSlot) => {
    const d = earliest(s, ps);
    return {
      isoKey: s.isoKey,
      label: s.label,
      deadline: toKstIso(d),
      deadlineKo: ko(d),
      overridden: s.deadlineDowOverride !== null,
      note: s.deadlineNote,
      passed: d.getTime() <= now.getTime(),
    };
  };
  return { weeks: [row(thisWeek), row(next)] };
}
