// S-08 L0 — OLE 컨테이너 접근 (cfb 래핑) + FileHeader 판정.
// Phase 1은 읽기 전용. 쓰기는 Phase 2 (writer.ts)에서.
import * as CFB from 'cfb';
import { inflateRawSync } from 'node:zlib';

const HWP_SIGNATURE = 'HWP Document File'; // FileHeader[0:17], ASCII (실측 확인)

export class HwpFormatError extends Error {
  constructor(
    public readonly reason:
      | 'not_ole'
      | 'no_fileheader'
      | 'bad_signature'
      | 'encrypted'
      | 'no_body'
      | 'decompress_failed',
    message: string,
  ) {
    super(message);
    this.name = 'HwpFormatError';
  }
}

export interface HwpFile {
  /** HWP 버전 (FileHeader[32:36], 예: 5.1.0.0) */
  version: string;
  compressed: boolean;
  /** BodyText/Section{n} 압축 해제된 레코드 스트림, n 오름차순 */
  sections: Buffer[];
  /** PrvText 평문 (있으면) — 디버깅·폴백용, 정본 아님 */
  previewText: string | null;
}

function streamOf(cf: CFB.CFB$Container, path: string): Buffer | null {
  const entry = CFB.find(cf, '/' + path);
  if (!entry || !entry.content) return null;
  return Buffer.from(entry.content as Uint8Array);
}

/** OLE 시그니처 (D0 CF 11 E0 A1 B1 1A E1) */
export function looksLikeOle(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
    buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1
  );
}

/** ZIP 시그니처 — .hwpx를 확장자만 바꿔 올린 경우 감지 (ST-06) */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** .hwp 열기 + 구조 검증 (ST-07 1~5) */
export function openHwp(buf: Buffer): HwpFile {
  if (!looksLikeOle(buf)) throw new HwpFormatError('not_ole', 'OLE 컨테이너가 아닙니다');

  let cf: CFB.CFB$Container;
  try {
    cf = CFB.read(buf, { type: 'buffer' });
  } catch {
    throw new HwpFormatError('not_ole', 'OLE 파싱에 실패했습니다');
  }

  const fh = streamOf(cf, 'FileHeader');
  if (!fh || fh.length !== 256) throw new HwpFormatError('no_fileheader', 'FileHeader가 없거나 크기가 다릅니다');
  if (fh.subarray(0, HWP_SIGNATURE.length).toString('latin1') !== HWP_SIGNATURE) {
    throw new HwpFormatError('bad_signature', 'HWP 시그니처가 아닙니다');
  }

  const flags = fh.readUInt32LE(36);
  const compressed = (flags & 0x1) !== 0;
  if ((flags & 0x2) !== 0) {
    throw new HwpFormatError('encrypted', '암호가 설정된 파일입니다');
  }
  const version = `${fh[35]}.${fh[34]}.${fh[33]}.${fh[32]}`;

  // BodyText/Section{n} 전부 수집 (n 오름차순)
  const sectionIdx: number[] = [];
  for (const p of cf.FullPaths) {
    const m = /BodyText\/Section(\d+)$/.exec(p);
    if (m) sectionIdx.push(Number(m[1]));
  }
  sectionIdx.sort((a, b) => a - b);
  if (sectionIdx.length === 0) throw new HwpFormatError('no_body', 'BodyText/Section0이 없습니다');

  const sections: Buffer[] = [];
  for (const n of sectionIdx) {
    const raw = streamOf(cf, `BodyText/Section${n}`);
    if (!raw) throw new HwpFormatError('no_body', `BodyText/Section${n}을 읽을 수 없습니다`);
    if (compressed) {
      try {
        sections.push(inflateRawSync(raw)); // HM-07: raw deflate
      } catch {
        throw new HwpFormatError('decompress_failed', `Section${n} 압축 해제에 실패했습니다`);
      }
    } else {
      sections.push(raw);
    }
  }

  const prv = streamOf(cf, 'PrvText');
  const previewText = prv ? prv.toString('utf16le').replace(/\0+$/, '') : null;

  return { version, compressed, sections, previewText };
}
