// API 공통 — 오류 형식(API-03), no-store(API-05), 속도 제한(API-34), 같은 출처(API-56 · AU-33).
import { NextResponse } from 'next/server';
import { AuthError } from './auth';
import { HttpError } from './authz';
import { logger } from './logger';
import { randomUUID } from 'node:crypto';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: NO_STORE });
}

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status, headers: NO_STORE });
}

// ── AU-33 — 상태를 바꾸는 요청은 같은 출처에서만 ─────────────────
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * AU-33 — 이 요청이 **다른 출처의 페이지**가 보낸 것인가.
 *
 * 쿠키는 포트를 보지 않아서(RU-42) 같은 서버 다른 포트의 페이지도 `SameSite=Lax`로는 「같은 사이트」다.
 * 그 페이지가 `fetch(..., { credentials: 'include' })`로 POST하면 방문자 이름으로 제출·초기화가 일어난다.
 *
 * 브라우저는 `Sec-Fetch-Site`를 HTTPS·localhost에만 보낸다 — 사내망 `http://<IP>:11111`에는 없다.
 * 그때는 POST마다 오는 `Origin`의 host를 `Host`와 맞춰 본다. 둘 다 없으면 브라우저가 아니다(스크립트·curl·테스트) —
 * 쿠키를 훔쳐 쓰는 공격은 브라우저를 통해서만 되므로 통과시킨다. `X-Forwarded-Host`는 앱이 믿지 않는 헤더라 보지 않는다.
 */
export function isCrossOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  if (origin === 'null') return true; // 샌드박스 iframe·교차 리다이렉트 — 출처를 숨긴 요청은 받지 않는다
  let host = req.headers.get('host');
  if (!host) {
    try {
      host = new URL(req.url).host;
    } catch {
      return true;
    }
  }
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true; // 읽을 수 없는 Origin은 같은 출처라고 믿을 근거가 없다
  }
}

/**
 * ST-04 — 업로드는 **본문을 읽기 전에** 크기를 본다. `req.formData()`가 먼저 돌면 그 전에 본문 전체가 메모리에 올라온다.
 * 멀티파트 머리·경계와 곁들인 필드 몫으로 1MB를 더 준다 — 한도 근처는 읽은 뒤의 422가 같은 문구로 답한다.
 */
const MULTIPART_SLACK = 1024 * 1024;
export function rejectOversizedBody(req: Request, maxBytes: number): void {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > maxBytes + MULTIPART_SLACK) {
    throw new HttpError(413, 'too_large', `파일이 너무 큽니다 (최대 ${Math.floor(maxBytes / 1024 / 1024)}MB).`);
  }
}

/** 라우트 핸들러 래퍼 — HttpError/AuthError → 규격 응답, 그 외 500 + 상관 ID */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    // AU-33 — 인증·본문보다 먼저. 남의 페이지가 보낸 요청이면 신원을 풀어 볼 이유도 없다
    const req = args[0];
    if (req instanceof Request && isCrossOrigin(req)) {
      logger.warn({ method: req.method, url: req.url, origin: req.headers.get('origin'), site: req.headers.get('sec-fetch-site') }, 'cross-origin request rejected');
      return jsonError(403, 'cross_origin', '다른 사이트에서 보낸 요청은 받지 않습니다. Tincase 화면에서 다시 시도해 주세요.');
    }
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.code, e.message);
      if (e instanceof AuthError) return jsonError(401, 'unauthenticated', '인증이 필요합니다.');
      const reqId = randomUUID().slice(0, 6);
      logger.error({ reqId, err: e instanceof Error ? e.stack : String(e) }, 'unhandled error');
      return jsonError(500, 'internal', `일시적인 오류입니다. 다시 시도해 주세요. (오류 코드: ${reqId})`);
    }
  };
}

// ── API-34 — 메모리 토큰 버킷 ────────────────────────────────
const buckets = new Map<string, { tokens: number; ts: number }>();

export function rateLimit(key: string, limit: number, perMs: number): void {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: limit, ts: now };
  b.tokens = Math.min(limit, b.tokens + ((now - b.ts) / perMs) * limit);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new HttpError(429, 'rate_limited', '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.');
  }
  b.tokens -= 1;
  buckets.set(key, b);
}

/**
 * 시험 전용 — 버킷을 비운다. 한 파일 안의 시험들이 같은 사람으로 승인을 여러 번 하면(tests/rollup-auto — 본부장 18번)
 * 분당 10번 한도에 걸려 429가 난다. 걸리는지는 파일이 얼마나 빨리 도느냐에 달려 있어(양식 픽스처가 있는 체크아웃 · 병합 줄을 합친 뒤
 * 빨라졌다) 시험이 그날그날 달라진다. 한도 자체를 보는 시험은 따로 있다
 */
export function resetRateLimitsForTest(): void {
  buckets.clear();
}
