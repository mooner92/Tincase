// GET·PUT /api/division/rule — 부서 병합 설정 (API-28/29). lead 전용.
// 문법이 없으므로 파싱 오류도 없다 (HM-18 v3). 길이·타입만 본다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireManager, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';
import { parseCategories } from '@/server/merge/rules';

export const dynamic = 'force-dynamic';

const MAX_TEXT_BYTES = 10_000;
const MAX_CATEGORY_BYTES = 500;

export const GET = handler(async (req: NextRequest) => {
  const d = (await requireManager(req.headers)).division;
  return json({
    categories: d.mergeCategories,
    dedupe: d.mergeDedupe,
    dropNotes: d.mergeDropNotes,
    ruleText: d.mergeRuleText,
    guideText: d.guideText,
    /** 화면에서 "이렇게 해석됩니다"를 보여주기 위해 (사람이 확인할 수 있어야 한다) */
    parsedCategories: parseCategories(d.mergeCategories),
  });
});

interface Body {
  categories?: unknown;
  dedupe?: unknown;
  dropNotes?: unknown;
  ruleText?: unknown;
  guideText?: unknown;
  emptyWords?: unknown;
}

export const PUT = handler(async (req: NextRequest) => {
  // TACP-6 — 쓰기 대상은 언제나 신원의 부서다. URL 슬러그는 관여하지 않는다
  // TACP §3.1 — 내 부서 병합 규칙은 lead·head·coordinator·operator가 쓴다.
  // 쓰기 대상은 언제나 `scope.division`이다 (TACP-6) — 슬러그는 관여하지 않는다
  const scope = await requireManager(req.headers);
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) throw new HttpError(422, 'invalid_rule', '요청 형식이 올바르지 않습니다.');

  const data: Record<string, string | boolean> = {};

  const text = (key: 'categories' | 'ruleText' | 'guideText' | 'emptyWords', col: string, max: number) => {
    const v = body[key];
    if (v === undefined) return;
    if (typeof v !== 'string') throw new HttpError(422, 'invalid_rule', `${key}는 문자열이어야 합니다.`);
    if (Buffer.byteLength(v, 'utf8') > max) {
      throw new HttpError(422, 'invalid_rule', `${key}가 너무 깁니다 (최대 ${Math.round(max / 1000) || 0.5}KB).`);
    }
    data[col] = v;
  };
  const flag = (key: 'dedupe' | 'dropNotes', col: string) => {
    const v = body[key];
    if (v === undefined) return;
    if (typeof v !== 'boolean') throw new HttpError(422, 'invalid_rule', `${key}는 true/false여야 합니다.`);
    data[col] = v;
  };

  text('categories', 'mergeCategories', MAX_CATEGORY_BYTES);
  // HM-33 — 부서가 정하는 「내용 없음」 낱말. 분류 순서와 같은 길이 제한이면 충분하다
  text('emptyWords', 'emptyWords', MAX_CATEGORY_BYTES);
  text('ruleText', 'mergeRuleText', MAX_TEXT_BYTES);
  text('guideText', 'guideText', MAX_TEXT_BYTES);
  flag('dedupe', 'mergeDedupe');
  flag('dropNotes', 'mergeDropNotes');

  if (Object.keys(data).length === 0) throw new HttpError(422, 'invalid_rule', '변경할 내용이 없습니다.');

  await prisma.division.update({ where: { id: scope.division.id }, data });
  await audit(scope.user.email, 'rule_update', scope.division.id, undefined, { fields: Object.keys(data) });
  return json({ ok: true, parsedCategories: parseCategories(String(data.mergeCategories ?? scope.division.mergeCategories)) });
});
