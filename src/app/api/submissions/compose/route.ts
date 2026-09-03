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
import { fillTable, packHwp, plainShapeIdOf } from '@/lib/hwp/writer';
import { BLUE, ensureColorShape } from '@/lib/hwp/charshape';
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
  /** HM-37 — 「전체 공유·전달이 필요한 주요 사항」 — 문서에 파란색으로 나간다 */
  emphasis?: unknown;
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

/**
 * HM-37 — 표 하나를 셀 격자 + **행별 강조**로. 둘을 같이 만드는 이유는 빈 줄을 버릴 때
 * 두 배열의 길이가 어긋나면 안 되기 때문이다 — 따로 만들면 언젠가 한 칸씩 밀린다.
 */
function toRows(list: Row[] | undefined, prefix: number): { cells: string[][]; emphasis: boolean[] } {
  const kept = (list ?? [])
    .map((r) => ({
      cells: [clean(r.content), clean(r.date), clean(r.place), clean(r.attendee)],
      emphasis: r.emphasis === true,
    }))
    .filter((r) => r.cells.some(Boolean)); // 전부 빈 줄은 버린다
  if (kept.length > MAX_ROWS) {
    throw new HttpError(422, 'too_many_rows', `한 표에 ${MAX_ROWS}행까지만 넣을 수 있습니다.`);
  }
  return {
    // ABS-5 — 구분 채번은 언제나 시스템이 다시 만든다
    cells: kept.map((r, i) => [`${prefix}-${i + 1}`, ...r.cells]),
    emphasis: kept.map((r) => r.emphasis),
  };
}

export const POST = handler(async (req: NextRequest) => {
  // TACP-6 — 제출 부서는 신원에서 나온다. 본문이 부서를 정하지 않는다
  const scope = await requireSubmitter(req.headers); // API-45 — 본문을 읽기 전에 판정한다

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) throw new HttpError(422, 'invalid_request', '요청 형식이 올바르지 않습니다.');

  const ach = toRows(body.achievements, 1);
  const plans = toRows(body.plans, 2);
  const notes = toRows(body.notes, 3);
  if (ach.cells.length === 0 && plans.cells.length === 0 && notes.cells.length === 0) {
    throw new HttpError(422, 'empty_content', '내용을 한 줄 이상 적어 주세요.');
  }

  const template = await prisma.template.findFirst({
    where: { divisionId: scope.division.id, isActive: true },
  });
  if (!template) throw new HttpError(409, 'no_template', '등록된 부서 양식이 없습니다. 담당자에게 요청해 주세요.');

  const base = await readStoredFile(template.filePath);
  const file = openHwp(base);
  const recs = parseRecords(file.sections[0]);
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
  /*
   * HM-37 — 강조(파란색)가 하나라도 있으면 그 서식을 DocInfo에 만들어 넣는다.
   * 없으면 DocInfo를 손대지 않는다 — 바꿀 이유가 없으면 건드리지 않는다.
   */
  const wantEmphasis = [ach, plans, notes].some((t) => t.emphasis.some(Boolean));
  let docInfoOut: Buffer | undefined;
  let blueShapeId: number | null = null;
  if (wantEmphasis) {
    const diRecs = parseRecords(file.docInfo);
    const plain = plainShapeIdOf(recs, 0);
    blueShapeId = plain === null ? null : ensureColorShape(diRecs, plain, BLUE);
    if (blueShapeId !== null) docInfoOut = serializeRecords(diRecs);
  }

  [ach, plans, notes].forEach((t, i) =>
    fillTable(recs, i, t.cells, { emphasis: t.emphasis, emphasisShapeId: blueShapeId }),
  );
  const bytes = packHwp(base, [serializeRecords(recs)], docInfoOut);

  // WA-05 — 생성물도 자체 검증을 통과해야 한다. 우리가 만든 것이라고 봐주지 않는다.
  // **세 표를 다 본다** — 실적만 보면 계획·특이사항이 어긋나도 통과한다
  const back = readWorklog(bytes);
  const got = back.worklog;
  const mismatch = [
    ['실적', got.achievements.length, ach.cells.length],
    ['계획', got.plans.length, plans.cells.length],
    ['특이사항', got.notes.length, notes.cells.length],
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
    rows: { achievements: ach.cells.length, plans: plans.cells.length, notes: notes.cells.length },
  });
});
