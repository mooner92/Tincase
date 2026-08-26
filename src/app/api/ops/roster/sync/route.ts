// POST /api/ops/roster/sync — ERP 인원 현황(xlsx) 업로드 (operator 전용, RS-13).
//
// **두 단계다.** 먼저 `mode=preview`로 무엇이 바뀌는지 받아 보고, 사람이 확인한 뒤
// `mode=apply`로 반영한다. 한 번에 하지 않는 이유는 §sync.ts 머리말에 있다 —
// 엑셀 한 번 잘못 뽑으면 멀쩡한 사람 수백 명이 잠긴다.
//
// **미리보기와 적용이 같은 파일을 두 번 읽는다.** 계획을 서버에 담아 두었다가 적용하지
// 않는 이유: 그 사이 다른 곳에서 명단이 바뀌면 화면이 보여준 계획과 실제로 적용되는 것이
// 달라진다. 매번 «지금 DB»와 «지금 엑셀»로 다시 계산하는 편이 정직하다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { HttpError, requireOperator } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { audit } from '@/server/audit';
import { readTable } from '@/lib/xlsx';
import { planRosterSync, applyRosterSync, toErpPerson, REQUIRED_COLUMNS } from '@/server/roster/sync';

export const dynamic = 'force-dynamic';

/** 인원 현황 엑셀은 300명대에 100KB 남짓이다. 넉넉히 잡되 무한정 받지는 않는다 */
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOperator(req.headers);
  rateLimit(`roster-sync:${scope.user.email}`, 20, 60_000);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const mode = String(form?.get('mode') ?? 'preview');
  if (!(file instanceof File)) throw new HttpError(422, 'invalid_request', '엑셀 파일이 없습니다.');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'too_large', '파일이 너무 큽니다 (8MB 이하).');

  const bytes = Buffer.from(await file.arrayBuffer());

  let erp;
  try {
    erp = readTable(bytes, [...REQUIRED_COLUMNS])
      .map(toErpPerson)
      .filter((x): x is NonNullable<typeof x> => !!x);
  } catch (e) {
    // 파싱 실패는 사용자 잘못이 아니라 **파일이 다른 것**인 경우가 대부분이다.
    // 무엇이 없는지 그대로 알려준다 — "형식 오류"만으로는 고칠 방법이 없다
    throw new HttpError(422, 'invalid_file', (e as Error).message);
  }

  const users = await prisma.user.findMany({ include: { division: true } });
  const divisions = await prisma.division.findMany({ select: { nameKo: true } });
  const plan = planRosterSync(
    users.map((u) => ({ ...u, divisionKo: u.division.nameKo })),
    erp,
    divisions.map((d) => d.nameKo),
  );

  if (mode !== 'apply') {
    return json({ ...plan, applied: null });
  }
  if (plan.blockers.length > 0) {
    throw new HttpError(409, 'sync_blocked', plan.blockers.join(' / '));
  }

  const applied = await applyRosterSync(prisma, plan);
  await audit(scope.user.email, 'roster_sync', null, `rows:${plan.totalRows}`, {
    ...applied,
    changes: plan.changes.length,
    leadWarnings: plan.leadWarnings,
  });

  // 적용 뒤 비밀번호가 없는 사람 = 이번에 새로 생긴 사람 (RS-14).
  // 비밀번호는 여기서 만들지 않는다 — 개인별로 전달해야 하므로 발급은 따로 한다
  const needPassword = await prisma.user.findMany({
    where: { isActive: true, passwordHash: null },
    select: { name: true, email: true, division: { select: { nameKo: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return json({
    ...plan,
    applied,
    needPassword: needPassword.map((u) => ({ name: u.name, email: u.email, division: u.division.nameKo })),
  });
});
