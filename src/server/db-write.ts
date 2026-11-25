// OPS-52 — DB에 **쓸 수 있나**를 실제로 써 보고 되돌려서 확인한다. 남는 것이 없다.
//
// 왜 (2026-11-25 사고): 호스트의 취약점 조치가 데이터 폴더의 주인을 root로 바꿨다. 앱은 열어 둔 파일로 **읽기는 계속** 됐고
// `SELECT 1`도 통과했다 — 쓰기만 「attempt to write a readonly database」(SQLite 1032: 경로를 다시 확인하지 못함)로 실패했다.
// 그래서 마감 전 알림이 「보냈음」을 적지 못한 채 1분마다 다시 나갔다(8번 × 9명). 읽기 검사로는 이 상태가 보이지 않는다.
//
// 방법: 쓰기 트랜잭션을 열고 `PRAGMA user_version`을 **같은 값으로** 다시 쓴다 — 1쪽을 건드리므로 저널을 열고(여기서 위 오류가 난다),
// 곧 되돌린다. 값이 같아 되돌리기가 실패해도 바뀌는 것이 없다. 표·행을 만들지 않는다.
import { prisma } from './db';

class ProbeRollback extends Error {}

export type DbWriteProbe =
  | { ok: true; busy?: boolean }
  /** kind — health에 그대로 나간다(무인증 주소라 원문은 싣지 않는다, API-33). error는 로그·운영자 알림용 */
  | { ok: false; kind: 'readonly' | 'full' | 'io' | 'open' | 'other'; error: string };

/** 오류 원문 → 종류. 잠김·시간 초과는 고장이 아니다(다른 쓰기가 도는 중) */
export function classifyWriteError(message: string): 'busy' | 'readonly' | 'full' | 'io' | 'open' | 'other' {
  const m = message.toLowerCase();
  if (/readonly|read-only|read only/.test(m)) return 'readonly';
  if (/database or disk is full|no space left/.test(m)) return 'full';
  if (/disk i\/o error/.test(m)) return 'io';
  if (/unable to open (the )?database|permission denied|eacces/.test(m)) return 'open';
  if (/busy|locked|timed out|timeout|unable to start a transaction|transaction api error|expired transaction/.test(m)) return 'busy';
  return 'other';
}

export async function probeDbWrite(): Promise<DbWriteProbe> {
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ user_version: number | bigint }[]>('PRAGMA user_version');
      const v = Number(rows[0]?.user_version ?? 0);
      await tx.$executeRawUnsafe(`PRAGMA user_version = ${Number.isInteger(v) ? v : 0}`);
      throw new ProbeRollback();
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof ProbeRollback) return { ok: true };
    const error = String((e as Error)?.message ?? e)
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const kind = classifyWriteError(error);
    if (kind === 'busy') return { ok: true, busy: true };
    return { ok: false, kind, error };
  }
}
