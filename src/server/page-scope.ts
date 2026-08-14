// PG-04 — 페이지용 스코프 해석. 요청당 1회 (React cache).
// 실패를 throw가 아니라 판별 유니온으로 돌려서 페이지가 안내/리다이렉트를 고르게 한다.
import { cache } from 'react';
import { headers } from 'next/headers';
import { requireScope, HttpError, type Scope } from './authz';
import { AuthError } from './auth';

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
