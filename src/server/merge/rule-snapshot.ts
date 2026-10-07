// DM-13 · CP-107 — 병합 규칙 스냅샷: 실행이 **무엇을 박제하나**와 **지금 설정과 다른가**를 한 곳에서 정한다.
//
// 규칙을 저장해도 이미 만든 병합본은 그대로다 — 규칙 저장은 병합을 다시 돌리지 않는다. 그런데 화면이 그걸
// 말하지 않으면 「설정이 안 먹는다」가 된다. 비교하려면 실행이 남긴 것과 지금 설정을 **같은 목록**으로 봐야 한다.
// 박제하는 곳(run.ts)과 비교하는 곳(수합 관리)이 목록을 따로 들고 있으면, 새 설정이 생길 때 한쪽에서 빠진다.
import { toPlan, type RuleFields } from './rules';
import { parseEmphasisWords } from '@/lib/emphasis-marker';

export interface SnapshotFields extends RuleFields {
  /** HM-38 — 괄호 낱말을 떼고 파란색으로 바꾼다. 문서가 달라지므로 스냅샷에 든다 */
  emphasisWords: string;
}

/** 실행 시점에 박제하는 설정 (`trigger`는 실행이 붙인다) */
export function ruleSnapshotOf(d: SnapshotFields) {
  return {
    categories: d.mergeCategories,
    dedupe: d.mergeDedupe,
    dropNotes: d.mergeDropNotes,
    guidance: d.mergeRuleText,
    // HM-48 — 줄 순서를 바꾸는 설정. 빠지면 「왜 이 순서」의 답이 스냅샷에 없다
    sort: d.mergeSort,
    undated: d.mergeUndated,
    emphasisWords: d.emphasisWords,
  };
}

type Snapshot = Partial<Record<keyof ReturnType<typeof ruleSnapshotOf>, unknown>>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/**
 * CP-107 — 이 스냅샷으로 만든 병합본 **뒤에** 바뀐 설정. 이름은 부서 설정 카드 제목이다(담당자가 찾아갈 곳).
 *
 * 비교는 엔진과 **같은 해석**(`toPlan`)으로 한다. 날 문자열로 비교하면 「AI, 홍보」와 「AI-홍보」가 다르다고 하고,
 * 제출자 순인데 「날짜 없는 줄」만 바꾼 것도 바뀌었다고 한다 — 문서는 그대로인데 [다시 병합]을 부른다.
 *
 * **스냅샷에 없는 키는 「모름」이다.** `sort`·`undated`는 생기기 전 실행이 지금의 기본값(제출자 순)과 같게
 * 돌았으므로 기본값으로 읽는다(HM-48 — 바이트 단위로 같다). `emphasisWords`는 그때 무엇이었는지 알 수 없으므로
 * 비교하지 않는다. 깨진 스냅샷도 비교하지 않는다 — 모르는 것을 「바뀜」이라고 하면 덮지 않아도 될 수정을 덮게 한다.
 */
export function rulesChangedSince(snapshotJson: string | null | undefined, now: SnapshotFields): string[] {
  let snap: Snapshot;
  try {
    const v = JSON.parse(snapshotJson ?? '') as unknown;
    if (!v || typeof v !== 'object') return [];
    snap = v as Snapshot;
  } catch {
    return [];
  }
  const then = toPlan({
    mergeCategories: str(snap.categories) ?? now.mergeCategories,
    mergeDedupe: bool(snap.dedupe) ?? now.mergeDedupe,
    mergeDropNotes: bool(snap.dropNotes) ?? now.mergeDropNotes,
    mergeRuleText: str(snap.guidance) ?? now.mergeRuleText,
    mergeSort: str(snap.sort) ?? '', // 없으면 기본값(제출자 순)으로 — toPlan이 좁힌다
    mergeUndated: str(snap.undated) ?? '',
  });
  const cur = toPlan(now);

  const changed: string[] = [];
  if (then.categories.join('\n') !== cur.categories.join('\n')) changed.push('분류 순서');
  // 「날짜 없는 줄」은 일자 순일 때만 문서에 닿는다
  if (then.sort !== cur.sort || (cur.sort === 'date' && then.undated !== cur.undated)) changed.push('정렬');
  if (then.dedupe !== cur.dedupe || then.dropEmptyNotes !== cur.dropEmptyNotes) changed.push('병합 동작');
  if (then.guidance !== cur.guidance) changed.push('병합 지침');
  const words = str(snap.emphasisWords);
  if (words !== undefined && parseEmphasisWords(words).join('\n') !== parseEmphasisWords(now.emphasisWords).join('\n')) {
    changed.push('공유 표시 낱말');
  }
  return changed;
}
