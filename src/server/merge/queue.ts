// HM-59 · HM-60 — 병합 **줄**: 작업 표 하나 · 일꾼 하나 (ADR-0019).
//
// ── 왜 시각표가 아니라 줄인가 ──────────────────────────────────
// 부서 하나를 병합하는 데 6초가 걸릴 때도 125초가 걸릴 때도 있다(2026-10 실측). 「부서마다 몇 분씩 띄워 시작」하면 빨리 끝난 만큼
// 시간이 버려지고, 늦게 끝난 만큼 다음 부서와 겹친다. 그래서 모든 병합을 줄 하나에 세우고 앞의 것이 끝나면 바로 다음을 한다.
// 「부서별 조절」은 시각이 아니라 순서로 한다(HM-59c). 알림은 이미 부서마다 끝난 시각을 따라간다(HM-50).
//
// ── 왜 상태는 DB에, 실행은 프로세스 안에 ───────────────────────
// 프로세스는 하나이고 DB는 SQLite다(ADR-0003). 재시작에도 줄이 남아야 하므로 작업은 표(`MergeJob`)에 두고, 일꾼은 프로세스 안에
// 하나만 둔다 — 모델 서버가 한 번에 하나만 처리하므로(NUM_PARALLEL=1) 일꾼을 늘려도 모델 문(HM-52) 앞에서 다시 줄을 설 뿐이고,
// 그 기다림은 실행 예산(HM-57b)을 먹는다. 일꾼 상태는 `globalThis`에 둔다(HM-52a · rollup/lock.ts와 같은 이유 — 스케줄러와
// [지금 병합]이 이 모듈의 다른 사본을 가져도 일꾼은 하나).
//
// ── 같은 부서는 합류한다 (HM-59b) ─────────────────────────────
// 대기 중이면 그 작업에, 병합 중이면 그 작업에 — 그 사이 새 제출이나 「덮기 확인」이 생겼으면 끝난 뒤 한 번 더(대기 작업 하나).
// 그래서 같은 부서 병합은 동시에 둘이 될 수 없다. 1단계(HM-58)의 409 `merging`은 다른 프로세스가 돌릴 때만 남는다.
import { createHash } from 'node:crypto';
import type { MergeJob } from '@prisma/client';
import { prisma } from '../db';
import { withLock } from '../rollup/lock';
import { mergeStaleAfterMs } from './budget';
import { mergePaused } from './pause';
import { INTERRUPTED_TEXT, MERGING_TEXT } from './inflight';
import { parseMark, unitMark } from './edits';
import { runMergeRecorded, type MergeRunResult, type MergeTrigger } from './run';

/** 넣기·집기는 이 잠금 안에서 — 확인과 넣기(집기) 사이에 다른 요청이 끼지 않는다 */
const QUEUE_LOCK = 'mergeq';
const ACTIVE = ['queued', 'running'];
/** HM-59e — 이만큼 잡혔던 작업은 회수돼도 다시 넣지 않는다(두 번 죽은 작업은 사람이 본다) */
export const MAX_ATTEMPTS = 2;
/**
 * HM-59d — lease = 멈춤 기준(HM-55a, 예산 + 6분) + 1분. 잡은 표(HM-58c)가 같은 기준으로 풀리므로, 회수한 작업을 다시 잡았을 때
 * 버려진 일꾼의 「잡음」이 먼저 풀려 있다.
 */
const LEASE_MARGIN_MS = 60_000;
/** HM-59f — 끝난 작업이 아직 없을 때 한 작업에 걸린다고 볼 시간 (8~9월 p50 24초 · 10월 70~113초의 사이) */
export const DEFAULT_JOB_MS = 60_000;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** 일꾼이 작업 하나를 끝낼 때마다 · 줄이 빌 때 부르는 것 — 스케줄러가 켜진 서버만 건다(HM-60c) */
export interface QueueHooks {
  afterEach?: () => Promise<void>;
  afterDrain?: () => Promise<void>;
}

interface WorkerState {
  /** 돌고 있는 일꾼의 약속. 없으면 자고 있다 */
  busy: Promise<void> | null;
  /** 도는 사이에 또 깨웠다 — 다 비운 뒤에 한 번 더 본다 */
  again: boolean;
  /** 일꾼의 세대. 회수가 일꾼을 버리면 하나 올린다 — 버려진 일꾼은 돌아와도 아무것도 적지 않는다 */
  gen: number;
  current: { jobId: string; since: number } | null;
  hooks: QueueHooks;
  /** 요청 밖(기동 때)의 실행 맥락 — 일꾼을 여기서 세운다(`bindMergeWorkerRoot`). 없으면(시험 · 스크립트) 부른 자리에서 */
  root?: <R>(fn: () => R) => R;
}

const shared = globalThis as unknown as { __tincaseMergeQueue?: WorkerState };
const worker = (shared.__tincaseMergeQueue ??= { busy: null, again: false, gen: 0, current: null, hooks: {} });

/**
 * HM-59d — 일꾼은 **요청 밖에서** 돈다. [지금 병합] 요청이 일꾼을 깨우면 그 요청의 비동기 맥락(Next의 AsyncLocalStorage — 요청 저장소 ·
 * `after()` 문맥)이 일꾼에 그대로 따라간다. 일꾼은 응답이 나간 뒤에도 몇 분씩 다른 부서까지 병합하므로, 그동안 모든 병합의 `after()`(병합 뒤
 * 맞추기의 `later`)가 이미 끝난 그 요청에 매달리고 그 요청의 저장소가 풀리지 않는다. 그래서 기동 때(요청 밖) 잡은 맥락을 두고 일꾼은 거기서 세운다.
 * 기동 때 instrumentation이 `AsyncLocalStorage.snapshot()`을 넘긴다.
 */
export function bindMergeWorkerRoot(root: <R>(fn: () => R) => R): void {
  worker.root = root;
}

/** HM-60c — 스케줄러가 기동할 때 건다. 꺼진 서버는 걸지 않는다 — 병합이 끝나도 알림을 판정하지 않는다(예전과 같다) */
export function setMergeQueueHooks(hooks: QueueHooks): void {
  worker.hooks = hooks;
}

/** HM-59b — 최신 제출 묶음의 열쇠. 병합 중에 새 제출(다시 낸 판 포함 — 새 행이다)이 왔는지 가른다 */
async function sourceKeyOf(divisionId: string, weekSlotId: string): Promise<string> {
  const rows = await prisma.submission.findMany({
    where: { divisionId, weekSlotId, isLatest: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return createHash('sha256')
    .update(rows.map((r) => r.id).join(','))
    .digest('hex')
    .slice(0, 16);
}

async function nextOrderKey(): Promise<number> {
  const agg = await prisma.mergeJob.aggregate({ _max: { orderKey: true } });
  return (agg._max.orderKey ?? 0) + 1;
}

/** 그 부서·주차의 대기·병합 중 작업 (병합 중이 먼저) */
export async function activeMergeJob(divisionId: string, weekSlotId: string): Promise<MergeJob | null> {
  const jobs = await prisma.mergeJob.findMany({
    where: { divisionId, weekSlotId, status: { in: ACTIVE } },
    orderBy: { orderKey: 'asc' },
  });
  return jobs.find((j) => j.status === 'running') ?? jobs[0] ?? null;
}

export interface EnqueueOptions {
  trigger: MergeTrigger;
  actorEmail?: string | null;
  /** 409 `edited`를 확인하고 들어온 요청 (API-55) — 정확히 true만 */
  overwriteEdits?: boolean;
  now?: Date;
}

export interface EnqueueResult {
  jobId: string;
  status: 'queued' | 'running';
  /** HM-59f — 병합 중인 작업이 1, 그 뒤 대기가 2, 3 … */
  position: number;
  /** 같은 부서·주차 작업에 합류했다 (새 작업을 세우지 않았다) */
  joined: boolean;
  etaMinutes: number | null;
}

/**
 * HM-59b — 줄에 넣는다. 같은 부서·주차가 이미 줄에 있으면 합류한다. 넣은 뒤 일꾼을 깨운다(기다리지 않는다).
 *   대기 중   → 그 작업에 합류. 수동이면 `manual`로 올리고 누른 사람 · 덮기 확인을 더하고, HM-61의 기준을 지금으로 다시 잡는다
 *               (누른 사람이 본 판이 기준이다 — 그 사람이 고친 것을 확인하고 눌렀다)
 *   병합 중   → 그 작업이 잡힌 뒤 최신 제출이 바뀌었거나 덮기 확인이 새로 붙었으면 끝난 뒤 한 번 더(대기 작업 하나), 아니면 그 작업에 합류
 *   없음      → 새 대기 작업. `orderKey`는 줄 전체의 마지막 + 1 — 맨 뒤에 선다
 */
export async function enqueueMerge(divisionId: string, weekSlotId: string, opts: EnqueueOptions): Promise<EnqueueResult> {
  const now = opts.now ?? new Date();
  const manual = opts.trigger === 'manual';
  const overwrite = opts.overwriteEdits === true;
  const picked = await withLock(QUEUE_LOCK, async () => {
    const active = await prisma.mergeJob.findMany({
      where: { divisionId, weekSlotId, status: { in: ACTIVE } },
      orderBy: { orderKey: 'asc' },
    });
    const waiting = active.find((j) => j.status === 'queued');
    if (waiting) {
      const job = await prisma.mergeJob.update({
        where: { id: waiting.id },
        data: {
          overwriteEdits: waiting.overwriteEdits || overwrite,
          ...(manual && {
            trigger: 'manual',
            actorEmail: opts.actorEmail ?? waiting.actorEmail,
            baseMark: JSON.stringify(await unitMark(divisionId, weekSlotId)),
          }),
        },
      });
      return { job, joined: true };
    }
    const running = active.find((j) => j.status === 'running');
    if (running) {
      const newSources = running.sourceKey !== null && running.sourceKey !== (await sourceKeyOf(divisionId, weekSlotId));
      const newOverwrite = overwrite && !running.overwriteEdits;
      if (!newSources && !newOverwrite) return { job: running, joined: true };
    }
    const job = await prisma.mergeJob.create({
      data: {
        divisionId,
        weekSlotId,
        trigger: opts.trigger,
        actorEmail: opts.actorEmail ?? null,
        overwriteEdits: overwrite,
        orderKey: await nextOrderKey(),
        status: 'queued',
        baseMark: JSON.stringify(await unitMark(divisionId, weekSlotId)),
        enqueuedAt: now,
      },
    });
    return { job, joined: false };
  });
  void kickMergeQueue();
  const view = await jobView(picked.job, now);
  return {
    jobId: picked.job.id,
    status: picked.job.status === 'running' ? 'running' : 'queued',
    position: view.position ?? 1,
    joined: picked.joined,
    etaMinutes: view.etaMinutes,
  };
}

/**
 * HM-59d — 맨 앞 대기 작업 하나를 잡는다(잠금 안에서 — 일꾼이 둘이 되어도 같은 작업을 둘이 잡지 않는다).
 * 일시정지(HM-44) 중에는 수동만 — 자동 작업은 대기로 남아 풀리면 돈다. 같은 부서·주차가 병합 중이면 건너뛴다(버려진 일꾼의 것).
 */
async function claimNext(now: Date): Promise<MergeJob | null> {
  return withLock(QUEUE_LOCK, async () => {
    const paused = mergePaused(now);
    const waiting = await prisma.mergeJob.findMany({
      where: { status: 'queued', ...(paused && { trigger: 'manual' }) },
      orderBy: [{ orderKey: 'asc' }, { id: 'asc' }],
    });
    for (const c of waiting) {
      if (await prisma.mergeJob.count({ where: { divisionId: c.divisionId, weekSlotId: c.weekSlotId, status: 'running' } })) continue;
      const n = await prisma.mergeJob.updateMany({
        where: { id: c.id, status: 'queued' },
        data: {
          status: 'running',
          startedAt: now,
          leaseUntil: new Date(now.getTime() + mergeStaleAfterMs() + LEASE_MARGIN_MS),
          attempt: { increment: 1 },
          sourceKey: await sourceKeyOf(c.divisionId, c.weekSlotId),
        },
      });
      if (n.count === 1) return prisma.mergeJob.findUnique({ where: { id: c.id } });
    }
    return null;
  });
}

async function runJob(job: MergeJob): Promise<MergeRunResult> {
  try {
    return await runMergeRecorded(job.divisionId, job.weekSlotId, job.trigger as MergeTrigger, job.actorEmail, {
      job: { id: job.id, overwriteEdits: job.overwriteEdits, baseMark: parseMark(job.baseMark) },
    });
  } catch (e) {
    // runMergeRecorded는 실패를 결과로 돌려준다 — 여기 오는 것은 DB 오류 같은 것이다. 일꾼은 다음 작업으로 간다
    console.error('[merge] 줄 작업 오류', e);
    return { runId: '', status: 'failed', errorText: `예상치 못한 오류 (${(e as Error).message})`, outcome: null };
  }
}

async function finishJob(job: MergeJob, r: MergeRunResult): Promise<JobStatus> {
  // busy — 다른 프로세스(개발 스크립트 등)가 같은 부서·주차를 돌리고 있었다(HM-58). 그 결과를 따른다
  const status: JobStatus = r.status === 'succeeded' ? 'done' : r.status === 'busy' ? 'cancelled' : 'failed';
  await prisma.mergeJob.updateMany({
    where: { id: job.id, status: 'running' },
    data: {
      status,
      mergeRunId: r.runId || null,
      errorText: r.status === 'succeeded' ? null : (r.errorText ?? (r.status === 'busy' ? MERGING_TEXT : null)),
      finishedAt: new Date(),
      leaseUntil: null,
    },
  });
  return status;
}

async function safely(label: string, fn?: () => Promise<void>): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch (e) {
    console.error(`[merge] 줄 ${label} 오류`, e);
  }
}

/** HM-59g — `[merge] 줄 5/13 — 연구관리실 · 대기 42초 · 실행 61초 · 모델 3/3` */
async function logJob(job: MergeJob, r: MergeRunResult, startedAt: Date): Promise<void> {
  try {
    const [division, total, upTo] = await Promise.all([
      prisma.division.findUnique({ where: { id: job.divisionId }, select: { nameKo: true } }),
      prisma.mergeJob.count({ where: { weekSlotId: job.weekSlotId, enqueuedAt: { gte: new Date(startedAt.getTime() - 24 * 60 * 60_000) } } }),
      prisma.mergeJob.count({ where: { weekSlotId: job.weekSlotId, orderKey: { lte: job.orderKey }, enqueuedAt: { gte: new Date(startedAt.getTime() - 24 * 60 * 60_000) } } }),
    ]);
    const tables = r.outcome?.model.tables ?? [];
    const asked = tables.filter((t) => t.kind !== 'skipped');
    const sec = (ms: number) => `${Math.round(ms / 1000)}초`;
    console.log(
      `[merge] 줄 ${upTo}/${total} — ${division?.nameKo ?? job.divisionId} · 대기 ${sec(startedAt.getTime() - job.enqueuedAt.getTime())} · ` +
        `실행 ${sec(Date.now() - startedAt.getTime())} · ` +
        (r.status === 'succeeded' ? `모델 ${asked.filter((t) => t.used).length}/${asked.length}` : `${r.status} ${r.errorText ?? ''}`.trim()),
    );
  } catch {
    // 로그 한 줄 때문에 일꾼이 멈추지 않는다
  }
}

/** 일꾼의 한 바퀴 — 집을 것이 없을 때까지 하나씩 */
async function drain(gen: number): Promise<void> {
  let ran = 0;
  for (;;) {
    if (worker.gen !== gen) return;
    const job = await claimNext(new Date());
    if (!job) break;
    worker.current = { jobId: job.id, since: Date.now() };
    const startedAt = job.startedAt ?? new Date();
    const r = await runJob(job);
    if (worker.gen !== gen) return; // 회수돼 버려진 일꾼 — 그 작업은 이미 다른 상태다. 아무것도 적지 않는다
    await finishJob(job, r);
    worker.current = null;
    ran++;
    await logJob(job, r, startedAt);
    // HM-50 — 이 부서의 안내는 뒤 부서들을 기다리지 않는다
    await safely('알림 판정', worker.hooks.afterEach);
  }
  // HM-54 — 줄이 빈 순간. 「병합 점검」 요약이 여기서도 판정된다(늦어도 +15분은 스케줄러가)
  if (ran > 0) await safely('빈 줄 판정', worker.hooks.afterDrain);
}

/**
 * HM-59d — 일꾼을 깨운다. 자고 있으면 돌기 시작하고, 돌고 있으면 「다 비운 뒤 한 번 더 보기」만 표시한다 — 일꾼은 언제나 하나다.
 * 돌려주는 약속은 지금 일꾼이 쉴 때 끝난다(시험 · 스크립트가 기다린다). 요청 · 틱은 기다리지 않는다.
 */
export function kickMergeQueue(): Promise<void> {
  if (worker.busy) {
    worker.again = true;
    return worker.busy;
  }
  const gen = worker.gen;
  const box: { run?: Promise<void> } = {};
  const start = () => (async () => {
    await null; // 표에 먼저 올린 뒤 시작한다 — 그 사이 또 깨워도 새 일꾼을 세우지 않게
    try {
      do {
        worker.again = false;
        await drain(gen);
      } while (worker.again && worker.gen === gen);
    } catch (e) {
      console.error('[merge] 줄 일꾼 오류', e);
    } finally {
      // 버려진 일꾼(회수 — HM-59e)은 새 일꾼의 자리를 비우지 않는다
      if (worker.busy === box.run) {
        worker.busy = null;
        worker.current = null;
      }
    }
  })();
  box.run = worker.root ? worker.root(start) : start();
  worker.busy = box.run;
  return box.run;
}

/** 시험 · 스크립트용 — 일꾼이 쉴 때까지 기다린다(그 사이 다시 깨어난 것까지) */
export async function settleMergeQueue(): Promise<void> {
  while (worker.busy) await worker.busy;
}

/**
 * HM-59e — 죽은 작업을 회수한다. 기동 때(`atBoot`)는 `running`이 모두 죽은 것이고(병합을 돌리는 프로세스는 이 앱 하나 — HM-55b와 같은 이유),
 * 도는 중(매분)에는 `leaseUntil`이 지난 것이다. `attempt` < 2면 다시 대기 — 제 `orderKey`를 그대로 가지므로 맨 앞이고, HM-43 대기를 거치지
 * 않는다. 아니면 실패. 이 프로세스의 일꾼이 그 작업을 쥐고 있었으면 그 일꾼은 버린다 — 다음에 깨우는 일꾼이 잇는다.
 * 부르는 쪽이 회수 뒤 일꾼을 깨운다.
 */
export async function recoverMergeJobs(now: Date = new Date(), opts: { atBoot?: boolean } = {}): Promise<MergeJob[]> {
  const dead = await prisma.mergeJob.findMany({
    where: opts.atBoot ? { status: 'running' } : { status: 'running', leaseUntil: { lt: now } },
  });
  if (dead.length === 0) return [];
  for (const j of dead) {
    await prisma.mergeJob.updateMany({
      where: { id: j.id, status: 'running' },
      data:
        j.attempt < MAX_ATTEMPTS
          ? { status: 'queued', startedAt: null, leaseUntil: null }
          : { status: 'failed', errorText: INTERRUPTED_TEXT, finishedAt: now, leaseUntil: null },
    });
  }
  if (worker.current && dead.some((j) => j.id === worker.current!.jobId)) {
    worker.gen++;
    worker.busy = null;
    worker.current = null;
  }
  console.warn(
    `[merge] 멈춘 줄 작업 ${dead.length}건 회수 — ` +
      dead.map((j) => `${j.id}(${j.attempt < MAX_ATTEMPTS ? '다시 대기' : INTERRUPTED_TEXT})`).join(', '),
  );
  return dead;
}

// ── 읽기 (HM-59f) ─────────────────────────────────────────

/** 지금 줄 — 병합 중이 먼저, 그 뒤 대기를 순서대로. 순번은 1부터 */
async function lineup(): Promise<MergeJob[]> {
  const jobs = await prisma.mergeJob.findMany({ where: { status: { in: ACTIVE } }, orderBy: [{ orderKey: 'asc' }, { id: 'asc' }] });
  return [...jobs.filter((j) => j.status === 'running'), ...jobs.filter((j) => j.status === 'queued')];
}

/** 한 작업에 걸리는 시간 — 최근 끝난 작업(최대 10개)의 평균, 없으면 1분. 점검 요약의 「예상 끝」도 이것으로 */
export async function averageJobMs(): Promise<number> {
  const done = await prisma.mergeJob.findMany({
    where: { status: { in: ['done', 'failed'] }, startedAt: { not: null }, finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    take: 10,
    select: { startedAt: true, finishedAt: true },
  });
  const spans = done.map((j) => j.finishedAt!.getTime() - j.startedAt!.getTime()).filter((ms) => ms >= 0);
  return spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : DEFAULT_JOB_MS;
}

export interface JobView {
  status: JobStatus;
  /** 줄의 순번 — 끝났으면 null */
  position: number | null;
  /** 끝나기까지 대략 몇 분 — 끝났으면 null */
  etaMinutes: number | null;
}

/** 작업 하나의 자리와 남은 시간. `etaMinutes`는 앞의 작업들과 그 작업 자신이 끝나기까지(병합 중인 것의 지난 시간은 뺀다) */
export async function jobView(job: Pick<MergeJob, 'id' | 'status' | 'startedAt'>, now: Date = new Date()): Promise<JobView> {
  const status = job.status as JobStatus;
  if (status !== 'queued' && status !== 'running') return { status, position: null, etaMinutes: null };
  const line = await lineup();
  const i = line.findIndex((j) => j.id === job.id);
  const position = i >= 0 ? i + 1 : 1;
  const avg = await averageJobMs();
  const head = line[0];
  const spent = head?.status === 'running' && head.startedAt ? Math.min(avg, now.getTime() - head.startedAt.getTime()) : 0;
  const ms = Math.max(0, position * avg - spent);
  return { status, position, etaMinutes: Math.max(1, Math.ceil(ms / 60_000)) };
}

export interface QueueRow {
  jobId: string;
  divisionId: string;
  divisionName: string;
  trigger: string;
  status: JobStatus;
  position: number | null;
  enqueuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorText: string | null;
  /** 병합 실행의 표별 모델 사용 (HM-57c) — 부르지 않은 표(`skipped`)는 세지 않는다 */
  model: ModelUse | null;
}

export interface QueueView {
  rows: QueueRow[];
  /** 그 주차 작업이 있는 부서 중 마지막 작업이 끝난(`done`) 곳 */
  done: number;
  total: number;
  waiting: number;
  running: number;
  /** 남은 것이 다 끝날 대략의 시각 — 남은 것이 없으면 null */
  etaAt: Date | null;
}

const TABLE_KO: Record<string, string> = { achievements: '실적', plans: '계획', notes: '특이', categories: '분류' };

/** 표별 모델 사용 요약. `misses`는 불렀는데 못 쓴 표 — `kind`가 `timeout`·`connection`·`http`·`budget`·`invalid` */
export interface ModelUse {
  used: number;
  asked: number;
  misses: { table: string; kind: string | null; reason: string }[];
}

/**
 * HM-57c 표별 기록 → 화면 한 칸 · 점검 요약 한 줄. 부르지 않은 표(`skipped` — 모델 없음 · 묶을 행 없음)는 세지 않는다 —
 * 모델이 원래 없는 서버에서 매주 「못 씀」이 쌓이지 않게. 옛 실행(표별 기록 없음)은 `model.used` 하나로 본다
 */
export function modelUseOf(reviewJson: string | null): ModelUse | null {
  if (!reviewJson) return null;
  try {
    const m = (
      JSON.parse(reviewJson) as {
        model?: { used?: boolean; reason?: string | null; tables?: { table: string; used: boolean; reason: string | null; kind: string | null }[] };
      }
    ).model;
    if (!m) return null;
    if (!Array.isArray(m.tables)) return m.used ? { used: 1, asked: 1, misses: [] } : { used: 0, asked: 0, misses: [] };
    const asked = m.tables.filter((t) => t.kind !== 'skipped');
    return {
      used: asked.filter((t) => t.used).length,
      asked: asked.length,
      misses: asked.filter((t) => !t.used).map((t) => ({ table: TABLE_KO[t.table] ?? t.table, kind: t.kind, reason: t.reason ?? '' })),
    };
  } catch {
    return null;
  }
}

/**
 * HM-59f — 그 주차의 줄. 부서마다 가장 최근 작업 하나를 줄 순서로 — `/ops` 「병합 줄」 카드(PG-90)가 읽는다.
 * 끝난 작업의 모델 사용은 그 작업이 만든 병합 실행에서 읽는다.
 */
export async function mergeQueueView(weekSlotId: string, now: Date = new Date()): Promise<QueueView> {
  const jobs = await prisma.mergeJob.findMany({ where: { weekSlotId }, orderBy: [{ orderKey: 'asc' }, { id: 'asc' }] });
  const latest = new Map<string, MergeJob>();
  for (const j of jobs) latest.set(j.divisionId, j); // 순서대로 덮으므로 마지막이 가장 최근
  const picked = [...latest.values()].sort((a, b) => a.orderKey - b.orderKey);
  const [divisions, runs, line, avg] = await Promise.all([
    prisma.division.findMany({ where: { id: { in: picked.map((j) => j.divisionId) } }, select: { id: true, nameKo: true } }),
    prisma.mergeRun.findMany({ where: { id: { in: picked.map((j) => j.mergeRunId).filter((x): x is string => !!x) } }, select: { id: true, reviewJson: true } }),
    lineup(),
    averageJobMs(),
  ]);
  const nameOf = new Map(divisions.map((d) => [d.id, d.nameKo]));
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const posOf = new Map(line.map((j, i) => [j.id, i + 1]));
  const rows: QueueRow[] = picked.map((j) => ({
    jobId: j.id,
    divisionId: j.divisionId,
    divisionName: nameOf.get(j.divisionId) ?? '(없는 부서)',
    trigger: j.trigger,
    status: j.status as JobStatus,
    position: posOf.get(j.id) ?? null,
    enqueuedAt: j.enqueuedAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    errorText: j.errorText,
    model: j.mergeRunId ? modelUseOf(runOf.get(j.mergeRunId)?.reviewJson ?? null) : null,
  }));
  const waiting = rows.filter((r) => r.status === 'queued').length;
  const running = rows.filter((r) => r.status === 'running').length;
  const left = line.length;
  const head = line[0];
  const spent = head?.status === 'running' && head.startedAt ? Math.min(avg, now.getTime() - head.startedAt.getTime()) : 0;
  return {
    rows,
    done: rows.filter((r) => r.status === 'done').length,
    total: rows.length,
    waiting,
    running,
    etaAt: left > 0 ? new Date(now.getTime() + Math.max(0, left * avg - spent)) : null,
  };
}

/** 시험용 — 일꾼 상태를 처음으로 (표는 건드리지 않는다) */
export function resetMergeQueueForTest(): void {
  worker.gen++;
  worker.busy = null;
  worker.again = false;
  worker.current = null;
  worker.hooks = {};
  worker.root = undefined;
}
