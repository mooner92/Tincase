// GET /api/health — 무인증 (API-31~33). 민감정보 노출 금지.
import { prisma } from '@/server/db';
import { storageWritable } from '@/server/storage';
import { templateStates } from '@/server/template-state';
import { currentWeek, toKstIso } from '@/lib/week';
import { NextResponse } from 'next/server';
import { statfsSync } from 'node:fs';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  const checks: Record<string, 'ok' | 'fail' | string> = {};
  /** OPS-19 — 지금 고장은 아니지만 사람이 봐야 하는 것. `ok`를 뒤집지 않는다 */
  const warnings: string[] = [];
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

  /*
   * OPS-05 · OPS-41 — 양식은 **파일까지** 본다. 예전에는 `Template` 행 수만 셌다 — 2026-09-10처럼 30개 부서에
   * 행은 있는데 파일이 한 부서 것뿐인 상태에서도 `ok`라고 답했을 판정이다. 그러면 14:01 자동 병합이 실패하는데
   * health는 초록이다. 부서 이름은 적지 않는다 — 누구나 부르는 주소다(API-33). 몇 곳인지만.
   */
  try {
    const active = await prisma.division.findMany({ where: { isActive: true }, select: { id: true } });
    if (active.length === 0) {
      // 아직 아무 부서도 켜지 않은 서버 — 양식이 하나라도 있으면 된다 (예전 판정)
      const n = await prisma.template.count({ where: { isActive: true } });
      checks.template = n > 0 ? 'ok' : 'fail';
    } else {
      const states = await templateStates(active.map((d) => d.id));
      const bad = [...states.values()].filter((v) => v !== 'ok').length;
      checks.template = bad === 0 ? 'ok' : `fail: ${bad} active division(s) without template file`;
    }
    if (checks.template !== 'ok') ok = false;
  } catch {
    checks.template = 'fail';
    ok = false;
  }

  /*
   * OPS-19 — 루트 디스크. 1~5G는 경고만(`warnings`) — 이 서버는 평소 97~99%라 그때마다 503이면 도커 상태가
   * 늘 unhealthy가 되어 정말 위험할 때를 못 가린다. 1G 밑은 SQLite 저널·로그 쓰기가 실패할 수 있어 숨기지 않는다.
   */
  try {
    const st = statfsSync('/');
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
    const free = `${freeGb.toFixed(1)}G free`;
    if (freeGb < 1) {
      checks.rootDisk = `fail: ${free}`;
      warnings.push(`root disk low: ${free}`);
      ok = false;
    } else if (freeGb < 5) {
      checks.rootDisk = `warn: ${free}`;
      warnings.push(`root disk low: ${free}`);
    } else {
      checks.rootDisk = 'ok';
    }
  } catch {
    checks.rootDisk = 'unknown';
  }

  const w = currentWeek();
  return NextResponse.json(
    {
      ok,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      checks,
      warnings,
      now: toKstIso(new Date()),
      currentSlot: w.label, // 주차 라벨만 — 사용자·부서 정보 없음 (API-33)
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
