// PG-04 — 페이지용 스코프 해석. 요청당 1회 (React cache).
// 실패를 throw가 아니라 판별 유니온으로 돌려서 페이지가 안내/리다이렉트를 고르게 한다.
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
 * AU-22 — **보호 페이지의 표준 진입점.** 여기서 실제로 내보낸다.
 *
 *   미인증            → `/login`
 *   초기 비밀번호 미변경 → `/password?first=1`
 *   그 외(미등록·미온보딩) → PageScope를 그대로 돌려준다 (페이지가 안내 화면을 고른다)
 *
 * v1.23.1까지 이 함수는 **위 주석대로 동작하지 않았다** — 그냥 `getPageScope()`를
 * 돌려주기만 했고, 실제 리다이렉트는 페이지 11곳에 각각 복사돼 있었다.
 * 그리고 갈라졌다: `/guide`에만 빠져서, 비밀번호를 초기화당한 사람이 그 페이지는
 * 그대로 볼 수 있었다 (실측 확인 2026-08-26).
 *
 * 판정이 여러 곳에 복사되면 반드시 갈라진다 — TACP-12가 라우트에 대해 말하는 것과
 * 같은 이야기다. 그래서 판정을 **여기 하나로** 모으고, 페이지는 이 함수만 부른다.
 * 누락은 AU-T39가 소스에서 잡는다.
 */
export async function requirePageScope(): Promise<PageScope> {
  const ps = await getPageScope();
  if (!ps.ok) {
    if (ps.code === 'unauthenticated') redirect('/login');
    return ps; // 미등록·미온보딩은 안내 화면이 낫다 — 리다이렉트하면 이유를 못 읽는다
  }
  if (ps.scope.user.mustChangePassword) redirect('/password?first=1');
  return ps;
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
    canManage: (isOwn && ps.scope.isManager) || ps.scope.readAll,
    // 제출은 내 부서에서만 (DM-12 — 업로드 부서는 신원에서 도출된다).
    // 명단(onRoster)은 **집계 대상**이지 제출 권한이 아니다 (DM-16)
    canSubmit: isOwn,
    /*
      TACP-15·16 — 병합본 **수정** 권한. API(`PUT /api/division/merged/content`)가
      `requireOwnManager`(lead·head + 신원의 부서)를 요구하므로 화면도 **똑같이** 판정한다.

      `canManage`를 쓰면 안 된다 — 거기엔 `readAll`(총괄·운영자)이 섞여 있어서
      총괄담당에게 수정 버튼이 보이는데 누르면 404가 난다. 못 하는 행동의 버튼은
      아예 렌더하지 않는다 (TACP-9).
    */
    canEditMerged: isOwn && ps.scope.isManager,
    /*
      TACP-17 — 병합본 **작성자** 열람. 부서장이 검토하다 잘못된 내용을 보면
      다음 행동은 «그 사람과 이야기하는 것»이라 누가 썼는지가 필요하다.
      부서원(member)에게는 서버가 **아예 내려보내지 않는다** — 화면에서 숨기는 게 아니다.
    */
    canSeeAuthors: (isOwn && ps.scope.isManager) || ps.scope.readAll,
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
  /** TACP-15·16 — 병합본 수정 (lead·head + 내 부서). 열람과 다르다 */
  canEditMerged: boolean;
  /** TACP-17 — 병합본 각 행의 **작성자** 열람 (lead·head·readAll) */
  canSeeAuthors: boolean;
  /** TACP-14 — 남의 제출물 삭제 (operator 전용) */
  canDeleteAny: boolean;
}
