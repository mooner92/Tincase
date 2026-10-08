// OPS-48 — 기동할 때 DB가 **이 판의 스키마를 따라왔는지** 본다. 모자라면(배포에서 `prisma db push`를 빠뜨림) 무엇이 없는지 찍고 멈춘다.
//
// 왜 (2026-10-09 v2 전환 점검에서 실측): 운영 main(v1.39.0) DB에 이 판을 그대로 띄우면 **뜬다.** health는 `ok:true`(DB 연결 · 저장소 ·
// 양식만 본다)라 deploy.sh가 성공으로 끝나는데, 부서를 읽는 화면은 모두 500(`Division.rollupOrder` 없음)이고 병합 줄(`MergeJob` 없음)은
// 로그에 오류만 남긴다 — 목요일 마감에 자동 병합이 하나도 돌지 않는 것을 15:00 미도착 목록에서야 안다.
// 그래서 기동할 때 한 번 맞춰 보고 멈춘다 — OPS-05(빈 DB · entrypoint)·OPS-46(메신저 설정 · env.ts)과 같은 fail fast.
//
// 기준은 이 판의 Prisma 클라이언트(`Prisma.dmmf`)다. schema.prisma에서 생성된 것이라 목록을 손으로 적지 않는다 — 손으로 적은 목록은
// 다음에 표를 더할 때 빠진다. **모자란 것만** 본다: DB에 더 있는 표·열(지난 판의 것 · 롤백한 옛 앱이 남긴 것)은 문제가 아니다.
import { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface SchemaGap {
  /** 없는 표 */
  tables: string[];
  /** 있는 표의 없는 열 — `표.열` */
  columns: string[];
}

/** 이 판이 기대하는 표 → 열. 관계 필드(`kind: object`)는 열이 아니다 — `Division.users` 같은 것은 표에 없다 */
export function expectedSchema(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of Prisma.dmmf.datamodel.models) {
    out.set(
      m.dbName ?? m.name,
      m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName ?? f.name),
    );
  }
  return out;
}

/** 순수 판정 — 기대(표 → 열)에 비해 실제(표 → 열)에 없는 것. 실제에만 있는 것은 보지 않는다 */
export function schemaGaps(expected: ReadonlyMap<string, readonly string[]>, actual: ReadonlyMap<string, ReadonlySet<string>>): SchemaGap {
  const tables: string[] = [];
  const columns: string[] = [];
  for (const [table, cols] of expected) {
    const have = actual.get(table);
    if (!have) {
      tables.push(table);
      continue;
    }
    for (const c of cols) if (!have.has(c)) columns.push(`${table}.${c}`);
  }
  return { tables, columns };
}

/** 지금 DB(SQLite)의 표 → 열. 질의 한 번 */
export async function actualSchema(): Promise<Map<string, Set<string>>> {
  const rows = await prisma.$queryRaw<{ tbl: string; col: string }[]>`
    SELECT m.name AS tbl, p.name AS col FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type = 'table'`;
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    let cols = out.get(r.tbl);
    if (!cols) out.set(r.tbl, (cols = new Set()));
    cols.add(r.col);
  }
  return out;
}

/** 모자란 것을 사람이 읽는 몇 줄로 — 무엇이 없고 무엇을 하면 되는지. 모자란 것이 없으면 null */
export function schemaGapMessage(gap: SchemaGap): string | null {
  if (gap.tables.length === 0 && gap.columns.length === 0) return null;
  return [
    'DB 스키마가 이 판보다 오래됐습니다 — 배포에서 `prisma db push`를 빠뜨렸습니다 (OPS-48)',
    ...(gap.tables.length ? [`  없는 표 ${gap.tables.length}개: ${gap.tables.join(', ')}`] : []),
    ...(gap.columns.length ? [`  없는 열 ${gap.columns.length}개: ${gap.columns.join(', ')}`] : []),
    '  할 일 — 호스트에서, DB 스냅샷 뒤에 (docs/DEPLOY.md §2b-2 · §2b-3):',
    '    cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db npx prisma db push --skip-generate   (테스트·시연 서버는 그 저장소의 DB)',
    '  그다음 다시 띄운다: bash scripts/deploy.sh prod --no-build — 바뀌는 것은 더하기만이라 데이터 손실 확인을 묻지 않는다(물으면 멈춘다)',
  ].join('\n');
}

/**
 * OPS-48 — 기동 검사. 모자라면 그 설명을 돌려준다(부르는 쪽 — instrumentation — 이 찍고 멈춘다). 맞으면 null.
 * DB를 읽지 못했으면(잠김 등) 경고만 남기고 null — 검사를 못 한 것을 「모자람」으로 치면 멀쩡한 서버가 뜨지 않는다.
 */
export async function schemaProblemAtBoot(): Promise<string | null> {
  let actual: Map<string, Set<string>>;
  try {
    actual = await actualSchema();
  } catch (e) {
    console.warn('[boot] 스키마 확인을 하지 못했습니다 — 그대로 뜬다 (OPS-48)', (e as Error).message);
    return null;
  }
  return schemaGapMessage(schemaGaps(expectedSchema(), actual));
}

/**
 * OPS-48 — instrumentation이 기동할 때 부른다(회수·스케줄러보다 먼저). 모자라면 이유와 할 일을 찍고 **프로세스를 끝낸다** —
 * 컨테이너는 health에 닿지 못하고 deploy.sh가 「health가 … 아니다」로 멈춘다. 로그 첫 FATAL 줄이 이유다.
 */
export async function stopIfSchemaBehind(): Promise<void> {
  const problem = await schemaProblemAtBoot();
  if (!problem) return;
  console.error(`[boot] FATAL: ${problem}`);
  process.exit(1);
}
