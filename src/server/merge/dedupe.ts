// HM-24 순수 계층 — 중복 판정 로직.
//
// 모델 호출(model.ts)과 분리한 이유: 이 파일이 **모델을 믿지 않는 근거**이기 때문이다.
// env·네트워크가 끼면 "하네스가 실제로 작동하는가"를 단위로 확인할 수 없다.
// 여기에는 외부 의존성이 하나도 없다.

export interface MergeRow {
  id: number;
  who: string;
  content: string;
  date: string;
  place: string;
  attendee: string;
}

export interface RowGroup {
  ids: number[];
  reason: string;
}

/**
 * 비교용 정규화 — 공백·문장부호·괄호주석을 털어낸다.
 * "정기간행물 발간 진행(10건)" 두 건은 이것만으로 같아진다 (실측 데이터에 실제로 있었다).
 */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/\([^)]*\)/g, '') // 괄호 주석 — (2건), (계속) 등
    .replace(/[\s·,./\-–—~"'“”‘’()[\]]/g, '')
    .toLowerCase();
}

/**
 * 결정론 중복 탐지 — 정규화 후 **완전히 같은** 행만 묶는다.
 *
 * 모델보다 먼저 돌린다. 명백한 중복에 모델을 쓸 이유가 없고, 모델이 죽어도 이만큼은
 * 항상 잡힌다. 여기서 더 과감해지지 않는 이유는 **잘못 묶는 게 못 묶는 것보다 나쁘기
 * 때문**이다 — 두 사람의 다른 업무가 한 줄로 합쳐지면 하나는 문서에서 사라진다.
 */
export function exactDuplicates(rows: readonly MergeRow[]): RowGroup[] {
  const byKey = new Map<string, MergeRow[]>();
  for (const r of rows) {
    const key = normalizeForCompare(r.content);
    if (!key) continue; // 빈 내용은 묶지 않는다 — 빈 행끼리 합쳐지면 표가 무너진다
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  return [...byKey.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({
      ids: list.map((r) => r.id),
      reason: `내용이 같습니다 (${[...new Set(list.map((r) => r.who))].join('·')})`,
    }));
}

/**
 * 모델이 낸 중복 묶음 검증.
 *
 * 모델에게 **전체 분할**을 시키지 않는다. 23행짜리 실측에서 14B가 id 하나를 두 번
 * 내보내 전체가 폐기됐다. 어려운 과제를 내고 하네스로 막는 것보다 **쉬운 과제를 내는 게
 * 낫다** — "중복인 것만" 받고 나머지 단독 행은 코드가 채운다. 모델이 빠뜨려도 손실이 없다.
 *
 * 남은 확인은 셋뿐이다: 있는 id인가 · 두 묶음에 겹치지 않는가 · 2개 이상인가.
 */
export function validateGroups(rows: readonly MergeRow[], groups: readonly RowGroup[]): string | null {
  const expected = new Set(rows.map((r) => r.id));
  const seen = new Set<number>();
  for (const g of groups) {
    if (!g || !Array.isArray(g.ids)) return 'ids가 배열이 아닙니다';
    if (g.ids.length < 2) return `중복 묶음에 행이 ${g.ids.length}개뿐입니다`;
    for (const id of g.ids) {
      if (!Number.isInteger(id)) return `id가 정수가 아닙니다 (${String(id)})`;
      if (!expected.has(id)) return `없는 id가 있습니다 (${id})`;
      if (seen.has(id)) return `id가 두 묶음에 겹칩니다 (${id})`;
      seen.add(id);
    }
  }
  return null;
}

/**
 * 결정론 묶음(우선) + 모델 묶음.
 * 이미 배정된 id가 하나라도 들어 있는 모델 묶음은 버린다 — 어느 쪽이 맞는지 모르는
 * 상태의 추측이라, 안 묶는 편이 안전하다.
 */
export function mergeDuplicateSets(base: readonly RowGroup[], extra: readonly RowGroup[]): RowGroup[] {
  const taken = new Set<number>();
  const out: RowGroup[] = [];
  for (const g of base) {
    out.push(g);
    g.ids.forEach((id) => taken.add(id));
  }
  for (const g of extra) {
    if (g.ids.some((id) => taken.has(id))) continue;
    out.push(g);
    g.ids.forEach((id) => taken.add(id));
  }
  return out;
}

/** 중복 묶음 + 나머지 단독 행 → 전체 분할. 순서는 입력 순서를 따른다 (ABS-6). */
export function expandToPartition(rows: readonly MergeRow[], duplicates: readonly RowGroup[]): RowGroup[] {
  const inGroup = new Map<number, RowGroup>();
  for (const g of duplicates) for (const id of g.ids) inGroup.set(id, g);

  const out: RowGroup[] = [];
  const emitted = new Set<RowGroup>();
  for (const r of rows) {
    const g = inGroup.get(r.id);
    if (!g) {
      out.push({ ids: [r.id], reason: '' });
      continue;
    }
    if (emitted.has(g)) continue; // 묶음은 첫 등장 위치에 한 번만
    emitted.add(g);
    out.push({ ids: [...g.ids].sort((a, b) => a - b), reason: String(g.reason ?? '').slice(0, 200) });
  }
  return out;
}
