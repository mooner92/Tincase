// PUT /api/division/rule — 부서 분류 순서 (API-59). lead·head·coordinator·operator, 자기 부서만.
// GET은 지웠다(2026-10-08, R2) — 설정 화면은 서버에서 그리고, 이 GET을 부르는 화면이 없었다.
//
// 2026-10-08 (API-59 · HM-51 · ADR-0018) — 받는 키는 `categories` 하나다. 지침·정렬·날짜 없는 줄·묶기·3번 표·
// 작성 안내·확인할 낱말·공유 표시 낱말은 엔진의 고정값이 되었다. 다른 키는 **읽지 않는다** — 띄워 둔 옛 설정 화면이
// 보내도 아무도 읽지 않는 열이 바뀌어 감사 기록만 늘어나는 일을 막는다. 문법이 없으므로 길이·타입만 본다 (HM-18 v3).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { parseCategories } from '@/server/merge/rules';

export const dynamic = 'force-dynamic';

const MAX_CATEGORY_BYTES = 500;

export const PUT = handler(async (req: NextRequest) => {
  // TACP §3.1 — 내 부서 병합 규칙은 lead·head·coordinator·operator가 쓴다.
  // 쓰기 대상은 언제나 신원의 부서다 (TACP-6) — URL 슬러그는 관여하지 않는다
  const scope = await requireManager(req.headers);
  const body = (await req.json().catch(() => null)) as { categories?: unknown } | null;
  if (!body || typeof body !== 'object') throw new HttpError(422, 'invalid_rule', '요청 형식이 올바르지 않습니다.');

  const v = body.categories;
  if (v === undefined) throw new HttpError(422, 'invalid_rule', '변경할 내용이 없습니다.');
  if (typeof v !== 'string') throw new HttpError(422, 'invalid_rule', 'categories는 문자열이어야 합니다.');
  if (Buffer.byteLength(v, 'utf8') > MAX_CATEGORY_BYTES) {
    throw new HttpError(422, 'invalid_rule', '분류 순서가 너무 깁니다 (최대 500B).');
  }

  await prisma.division.update({ where: { id: scope.division.id }, data: { mergeCategories: v } });
  await audit(scope.user.email, 'rule_update', scope.division.id, undefined, { fields: ['mergeCategories'] });
  return json({ ok: true, parsedCategories: parseCategories(v) });
});
