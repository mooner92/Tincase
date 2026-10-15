// LE-21 — 병합본에 안 들어간 최신 제출을 둘로 가른다. 순수 함수 — 서버(붙이기)와 화면(안내)이 같은 판정을 쓴다.
//
//   늦게 낸 사람(candidates) — 그 사람의 어느 판도 병합본에 안 들어갔다 → 맨 뒤에 붙인다
//   고쳐 낸 사람(revised)    — 앞선 판은 들어갔는데 최신 판은 안 들어갔다 → 붙이지 않는다(앞서 들어간 줄과 겹쳐 같은 일이 두 번 나온다). [다시 병합]
//
// `used` = `MergeRun.sourceIds`. 고친 판(v+1)은 id가 다르므로 이 둘을 가르는 것이 「그 사람의 어떤 판이든 들어갔나」다.
export interface LateSub {
  id: string;
  userId: string;
  isLatest: boolean;
}

export function splitLate<T extends LateSub>(subs: readonly T[], used: ReadonlySet<string>): { candidates: T[]; revised: T[] } {
  const included = new Set(subs.filter((s) => used.has(s.id)).map((s) => s.userId));
  const candidates: T[] = [];
  const revised: T[] = [];
  for (const s of subs) {
    if (!s.isLatest || used.has(s.id)) continue;
    (included.has(s.userId) ? revised : candidates).push(s);
  }
  return { candidates, revised };
}

/** CP-134 — 안내 줄의 이름 목록. 길면 앞의 몇 명과 「외 n명」 */
export function nameList(names: readonly string[], max = 4): string {
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} 외 ${names.length - max}명`;
}

/** CP-134 — [맨 뒤에 붙이기] 성공 뒤 한 줄: 누가 · 표별 몇 줄. 읽지 못해 건너뛴 사람이 있으면 그 수까지 (LE-23) */
export function appendedNote(r: {
  appended: { name: string; achievements: number; plans: number; notes: number }[];
  skipped?: unknown[];
}): string {
  const sum = (k: 'achievements' | 'plans' | 'notes') => r.appended.reduce((n, a) => n + a[k], 0);
  const notes = sum('notes');
  const skipped = r.skipped?.length ?? 0;
  return (
    `${nameList(r.appended.map((a) => a.name))} 맨 뒤에 붙였어요 · 실적 ${sum('achievements')}줄 · 계획 ${sum('plans')}줄` +
    (notes > 0 ? ` · 특이 ${notes}줄` : '') +
    (skipped > 0 ? ` · ${skipped}명은 파일을 읽지 못해 건너뜀` : '')
  );
}
