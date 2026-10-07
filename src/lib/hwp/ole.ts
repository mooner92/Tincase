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
  /**
   * DocInfo 압축 해제 스트림 (HM-37).
   *
   * 글자 서식(색·굵기·글꼴)은 본문이 아니라 **여기**에 있다. 본문은 「몇 번 서식」이라는
   * 번호만 들고 있어서, 파란 글자를 알아보려면 이 스트림을 같이 읽어야 한다.
   */
  docInfo: Buffer;
  /** PrvText 평문 (있으면) — 디버깅·폴백용, 정본 아님 */
  previewText: string | null;
}

/*
 * ST-07 — 압축 해제 **상한**. deflate는 0으로 채운 데이터를 약 1000:1로 줄인다 — 상한이 없을 때 260KB짜리 가짜
 * hwp 하나가 256MiB로 풀리며 이벤트 루프를 2.3초 멈췄다(20MB 업로드면 약 20GB). 로그인한 부서원 한 명이 전 부서의
 * 제출·병합을 멈출 수 있었다. 실제 업무일지 섹션은 수백 KB, 병합본도 몇 MB라 이 값은 그 수십 배다.
 */
export const INFLATE_LIMITS = { stream: 64 * 1024 * 1024, total: 128 * 1024 * 1024 } as const;
export type InflateLimits = { stream: number; total: number };

/** 상한까지만 푼다. 넘으면 끝까지 풀지 않고 멈춘다 — 다 풀고 나서 재면 이미 늦다 */
function inflateBounded(raw: Buffer, name: string, perStream: number, budget: number): Buffer {
  const limit = Math.min(perStream, budget);
  if (limit < 1) throw new HwpFormatError('decompress_failed', `${name}을(를) 풀기 전에 합계 한도를 넘었습니다`);
  try {
    return inflateRawSync(raw, { maxOutputLength: limit }); // HM-07: raw deflate
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new HwpFormatError('decompress_failed', `${name}이(가) 풀면 너무 큽니다 (한도 ${Math.floor(limit / 1024 / 1024)}MB)`);
    }
    throw new HwpFormatError('decompress_failed', `${name} 압축 해제에 실패했습니다`);
  }
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

/** .hwp 열기 + 구조 검증 (ST-07 1~5). `limits`는 시험용 — 운영 경로는 넘기지 않는다 */
export function openHwp(buf: Buffer, limits: InflateLimits = INFLATE_LIMITS): HwpFile {
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

  // 섹션을 여러 개 넣어 한도를 나눠 쓰는 것도 막는다 — 스트림마다 64MiB여도 합계는 128MiB까지 (ST-07)
  let budget = limits.total;
  const sections: Buffer[] = [];
  for (const n of sectionIdx) {
    const raw = streamOf(cf, `BodyText/Section${n}`);
    if (!raw) throw new HwpFormatError('no_body', `BodyText/Section${n}을 읽을 수 없습니다`);
    const sec = compressed ? inflateBounded(raw, `Section${n}`, limits.stream, budget) : raw;
    budget -= sec.length;
    sections.push(sec);
  }

  const diRaw = streamOf(cf, 'DocInfo');
  if (!diRaw) throw new HwpFormatError('no_body', 'DocInfo가 없습니다');
  const docInfo = compressed ? inflateBounded(diRaw, 'DocInfo', limits.stream, budget) : diRaw;

  const prv = streamOf(cf, 'PrvText');
  const previewText = prv ? prv.toString('utf16le').replace(/\0+$/, '') : null;

  return { version, compressed, sections, docInfo, previewText };
}
