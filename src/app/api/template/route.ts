// GET /api/template — 자기 부서 active 양식 (API-17~19)
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope, HttpError } from '@/server/authz';
import { ensureCurrentSlot } from '@/server/worklog';
import { contentDisposition, readStoredFile } from '@/server/storage';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  const tpl = await prisma.template.findFirst({
    where: { divisionId: scope.division.id, isActive: true }, // DM-14
  });
  if (!tpl) {
    throw new HttpError(404, 'not_found', '등록된 부서 양식이 없습니다. 담당자에게 양식 등록을 요청하세요.');
  }
  const bytes = await readStoredFile(tpl.filePath);
  const slot = await ensureCurrentSlot();
  // API-18 — 파일명에 주차·부서명 주입. 받자마자 올바른 이름
  const filename = `${slot.label.replace(/ /g, '_')}_${scope.division.nameKo}_주간업무.hwp`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/x-hwp',
      'Content-Disposition': contentDisposition(filename),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store', // API-19: 잠김 여부와 무관하게 항상 제공
    },
  });
});
