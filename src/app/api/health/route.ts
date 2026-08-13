// GET /api/health — 무인증 (API-31~33). 민감정보 노출 금지.
import { prisma } from '@/server/db';
import { storageWritable } from '@/server/storage';
import { currentWeek, toKstIso } from '@/lib/week';
import { NextResponse } from 'next/server';
import { statfsSync } from 'node:fs';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  const checks: Record<string, 'ok' | 'fail' | string> = {};
  let ok = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
    ok = false;
  }

  checks.storage = (await storageWritable()) ? 'ok' : 'fail';
  if (checks.storage === 'fail') ok = false;

  try {
    const n = await prisma.template.count({ where: { isActive: true } });
    checks.template = n > 0 ? 'ok' : 'fail'; // OPS-05: 양식 없으면 비정상
    if (n === 0) ok = false;
  } catch {
    checks.template = 'fail';
    ok = false;
  }

  // OPS-19 — 루트 디스크 감시 (실측 98% 사용 서버). 5G 미만이면 경고
  try {
    const st = statfsSync('/');
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
    checks.rootDisk = freeGb < 5 ? `warn: ${freeGb.toFixed(1)}G free` : 'ok';
  } catch {
    checks.rootDisk = 'unknown';
  }

  const w = currentWeek();
  return NextResponse.json(
    {
      ok,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      checks,
      now: toKstIso(new Date()),
      currentSlot: w.label, // 주차 라벨만 — 사용자·부서 정보 없음 (API-33)
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
