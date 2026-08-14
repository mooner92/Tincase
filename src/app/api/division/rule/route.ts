// GET·PUT /api/division/rule — 부서 병합 규칙 텍스트 (API-28/29). lead 전용.
// Phase 1: 저장만 한다. 문법 검증·병합 반영은 Phase 2 (rule.ts 파서, Q-16).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireLead, HttpError } from '@/server/authz';
import { handler, json } from '@/server/http';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const MAX_RULE_BYTES = 10_000;

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireLead(req.headers);
  return json({ ruleText: scope.division.mergeRuleText, guideText: scope.division.guideText });
});

export const PUT = handler(async (req: NextRequest) => {
  const scope = await requireLead(req.headers);
  const body = (await req.json().catch(() => null)) as { ruleText?: unknown; guideText?: unknown } | null;
  if (!body) throw new HttpError(422, 'invalid_rule', '요청 형식이 올바르지 않습니다.');

  const data: { mergeRuleText?: string; guideText?: string } = {};
  for (const [key, col] of [
    ['ruleText', 'mergeRuleText'],
    ['guideText', 'guideText'],
  ] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new HttpError(422, 'invalid_rule', `${key}는 문자열이어야 합니다.`);
    if (Buffer.byteLength(v, 'utf8') > MAX_RULE_BYTES) {
      throw new HttpError(422, 'invalid_rule', `${key}가 너무 깁니다 (최대 10KB).`);
    }
    data[col] = v;
  }
  if (Object.keys(data).length === 0) throw new HttpError(422, 'invalid_rule', '변경할 내용이 없습니다.');

  await prisma.division.update({ where: { id: scope.division.id }, data });
  await audit(scope.user.email, 'rule_update', scope.division.id, undefined, {
    fields: Object.keys(data),
  });
  return json({ ok: true });
});
