// 표 붙여넣기 해석 — 한글·엑셀에서 복사한 표를 행 목록으로 바꾼다.
//
// 한 칸씩 옮겨 적는 건 웹 작성을 쓸 이유를 없앤다. 이미 한글에 표가 있다면
// 통째로 긁어 붙이는 게 자연스럽다.
//
// **한글은 평문(text/plain)에 셀을 줄바꿈으로 넣는다.** 엑셀처럼 탭으로 나누지 않아,
// 평문만 보면 칸 하나가 행 하나가 되어 버린다 (실측: 4열 4행 → 16줄).
// 다행히 클립보드에는 `text/html`이 함께 들어오고 거기엔 진짜 표 구조가 있다.
// 그래서 **HTML을 먼저 보고, 없을 때만 평문을 본다.**

export interface PastedRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
}

/** 우리 양식의 열 구성 — `구분`은 시스템이 다시 매기므로 받아도 버린다 (ABS-5) */
const OUR_COLUMNS = 4; // 내용·일자·장소·참석자

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(' ');
  return /구\s*분/.test(joined) && /내용|실적/.test(joined);
}

/** `1-1`, `2-13` 같은 채번 칸인가 */
function looksLikeIndex(cell: string): boolean {
  return /^\d+\s*-\s*\d+$/.test(cell.trim());
}

/** 격자 → 우리 행. 열 수가 달라도 앞에서부터 맞춘다 */
export function gridToRows(grid: string[][]): PastedRow[] {
  const rows: PastedRow[] = [];
  for (const raw of grid) {
    let cells = raw.map((c) => c.replace(/\s+/g, ' ').trim());
    if (looksLikeHeader(cells)) continue;
    if (looksLikeIndex(cells[0]) || cells.length > OUR_COLUMNS) cells = cells.slice(1);

    const [content = '', date = '', place = '', attendee = ''] = cells;
    if (!content && !date && !place && !attendee) continue;
    rows.push({ content, date, place, attendee });
  }
  return rows;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** 태그를 걷어내고 글자만. 줄바꿈 태그는 공백으로 (셀 안 줄바꿈은 한 줄로 합친다) */
function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 클립보드 HTML에서 표 격자를 뽑는다. DOM 없이 동작한다 (테스트 가능해야 한다).
 * 표가 없으면 `null`.
 */
export function parseHtmlTable(html: string): string[][] | null {
  if (!/<t[rd]\b/i.test(html)) return null;
  const grid: string[][] = [];
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const c of m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(cellText(c[1]));
    }
    if (cells.length) grid.push(cells);
  }
  return grid.length ? grid : null;
}

/**
 * 평문 해석 (엑셀·탭 구분, 또는 내용만 여러 줄).
 * 표가 아니면 `null` — 한 칸에 긴 글을 붙이는 것도 정상적인 사용이다.
 */
export function parseTablePaste(text: string): PastedRow[] | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const grid = lines.map((l) => l.split('\t')).filter((cells) => cells.some((c) => c.trim()));
  if (grid.length === 0) return null;

  const multiColumn = grid.some((cells) => cells.length > 1);
  if (!multiColumn && grid.length < 2) return null;

  const rows = gridToRows(grid);
  return rows.length > 0 ? rows : null;
}

/**
 * 붙여넣기 진입점 — HTML을 먼저 보고, 없으면 평문으로.
 * 한글은 평문에 셀을 줄바꿈으로 넣어 격자가 무너지므로 HTML이 있으면 반드시 그쪽이다.
 */
export function parseClipboardTable(html: string, text: string): PastedRow[] | null {
  const grid = html ? parseHtmlTable(html) : null;
  if (grid) {
    const rows = gridToRows(grid);
    if (rows.length > 0) return rows;
  }
  return parseTablePaste(text);
}
