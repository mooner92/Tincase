// S-04 — 파일 저장. 경로는 항상 DB 값으로만 조립 (ST-03), 원자적 쓰기 (ST-10).
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './env';

const ROOT = path.resolve(env.STORAGE_ROOT);

export function storageRoot(): string {
  return ROOT;
}

/** ST-03 — 경로 세그먼트 방어 (DB 값에도 2중 적용) */
export function sanitizeSegment(s: string): string {
  const out = s.replace(/[/\\:*?"<>|\s]/g, '').replace(/^\.+/, '').trim();
  if (!out) throw new Error('empty path segment');
  return out;
}

/** 상대경로 → 절대경로. ROOT 이탈 시 예외 (ST-03) */
export function resolveInRoot(rel: string): string {
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error('path escape');
  return abs;
}

/** ST-02 — 제출 파일 상대경로 */
export function submissionRelPath(
  divisionSlug: string,
  year: number,
  weekLabel: string,
  userName: string,
  version: number,
): string {
  return path.join(
    'divisions',
    sanitizeSegment(divisionSlug),
    'submissions',
    String(year),
    sanitizeSegment(weekLabel.replace(/ /g, '_')),
    `${sanitizeSegment(userName)}_v${version}.hwp`,
  );
}

/** ST-19 — 부서 양식 상대경로 */
export function templateRelPath(divisionSlug: string, version: number, active = false): string {
  const dir = path.join('divisions', sanitizeSegment(divisionSlug), 'template');
  return active ? path.join(dir, 'active.hwp') : path.join(dir, `v${version}.hwp`);
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** ST-10 — tmp에 쓴 뒤 rename. 디렉터리는 자동 생성 (ST-11) */
export async function writeFileAtomic(rel: string, data: Buffer): Promise<void> {
  const abs = resolveInRoot(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o750 });
  const tmpDir = path.join(ROOT, 'tmp');
  await fs.mkdir(tmpDir, { recursive: true, mode: 0o750 });
  const tmp = path.join(tmpDir, `${randomUUID()}.part`);
  try {
    await fs.writeFile(tmp, data, { mode: 0o640 });
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.rm(tmp, { force: true }); // ST-T09: 실패 시 잔여물 없음
    throw e;
  }
}

export async function readStoredFile(rel: string): Promise<Buffer> {
  return fs.readFile(resolveInRoot(rel));
}

export async function fileExists(rel: string): Promise<boolean> {
  try {
    await fs.access(resolveInRoot(rel));
    return true;
  } catch {
    return false;
  }
}

/** OPS-05 — 기동 시 tmp 청소 */
export function cleanTmpSync(): void {
  const tmpDir = path.join(ROOT, 'tmp');
  if (!existsSync(tmpDir)) return;
  for (const f of readdirSync(tmpDir)) {
    try {
      rmSync(path.join(tmpDir, f), { force: true });
    } catch {
      /* 청소 실패는 치명 아님 */
    }
  }
}

/** 저장소 쓰기 가능 확인 (health용) */
export async function storageWritable(): Promise<boolean> {
  try {
    mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    const probe = path.join(ROOT, 'tmp', `.health-${randomUUID()}`);
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** ST-13 — RFC 5987 Content-Disposition (한글 파일명 + ASCII 폴백) */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
