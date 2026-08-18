// PG-04 — 페이지용 스코프 해석. 요청당 1회 (React cache).
// 실패를 throw가 아니라 판별 유니온으로 돌려서 페이지가 안내/리다이렉트를 고르게 한다.
import { cache } from 'react';
import { headers } from 'next/headers';
import { requireScope, resolveTargetDivision, HttpError, type Scope } from './authz';
import { AuthError } from './auth';
import type { Division } from '@prisma/client';

export type PageScope =
  | { ok: true; scope: Scope }
  | { ok: false; code: 'unauthenticated' | 'not_registered' | 'division_not_onboarded'; message: string };

export const getPageScope = cache(async (): Promise<PageScope> => {
  const h = await headers();
  try {
    return { ok: true, scope: await requireScope(h) };
  } catch (e) {
    if (e instanceof HttpError && (e.code === 'not_registered' || e.code === 'division_not_onboarded')) {
      return { ok: false, code: e.code, message: e.message };
    }
    if (e instanceof AuthError) {
      return { ok: false, code: 'unauthenticated', message: '로그인이 필요합니다.' };
    }
    throw e;
  }
});

/**
 * 보호 페이지의 표준 진입점.
 * - 미인증 → /login
 * - 초기 비밀번호 미변경 → /password (AU-22)
 * 그 외 오류(미등록·미온보딩)는 안내 화면으로 내보내도록 PageScope를 그대로 돌려준다.
 */
export async function requirePageScope(): Promise<PageScope> {
  return getPageScope();
}

/**
 * 부서 페이지 공통 진입점 — 레이아웃과 페이지가 **같은 부서**를 보게 한다.
 * 요청당 1회만 계산된다 (React cache).
 */
export const getDivisionView = cache(async (slugParam: string): Promise<DivisionView> => {
  const ps = await getPageScope();
  if (!ps.ok) throw new HttpError(401, 'unauthenticated', '로그인이 필요합니다.');
  const { division, isOwn, redirectTo } = await resolveTargetDivision(ps.scope, decodeURIComponent(slugParam));
  return {
    scope: ps.scope,
    division,
    isOwn,
    redirectTo,
    // 관리 권한: 내 부서의 담당자이거나, 전 부서 열람 권한자
    canManage: (isOwn && ps.scope.isLead) || ps.scope.readAll,
    // 제출은 내 부서에서만 (DM-12 — 업로드 부서는 신원에서 도출된다).
    // 명단(onRoster)은 **집계 대상**이지 제출 권한이 아니다 (DM-16)
    canSubmit: isOwn,
    // TACP-14 — 남의 제출물 삭제는 operator만. lead·coordinator는 읽기까지다.
    // canManage와 **일부러 분리한다** — 합치면 담당자에게 삭제권이 딸려간다
    canDeleteAny: ps.scope.user.isOperator,
  };
});

export interface DivisionView {
  scope: Scope;
  division: Division;
  isOwn: boolean;
  redirectTo: string | null;
  canManage: boolean;
  canSubmit: boolean;
  /** TACP-14 — 남의 제출물 삭제 (operator 전용) */
  canDeleteAny: boolean;
}
