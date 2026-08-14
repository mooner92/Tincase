// POST /api/auth/logout — 세션 종료 (사내망 경로). Cloudflare 경로는 CF 로그아웃 사용 (AU-08)
import { NextRequest, NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { destroySession, SESSION_COOKIE } from '@/server/session';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(cookie);
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', expires: new Date(0), httpOnly: true });
  return res;
});
