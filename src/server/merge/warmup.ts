// HM-53 — 모델을 **미리 올려 둔다** — 기동할 때 한 번, 그리고 마감 전에.
//
// 모델 서버는 5분 동안 안 쓰인 모델을 내린다(서버 기본 KEEP_ALIVE=5m). 그래서 마감 +1분의 첫 병합 호출이 모델을 올리는
// 시간까지 떠안았다 — 10월 실측 25~46초. 그 시간이 호출 제한(60초)에 들어가 첫 표가 모델 없이 확정됐다(2026-10-07에 두 번).
//
// 2026-10-08 개정 — **상주.** 사용자 결정(「독점하듯이 사용해도 돼」)으로 모든 호출이 `keep_alive: -1`을 붙인다(gate.ts
// `modelKeepAlive`). 한 번 올리면 내려가지 않으므로, 기동하자마자 올려 두면 [지금 병합]도 첫 호출부터 바로 생성에 들어간다.
// 마감 10분 전 데우기는 그대로 둔다 — 모델 서버가 재시작했거나 다른 모델이 자리를 밀어냈으면 그때 다시 올린다
// (이미 올라와 있으면 빈 요청은 바로 끝난다).
//
// - 빈 프롬프트(`prompt: ''`)는 ollama에서 「모델만 올리고 끝」이다. 답을 만들지 않는다.
// - 데우기도 모델 문(HM-52)을 지난다 — 병합 호출과 섞여 서버에 둘이 들어가면 데우기가 병합을 늦춘다.
// - 기준 시각마다 한 번 · 기동 때 한 번. 실패해도 로그만 남긴다 — 데우기가 안 됐다고 병합을 막을 이유는 없다(첫 호출이 느릴 뿐이다).
// - 스케줄러가 꺼진 서버(테스트·시연, `MERGE_SCHEDULER=off`)는 데우지 않는다 — 그쪽은 [지금 병합]이 올리고, 올린 모델은
//   keep_alive로 남는다. 일시정지(HM-44) 중에도 데우지 않는다 — 자동 병합이 돌지 않는다.

import { prisma } from '../db';
import { env } from '../env';
import { ensureCurrentSlot } from '../worklog';
import { mergeGate } from '@/lib/deadline';
import { deadlineFor } from '@/lib/week';
import { mergePaused } from './pause';
import { callModel, modelKeepAlive, type ModelReply } from './gate';

/** 기준 시각 이만큼 전부터 데운다 (10월 실측 모델 올리기 25~46초, 넉넉히) */
export const WARMUP_LEAD_MS = 10 * 60_000;
/**
 * … 기준 +1분(병합 시작, HM-35) 전까지. 그 뒤에 처음 본 기준 시각(재시작 직후 등)은 데우지 않는다 —
 * 병합 호출이 곧 같은 일을 한다.
 */
export const WARMUP_UNTIL_AFTER_MS = 60_000;

/** 이미 데운 기준 시각 (ms). 프로세스 안에서만 — 재시작하면 한 번 더 데울 수 있고, 그래도 해가 없다 */
const warmedGates = new Set<number>();

export interface WarmupOutcome {
  /** 이 데우기를 일으킨 병합 기준 시각. 기동 때 데우기면 null */
  gate: Date | null;
  ok: boolean;
  ms: number;
  reason: string | null;
}

/**
 * 이번 주차 활성 부서들의 병합 기준 시각 — 마감(주차 예외 포함, WS-18)과 「마감 열기」가 닫히는 시각(DM-20) 중 늦은 것.
 * `mergeGateOf`와 같은 계산을 부서마다 질의하지 않고 한 번에 한다 — 매분 도는 길이다.
 */
async function activeMergeGates(now: Date): Promise<Date[]> {
  const slot = await ensureCurrentSlot(now);
  const divisions = await prisma.division.findMany({ where: { isActive: true } });
  const openings = await prisma.slotOpening.findMany({
    where: { weekSlotId: slot.id },
    select: { divisionId: true, openUntil: true, openedBy: true },
  });
  const openOf = new Map(openings.map((o) => [o.divisionId, o]));
  const gates: Date[] = [];
  for (const d of divisions) {
    try {
      gates.push(mergeGate(deadlineFor(slot, d), openOf.get(d.id) ?? null));
    } catch {
      // 마감 설정이 깨진 부서 하나 때문에 데우기 전체가 멈추지 않는다 (병합 쪽이 그 부서의 오류를 따로 남긴다)
    }
  }
  return gates;
}

/** 데우는 곳인가 — 스케줄러가 켜져 있고 · 모델이 있고 · 일시정지가 아니다 (HM-53d) */
function warmable(now: Date): boolean {
  // 스케줄러가 꺼진 서버에서는 instrumentation이 여기까지 오지 않는다. 그래도 직접 부르는 길이 생길 때를 위해 여기서도 본다
  if (process.env.MERGE_SCHEDULER === 'off') return false;
  if (!env.MERGE_MODEL) return false;
  return !mergePaused(now);
}

/** 빈 프롬프트 하나를 문을 지나 보낸다. 다시 부르지 않는다. keep_alive는 병합 호출과 같다(상주) */
function sendWarmup(label: string): Promise<ModelReply> {
  return callModel({ label, warmup: true, retries: 0, body: { prompt: '' } });
}

/** 데우기 결과를 로그 한 줄로 — 성공이면 걸린 시간과 keep_alive, 실패면 이유 */
function logWarmup(what: string, reply: ModelReply): void {
  if (reply.ok) {
    console.log(`[merge] 모델 데우기 — ${what} · ${(reply.elapsedMs / 1000).toFixed(1)}초 · keep_alive ${modelKeepAlive()}`);
  } else {
    console.warn(`[merge] 모델 데우기 실패 — ${what}: ${reply.reason} (병합은 그대로 돈다)`);
  }
}

/**
 * HM-53 — **기동할 때 한 번** 모델을 올린다(2026-10-08 — 상주). 마감을 기다리지 않는다: 그 사이의 [지금 병합]도 첫 호출부터
 * 모델이 올라와 있게. instrumentation이 기다리지 않고 부른다. 보냈으면 그 결과, 데우지 않는 곳이면 null. 던지지 않는다.
 */
export async function warmModelAtBoot(now: Date = new Date()): Promise<WarmupOutcome | null> {
  if (!warmable(now)) return null;
  const reply = await sendWarmup('데우기(기동)');
  logWarmup('기동', reply);
  return { gate: null, ok: reply.ok, ms: reply.elapsedMs, reason: reply.ok ? null : reply.reason };
}

/**
 * HM-53 — 스케줄러가 매분 부른다. 가장 이른 기준 시각이 10분 안이면 모델 문을 지나 데우기 요청을 한 번 보낸다.
 * 보냈으면 그 결과, 아니면 null. 던지지 않는다.
 */
export async function warmModelIfDue(now: Date = new Date()): Promise<WarmupOutcome | null> {
  if (!warmable(now)) return null;

  let gates: Date[];
  try {
    gates = await activeMergeGates(now);
  } catch (e) {
    console.error('[merge] 데우기 — 기준 시각을 읽지 못함', e);
    return null;
  }

  const t = now.getTime();
  const due = gates
    .map((g) => g.getTime())
    .filter((g) => t >= g - WARMUP_LEAD_MS && t < g + WARMUP_UNTIL_AFTER_MS && !warmedGates.has(g))
    .sort((a, b) => a - b)[0];
  if (due === undefined) return null;
  // 보내기 **전에** 적는다 — 데우기가 1분을 넘겨도 다음 주기가 같은 기준 시각으로 한 번 더 보내지 않게.
  // 하루 지난 기준 시각은 잊는다 — 주마다 쌓이기만 할 이유가 없다
  for (const g of warmedGates) if (g < t - 24 * 60 * 60_000) warmedGates.delete(g);
  warmedGates.add(due);

  const reply = await sendWarmup('데우기');
  logWarmup(`기준 ${new Date(due).toISOString()}`, reply);
  return { gate: new Date(due), ok: reply.ok, ms: reply.elapsedMs, reason: reply.ok ? null : reply.reason };
}

/** 시험용 — 데운 기준 시각 기억을 비운다 */
export function resetWarmupForTest(): void {
  warmedGates.clear();
}
