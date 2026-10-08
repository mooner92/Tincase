// CP-114 — 병합본 드로어가 **무엇을 그리나**. 화면 밖에서 시험할 수 있게 순수 함수로 둔다(CP-T100).
//
// 부서원 홈의 [병합본]은 누구에게나 읽기 전용이다(`view`). 담당자·부서장이 홈에서 열어도 그렇다 —
// 고치기·승인은 수합 관리에서 한다. 부서장에게 [승인]이 홈에도 생기면 승인하는 곳이 둘이 되고,
// 승인은 곧 위로 넘기는 일이라(ADR-0015) 어디서 눌렀는지가 흐려진다(home-spec D10).

export type DrawerVariant = 'edit' | 'view';

export interface DrawerReviewLike {
  changedAfter: boolean;
}

export interface DrawerControls {
  /** 손잡이·칸 편집·줄 지우기·「공유」 켜고 끄기·[수정 저장] */
  edit: boolean;
  /** 승인 띠 — 「승인 완료 · 이름」·「승인 전」 */
  reviewBand: boolean;
  /** [고칠 것 없음 · 승인] */
  approve: boolean;
}

export function drawerControls(
  variant: DrawerVariant,
  canEdit: boolean,
  data: { review?: DrawerReviewLike | null; canApprove?: boolean } | null,
): DrawerControls {
  // 서버가 `canApprove=true`·`review`를 보내도(부서장·담당자에게는 보낸다 — API-58) view에서는 그리지 않는다 — 판정 기준은 변형이다
  if (variant === 'view') return { edit: false, reviewBand: false, approve: false };
  return {
    edit: canEdit,
    reviewBand: !!data && (!!data.review || !!data.canApprove),
    approve: !!data?.canApprove && (!data.review || data.review.changedAfter),
  };
}
