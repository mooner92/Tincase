// ADR-0022 D4 — **알림 묶기.** 같은 사람에게 짧은 사이(`NOTIFY_BATCH_MS`, 운영 20초)에 쪽지가 둘 이상이면 한 통으로 보낸다.
//
// 왜: 한 사람이 자리를 둘 맡으면(실 담당 + 본부 담당, ADR-0022) 실장이 승인하는 순간 「승인 완료(실)」와 「본부본 준비(본부)」가
// 몇 초 사이로 같은 사람에게 간다. 실 여럿을 맡으면 마감 뒤 같은 안내가 실 수만큼. 운영자: 「두 번 알림 가지 않게」.
//
// 길: 알림은 곧바로 메신저로 가지 않고 **사람별 보낼 함**(`NotifyOutbox`)에 들어간다 → 창이 지나면 사람마다 모아 한 통(둘 이상이면 묶음)으로.
// 창이 0이면(기본 — 개발·시험) 지금처럼 바로 보낸다. 묶지 않는 것: 설정 링크 · 비밀번호 찾기(그 사람이 지금 기다린다 — `sendAlert`를 직접 부른다).
//
// 기록(NT-42): 보낼 함에 넣은 순간을 「보냄」으로 돌려준다 — 허용 목록·주소는 넣기 **전에** 거른다(`reachable`). 메신저가 실패하면
// 함이 다음 비움에 다시 보낸다(3번까지) — 그 뒤는 오류로 남는다(`error`). 비우기는 창이 지난 뒤 한 번(타이머) + 스케줄러 매분(안전망).
import { prisma } from '../db';
import { logger } from '../logger';
import { reachable, sendAlert, type AlertInput, type SendResult } from '../messenger';

const MAX_ATTEMPTS = 3;

/** `NOTIFY_BATCH_MS` — 묶는 창(밀리초). 비었거나 읽을 수 없으면 0(묶지 않음 — 바로 보낸다) */
export function batchWindowMs(raw = process.env.NOTIFY_BATCH_MS): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10 * 60_000) : 0;
}

/** 프로세스 하나에 비우기 하나 — 타이머와 스케줄러가 겹쳐 같은 줄을 두 번 보내지 않게(일꾼 상태처럼 globalThis — HM-59d와 같은 이유) */
const state = ((globalThis as { __tincaseOutbox?: { timer: ReturnType<typeof setTimeout> | null; flushing: Promise<unknown> | null } }).__tincaseOutbox ??= {
  timer: null,
  flushing: null,
});

/**
 * 알림 하나를 보낸다 — 창이 열려 있으면 보낼 함에 넣고, 아니면 바로. 돌려주는 값은 `sendAlert`와 같은 꼴이다
 * (`sent` = 넣은 사번 — 부르는 쪽이 NotifyLog에 그대로 적는다).
 */
export async function sendOrQueue(input: AlertInput, now = new Date()): Promise<SendResult> {
  const windowMs = batchWindowMs();
  if (windowMs === 0) return sendAlert(input);
  const r = reachable(input.recvIds);
  const result: SendResult = { requested: r.requested, sent: [], blocked: r.blocked, disabled: r.disabled, errors: [] };
  if (r.targets.length === 0) return result;
  await prisma.notifyOutbox.createMany({
    data: r.targets.map((recvId) => ({
      recvId,
      subject: input.subject,
      contents: input.contents,
      url: input.url ?? null,
      kind: input.kind ?? 'notice',
      createdAt: now,
    })),
  });
  result.sent.push(...r.targets);
  kick(windowMs);
  return result;
}

/** 창이 지난 뒤 한 번 비운다 — 이미 타이머가 있으면 그것이 함께 가져간다 */
function kick(windowMs: number): void {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushOutbox().catch((e) => logger.error({ err: (e as Error).message }, '[알림] 보낼 함 비우기 실패'));
  }, windowMs + 500);
  // 프로세스가 끝나는 것을 이 타이머가 붙잡지 않는다(시험·스크립트) — 남은 것은 다음 기동의 스케줄러가 비운다
  (state.timer as { unref?: () => void }).unref?.();
}

/** 여러 건을 한 통으로 — 둘 이상일 때만 부른다. 제목은 건수와 첫 제목, 본문은 건마다 제목 한 줄 + 내용, 링크는 첫 건 */
export function combineAlerts(items: readonly { subject: string; contents: string; url: string | null }[]): { subject: string; contents: string; url?: string } {
  const bare = (s: string) => s.replace(/^\[Tincase\]\s*/, '');
  return {
    subject: `[Tincase] 알림 ${items.length}건 — ${bare(items[0].subject)}`,
    contents: items.map((it, i) => `■ ${i + 1}. ${bare(it.subject)}\n${it.contents}`).join('\n\n──────────\n\n'),
    url: items.find((it) => it.url)?.url ?? undefined,
  };
}

/**
 * 보낼 함 비우기 — 창(`NOTIFY_BATCH_MS`)이 지난 줄을 사람마다 모아 한 통씩. 같은 꼴이 된 쪽지는 받는 사람을 묶어 한 번에 보낸다
 * (마감 독촉처럼 수십 명에게 같은 글이 가는 경우 — 메신저 요청 수를 늘리지 않는다).
 */
export async function flushOutbox(now = new Date()): Promise<{ batches: number; sent: number; failed: number }> {
  if (state.flushing) await state.flushing; // 앞의 비우기가 끝나기를 기다렸다가 남은 것을 본다
  const run = (async () => {
    const windowMs = batchWindowMs();
    const due = new Date(now.getTime() - windowMs);
    const rows = await prisma.notifyOutbox.findMany({
      where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS }, createdAt: { lte: due } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return { batches: 0, sent: 0, failed: 0 };
    // 사람마다 한 통
    const byPerson = new Map<string, typeof rows>();
    for (const r of rows) byPerson.set(r.recvId, [...(byPerson.get(r.recvId) ?? []), r]);
    // 같은 꼴의 쪽지는 받는 사람을 묶는다
    const groups = new Map<string, { msg: { subject: string; contents: string; url?: string; kind: string }; recvIds: string[]; rowIds: string[] }>();
    for (const [recvId, items] of byPerson) {
      const msg =
        items.length === 1
          ? { subject: items[0].subject, contents: items[0].contents, url: items[0].url ?? undefined, kind: items[0].kind }
          : { ...combineAlerts(items), kind: `batch:${[...new Set(items.map((i) => i.kind.split(':')[0]))].join('+')}` };
      const key = JSON.stringify([msg.subject, msg.contents, msg.url ?? '', msg.kind]);
      const g = groups.get(key) ?? { msg, recvIds: [], rowIds: [] };
      g.recvIds.push(recvId);
      g.rowIds.push(...items.map((i) => i.id));
      groups.set(key, g);
    }
    let sent = 0;
    let failed = 0;
    for (const g of groups.values()) {
      const batchId = `b${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const r = await sendAlert({ recvIds: g.recvIds, subject: g.msg.subject, contents: g.msg.contents, url: g.msg.url, kind: g.msg.kind });
      const ok = new Set(r.sent);
      const okRows = rows.filter((x) => g.rowIds.includes(x.id) && ok.has(x.recvId)).map((x) => x.id);
      const badRows = g.rowIds.filter((id) => !okRows.includes(id));
      if (okRows.length) await prisma.notifyOutbox.updateMany({ where: { id: { in: okRows } }, data: { sentAt: new Date(), batchId } });
      if (badRows.length) {
        // 메신저가 꺼졌거나(허용 목록에서 빠짐 포함) 실패 — 횟수를 올리고 다음 비움에. 세 번이면 그만(오류로 남는다)
        await prisma.notifyOutbox.updateMany({
          where: { id: { in: badRows } },
          data: { attempts: { increment: 1 }, error: (r.errors[0] ?? (r.disabled ? '메신저 꺼짐' : '보내지 못함')).slice(0, 300) },
        });
      }
      sent += okRows.length;
      failed += badRows.length;
    }
    if (failed) logger.warn({ failed }, '[알림] 보낼 함 — 못 보낸 줄(다음 비움에 다시)');
    return { batches: groups.size, sent, failed };
  })();
  state.flushing = run;
  try {
    return await run;
  } finally {
    if (state.flushing === run) state.flushing = null;
  }
}
