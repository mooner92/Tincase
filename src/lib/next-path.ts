// AU-34 (2026-10-10) — 로그인 뒤 **가려던 화면으로** 돌아간다. 순수 함수만 둔다 — 서버(가드·로그인 페이지)와 화면(로그인 폼)이 같이 쓴다.
//
// 왜: 메신저 쪽지의 링크(예: 부서장 검토 요청 → `/{부서}/manage`)를 로그인하지 않은 브라우저(Edge)로 열면 가드가 `/login`으로 보내고,
// 로그인하면 홈(`/`)에 떨어졌다 — 쪽지가 가리킨 화면을 다시 찾아가야 했다. 그래서 가드가 지금 주소를 `next`로 싣고 로그인 폼이 그리로 간다.
//
// ★ 열린 리다이렉트를 만들지 않는다. `next`는 **같은 사이트 안의 경로만** 받는다:
//   `/`로 시작 — 그러나 `//`(다른 호스트) · `/\`(브라우저가 `//`로 읽는다)로 시작하지 않는다 · 제어 문자(탭·줄바꿈 — 브라우저가 지워 `//`가 된다)와
//   역슬래시가 어디에도 없다 · `/login`(돌고 돈다)과 `/api/`(화면이 아니다)가 아니다 · 512자 이하.

/** 페이지가 「지금 어느 주소인가」를 아는 머리 — `src/proxy.ts`가 붙인다(요청이 보낸 같은 이름의 머리는 덮어쓴다) */
export const PATH_HEADER = 'x-tincase-path';

const MAX_NEXT = 512;

/** 같은 사이트 안의 경로면 그대로, 아니면 null */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_NEXT) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/') || raw.startsWith('/api/')) return null;
  return raw;
}

/** 로그인 화면 주소 — 돌아갈 곳이 있으면 `?next=`로 싣는다. 홈(`/`)은 싣지 않는다(로그인하면 어차피 홈이다) */
export function loginHref(path: string | null | undefined): string {
  const next = safeNextPath(path);
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** proxy가 머리에 실을 값 — 경로 + 쿼리. 화면 이동(RSC) 요청의 `_rsc` 꼬리는 뺀다(주소창의 주소가 아니다) */
export function requestPath(url: URL): string {
  const q = new URLSearchParams(url.search);
  q.delete('_rsc');
  const s = q.toString();
  return s ? `${url.pathname}?${s}` : url.pathname;
}
