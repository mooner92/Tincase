// 표 붙여넣기 해석 — 한글·엑셀에서 표를 복사하면 클립보드에 **탭으로 나뉜 글자**가 들어온다.
//
// 한 칸씩 옮겨 적는 건 웹 작성을 쓸 이유를 없앤다. 이미 한글에 표가 있다면
// 통째로 긁어 붙이는 게 자연스럽다.

export interface PastedRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
}

/** 우리 양식의 열 구성 — `구분`은 시스템이 다시 매기므로 받아도 버린다 (ABS-5) */
const OUR_COLUMNS = 4; // 내용·일자·장소·참석자

/** 머리글 행으로 보이는가 — 붙여넣을 때 같이 딸려 오는 경우가 흔하다 */
function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(' ');
  return /구\s*분/.test(joined) && /내용|실적/.test(joined);
}

/** `1-1`, `2-13` 같은 채번 칸인가 */
function looksLikeIndex(cell: string): boolean {
  return /^\d+\s*-\s*\d+$/.test(cell.trim());
}

/**
 * 붙여넣은 글자를 행 목록으로. 표가 아니면 `null`을 돌려주고, 호출자는 평범한
 * 붙여넣기로 처리한다 (한 칸에 긴 글을 붙이는 것도 정상적인 사용이다).
 */
export function parseTablePaste(text: string): PastedRow[] | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const grid = lines
    .map((l) => l.split('\t'))
    .filter((cells) => cells.some((c) => c.trim()));
  if (grid.length === 0) return null;

  const multiColumn = grid.some((cells) => cells.length > 1);
  // 탭도 없고 한 줄이면 그냥 글자다 — 표로 볼 이유가 없다
  if (!multiColumn && grid.length < 2) return null;

  const rows: PastedRow[] = [];
  for (const raw of grid) {
    let cells = raw.map((c) => c.replace(/\s+/g, ' ').trim());
    if (looksLikeHeader(cells)) continue;

    // 첫 칸이 채번(1-1)이거나, 우리 열 수보다 많으면 앞의 `구분`을 버린다
    if (looksLikeIndex(cells[0]) || cells.length > OUR_COLUMNS) cells = cells.slice(1);

    const [content = '', date = '', place = '', attendee = ''] = cells;
    if (!content && !date && !place && !attendee) continue;
    rows.push({ content, date, place, attendee });
  }
  return rows.length > 0 ? rows : null;
}
