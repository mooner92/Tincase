// HM-47 · RU-55 — MergeReview 표에 사는 두 가지 승인을 가르는 조건. 의존이 없는 작은 파일로 둔다 —
// 병합본 승인(review.ts)과 위로 가는 사본(rollup/handoff.ts)이 서로를 정적으로 읽으면 고리가 된다.

/**
 * HM-47 — **부서 병합본** 승인만 고르는 조건. MergeReview 표에는 본부장의 본부본 승인(`hq_approve`, RU-55)도
 * 같은 부서 id(본부)로 산다. 이 조건 없이 고르면 본부장이 본부본을 승인한 것이 그 본부 **자체 병합본**의
 * 승인으로 보이고, 같은 판 중복 판정이 엉뚱한 행과 비교된다. 부서 병합본 쪽 질의는 전부 이것을 쓴다.
 */
export const UNIT_REVIEW = { kind: { not: 'hq_approve' } } as const;

/** RU-55 — 본부장의 **본부본** 승인만 */
export const HQ_REVIEW = { kind: 'hq_approve' } as const;

/** 같은 밀리초에 둘이 생겨도 나중 것이 앞에 오도록 — cuid는 한 프로세스 안에서 만든 순서대로 커진다 */
export const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
