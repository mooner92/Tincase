// PG-04 — 페이지용 스코프 해석. 요청당 1회 (React cache).
// 실패를 throw가 아니라 판별 유니온으로 돌려서 레이아웃이 안내 화면을 그리게 한다.
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
      return { ok: false, code: 'unauthenticated', message: '인증 정보가 없습니다. 다시 로그인해 주세요.' };
    }
    throw e;
  }
});
