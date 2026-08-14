// POST /api/division/merge — 자동 병합 (Phase 2).
// 계약만 존재하고 동작은 없다 (API-30). writer(HM-16)와 규칙 파서(HM-18)가 서야 열린다.
// 라우트를 미리 두는 이유: 계약을 고정해 두면 Phase 2에서 클라이언트를 고칠 일이 없다.
import { NextRequest } from 'next/server';
import { requireLead } from '@/server/authz';
import { handler, jsonError } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  await requireLead(req.headers); // 권한은 지금부터 동일하게 강제 (member는 404)
  return jsonError(
    501,
    'not_implemented',
    '자동 병합은 준비 중입니다 (Phase 2). 지금은 전체 zip으로 받아 기존 방식으로 병합해 주세요.',
  );
});
