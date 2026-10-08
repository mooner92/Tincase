// HM-58 — 같은 부서·주차 병합은 **한 번에 하나만** 돈다 (줄이 생기기 전까지의 임시 조치, API-31).
// HM-55 — `running`으로 멈춘 병합 실행을 회수한다.
//
// ── 왜 같은 부서 병합이 겹치면 안 되나 ─────────────────────
// 병합본은 주차마다 **같은 자리**에 쓴다. 14:02:30 [지금 병합]과 14:02:52 자동 병합이 함께 돌면, 부서장이 그 사이
// (14:03:58) 고쳐 저장한 판을 늦게 끝난 쪽이 14:04:11에 덮는다 — 부서장 수정이 병합본에서 사라지고, 부서장에게는
// 「다시 승인해 주세요」가 간다(시뮬레이션 p20e). 2026-10-07 10:38:55와 10:39:43에도 실제로 겹쳤다.
// 수동 요청이 100초를 넘기면 Cloudflare가 524를 내므로 사람은 한 번 더 누른다 — 겹침이 겹침을 부른다.
// 버튼의 `busy`는 그 탭에만 있어서 다른 탭·다른 사람·스케줄러를 막지 못한다. 그래서 서버가 막는다.
//
// 두 겹이다:
//   1) 프로세스 안 — 확인과 잡기가 한 동기 구간이라, 같은 순간 두 요청이 둘 다 「없음」을 보고 둘 다 시작하는 틈이 없다.
//   2) DB의 running 행 — 다른 프로세스(개발용 scripts/run-merge.ts 등)가 돌리는 것도 본다.
// 둘 다 「멈춘 실행」(아래)은 돌고 있는 것으로 치지 않는다 — 죽은 기록이 병합을 영영 막으면 안 된다.
//
// ── 왜 멈춘 실행을 회수하나 ─────────────────────────────────
// 14:03에 재시작이 끼면 그 부서 기록이 running으로 남는다. 병합 안내는 「아직 도는 중」으로 보고 그 부서를 건너뛰고,
// 스케줄러는 최종본도 실패도 아닌 그 행 때문에 재시도(HM-43)를 셈하지 못한다. 그 주는 「병합본이 아직 없어요」도
// +30분 안내도 끝내 안 나간다. 운영 DB에 2026-09-03 14:18:50의 그런 행이 남아 있다.
//
// **기동할 때는 남은 running이 전부 죽은 것이다.** 병합을 돌리는 프로세스는 이 앱 하나뿐이라(DB는 이 앱 혼자 쓴다 — ADR-0003) 새 프로세스가
// 뜬 순간 그 DB에서 살아 있는 실행은 없다. 그래서 기동 때 바로 치운다. 「10분 지난 것만」으로 기다리게 했더니
// 시뮬레이션(14:02:49 시작 · 14:04 재시작)에서 끊긴 부서가 14:16에야 다시 돌았다 — 병합 루프가 주기를 붙잡아 회수가
// 10분보다 더 늦었고, 그 사이 담당자는 「병합본이 아직 없어요」를 받았다. 그 동안 [지금 병합]도 아무것도 돌지 않는데
// 「이미 병합 중입니다」(HM-58)로 막힌다.
// **도는 중(매분)에는 예산 + 여유(기본 10분)보다 오래 running이면 멈춘 것이다.** 예산(HM-57)이 모델 호출과 문 앞 대기를
// 끊으므로 살아 있는 실행은 그보다 오래 갈 수 없다 — 매분 치워도 살아 있는 실행을 죽이지 않는다.
// 개발용 scripts/run-merge.ts를 서버와 같은 DB에 돌리는 중에 서버가 재시작하면 그 실행은 잠깐 「중단됨」으로 보이지만,
// 끝나면 제 결과로 다시 쓴다(recordMerge가 id로 갱신한다). 운영 DB에는 그 스크립트를 돌리지 않는다.
// 2단계에서 병합 줄(작업 표)이 생기면 그 lease가 이 일을 맡는다.

import { prisma } from '../db';
import { mergeStaleAfterMs, mergeStaleBefore } from './budget';

/** HM-55 — 회수한 실행에 남기는 오류 문구. 수합 관리 병합 카드가 그대로 보여 준다 */
export const INTERRUPTED_TEXT = '중단됨(재시작 등)';
/** HM-58 — 409 `merging`의 문구 */
export const MERGING_TEXT = '이미 병합 중입니다';

interface Claim {
  since: number;
}
const claims = new Map<string, Claim>();
const unitKey = (divisionId: string, weekSlotId: string) => `${divisionId}:${weekSlotId}`;

function liveClaim(divisionId: string, weekSlotId: string, now: number): Claim | null {
  const c = claims.get(unitKey(divisionId, weekSlotId));
  // 잡은 지 멈춤 기준보다 오래면 매달린 것이다 — DB 행과 같은 규칙으로 놓아 준다
  return c && now - c.since < mergeStaleAfterMs() ? c : null;
}

/**
 * HM-58 — 이 프로세스 안에서 이 부서·주차를 잡는다. 이미 누가 잡고 있으면 null.
 * 확인과 잡기 사이에 `await`가 없다 — 그게 이 함수의 전부다. 돌려받은 함수로 놓는다(한 번만, 자기 것만).
 */
export function claimMergeUnit(divisionId: string, weekSlotId: string, now: number = Date.now()): (() => void) | null {
  if (liveClaim(divisionId, weekSlotId, now)) return null;
  const key = unitKey(divisionId, weekSlotId);
  const mine: Claim = { since: now };
  claims.set(key, mine);
  return () => {
    if (claims.get(key) === mine) claims.delete(key);
  };
}

/** HM-58 — DB에 멈추지 않은 running 실행이 있나 (다른 프로세스의 것도). 가장 최근 것 */
export async function freshRunningRun(
  divisionId: string,
  weekSlotId: string,
  now: Date = new Date(),
): Promise<{ id: string; startedAt: Date } | null> {
  return prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId, status: 'running', startedAt: { gte: mergeStaleBefore(now) } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  });
}

/**
 * HM-58 — 이 부서·주차 병합이 지금 돌고 있나. [지금 병합](409 `merging`)과 스케줄러(건너뜀)가 묻는다.
 * 돌고 있으면 시작 시각(과 알면 실행 id), 아니면 null.
 */
export async function mergeInFlight(
  divisionId: string,
  weekSlotId: string,
  now: Date = new Date(),
): Promise<{ runId: string | null; startedAt: Date } | null> {
  const row = await freshRunningRun(divisionId, weekSlotId, now);
  if (row) return { runId: row.id, startedAt: row.startedAt };
  // 잡았지만 아직 기록을 만들기 전 — 몇 ms의 틈이지만 그 틈에 두 번째 요청이 들어온다
  const c = liveClaim(divisionId, weekSlotId, now.getTime());
  return c ? { runId: null, startedAt: new Date(c.since) } : null;
}

/**
 * HM-55 — 멈춘 실행을 `failed`(「중단됨(재시작 등)」)로 바꾼다. 스케줄러가 매분 — 예산 + 여유보다 오래 running인 것만.
 * 기동 때 한 번(`atBoot`) — running이면 **모두** (이 프로세스가 뜨기 전에 시작한 것은 살아 있을 수 없다).
 * 바꾼 것을 돌려준다. 끝난 시각은 지금이다 — 「언제 멈춘 걸 알았나」가 사실이고, 병합 안내 창(HM-50)도 여기서 연다.
 * 바꾸는 순간 그 실행이 막 끝났으면 건드리지 않는다(`status: 'running'` 조건).
 */
export async function recoverStaleMergeRuns(
  now: Date = new Date(),
  opts: { atBoot?: boolean } = {},
): Promise<{ id: string; divisionId: string; weekSlotId: string; startedAt: Date }[]> {
  const stale = await prisma.mergeRun.findMany({
    where: opts.atBoot ? { status: 'running' } : { status: 'running', startedAt: { lt: mergeStaleBefore(now) } },
    select: { id: true, divisionId: true, weekSlotId: true, startedAt: true },
  });
  if (stale.length === 0) return [];
  await prisma.mergeRun.updateMany({
    where: { id: { in: stale.map((r) => r.id) }, status: 'running' },
    data: { status: 'failed', errorText: INTERRUPTED_TEXT, finishedAt: now },
  });
  console.warn(
    `[merge] 멈춘 병합 실행 ${stale.length}건 회수 — ${INTERRUPTED_TEXT}: ` +
      stale.map((r) => `${r.id}(${r.startedAt.toISOString()} 시작)`).join(', '),
  );
  return stale;
}
