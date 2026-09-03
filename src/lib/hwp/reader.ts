// S-08 L3 — 업무일지 도메인 읽기 (HM-14~15) + 업로드 구조 검증 (ST-07).
import { HwpFormatError, openHwp } from './ole';
import { parseRecords } from './record';
import { extractTables, tableGrid, HwpTable } from './model';
import { charShapeColors, isEmphasis } from './charshape';

export interface WorklogRow {
  content: string; // 업무실적 내용
  date: string; //    일자 "8/12" | ""
  place: string; //   장소
  attendee: string; // 참석자
  /**
   * HM-37 — **「전체 공유·전달이 필요한 주요 사항」 표시.**
   *
   * 기획조정실 규칙이 「파란색으로 작성」이라, 낸 파일에서는 **글자색**으로 들어온다.
   * 여기서 색을 참·거짓으로 눌러 두는 이유: 위층(웹 화면·병합)은 「무슨 색인가」가 아니라
   * 「강조인가」만 알면 되고, 색으로 들고 다니면 화면마다 색을 해석하는 코드가 생긴다.
   */
  emphasis?: boolean;
}

export interface WorklogData {
  achievements: WorklogRow[]; // 1. 주요 업무실적
  plans: WorklogRow[]; //        2. 주요 업무계획
  notes: WorklogRow[]; //        3. 기타 특이사항 (표 삭제 시 [])
}

export interface ParsedHwp {
  version: string;
  tables: HwpTable[];
  worklog: WorklogData;
  warnings: string[];
}

export const TABLE_TITLES = ['1. 주요 업무실적', '2. 주요 업무계획', '3. 기타 특이사항'] as const;
export const TABLE_COLUMNS = ['구분', '업무실적 내용', '일자', '장소', '참석자'] as const;

/** HM-15g — 자리표시자·공백 정규화 */
function cellValue(raw: string): string {
  const v = raw.trim();
  if (/^O{2,}\/O{2,}$/i.test(v)) return ''; // "OO/OO"
  return v;
}

/**
 * HM-37 — 행별 강조 여부. **내용 칸(1열)만 본다.**
 *
 * 일자·장소·참석자에 색을 넣는 사람은 없고, 있더라도 그건 그 칸을 꾸민 것이지
 * 「이 업무가 중요하다」는 뜻이 아니다. 신호는 내용 칸에 있다.
 *
 * 한 글자라도 색이면 그 줄을 강조로 친다 — 「제5차 공청회 **(원장 참석)**」처럼 일부만
 * 칠하는 경우가 실제로 있고, 그때 표시된 뜻은 그 줄 전체에 걸린다.
 */
function rowEmphasis(t: HwpTable, colors: readonly number[]): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const c of t.cells) {
    if (c.col !== 1 || c.row < 1) continue;
    // 빈 칸의 서식은 「색을 골라 두고 안 적은 것」이라 뜻이 없다
    if (!c.text.trim()) continue;
    out.set(c.row, c.shapeIds.some((id) => isEmphasis(colors[id] ?? 0)));
  }
  return out;
}

function gridToRows(t: HwpTable, colors: readonly number[]): WorklogRow[] {
  const grid = tableGrid(t);
  const emph = rowEmphasis(t, colors);
  const rows: WorklogRow[] = [];
  for (let r = 1; r < grid.length; r++) { // HM-15c: 첫 행은 헤더
    const [, content = '', date = '', place = '', attendee = ''] = grid[r]; // HM-15d: 구분 열 무시
    const row: WorklogRow = {
      content: cellValue(content),
      date: cellValue(date),
      place: cellValue(place),
      attendee: cellValue(attendee),
      emphasis: emph.get(r) ?? false,
    };
    // HM-15e: 4열 전부 공백인 행 제외
    if (row.content || row.date || row.place || row.attendee) rows.push(row);
  }
  return rows;
}

/** 파싱된 섹션들에서 업무일지 데이터 추출 */
export function readWorklog(buf: Buffer): ParsedHwp {
  const file = openHwp(buf);
  const warnings: string[] = [];

  const tables: HwpTable[] = [];
  for (const section of file.sections) {
    tables.push(...extractTables(parseRecords(section)));
  }
  // HM-37 — 색은 DocInfo에 있다. 못 읽어도 본문은 읽혀야 하므로 실패하면 색 없는 것으로 간다
  let colors: number[] = [];
  try {
    colors = charShapeColors(parseRecords(file.docInfo));
  } catch {
    warnings.push('글자 서식을 읽지 못했습니다 — 강조 표시 없이 처리합니다');
  }

  // HM-15a/b — 표는 순서대로 1·2·3. 2개면 3번(특이사항)이 삭제된 것 (관례상 정상)
  const [t1, t2, t3] = tables;
  const worklog: WorklogData = {
    achievements: t1 ? gridToRows(t1, colors) : [],
    plans: t2 ? gridToRows(t2, colors) : [],
    notes: t3 ? gridToRows(t3, colors) : [],
  };
  if (tables.length === 2) warnings.push('3번 표(기타 특이사항) 없음 — 관례상 정상');
  if (tables.length > 3) warnings.push(`표가 ${tables.length}개입니다 — 양식과 다른 구조`);

  return { version: file.version, tables, worklog, warnings };
}

// ── 업로드 검증 (ST-07) ────────────────────────────────────────
export type UploadRejectReason =
  | 'not_hwp'
  | 'hwpx_not_allowed'
  | 'encrypted'
  | 'corrupt_structure';

export class UploadValidationError extends Error {
  constructor(
    public readonly reason: UploadRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

/**
 * ST-06/07 — 매직 넘버 + 구조 + 표 파싱까지 검증.
 * 통과하면 파싱 결과를 돌려준다 (업로드 시점에 파싱 가능성을 보장 — 드로어·병합의 전제).
 */
export function validateHwpUpload(buf: Buffer): ParsedHwp {
  // ZIP이면 .hwpx를 이름만 바꾼 경우 (ST-05/06)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    throw new UploadValidationError(
      'hwpx_not_allowed',
      '.hwpx 형식은 받지 않습니다. 한글에서 [다른 이름으로 저장] → 파일 형식 [한글 문서(*.hwp)]로 저장한 뒤 다시 올려주세요.',
    );
  }
  try {
    const parsed = readWorklog(buf);
    if (parsed.tables.length === 0) {
      throw new UploadValidationError(
        'corrupt_structure',
        '표를 찾을 수 없습니다. 부서 양식으로 작성한 파일인지 확인해 주세요.',
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof UploadValidationError) throw e;
    if (e instanceof HwpFormatError) {
      if (e.reason === 'encrypted') {
        throw new UploadValidationError('encrypted', '암호가 설정된 파일은 올릴 수 없습니다. 암호를 해제한 뒤 다시 저장해 주세요.');
      }
      if (e.reason === 'not_ole') {
        throw new UploadValidationError('not_hwp', '한글(.hwp) 파일이 아닙니다. 한글에서 저장한 파일을 올려주세요.');
      }
      throw new UploadValidationError('corrupt_structure', '파일을 읽을 수 없습니다. 한글에서 다시 저장한 뒤 올려주세요.');
    }
    throw new UploadValidationError('corrupt_structure', '파일을 읽을 수 없습니다. 한글에서 다시 저장한 뒤 올려주세요.');
  }
}
