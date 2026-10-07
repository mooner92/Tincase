// RU-01·03·30 — 위로 [제출]·취소 (TACP-21).
//   GET    ?level=unit|hq&isoKey=   내 부서의 제출 상태 (본부본 `hq`는 본부의 lead·head만)
//   POST   { level, isoKey }        내 부서 결과를 위로 보낸다 — 그 순간의 사본
//   DELETE ?id=                     제출 취소 (내 부서가 보낸 것만)
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertReportSender, hqNodeOfManager, requireReportSender, requireScope, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { reportState, submitReport, withdrawReport } from '@/server/rollup/report';
import { rollupSlot } from '@/server/rollup/slot';

export const dynamic = 'force-dynamic';

const levelOf = (v: unknown) => (v === 'hq' ? 'hq' : 'unit');

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const level = levelOf(req.nextUrl.searchParams.get('level'));
  // TACP-21 — 본부본의 제출 상태는 본부 쓰기와 같은 칸이다(lead·head). 본부원(member)에게는 404
  if (level === 'hq') await hqNodeOfManager(scope);
  const slot = await rollupSlot(req.nextUrl.searchParams.get('isoKey'));
  // 내 부서의 상태만 — 대상은 신원의 부서다 (TACP-6·7)
  const state = await reportState(scope.division.id, slot, level);
  return json({ state });
});

const body = z.object({ level: z.enum(['unit', 'hq']), isoKey: z.string().optional() });

export const POST = handler(async (req: NextRequest) => {
  // 신원부터 — 본문을 읽거나 주차를 만들기 전에 (인증 안 된 요청이 DB에 아무것도 남기지 않게)
  const scope = await requireScope(req.headers);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(422, 'invalid_request', '요청 형식이 맞지 않습니다.');
  if (parsed.data.level === 'hq') {
    const node = await hqNodeOfManager(scope);
    const r = await submitReport(scope, 'hq', await rollupSlot(parsed.data.isoKey), node);
    return json({ id: r.report.id, unchanged: r.unchanged });
  }
  await assertReportSender(scope);
  const r = await submitReport(scope, 'unit', await rollupSlot(parsed.data.isoKey));
  return json({ id: r.report.id, unchanged: r.unchanged });
});

export const DELETE = handler(async (req: NextRequest) => {
  const scope = await requireReportSender(req.headers);
  const id = req.nextUrl.searchParams.get('id');
  if (!id) throw new HttpError(422, 'invalid_request', '취소할 제출을 지정하세요.');
  await withdrawReport(scope, id);
  return json({ ok: true });
});
