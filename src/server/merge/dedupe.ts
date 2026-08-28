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
  /**
   * HM-36 — 원문이 **글자까지 똑같은가.**
   *
   * 정규화가 괄호를 털어내므로 「…(유튜브 1건, SNS 1건)」과 「…(유튜브 1건)」이 같은 묶음이
   * 된다. 묶는 것 자체는 맞지만 **「내용이 같습니다」라고 말하면 거짓**이고, 담당자는
   * 확인할 필요가 없다고 읽고 넘어간다. 실제로 그렇게 「SNS 1건」이 문서에서 사라졌다.
   *
   * 모델이 낸 묶음에는 없다(undefined) — 모델은 애초에 «같은 업무»를 묶지 «같은 글자»를
   * 묶지 않으므로, 모르는 것을 참으로 적지 않는다.
   */
  identical?: boolean;
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
    .map((list) => {
      const who = [...new Set(list.map((r) => r.who))].join('·');
      // 정규화 전 원문이 하나뿐이면 진짜로 같은 것이고, 아니면 괄호·기호만 다른 것이다
      const identical = new Set(list.map((r) => r.content.trim())).size === 1;
      return {
        ids: list.map((r) => r.id),
        identical,
        reason: identical ? `내용이 같습니다 (${who})` : `괄호·기호가 다릅니다 (${who})`,
      };
    });
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

/** 비교용 토큰 — 괄호 주석·문장부호를 털고 1글자 토큰은 버린다 (조사·접속사 노이즈) */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .replace(/\([^)]*\)/g, '')
      .split(/[\s·,./\-–—~"'“”‘’()[\]]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2),
  );
}

/**
 * 짧은 쪽 토큰이 긴 쪽에 얼마나 들어 있는가 (0~1).
 * 중복이라면 **한쪽이 다른 쪽을 상당 부분 포함**해야 한다는 상식을 수치로 만든 것.
 */
export function containmentRatio(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size === 0) return 0;
  let hit = 0;
  for (const t of small) if (large.has(t)) hit++;
  return hit / small.size;
}

/**
 * 모델이 낸 묶음 중 **글자가 너무 안 겹치는 것**을 버린다.
 *
 * 실측 근거 (Qwen3.5-9B):
 *   버릴 것  "7월 언론보도 홈페이지 등록" + "오늘의 환경뉴스 발송 및 언론 모니터링"  → 0.00
 *   남길 것  "보도자료 배포(2건) 및 인포그래픽 제작" + "인포그래픽 제작"            → 1.00
 *   남길 것  "AI연구용 … 시스템 고도화" + "AI연구용 …  고도화 참석"                 → 1.00
 *
 * 모델이 "언론"이라는 공통 주제만 보고 다른 업무를 합치려 한 사례다. 주제가 같은 것과
 * 같은 업무인 것은 다르고, 그 차이는 결국 **같은 말을 쓰는지**로 드러난다.
 * 의미만으로 판단하는 층(모델) 위에 글자로 확인하는 층을 하나 둔다.
 */
export const CONTAINMENT_FLOOR = 0.5;

export function dropWeakGroups(
  rows: readonly MergeRow[],
  groups: readonly RowGroup[],
  floor = CONTAINMENT_FLOOR,
): { kept: RowGroup[]; dropped: { ids: number[]; ratio: number }[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kept: RowGroup[] = [];
  const dropped: { ids: number[]; ratio: number }[] = [];

  for (const g of groups) {
    const texts = g.ids.map((id) => byId.get(id)?.content ?? '');
    // 묶음 안의 모든 쌍이 기준을 넘어야 한다 — 한 쌍이라도 엉뚱하면 묶음 전체가 의심스럽다
    let worst = 1;
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        worst = Math.min(worst, containmentRatio(texts[i], texts[j]));
      }
    }
    if (worst >= floor) kept.push(g);
    else dropped.push({ ids: g.ids, ratio: worst });
  }
  return { kept, dropped };
}
