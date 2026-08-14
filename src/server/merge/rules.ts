// HM-18 — 부서 병합 규칙.
//
// **문법을 만들지 않는다.** 초안에는 `순서:` `빈행유지:` 같은 지시어 문법이 있었지만
// 실제 부서가 주고받은 규칙은 이 두 줄이 전부였다:
//
//     순서: AI-홍보(정간물 포함)-시스템-도서관
//     날짜: 상시업무는 공란, 특정되는 업무만 작성
//
// 배워야 하는 문법·틀릴 수 있는 문법을 만들 이유가 없다.
// 남은 것은 설정 3개와 자연어 지침 1개다.

export interface MergePlan {
  /** 분류 순서 (예: AI · 홍보 · 시스템 · 도서관). 비면 제출자 순서를 그대로 쓴다 */
  categories: string[];
  /** 중복 묶기 */
  dedupe: boolean;
  /** 특이사항이 비면 3번 표를 지운다 (실제 제출물의 관례) */
  dropEmptyNotes: boolean;
  /** 담당자가 쓴 자연어 지침 — 모델에 그대로 전달된다 */
  guidance: string;
}

export interface RuleFields {
  mergeCategories: string;
  mergeDedupe: boolean;
  mergeDropNotes: boolean;
  mergeRuleText: string;
}

/** 분류 이름은 표시용이라 길 필요가 없다. 너무 길면 모델 프롬프트만 오염된다 */
const MAX_CATEGORY_LEN = 20;
const MAX_CATEGORIES = 12;

/**
 * 분류 순서 문자열 → 배열.
 * 쉼표·가운뎃점·하이픈 어느 것으로 나눠도 받는다 — 부서가 보낸 원문이
 * "AI-홍보(정간물 포함)-시스템-도서관"이었다. 사람에게 구분자를 외우게 하지 않는다.
 */
export function parseCategories(raw: string): string[] {
  return raw
    .split(/[,·\-–—/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, MAX_CATEGORY_LEN))
    .filter((s, i, arr) => arr.indexOf(s) === i) // 중복 제거, 순서 유지
    .slice(0, MAX_CATEGORIES);
}

export function toPlan(d: RuleFields): MergePlan {
  return {
    categories: parseCategories(d.mergeCategories),
    dedupe: d.mergeDedupe,
    dropEmptyNotes: d.mergeDropNotes,
    guidance: d.mergeRuleText.trim(),
  };
}

/**
 * 제출자 정렬 — 분류를 안 쓰는 부서를 위한 기본 순서.
 * 명단·순서는 운영자 소관이므로(TACP-3) `sortOrder`를 그대로 따른다.
 * 규칙 텍스트에 사람 이름을 또 적게 하지 않는다 — 두 곳에 적으면 반드시 어긋난다.
 */
export function orderPeople<T extends { name: string; sortOrder: number }>(people: T[]): T[] {
  return [...people].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
}
