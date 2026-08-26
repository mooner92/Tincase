// RS-01 — xlsx 읽기. **의존성을 더하지 않는다.**
//
// 필요한 것은 «시트 하나를 문자열 격자로»가 전부다. 그걸 위해 라이브러리를 넣으면
// 이 저장소가 사내망에서 재빌드될 때마다 그 패키지가 살아 있어야 한다.
// xlsx는 zip + XML이고, Node에 zlib가 있으므로 직접 읽는 편이 오래 간다.
// (hwp를 직접 읽는 것과 같은 판단이다 — ADR-0001)
//
// 다루는 범위: ERP가 내보내는 단순 시트. 수식·차트·피벗은 보지 않는다.
import { inflateRawSync } from 'node:zlib';

/** zip 엔트리 하나 */
interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

/**
 * 중앙 디렉터리를 읽는다. **끝에서부터 찾는다** — zip은 앞이 아니라 뒤가 목차다.
 * (주석이 붙어 있을 수 있어 EOCD가 파일 맨 끝이라는 보장은 없다)
 */
function readCentralDirectory(buf: Buffer): Entry[] {
  let eocd = -1;
  const from = Math.max(0, buf.length - 66_000); // 주석 최대 65535 + EOCD 22
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx 형식이 아닙니다 (zip 목차를 찾지 못했습니다)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      localHeaderOffset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 엔트리 하나를 풀어 문자열로. 로컬 헤더의 길이를 다시 읽어야 데이터 시작점을 안다 */
function readEntry(buf: Buffer, e: Entry): string {
  const h = e.localHeaderOffset;
  const nameLen = buf.readUInt16LE(h + 26);
  const extraLen = buf.readUInt16LE(h + 28);
  const start = h + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString('utf8'); // 무압축
  if (e.method === 8) return inflateRawSync(raw).toString('utf8'); // deflate
  throw new Error(`지원하지 않는 압축 방식입니다 (method=${e.method})`);
}

const XML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[g] ?? m;
  });
}

/**
 * 공유 문자열 표. xlsx는 같은 글자를 여러 칸이 쓰면 여기에 한 번만 담고 번호로 가리킨다.
 * 한 `<si>` 안에 `<t>`가 여러 개일 수 있다 (서식이 섞인 글자) — **전부 이어 붙인다.**
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    let s = '';
    for (const t of si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []) {
      s += unescapeXml(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''));
    }
    out.push(s);
  }
  return out;
}

/** "BC7" → 54 (0-based 열 번호). 행 번호는 버린다 */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * 시트를 **문자열 격자**로. 빈 칸은 `''`이고, 행 사이가 비어 있어도 자리를 채운다 —
 * 인덱스가 곧 열 번호여야 «부서는 2번째 열»이라는 약속이 성립한다.
 */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
    const rowNum = Number(/\br="(\d+)"/.exec(rowXml)?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    for (const cellXml of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cellXml)?.[1];
      const type = /\bt="([^"]+)"/.exec(cellXml)?.[1] ?? 'n';
      let value = '';
      if (type === 'inlineStr') {
        for (const t of cellXml.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []) {
          value += unescapeXml(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''));
        }
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
        if (raw !== undefined) {
          const v = unescapeXml(raw);
          // t="s"면 공유 문자열 번호다. 숫자로 읽으면 사번이 색인 번호로 둔갑한다
          value = type === 's' ? (shared[Number(v)] ?? '') : v;
        }
      }
      const idx = ref ? columnIndex(ref) : cells.length;
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    while (rows.length < rowNum - 1) rows.push([]);
    rows[rowNum - 1] = cells;
  }
  return rows;
}

/** 첫 워크시트를 문자열 격자로 읽는다 */
export function readSheet(bytes: Buffer): string[][] {
  const entries = readCentralDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (sheets.length === 0) throw new Error('워크시트를 찾지 못했습니다.');

  const ss = byName.get('xl/sharedStrings.xml');
  const shared = ss ? parseSharedStrings(readEntry(bytes, ss)) : [];
  return parseSheet(readEntry(bytes, sheets[0]), shared);
}

/**
 * 머리행을 찾아 **열 이름 → 값** 객체 배열로. 열 순서가 바뀌어도 동작한다 —
 * ERP 내보내기 형식이 언젠가 바뀔 텐데, 순서에 기대면 그때 조용히 어긋난다.
 *
 * @param required 이 이름들이 머리행에 전부 있어야 한다. 없으면 어느 것이 없는지 알려준다
 */
export function readTable(bytes: Buffer, required: string[]): Record<string, string>[] {
  const grid = readSheet(bytes);
  const headerIdx = grid.findIndex((r) => required.every((h) => r.some((c) => c.trim() === h)));
  if (headerIdx < 0) {
    const first = grid.find((r) => r.some((c) => c.trim()))?.map((c) => c.trim()).filter(Boolean) ?? [];
    const missing = required.filter((h) => !first.includes(h));
    throw new Error(
      `엑셀에서 필요한 열을 찾지 못했습니다: ${missing.join(', ')}` +
        (first.length ? ` (첫 행에서 읽은 열: ${first.slice(0, 12).join(', ')})` : ''),
    );
  }
  const header = grid[headerIdx].map((c) => c.trim());
  return grid
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
