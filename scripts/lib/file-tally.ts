// OPS-49 — 파일 점검의 순수한 부분. `scripts/check-files.ts`가 쓰고, 시험(`tests/check-files.test.ts`)이 DB·파일 없이 부른다.
//
// **숫자만 남긴다.** 경로·파일 이름·오류 문구는 세지 않는다 — 운영 데이터에 돌리는 점검이라 출력에 사람 이름이나 문서 내용이
// 섞이면 안 된다(제출 파일 이름에는 사람 이름이 들어간다). 오류는 종류(클래스 이름 · 코드)로만 묶는다.
// 예외 하나 — 양식은 **부서 이름**을 붙일 수 있다(`labels`). 부서 이름은 조직도라 사람이 아니고, 어느 부서 양식을 다시 받을지 알아야 고친다.

export interface Tally {
  /** 경로가 있는 행 수 */
  rows: number;
  /** 파일이 없다(읽기 실패) */
  missing: number;
  /** 읽혔고 검사도 통과 */
  ok: number;
  /** 읽혔는데 검사가 던졌다 */
  failed: number;
  /** 실패를 종류별로 — `HwpFormatError:not_ole` 꼴. 문구는 넣지 않는다 */
  errors: Record<string, number>;
  /** `labels`를 준 무리만 — 없거나 실패한 행의 꼬리표(부서 이름) */
  problems?: string[];
}

/** 오류를 이름과 코드로만 — 메시지에는 파일 내용·경로가 들어갈 수 있다 */
export function errorKey(e: unknown): string {
  if (typeof e !== 'object' || e === null) return 'unknown';
  const x = e as { name?: unknown; code?: unknown; reason?: unknown };
  const name = typeof x.name === 'string' && /^[A-Za-z]{1,40}$/.test(x.name) ? x.name : 'Error';
  const raw = typeof x.code === 'string' ? x.code : typeof x.reason === 'string' ? x.reason : '';
  const code = /^[a-z_]{1,40}$/i.test(raw) ? raw : '';
  return code ? `${name}:${code}` : name;
}

/**
 * 경로 목록을 하나씩 읽고(`read`) 검사한다(`check`). `check`가 null이면 있는지만 본다.
 * 빈 경로(null · '')는 세지 않는다 — 옛 실행에는 결과 파일이 없을 수 있다.
 */
export async function tally(
  paths: readonly (string | null | undefined)[],
  read: (rel: string) => Promise<Buffer>,
  check: ((buf: Buffer) => unknown) | null,
  labels?: readonly string[],
): Promise<Tally> {
  const t: Tally = { rows: 0, missing: 0, ok: 0, failed: 0, errors: {}, ...(labels ? { problems: [] } : {}) };
  const flag = (i: number) => {
    if (t.problems && labels?.[i]) t.problems.push(labels[i]);
  };
  for (const [i, rel] of paths.entries()) {
    if (!rel) continue;
    t.rows++;
    let buf: Buffer;
    try {
      buf = await read(rel);
    } catch {
      t.missing++;
      flag(i);
      continue;
    }
    if (!check) {
      t.ok++;
      continue;
    }
    try {
      await check(buf);
      t.ok++;
    } catch (e) {
      t.failed++;
      flag(i);
      const k = errorKey(e);
      t.errors[k] = (t.errors[k] ?? 0) + 1;
    }
  }
  return t;
}

/** `file:/절대/경로` → 절대 경로. 상대 경로·다른 꼴은 null — 점검은 어느 파일을 읽는지 분명해야 한다 */
export function sqliteFileOf(databaseUrl: string | undefined): string | null {
  const m = /^file:(\/[^?]+)$/.exec(databaseUrl ?? '');
  return m ? m[1] : null;
}

/**
 * 종료 코드 — 0 모두 읽힘 · 1 문제 있음. `optional` 무리(꺼진 부서의 양식)는 **숫자만 보이고 종료 코드에 넣지 않는다** —
 * 파일이 없는 것은 OPS-41 정리 뒤에 남은 등록 기록이고(운영에서 27개 중 17개), 쓰지 않는 부서의 양식이 안 채워지는 것은 그 부서를 켤 때의 일이다.
 */
export function verdict(groups: Record<string, Tally>, optional: readonly string[]): 0 | 1 {
  for (const [name, t] of Object.entries(groups)) {
    if (optional.includes(name)) continue;
    if (t.failed > 0 || t.missing > 0) return 1;
  }
  return 0;
}
