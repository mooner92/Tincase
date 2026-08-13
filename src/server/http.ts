// API 공통 — 오류 형식(API-03), no-store(API-05), 속도 제한(API-34).
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

/** 라우트 핸들러 래퍼 — HttpError/AuthError → 규격 응답, 그 외 500 + 상관 ID */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
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
