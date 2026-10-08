// RU-71~76 — **본부본·전사본은 저절로 맞춰진다** (ADR-0015 「승인이 곧 제출」).
//
// 사건이 시키고, 상태가 정한다: 각 단계는 「지금 있어야 할 것」을 DB 기록만으로 계산하고(입력 열쇠, RU-74), 다르면 다시 만든다.
// 같은 상태에서 몇 번을 돌려도 결과가 같으므로 시키는 곳이 여럿이어도 된다(RU-72):
//   · 승인 요청 뒤(`after()` — 사본은 이미 그 요청 안에서 커밋됐다)
//   · 순서·양식·섹션·나무가 바뀐 요청 뒤
//   · 화면 열기(읽기 수리) — `/hq`·`/org`를 그리기 **전에**. 스케줄러가 꺼진 테스트 서버(RU-41)에서도 흐름 전체가 도는 이유다
//   · 스케줄러(켜져 있을 때만) — 안전망. 이것에만 기대는 것은 없다
// 기록의 주체는 `system`이고 일으킨 사건·사람을 붙인다(TACP-23). 입력은 나무·받은 사본·설정이 정한다 — 요청 값이 고르지 못한다.
import type { RollupRun, WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { later } from '../after';
import { currentWeek } from '@/lib/week';
import { RETRY_BACKOFF_MINUTES } from '../merge/run';
import { composeHq, hqInputKey, hqInputs, causeLabel, type BuildCause } from './run';
import { composeOrg, orgInputKey, orgTemplateRef } from './orgrun';
import { resolveSections } from './sections';
import { hqNodeOf, loadTree, type RollupNode } from './tree';
import { rollupEnabled, stageTimes } from './schedule';
import { coalesce, settled, withLock } from './lock';
import { hasHead, hqLockKey, syncHqHandoffLocked, syncUnit, targetLabel, unitTarget, type AutoCause } from './handoff';
import { notifyReapprove, type ReapproveReason } from '../merge/review';
import { noticeHqBuilt, noticeOrgBuilt, noticeRollupFailed } from './notices';

/** RU-75 — `running`으로 이만큼 남은 조립은 프로세스가 죽은 것으로 보고 실패로 돌린 뒤 다시 만든다 */
export const STALE_RUNNING_MINUTES = 10;

export interface SyncOptions extends AutoCause {
  /** [다시 시도] — 실패 뒤 기다리는 간격(1·5·15·30분)을 건너뛴다. 마지막이 성공이고 열쇠가 같으면 그래도 아무것도 하지 않는다 */
  force?: boolean;
}

const mergeOpts = (a: SyncOptions, b: SyncOptions): SyncOptions => ({ ...b, force: !!(a.force || b.force) });

/** RU-75 — 죽은 조립(`running`이 10분 넘게)을 실패로 돌린다. 그래야 같은 열쇠로 다시 만든다 */
async function failStaleRunning(level: 'hq' | 'org', divisionId: string | null, slot: WeekSlot, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MINUTES * 60_000);
  const n = await prisma.rollupRun.updateMany({
    where: { level, divisionId, weekSlotId: slot.id, status: 'running', startedAt: { lt: cutoff } },
    data: { status: 'failed', errorText: `${STALE_RUNNING_MINUTES}분 넘게 끝나지 않았습니다 — 다시 만듭니다.`, finishedAt: now },
  });
  if (n.count) logger.warn({ level, divisionId, slot: slot.isoKey, count: n.count }, '[자동] 끝나지 않은 조립을 실패로 돌렸다');
}

/**
 * RU-76 — 같은 열쇠로 실패했으면 사건이 다시 몰아치지 않는다 — HM-43처럼 1·5·15·30분 간격.
 * 되는 실패(잠깐 파일이 없음)는 곧 낫고, 안 되는 실패(양식 없음)는 사람이 고친다 — 고치면 열쇠가 바뀌어 바로 다시 만든다.
 */
async function inBackoff(level: 'hq' | 'org', divisionId: string | null, slot: WeekSlot, key: string, now = new Date()): Promise<boolean> {
  const runs = await prisma.rollupRun.findMany({
    where: { level, divisionId, weekSlotId: slot.id, inputKey: key },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: { status: true, startedAt: true },
  });
  const failures = runs.filter((r) => r.status === 'failed').length;
  if (failures === 0 || runs[0]?.status !== 'failed') return false;
  const wait = RETRY_BACKOFF_MINUTES[Math.min(failures - 1, RETRY_BACKOFF_MINUTES.length - 1)];
  return now.getTime() - runs[0].startedAt.getTime() < wait * 60_000;
}

function lastSucceeded(level: 'hq' | 'org', divisionId: string | null, slot: WeekSlot) {
  return prisma.rollupRun.findFirst({
    where: { level, divisionId, weekSlotId: slot.id, status: 'succeeded' },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: { inputKey: true },
  });
}

// ── 본부 ────────────────────────────────────────────────

const hqFlightKey = (nodeId: string, slotId: string) => `flight:hq:${nodeId}:${slotId}`;

/** 한 번 맞추기 — `hq:` 잠금 안에서. 나무를 매번 다시 읽는다(밀린 다음 번이 옛 나무를 쓰지 않게) */
async function buildHq(nodeId: string, slot: WeekSlot, opts: SyncOptions): Promise<void> {
  const node = hqNodeOf(await loadTree(), nodeId);
  if (!node) return; // RU-07 — 본부 단계가 없어졌다(기여 단위가 하나만 남음). 사본은 바로 총괄로 간다
  let built: RollupRun | null = null;
  await withLock(hqLockKey(nodeId, slot.id), async () => {
    await failStaleRunning('hq', nodeId, slot);
    const inputs = await hqInputs(node, slot);
    if (inputs.some((i) => i.report)) {
      const key = await hqInputKey(node, inputs);
      const ok = await lastSucceeded('hq', nodeId, slot);
      if (ok?.inputKey !== key && (opts.force || !(await inBackoff('hq', nodeId, slot, key)))) {
        built = await composeHq(node, slot, inputs, key, opts);
      }
    }
    // 본부장 없음 → 지금 본부본이 곧 넘김 · 본부장 있음 → 어긋난 승인 따라잡기 (handoff.ts)
    const handed = await syncHqHandoffLocked(node, slot, { cause: built ? `hq_rebuilt:${(built as RollupRun).id}` : opts.cause, causedBy: opts.causedBy });
    if (handed) later('syncOrg', () => syncOrg(slot, { cause: `hq_handoff:${handed.id}`, causedBy: opts.causedBy }));
  });
  const run = built as RollupRun | null;
  if (!run) return;
  try {
    if (run.status === 'succeeded') await noticeHqBuilt(node, slot, run, await causeLabel(run.cause));
    else await noticeRollupFailed('hq', node, slot, run);
  } catch (e) {
    // 알림은 결과이지 조건이 아니다 (HM-47) — 본부본은 이미 만들어졌다
    logger.error({ err: (e as Error).message, node: node.node.nameKo }, '[알림] 본부본 알림 실패');
  }
}

/**
 * RU-71 — 본부본 맞추기. 입력 열쇠가 가장 최근 성공한 본부본과 같으면 아무것도 하지 않는다(RU-74).
 * 한 번에 하나, 밀린 것은 한 번만 더(RU-75) — 돌고 있으면 기다렸다가 돌아온다(읽기 수리가 반쯤 만든 상태를 그리지 않게).
 * 3단계가 꺼져 있거나 본부 단계가 없는 본부면 아무것도 하지 않는다(RU-79 · RU-07).
 */
export async function syncHq(node: Pick<RollupNode, 'node' | 'hasHqStep'>, slot: WeekSlot, opts: SyncOptions): Promise<void> {
  if (!node.hasHqStep || !(await rollupEnabled())) return;
  await coalesce(hqFlightKey(node.node.id, slot.id), opts, (o) => buildHq(node.node.id, slot, o), mergeOpts);
}

// ── 전사 ────────────────────────────────────────────────

const orgFlightKey = (slotId: string) => `flight:org:${slotId}`;

async function buildOrg(slot: WeekSlot, opts: SyncOptions): Promise<void> {
  const tree = await loadTree();
  let built: RollupRun | null = null;
  let arrivals: { section: { title: string }; kind: string }[] = [];
  await withLock(`org:${slot.id}`, async () => {
    await failStaleRunning('org', null, slot);
    // RU-83 — 섹션 목록이 아직 저장되지 않았으면 **만들지 않고** 기본 13개를 이름으로 맞춰 쓴다 (system이 총괄의 설정을 바꾸지 않는다)
    const sources = await resolveSections(slot, tree, { create: false });
    if (!sources.some((s) => s.filePath)) return; // O0 — 아직 들어온 섹션이 없다
    const key = orgInputKey(sources, await orgTemplateRef());
    const ok = await lastSucceeded('org', null, slot);
    if (ok?.inputKey === key) return;
    if (!opts.force && (await inBackoff('org', null, slot, key))) return;
    built = await composeOrg(slot, tree, sources, key, opts);
    arrivals = sources;
  });
  const run = built as RollupRun | null;
  if (!run) return;
  try {
    if (run.status === 'succeeded') await noticeOrgBuilt(slot, run, arrivals, await causeLabel(run.cause));
    else await noticeRollupFailed('org', null, slot, run);
  } catch (e) {
    logger.error({ err: (e as Error).message }, '[알림] 전사본 알림 실패');
  }
}

/** RU-71 — 전사본 맞추기. 섹션 출처가 바뀌면 다시 만든다(RU-83 — 전사본은 늘 준비돼 있다). 3단계가 꺼져 있으면 아무것도 하지 않는다 */
export async function syncOrg(slot: WeekSlot, opts: SyncOptions): Promise<void> {
  if (!(await rollupEnabled())) return;
  await coalesce(orgFlightKey(slot.id), opts, (o) => buildOrg(slot, o), mergeOpts);
}

// ── 묶음 ────────────────────────────────────────────────

/**
 * 실·팀 사본이 생긴 뒤 — 받는 곳을 맞춘다. 본부 단계가 있으면 그 본부본(→ 본부장 없는 본부면 총괄까지), 없으면 전사본(RU-07).
 * 받는 곳은 그때그때 나무로 정한다 — 주 중간에 기여 단위가 늘거나 줄면 같은 사본이 새 받는 곳으로 간다.
 */
export async function syncAfterUnit(divisionId: string, slot: WeekSlot, opts: SyncOptions): Promise<void> {
  const target = await unitTarget(divisionId);
  if (!target) return;
  if (target.kind === 'hq') await syncHq(target.node, slot, opts);
  await syncOrg(slot, opts);
}

/** 요청 뒤(`after()`)에 받는 곳을 맞춘다 — 사본은 이미 그 요청 안에서 커밋됐다 */
export function laterAfterUnit(divisionId: string, slot: WeekSlot, opts: SyncOptions): void {
  later('syncAfterUnit', () => syncAfterUnit(divisionId, slot, opts));
}

/**
 * RU-72 · HM-47 — 실·팀 병합본의 **판이 바뀐 뒤**(병합 성공·담당자 수정 저장). 승인한 사람이 아닌 일이 판을 바꿨다:
 *   부서장 있음  위로 보내지 않는다(승인이 아니다). 승인한 적이 있으면 부서장에게 NT-52 「다시 승인해 주세요」(새 판마다 한 번)
 *   부서장 없음  마감 뒤 최종본이면 그것이 곧 넘김 — `syncUnit`(`system`, `basis=no_head`) 그리고 받는 곳을 맞춘다
 * 3단계가 꺼져 있거나 기여 단위가 아니면 아무것도 하지 않는다. 던지지 않는다 — 병합·저장은 이미 끝났다.
 */
export async function onUnitVersionChanged(divisionId: string, slot: WeekSlot, opts: AutoCause & { reason: ReapproveReason }): Promise<void> {
  try {
    if (!(await rollupEnabled())) return;
    const target = await unitTarget(divisionId);
    if (!target) return;
    if (await hasHead(divisionId)) {
      const division = await prisma.division.findUniqueOrThrow({ where: { id: divisionId } });
      await notifyReapprove(division, slot, targetLabel(target), opts.reason);
      return;
    }
    const sub = await syncUnit(divisionId, slot, opts);
    if (sub) laterAfterUnit(divisionId, slot, { cause: `unit_handoff:${sub.id}`, causedBy: opts.causedBy });
  } catch (e) {
    logger.error({ err: (e as Error).message, divisionId }, '[자동] 병합본이 바뀐 뒤 맞추기 실패');
  }
}

/**
 * RU-72 — 이번 주를 위에서 아래로 한 번: 실·팀(부서장 없는 단위의 최종본 · 아직 안 넘어간 승인) → 모든 본부 → 전사.
 * 3단계를 켤 때(RU-79)·나무가 바뀔 때·양식이 바뀔 때·스케줄러가 부른다.
 */
export async function syncAll(slot: WeekSlot, opts: SyncOptions): Promise<void> {
  if (!(await rollupEnabled())) return;
  const tree = await loadTree();
  for (const n of tree.nodes) {
    for (const c of n.contributors) {
      try {
        await syncUnit(c.id, slot, opts);
      } catch (e) {
        logger.error({ err: (e as Error).message, division: c.nameKo }, '[자동] 실·팀 맞추기 실패');
      }
    }
  }
  for (const n of tree.nodes.filter((x) => x.hasHqStep)) {
    try {
      await syncHq(n, slot, opts);
    } catch (e) {
      logger.error({ err: (e as Error).message, node: n.node.nameKo }, '[자동] 본부본 맞추기 실패');
    }
  }
  await syncOrg(slot, opts);
}

/** 요청 뒤에 **이번 주**를 맞춘다 — 양식·나무·3단계 스위치처럼 무엇이 영향받는지 좁히기 어려운 변경 뒤에 */
export function laterSyncCurrentWeek(opts: SyncOptions): void {
  later('syncAll', async () => {
    const { ensureCurrentSlot } = await import('../worklog');
    await syncAll(await ensureCurrentSlot(), opts);
  });
}

/**
 * 읽기 수리가 맞추는 주차인가 — 이번 주, 또는 「본부 → 총괄」 기한 + 24시간까지(스케줄러의 창과 같다).
 * 지난 주를 열었을 때 양식이 바뀌었다는 이유로 옛 본부본을 다시 만들어 승인을 풀지 않는다.
 */
export async function isLiveSlot(slot: WeekSlot, now = new Date()): Promise<boolean> {
  if (slot.isoKey === currentWeek(now).isoKey) return true;
  const t = await stageTimes(slot);
  return now.getTime() <= t.hqDue.getTime() + 24 * 3600_000;
}

/** RU-72 — `/hq`를 그리기 **전에**. 열쇠가 같으면 질의 몇 번으로 끝난다. 보는 사람과 상관없이 같은 결과다(조립은 `system`의 것) */
export async function readRepairHq(node: RollupNode, slot: WeekSlot): Promise<void> {
  try {
    if (await isLiveSlot(slot)) await syncHq(node, slot, { cause: 'read_repair', causedBy: null });
    else await settled(hqFlightKey(node.node.id, slot.id));
  } catch (e) {
    // 화면은 그린다 — 맞추지 못한 것은 화면이 그대로 보인다(상태·실패 이유)
    logger.error({ err: (e as Error).message, node: node.node.nameKo }, '[자동] 본부 읽기 수리 실패');
  }
}

/** RU-72 — `/org`를 그리기 **전에** */
export async function readRepairOrg(slot: WeekSlot): Promise<void> {
  try {
    if (await isLiveSlot(slot)) await syncOrg(slot, { cause: 'read_repair', causedBy: null });
    else await settled(orgFlightKey(slot.id));
  } catch (e) {
    logger.error({ err: (e as Error).message }, '[자동] 전사 읽기 수리 실패');
  }
}

/**
 * RU-72 — 스케줄러(켜져 있을 때만)의 안전망: 이번 주 기준 시각(RU-50)부터 「본부 → 총괄」 기한 + 24시간까지 매 주기 한 번.
 * 요청이 놓친 것(요청 뒤 프로세스 종료 등)을 따라잡는다. 같은 상태면 아무것도 하지 않는다.
 */
export async function runDueRollupSync(now = new Date()): Promise<boolean> {
  if (!(await rollupEnabled())) return false;
  const { ensureCurrentSlot } = await import('../worklog');
  const slot = await ensureCurrentSlot(now);
  const t = await stageTimes(slot);
  if (now < t.anchor || now.getTime() > t.hqDue.getTime() + 24 * 3600_000) return false;
  await syncAll(slot, { cause: 'scheduler', causedBy: null });
  return true;
}

export type { BuildCause };
