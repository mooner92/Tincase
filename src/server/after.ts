// RU-72 — 요청이 응답한 **뒤에** 할 일 (Next `after()`).
//
// 승인 요청이 할 일은 「승인 + 사본」까지다(그 요청 안에서, 한 트랜잭션). 본부본·전사본을 다시 만드는 것은 부서장을
// 기다리게 할 이유가 없어 응답 뒤로 미룬다. 그런데 `after()`는 요청 안에서만 부를 수 있다 — 스케줄러·스크립트·시험은
// 요청 밖이라 던진다. 그때는 **지금 바로** 돌리고(기다리지 않는다) 그 약속을 모아 둔다: 시험은 `settleLater()`로
// 끝날 때까지 기다리고, 스케줄러는 다음 주기 전에 끝난다. 실패는 로그로 남기고 삼킨다 — 요청 뒤의 일이 실패해도
// 이미 커밋된 승인·사본은 그대로이고, 화면 열기(읽기 수리)·스케줄러가 따라잡는다 (ADR-0015 「위험과 대응」).
import { after } from 'next/server';
import { logger } from './logger';

const pending = new Set<Promise<unknown>>();

export function later(label: string, task: () => Promise<unknown>): void {
  const run = () =>
    task().catch((e) => {
      logger.error({ err: e instanceof Error ? e.message : String(e), label }, '[자동] 요청 뒤 작업 실패');
    });
  try {
    after(run);
    return;
  } catch {
    // 요청 밖 — 아래로
  }
  const p: Promise<unknown> = run().finally(() => pending.delete(p));
  pending.add(p);
}

/** 시험·스크립트용 — 요청 밖에서 미뤄 둔 일이 (그 일이 다시 미룬 일까지) 모두 끝날 때까지 기다린다 */
export async function settleLater(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
