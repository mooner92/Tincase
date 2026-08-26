// POST /api/submissions/compose — 웹에서 작성한 내용을 hwp로 만들어 제출한다 (WA-04).
//
// 결과물이 업로드된 파일과 **구별되지 않아야 한다**: 부서 양식으로 만들고,
// 기존 uploadSubmission()과 같은 경로로 저장한다 (검증·버전·감사 로그 전부 동일).
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSubmitter, HttpError } from '@/server/authz';
import { submissionName } from '@/lib/docname';
import { handler, json } from '@/server/http';
import { logger } from '@/server/logger';
import { readStoredFile } from '@/server/storage';
import { openHwp } from '@/lib/hwp/ole';
import { parseRecords, serializeRecords } from '@/lib/hwp/record';
import { fillTable, packHwp } from '@/lib/hwp/writer';
import { uploadSubmission, ensureCurrentSlot } from '@/server/worklog';
import { readWorklog } from '@/lib/hwp/reader';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 200;
const MAX_CELL = 500;

interface Row {
  content?: unknown;
  date?: unknown;
  place?: unknown;
  attendee?: unknown;
}
interface Body {
  achievements?: Row[];
  plans?: Row[];
  notes?: Row[];
}

/** 사람이 넣은 글자를 다듬는다 — 제어 문자는 hwp 레코드를 깨뜨린다 */
function clean(v: unknown): string {
  return String(v ?? '')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\t')
    .join('')
    .trim()
    .slice(0, MAX_CELL);
}

function toRows(list: Row[] | undefined, prefix: number): string[][] {
  const rows = (list ?? [])
    .map((r) => [clean(r.content), clean(r.date), clean(r.place), clean(r.attendee)])
    .filter((r) => r.some(Boolean)); // 전부 빈 줄은 버린다
  if (rows.length > MAX_ROWS) {
    throw new HttpError(422, 'too_many_rows', `한 표에 ${MAX_ROWS}행까지만 넣을 수 있습니다.`);
  }
  // ABS-5 — 구분 채번은 언제나 시스템이 다시 만든다
  return rows.map((r, i) => [`${prefix}-${i + 1}`, ...r]);
}

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 제출 부서는 신원에서 나온다. 본문이 부서를 정하지 않는다
  const scope = await requireSubmitter(req.headers); // API-45 — 본문을 읽기 전에 판정한다

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');

  const ach = toRows(body.achievements, 1);
  const plans = toRows(body.plans, 2);
  const notes = toRows(body.notes, 3);
  if (ach.length === 0 && plans.length === 0 && notes.length === 0) {
    throw new HttpError(422, 'empty_content', '내용을 한 줄 이상 적어 주세요.');
  }

  const template = await prisma.template.findFirst({
    where: { divisionId: scope.division.id, isActive: true },
  });
  if (!template) throw new HttpError(409, 'no_template', '등록된 부서 양식이 없습니다. 담당자에게 요청해 주세요.');

  const base = await readStoredFile(template.filePath);
  const recs = parseRecords(openHwp(base).sections[0]);
  /*
   * WA-08 — 세 표를 **전부** 채운다. 빈 표라고 건너뛰지 않는다.
   *
   * 예전에는 `if (rows.length > 0)`로 걸렀는데, 그건 **양식의 표가 비어 있다는 전제**였다.
   * 실제 양식(AI홍보전략실)의 실적 표에는 예시 4줄이 들어 있어서, 실적을 비우고 계획만
   * 적으면 그 예시가 «내가 한 일»로 문서에 남았다. 검증이 그걸 잡아 500을 냈고,
   * 사용자에게는 「검증에 실패했습니다」로만 보여 이유를 알 수 없었다 (2026-08-26).
   *
   * `fillTable(recs, i, [])`는 머리행만 남기고 본문을 지운다 — 안 적은 표는 빈 표가 된다.
   */
  [ach, plans, notes].forEach((rows, i) => fillTable(recs, i, rows));
  const bytes = packHwp(base, [serializeRecords(recs)]);

  // WA-05 — 생성물도 자체 검증을 통과해야 한다. 우리가 만든 것이라고 봐주지 않는다.
  // **세 표를 다 본다** — 실적만 보면 계획·특이사항이 어긋나도 통과한다
  const back = readWorklog(bytes);
  const got = back.worklog;
  const mismatch = [
    ['실적', got.achievements.length, ach.length],
    ['계획', got.plans.length, plans.length],
    ['특이사항', got.notes.length, notes.length],
  ].filter(([, a, b]) => a !== b);
  if (mismatch.length > 0) {
    // 무엇이 어긋났는지 로그에 남긴다 — 「검증 실패」만으로는 다음에도 못 고친다
    logger.error(
      { division: scope.division.nameKo, mismatch: mismatch.map(([k, a, b]) => `${k} ${b}행 요청 → ${a}행`) },
      '[웹작성] 생성물 검증 실패',
    );
    throw new HttpError(500, 'generate_failed', '문서를 만들었으나 검증에 실패했습니다. 담당자에게 알려 주세요.');
  }

  const slot = await ensureCurrentSlot();
  const result = await uploadSubmission({
    user: scope.user,
    division: scope.division,
    fileName: submissionName(slot.year, slot.label, scope.division.nameKo, scope.user.name),
    bytes,
    fromIp: req.headers.get('x-forwarded-for'),
    origin: 'web',
  });

  return json({
    ok: true,
    version: result.submission.version,
    rows: { achievements: ach.length, plans: plans.length, notes: notes.length },
  });
});
