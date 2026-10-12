// HM-54 · NT-60 — 「병합 점검」 요약: 마감 병합이 **다 끝났는지, 문제없는지** 누군가 확인하고 알린다.
//
// 예전에는 실패 알림이 그 부서 담당자 개인에게만 갔다(NT-40 merge_missing). 13개 중 2개가 실패해 재시도를 기다리고 3개가 모델 없이
// 처리돼도 운영자와 기획조정실은 몰랐고, 총괄은 15:00 미도착 목록에서야 알았다(2026-10-08 검토의 P1).
//
// 그래서 한 통으로 묶어 보낸다 — 줄이 빈 순간(늦어도 마감 +15분). 그때 남은 부서가 있으면 그 목록과 예상 끝 시각을, 다 끝나면 「완료」를
// 한 통 더. 한 기준 시각에 사람마다 많아야 두 통이다. **10분을 넘겨도 모델을 계속 쓴다**(사용자 결정 — 품질 먼저): 시간을 맞추려
// 남은 부서를 모델 없이 처리하지 않는 대신, 이 요약이 「아직 n곳 · 예상 끝」을 사실대로 말한다.
//
// 받는 사람은 운영자와 기획조정실 담당이다(TACP-30 — `mergeBatchAudience`). 담는 것은 부서 이름과 상태뿐 — 사람 이름 · 문서 내용은 없다.
import type { Division, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { env } from '../env';
import { messengerStatus, sendAlert } from '../messenger';
import { claimNotice, settleNotice } from './claim';
import { effectiveDeadline, ensureCurrentSlot } from '../worklog';
import { mergeGateOf } from '../deadline';
import { mergeBatchAudience, type MergeBatchRecipient } from '../authz';
import { readStoredFile, sha256 } from '../storage';
import { editsOf, HELD_TEXT } from '../merge/edits';
import { MERGE_DELAY_MINUTES, RETRY_BACKOFF_MINUTES } from '../merge/run';
import { averageJobMs, modelUseOf } from '../merge/queue';
import { LATE_LIMIT_MINUTES } from './merge-notices';
import { slotKind, toKstIso } from '@/lib/week';

/** HM-54b — 줄이 비지 않아도 이때는 보낸다 (마감 +15분) */
export const BATCH_BY_MINUTES = 15;
/** HM-54c — 「완료」를 기다리는 끝 (기준 +24시간) */
export const BATCH_DONE_HORIZON_MINUTES = 24 * 60;
/** 문제 줄은 이만큼까지 — 팝업이라 길면 안 읽힌다 */
const ISSUE_LINES = 12;

/**
 * 부서 하나의 상태 (HM-54e ⑥).
 *   done 최종본 있음 · held 보류(사람이 고친 판 — HM-49 · HM-61) · nothing 낸 사람 없음 · open 마감 열림(닫히면 돈다)
 *   running 병합 중 · queued 줄에서 기다림 · failed 실패(재시도 기다림) · waiting 아직 시작 안 함
 */
export type BatchState = 'done' | 'held' | 'nothing' | 'open' | 'running' | 'queued' | 'failed' | 'waiting';

export interface BatchDivision {
  id: string;
  name: string;
  state: BatchState;
  finishedAt: Date | null;
  /** 최종본의 모델 사용 — 썼다 · 못 쓴 표가 있다 · 부르지 않았다. 최종본이 없으면 null */
  model: 'used' | 'fallback' | 'none' | null;
  /** 문제 줄 (부서 이름 뒤에 붙는다). 문제가 없으면 비어 있다 */
  notes: string[];
}

export interface BatchReport {
  deadline: Date;
  divisions: BatchDivision[];
  /** 낸 사람이 있는 부서 수 */
  total: number;
  /** 최종본이 있는 부서 수(보류 포함 — 병합본이 있다) */
  done: number;
  left: number;
  counts: { used: number; fallback: number; failed: number; held: number; waiting: number; nothing: number };
  lastFinishedAt: Date | null;
  /** 줄이 비었다 — 병합 중 · 대기 · 아직 시작 안 함이 없다(실패해 재시도를 기다리는 것 · 마감 열림은 줄 밖이다) */
  drained: boolean;
  /** 다 끝났다 — 모두 최종본 · 보류 · 제출 없음 */
  complete: boolean;
  etaAt: Date | null;
}

const hhmm = (d: Date) => toKstIso(d).slice(11, 16);
const hhmmss = (d: Date) => toKstIso(d).slice(11, 19);
const KIND_KO: Record<string, string> = {
  timeout: '시간 초과',
  connection: '연결 실패',
  http: '모델 서버 오류',
  budget: '시간 예산 초과',
  invalid: '모델 답 오류',
};

/** HM-54e — 부서 하나를 본다. 순서가 곧 우선순위다: 줄의 작업 → 최종본 → 제출 없음 → 마감 열림 → 보류 → 실패 → 아직 */
async function checkDivision(division: Division, slot: WeekSlot, now: Date, lineup: Map<string, number>): Promise<BatchDivision> {
  const base = { id: division.id, name: division.nameKo, finishedAt: null, model: null } as const;
  const job = await prisma.mergeJob.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: { in: ['queued', 'running'] } },
    orderBy: { orderKey: 'asc' },
  });
  if (job?.status === 'running') return { ...base, state: 'running', notes: ['병합 중'] };
  if (job) return { ...base, state: 'queued', notes: [`대기 ${lineup.get(job.id) ?? '?'}번째`] };

  const gate = await mergeGateOf(division, slot);
  const final = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null }, startedAt: { gte: gate } },
    orderBy: { startedAt: 'desc' },
  });
  if (final) {
    const notes: string[] = [];
    // ③ 표마다 모델을 썼나 — 부르지 않은 표(skipped)는 문제가 아니다
    const use = modelUseOf(final.reviewJson);
    for (const m of use?.misses ?? []) {
      const why = (m.kind && KIND_KO[m.kind]) || m.reason || '모델 못 씀';
      notes.push(m.table === '분류' ? `분류 못 함(${why})` : `${m.table} 중복 묶기 못 함(${why})`);
    }
    // ④ 디스크 파일 = 기록 — 겹친 쓰기로 파일과 기록이 어긋난 것을 잡는다(HM-56e). 옛 실행(outputSha 없음)은 보지 않는다
    if (final.outputSha) {
      try {
        if (sha256(await readStoredFile(final.outputPath!)) !== final.outputSha) notes.push('파일이 기록과 다름');
      } catch {
        notes.push('파일 없음');
      }
    }
    // ⑤ 늦게 낸 사람 — 병합에 안 들어간 최신 제출 (NT-40 「병합한 뒤에 n명이 더 냈어요」와 같은 계산)
    let used: Set<string>;
    try {
      used = new Set(JSON.parse(final.sourceIds) as string[]);
    } catch {
      used = new Set();
    }
    const latest = await prisma.submission.findMany({ where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true }, select: { id: true } });
    const late = latest.filter((s) => !used.has(s.id)).length;
    if (late > 0) notes.push(`늦게 낸 ${late}명 빠짐`);
    return {
      ...base,
      state: 'done',
      finishedAt: final.finishedAt,
      model: use && use.misses.length > 0 ? 'fallback' : use && use.used > 0 ? 'used' : 'none',
      notes,
    };
  }

  const submitted = await prisma.submission.count({ where: { divisionId: division.id, weekSlotId: slot.id, isLatest: true } });
  if (submitted === 0) return { ...base, state: 'nothing', notes: [] };
  if (now < gate) return { ...base, state: 'open', notes: [`마감 열림(~${hhmm(gate)})`] };

  const lastAfterGate = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, startedAt: { gte: gate } },
    orderBy: { startedAt: 'desc' },
  });
  if (lastAfterGate?.status === 'failed' && lastAfterGate.errorText === HELD_TEXT) {
    return { ...base, state: 'held', notes: ['보류 — 병합하는 동안 고친 판을 덮지 않음'] };
  }
  // HM-49 — 마감 뒤 최종본을 사람이 고쳐 자동 재병합을 멈췄다(마감 열기가 닫혀 기준이 밀린 경우)
  const latestOk = await prisma.mergeRun.findFirst({
    where: { divisionId: division.id, weekSlotId: slot.id, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  if (latestOk && latestOk.startedAt >= effectiveDeadline(slot, division) && editsOf(latestOk)) {
    return { ...base, state: 'held', notes: ['보류 — 사람이 고친 병합본'] };
  }
  if (lastAfterGate?.status === 'failed') {
    const failures = await prisma.mergeRun.count({
      where: { divisionId: division.id, weekSlotId: slot.id, status: 'failed', startedAt: { gte: gate } },
    });
    const wait = RETRY_BACKOFF_MINUTES[Math.min(failures - 1, RETRY_BACKOFF_MINUTES.length - 1)];
    const next = new Date(lastAfterGate.startedAt.getTime() + wait * 60_000);
    return { ...base, state: 'failed', notes: [`실패 — 다음 재시도 ${hhmm(next)} (${lastAfterGate.errorText ?? '알 수 없는 오류'})`] };
  }
  if (lastAfterGate?.status === 'running') return { ...base, state: 'running', notes: ['병합 중'] };
  return { ...base, state: 'waiting', notes: ['아직 시작 안 함'] };
}

/** HM-54 — 한 묶음(같은 주 마감을 쓰는 부서들)의 점검 결과 */
export async function mergeBatchReport(slot: WeekSlot, deadline: Date, divisions: Division[], now: Date = new Date()): Promise<BatchReport> {
  const active = await prisma.mergeJob.findMany({ where: { status: { in: ['queued', 'running'] } }, orderBy: [{ orderKey: 'asc' }, { id: 'asc' }] });
  const line = [...active.filter((j) => j.status === 'running'), ...active.filter((j) => j.status === 'queued')];
  const lineup = new Map(line.map((j, i) => [j.id, i + 1]));
  const rows: BatchDivision[] = [];
  for (const d of divisions) {
    try {
      rows.push(await checkDivision(d, slot, now, lineup));
    } catch (e) {
      // 한 부서의 설정 오류가 요약 전체를 막지 않는다 — 그 부서는 「확인 못 함」으로
      logger.error({ division: d.nameKo, err: (e as Error).message }, '[알림] 병합 점검 — 부서 확인 실패');
      rows.push({ id: d.id, name: d.nameKo, state: 'waiting', finishedAt: null, model: null, notes: ['확인 못 함'] });
    }
  }
  const count = (s: BatchState) => rows.filter((r) => r.state === s).length;
  const nothing = count('nothing');
  const total = rows.length - nothing;
  const done = count('done') + count('held');
  const inLine = count('running') + count('queued') + count('waiting');
  const finished = rows.map((r) => r.finishedAt).filter((d): d is Date => !!d);
  const avg = inLine > 0 ? await averageJobMs() : 0;
  return {
    deadline,
    divisions: rows,
    total,
    done,
    left: total - done,
    counts: {
      used: rows.filter((r) => r.model === 'used').length,
      fallback: rows.filter((r) => r.model === 'fallback').length,
      failed: count('failed'),
      held: count('held'),
      waiting: inLine + count('open'),
      nothing,
    },
    lastFinishedAt: finished.length ? new Date(Math.max(...finished.map((d) => d.getTime()))) : null,
    drained: inLine === 0,
    complete: rows.every((r) => r.state === 'done' || r.state === 'held' || r.state === 'nothing'),
    etaAt: inLine > 0 ? new Date(now.getTime() + inLine * avg) : null,
  };
}

/** HM-54f — 문구. 사실 한 줄과 수, 문제 있는 부서만 한 줄씩. 사람 이름 · 문서 내용은 넣지 않는다(TACP-30) */
export function batchMessage(p: Pick<MergeBatchRecipient, 'name' | 'employeeNo'>, slot: WeekSlot, r: BatchReport, kind: 'first' | 'done', now: Date) {
  const at = hhmm(now);
  const tally = `${r.done}/${r.total} 끝`;
  const c = r.counts;
  const label = `${slot.label} ${slotKind(slot) === 'monthly' ? '월간' : '주간'}`;
  const lines = [
    `[${p.employeeNo}]${p.name}님 ${label} 마감 병합 점검 (${at})`,
    '',
    [tally, `모델 사용 ${c.used}`, `모델 못 씀 ${c.fallback}`, `실패 ${c.failed}`, `보류 ${c.held}`, `대기 ${c.waiting}`, ...(c.nothing ? [`제출 없음 ${c.nothing}`] : [])].join(' · '),
  ];
  if (r.lastFinishedAt) lines.push(`마지막 끝 ${hhmmss(r.lastFinishedAt)}`);
  if (r.left > 0 && r.etaAt) lines.push(`예상 끝 ${hhmm(r.etaAt)}`);
  const issues = r.divisions.flatMap((d) => d.notes.map((n) => `· ${d.name} — ${n}`));
  if (issues.length) {
    lines.push('', ...issues.slice(0, ISSUE_LINES));
    if (issues.length > ISSUE_LINES) lines.push(`· 외 ${issues.length - ISSUE_LINES}건`);
  }
  return {
    subject: kind === 'done' ? `[Tincase] 병합 점검 완료 ${at} · ${tally}` : `[Tincase] 병합 점검 ${at} · ${tally}${r.left > 0 ? ` · ${r.left}곳 남음` : ''}`,
    contents: lines.join('\n'),
  };
}

/** HM-54c — 기록 종류. 사람마다 · 기준 시각마다 (`(부서, 주차, 종류)` 유일 키 — 받는 사람의 부서로 남긴다) */
export const batchKind = (deadline: Date, userId: string) => `merge_batch:${deadline.getTime()}:${userId}`;
export const batchDoneKind = (deadline: Date, userId: string) => `merge_batch_done:${deadline.getTime()}:${userId}`;

export interface BatchNoticeOutcome {
  kind: 'merge_batch' | 'merge_batch_done';
  deadline: Date;
  sent: number;
  targets: number;
}

async function deliverBatch(
  people: MergeBatchRecipient[],
  kindOf: (p: MergeBatchRecipient) => string,
  slot: WeekSlot,
  report: BatchReport,
  kind: 'first' | 'done',
  now: Date,
): Promise<BatchNoticeOutcome | null> {
  const detail = { complete: report.complete, done: report.done, total: report.total, left: report.left };
  let sent = 0;
  let targets = 0;
  for (const p of people) {
    // 기록을 먼저 잡는다(결정 f) — 스케줄러와 일꾼이 같은 순간에 판정해도 한 번
    const logKind = kindOf(p);
    const claim = await claimNotice(p.divisionId, slot.id, logKind, detail);
    if (!claim) continue;
    targets++;
    const out: string[] = [];
    try {
      const url = p.operator && env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/ops` : undefined;
      // NT-56 — NotifyLog와 같은 종류를 싣는다(가짜 알림 수신함으로 갈 때만 머리로 — 한 주 리허설이 이 값으로 판정한다)
      const r = await sendAlert({ recvIds: [p.employeeNo], ...batchMessage(p, slot, report, kind, now), url, kind: logKind });
      out.push(...r.sent);
    } finally {
      await settleNotice(claim, out, detail);
    }
    sent += out.length;
  }
  return targets ? { kind: kind === 'done' ? 'merge_batch_done' : 'merge_batch', deadline: report.deadline, sent, targets } : null;
}

/**
 * HM-54b·c·g — 스케줄러가 매분, 일꾼이 줄이 빌 때 부른다(`coalesce('merge-notices')` 안에서 — HM-60c).
 * 마감이 같은 부서끼리 묶어 기준 시각마다 판정한다. 메신저가 꺼져 있으면 아무것도 안 한다(기록도 없다).
 * 창 밖이면 기록만 보고 빠져나온다 — 1분마다 도는 길이다.
 */
export async function runDueMergeBatchNotices(now: Date = new Date()): Promise<BatchNoticeOutcome[]> {
  if (!messengerStatus().enabled) return [];
  const slot = await ensureCurrentSlot(now);
  const divisions = await prisma.division.findMany({ where: { isActive: true }, orderBy: { nameKo: 'asc' } });
  const groups = new Map<number, Division[]>();
  for (const d of divisions) {
    try {
      const t = effectiveDeadline(slot, d).getTime();
      groups.set(t, [...(groups.get(t) ?? []), d]);
    } catch {
      // 마감 설정이 깨진 부서는 병합 쪽이 따로 오류를 남긴다
    }
  }

  const out: BatchNoticeOutcome[] = [];
  let audience: MergeBatchRecipient[] | null = null;
  for (const [t, members] of groups) {
    const passed = (now.getTime() - t) / 60_000;
    if (passed < MERGE_DELAY_MINUTES || passed > BATCH_DONE_HORIZON_MINUTES) continue;
    const deadline = new Date(t);
    audience ??= await mergeBatchAudience();
    if (audience.length === 0) return out;

    const logs = await prisma.notifyLog.findMany({
      where: { weekSlotId: slot.id, kind: { in: audience.flatMap((p) => [batchKind(deadline, p.id), batchDoneKind(deadline, p.id)]) } },
      select: { kind: true, detail: true },
    });
    const logOf = new Map(logs.map((l) => [l.kind, l]));
    const firstOpen = passed <= LATE_LIMIT_MINUTES; // HM-54b — 대외 마감이 지나면 첫 통은 보내지 않는다
    const needFirst = firstOpen ? audience.filter((p) => !logOf.has(batchKind(deadline, p.id))) : [];
    const needDone = audience.filter((p) => {
      const first = logOf.get(batchKind(deadline, p.id));
      if (!first || logOf.has(batchDoneKind(deadline, p.id))) return false;
      try {
        return JSON.parse(first.detail ?? '{}').complete === false;
      } catch {
        return false;
      }
    });
    if (needFirst.length === 0 && needDone.length === 0) continue;

    const report = await mergeBatchReport(slot, deadline, members, now);
    if (needFirst.length && (report.drained || passed >= BATCH_BY_MINUTES)) {
      const r = await deliverBatch(needFirst, (p) => batchKind(deadline, p.id), slot, report, 'first', now);
      if (r) out.push(r);
    }
    if (needDone.length && report.complete) {
      const r = await deliverBatch(needDone, (p) => batchDoneKind(deadline, p.id), slot, report, 'done', now);
      if (r) out.push(r);
    }
  }
  return out;
}
