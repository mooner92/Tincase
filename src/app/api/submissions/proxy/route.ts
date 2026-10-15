// POST /api/submissions/proxy — 담당자가 **낸 적 없는** 부서원의 표를 대신 채워 제출한다 (LE-01~13 · TACP-18 v1.17).
//
// 판의 주인은 그 사람이고(「그 계정이 올린 것처럼」) 쓴 사람은 같은 행의 `editedById`·`origin='lead_entry'`에 남는다.
// 문서는 웹 작성·첨삭과 같은 길(`buildWorklogHwp`)로 만든다 — 부서 양식 + 같은 자체 검증. 마감은 보지 않는다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, requireProxyTarget, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { readStoredFile } from '@/server/storage';
import { proxySubmit } from '@/server/worklog';
import { buildWorklogHwp, type DocInput } from '@/server/worklog-doc';
import { submissionName } from '@/lib/docname';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 부서는 신원에서 나온다. 본문은 **사람**만 가리키고, 그 사람이 내 부서가 아니면 404다
  const scope = await requireScope(req.headers);
  const body = (await req.json().catch(() => null)) as (DocInput & { userId?: unknown; isoKey?: unknown }) | null;
  const owner = await requireProxyTarget(scope, body?.userId); // 권한 없음 404 → 사람 없음 422 → 같은 부서·활성·본인 아님 404
  rateLimit(`proxy:${scope.user.email}`, 30, 60_000);

  const isoKey = typeof body?.isoKey === 'string' ? body.isoKey : '';
  if (!body || !isoKey) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');
  const slot = await prisma.weekSlot.findUnique({ where: { isoKey } });
  const now = new Date();
  if (!slot || slot.opensAt > now) throw new HttpError(404, 'not_found', '해당 주차를 찾을 수 없습니다.');

  const template = await prisma.template.findFirst({ where: { divisionId: scope.division.id, isActive: true } });
  if (!template) throw new HttpError(409, 'no_template', '등록된 부서 양식이 없습니다. 부서 설정에서 양식을 먼저 등록하세요.');

  const built = buildWorklogHwp(await readStoredFile(template.filePath), body, {
    division: scope.division.nameKo,
    proxy: owner.id,
  });
  const created = await proxySubmit(
    {
      editor: scope.user,
      owner,
      division: scope.division,
      slot,
      bytes: built.bytes,
      fileName: submissionName(slot.year, slot.label, scope.division.nameKo, owner.name),
    },
    now,
  );
  return json({ ok: true, id: created.id, version: created.version, rows: built.rows });
});
