// OPS-52 — 쓰기가 막힌 서버는 **아무것도 보내지 않고, 운영자에게 한 번 알린다.**
//
// 2026-11-25: 데이터 폴더의 주인이 바뀌어 DB·파일 쓰기가 3시간 막혔다. health는 그동안 503이었지만(저장소 쓰기 실패) 아무도 보지 않았고,
// 처음 드러난 것은 「마감이 내일이에요」가 1분마다 다시 온 것이었다. 스케줄러가 매 주기 맨 앞에서 쓰기를 확인한다:
//   · 막혔으면 그 주기는 **통째로 건너뛴다** — 기록할 수 없는 서버가 알림·병합을 판정하지 않는다
//   · 운영자에게 메신저 한 통. 다시 보내는 것은 여섯 시간 뒤 — 「보냈음」은 DB에 적을 수 없으므로 임시 폴더의 표식 파일과 메모리에 둔다
//     (표식을 **먼저** 쓰고 보낸다 — 표식도 못 쓰면 메모리만 믿는다. 프로세스가 다시 떠도 표식 파일이 남아 되풀이하지 않는다)
//   · 풀리면 표식을 지우고 로그 한 줄
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from './db';
import { env } from './env';
import { probeDbWrite } from './db-write';
import { storageWritable } from './storage';
import { messengerStatus, sendAlert } from './messenger';

/** 같은 고장으로 운영자에게 다시 알리는 간격 */
export const WRITE_ALERT_EVERY_MS = 6 * 60 * 60_000;
/** 막힌 동안 로그는 이 간격으로 한 줄(1분마다 같은 줄을 찍지 않는다) */
const LOG_EVERY_MS = 10 * 60_000;

export type WriteState = { ok: true } | { ok: false; what: 'db' | 'storage'; reason: string };

export async function checkWrites(): Promise<WriteState> {
  const db = await probeDbWrite();
  if (!db.ok) return { ok: false, what: 'db', reason: db.error };
  if (!(await storageWritable())) return { ok: false, what: 'storage', reason: '저장소 폴더에 파일을 쓸 수 없음' };
  return { ok: true };
}

const latchFile = () => path.join(os.tmpdir(), 'tincase-write-alert');
let memAlertAt = 0;
let loggedAt = 0;
let wasBlocked = false;

function lastAlertAt(): number {
  let fileAt = 0;
  try {
    fileAt = Number(readFileSync(latchFile(), 'utf8').trim()) || 0;
  } catch {
    fileAt = 0;
  }
  return Math.max(memAlertAt, fileAt);
}

function markAlert(at: number): void {
  memAlertAt = at;
  try {
    writeFileSync(latchFile(), String(at));
  } catch {
    /* 임시 폴더도 못 쓰면 메모리만 — 그래도 이 프로세스는 되풀이하지 않는다 */
  }
}

function clearAlert(): void {
  memAlertAt = 0;
  try {
    rmSync(latchFile(), { force: true });
  } catch {
    /* 없어도 된다 */
  }
}

export function writeAlertMessage(state: Extract<WriteState, { ok: false }>, name: string, employeeNo: string) {
  return {
    subject: '[Tincase] 지금 저장이 안 돼요 — 운영자 확인이 필요해요',
    contents: [
      `[${employeeNo}]${name}님, Tincase가 ${state.what === 'db' ? 'DB' : '파일 저장소'}에 쓰지 못하고 있어요.`,
      '',
      '제출 · 병합 · 알림을 멈췄어요. 풀릴 때까지 아무것도 보내지 않아요.',
      `원인: ${state.reason.slice(0, 160)}`,
      '',
      '데이터 폴더의 주인·권한을 확인해 주세요 (docs/DEPLOY.md 「쓰기가 막혔을 때」).',
    ].join('\n'),
  };
}

/** 운영자(활성 · 알림 켬 · 사번) — 읽기만 한다. 읽기도 안 되면 빈 목록 */
async function operators(): Promise<{ name: string; employeeNo: string }[]> {
  try {
    const us = await prisma.user.findMany({
      where: { isOperator: true, isActive: true, notifyEnabled: true, employeeNo: { not: null } },
      select: { name: true, employeeNo: true },
    });
    return us.map((u) => ({ name: u.name, employeeNo: u.employeeNo! }));
  } catch {
    return [];
  }
}

/**
 * 스케줄러 한 주기의 문. **true면 막혔다 — 그 주기는 아무것도 하지 않는다.** 던지지 않는다.
 * `check`는 시험이 갈아 끼운다.
 */
export async function guardWrites(now: Date = new Date(), check: () => Promise<WriteState> = checkWrites): Promise<boolean> {
  let state: WriteState;
  try {
    state = await check();
  } catch (e) {
    // 검사 자체가 죽으면 막지 않는다 — 검사 고장으로 본업이 멈추지 않게
    console.error('[점검] 쓰기 검사 오류', e);
    return false;
  }
  const t = now.getTime();
  if (state.ok) {
    if (wasBlocked || lastAlertAt() > 0) {
      console.log('[점검] 쓰기가 다시 됩니다 — 스케줄러를 잇습니다');
      clearAlert();
    }
    wasBlocked = false;
    return false;
  }

  wasBlocked = true;
  if (t - loggedAt >= LOG_EVERY_MS) {
    loggedAt = t;
    console.error(`[점검] ${state.what === 'db' ? 'DB' : '저장소'}에 쓸 수 없습니다 — 이번 주기를 건너뜁니다(알림·병합 판정 안 함): ${state.reason}`);
  }
  if (t - lastAlertAt() < WRITE_ALERT_EVERY_MS) return true;

  markAlert(t); // 먼저 적고 보낸다 — 보내다 죽어도 되풀이하지 않는다
  try {
    if (!messengerStatus().enabled) return true;
    const url = env.MESSENGER_LINK_BASE ? `${env.MESSENGER_LINK_BASE}/ops` : undefined;
    let sent = 0;
    for (const o of await operators()) {
      const r = await sendAlert({ recvIds: [o.employeeNo], ...writeAlertMessage(state, o.name, o.employeeNo), url, kind: 'write_blocked' });
      sent += r.sent.length;
    }
    console.error(`[점검] 운영자에게 알림 ${sent}통 — 다음 알림은 ${WRITE_ALERT_EVERY_MS / 3_600_000}시간 뒤(계속 막혀 있으면)`);
  } catch (e) {
    console.error('[점검] 운영자 알림 실패', e);
  }
  return true;
}

/** 시험용 — 메모리 상태를 처음으로 */
export function resetWriteGuardForTest(): void {
  memAlertAt = 0;
  loggedAt = 0;
  wasBlocked = false;
  clearAlert();
}
