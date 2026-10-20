// POST /api/division/erp-import — RH-90: ERP 주간업무보고 PDF들 → 업무일지 후보. 본부·센터의 담당·부서장만(내 부서 — TACP-6).
// 아무것도 저장하지 않는다 — 후보는 작성 화면으로 가고, 사람이 고른 것만 보통 제출(compose)로 들어간다.
import { NextRequest } from 'next/server';
import { requireOwnManager, HttpError } from '@/server/authz';
import { handler, json, rateLimit, rejectOversizedBody } from '@/server/http';
import { audit } from '@/server/audit';
import { hqScopeOf } from '@/server/project-form';
import { ERP_LIMITS, erpCandidates } from '@/server/erp-import';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOwnManager(req.headers);
  rateLimit(`erp:${scope.user.email}`, 10, 60_000);
  rejectOversizedBody(req, ERP_LIMITS.files * ERP_LIMITS.bytes + 64 * 1024);

  const hq = await hqScopeOf(scope.division);
  if (!hq) throw new HttpError(409, 'not_hq', 'ERP 가져오기는 본부·센터 부서(연구실 양식)에서만 씁니다.');

  const form = await req.formData().catch(() => null);
  const raw = form ? form.getAll('files') : [];
  const files: { name: string; bytes: Buffer }[] = [];
  for (const f of raw) {
    if (typeof f === 'string') continue;
    if (f.size > ERP_LIMITS.bytes) throw new HttpError(422, 'invalid_file', `${f.name} — 파일이 너무 큽니다(3MB까지).`);
    files.push({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
  }
  if (files.length === 0) throw new HttpError(422, 'invalid_file', 'PDF를 골라 주세요.');
  if (files.length > ERP_LIMITS.files) throw new HttpError(422, 'too_many', `PDF는 한 번에 ${ERP_LIMITS.files}개까지입니다.`);

  // RH-95 — 오늘(KST)보다 뒤의 일은 계획으로
  const [, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).split('-').map(Number);
  const result = await erpCandidates(files, scope.division.nameKo, hq.units.map((u) => u.nameKo), [m, d]);
  await audit(scope.user.email, 'erp_import', scope.division.id, undefined, {
    files: files.length,
    read: result.files.filter((f) => !f.skipped).length,
    candidates: result.candidates.length,
    picked: result.candidates.filter((c) => c.pick).length,
  });
  return json(result);
});
