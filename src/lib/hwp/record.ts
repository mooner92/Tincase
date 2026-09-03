// S-08 L1 — HWP 5.0 레코드 파싱/직렬화.
// 불변식 HM-04: serialize(parse(bytes)) === bytes (바이트 단위 완전 일치).
// 바이트 레이아웃 근거: docs/research/001-hwp-format-findings.md §4

export const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  PARA_LINE_SEG: 69,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77,
} as const;

export interface HwpRecord {
  tag: number;
  level: number;
  data: Buffer;
  /** 원본이 0xFFF 확장 길이 형식이었는지 — 왕복 동일성에 필요 (HM-05) */
  extended: boolean;
}

export function parseRecords(buf: Buffer): HwpRecord[] {
  const out: HwpRecord[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const h = buf.readUInt32LE(i);
    i += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    let extended = false;
    if (size === 0xfff) {
      size = buf.readUInt32LE(i);
      i += 4;
      extended = true;
    }
    if (i + size > buf.length) throw new Error(`record overruns stream at offset ${i}`);
    out.push({ tag, level, data: buf.subarray(i, i + size), extended });
    i += size;
  }
  if (i !== buf.length) throw new Error(`trailing ${buf.length - i} bytes after last record`);
  return out;
}

export function serializeRecords(records: readonly HwpRecord[]): Buffer {
  const parts: Buffer[] = [];
  for (const r of records) {
    const size = r.data.length;
    if (size >= 0xfff || r.extended) {
      // HM-05/06 — 원본이 확장 형식이면 크기가 작아도 확장 유지
      const h = Buffer.alloc(8);
      h.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (0xfff << 20)) >>> 0, 0);
      h.writeUInt32LE(size, 4);
      parts.push(h);
    } else {
      const h = Buffer.alloc(4);
      h.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | (size << 20)) >>> 0, 0);
      parts.push(h);
    }
    parts.push(r.data);
  }
  return Buffer.concat(parts);
}

// ── PARA_TEXT 디코딩 ─────────────────────────────────────────
// UTF-16LE. 제어 문자 폭 (HWP 5.0 표준):
//   char(1유닛):     0, 10, 13, 24~31
//   inline(8유닛):   4~9, 19, 20
//   extended(8유닛): 1, 2, 3, 11, 12, 14~18, 21, 22, 23
const CHAR_CTRL = new Set([0, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
const WIDE_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

/**
 * HM-39 — **10은 줄바꿈이다. 버리면 안 된다.**
 *
 * 예전에는 다른 제어 문자와 같이 지웠는데, 그러면 왕복이 깨진다:
 * 한 칸에 두 줄을 적은 제출물을 읽으면 `\n`이 들어오고(HM-13: 여러 문단을 `\n`으로 잇는다),
 * 그 글자를 그대로 써 넣으면 0x0A로 저장되며, 다시 읽을 때 사라진다 →
 * 병합 자체 점검(HM-22)이 「내용이 다르다」로 판단해 **그 주 병합이 통째로 멈춘다.**
 *
 * 2026-09-03 14:01에 실제로 그랬다. 한 부서원이 낸 칸이 두 줄이었고
 * (「국립세종도서관 …자료 제공 ⏎ 2026년 1월~현재 …목록」), 자동 병합이 1분마다
 * 재시도하며 계속 실패했다. 아무도 손대지 않았는데 어느 주 갑자기 멈추는 종류다.
 *
 * `\n`으로 살려 두면 읽기·쓰기가 같은 글자를 뜻하게 되고, 병합본에도 줄바꿈이 그대로 남는다.
 */
const LINE_BREAK = 10;

/** 문단 텍스트 추출 — 제어 문자 제거. 문단 끝 CR(13)도 제거된다. 줄바꿈(10)은 `\n`으로 */
export function paraText(data: Buffer): string {
  let out = '';
  let i = 0;
  while (i + 2 <= data.length) {
    const c = data.readUInt16LE(i);
    if (c === LINE_BREAK) {
      out += '\n';
      i += 2;
    } else if (CHAR_CTRL.has(c)) {
      i += 2;
    } else if (WIDE_CTRL.has(c)) {
      i += 16; // 8 code units
    } else {
      out += String.fromCharCode(c);
      i += 2;
    }
  }
  return out;
}
