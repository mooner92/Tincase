// NT-42 · 12 §8 (2026-10-08 결정 f) — 알림 기록을 **보내기 전에** 잡는다.
//
// 같은 알림을 두 곳이 판정할 수 있다 — RU-54는 「다 모인 순간」(조립 직후)과 「실·팀 → 본부」 기한(스케줄러), NT-52는 병합 뒤와 저장 뒤.
// 예전에는 「기록이 있나 보고 → 보내고 → 기록」이어서, 둘이 같은 순간에 돌면 둘 다 「아직 안 보냄」을 보고 같은 사람에게 두 번 보냈다
// (두 번째 기록은 유일 키에 걸려 실패했지만 메시지는 이미 나갔다). 이제 (부서·주차·종류) 유일 키로 **먼저 넣고**, 넣은 쪽만 보낸다.
// 아무에게도 나가지 않았으면(대상 0명·전송 실패) 잡은 줄을 지운다 — 「실제로 나간 것만 기록한다」(메신저가 꺼진 동안의 「보냄」이 남지 않는다)는 그대로다.
//
// 남는 위험: 잡은 뒤 보내기 전에 프로세스가 죽으면 그 알림은 다시 가지 않는다 — 두 번 가는 것보다 한 번 덜 가는 쪽을 골랐다(12 §2a 「남은 위험」).
import { prisma } from '../db';

function isUniqueClash(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** 기록을 잡는다. 잡았으면 그 줄 id, 이미 누가 잡았으면(보냈거나 보내는 중) null */
export async function claimNotice(divisionId: string, weekSlotId: string, kind: string, detail: Record<string, unknown> = {}): Promise<string | null> {
  try {
    const row = await prisma.notifyLog.create({
      data: { divisionId, weekSlotId, kind, recipients: '[]', detail: JSON.stringify({ ...detail, claimed: true }) },
    });
    return row.id;
  } catch (e) {
    if (isUniqueClash(e)) return null;
    throw e;
  }
}

/** 보낸 뒤 — 나간 사람이 있으면 그 줄에 적고, 없으면 줄을 놓는다(다음 판정이 다시 보낼 수 있게) */
export async function settleNotice(id: string, sent: readonly string[], detail: Record<string, unknown>): Promise<void> {
  if (sent.length === 0) {
    await prisma.notifyLog.delete({ where: { id } }).catch(() => {});
    return;
  }
  await prisma.notifyLog.update({ where: { id }, data: { recipients: JSON.stringify(sent), detail: JSON.stringify(detail), sentAt: new Date() } });
}
