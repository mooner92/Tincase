// AU-34 (2026-10-10) — 화면 요청에 「지금 어느 주소인가」를 머리 하나로 붙인다. 하는 일은 그것뿐이다 — 인증·권한은 보지 않는다(그건 authz.ts).
//
// 왜 여기인가: 서버 컴포넌트(페이지·레이아웃)는 자기 주소를 모른다. 부서 레이아웃은 `/{부서}` 아래 모든 화면을 감싸는데 받는 것은 슬러그뿐이라,
// 로그인 가드가 「로그인 뒤 돌아갈 곳」(`/login?next=`)을 만들 수 없었다 — 메신저 쪽지의 링크를 로그인 없이 열면 로그인 뒤 홈에 떨어졌다.
// 같은 이름의 머리를 요청이 보내도 여기서 덮어쓴다. 그 값을 믿는 곳은 `next`를 만드는 가드뿐이고, 그것도 같은 사이트 경로만 받는다(`safeNextPath`).
import { NextResponse, type NextRequest } from 'next/server';
import { PATH_HEADER, requestPath } from '@/lib/next-path';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, requestPath(request.nextUrl));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 화면만 — API · Next 내부 파일 · 점이 든 경로(정적 파일: /brand/*.svg · /icon.svg 등)는 지나가지 않는다
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
