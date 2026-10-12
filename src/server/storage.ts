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

/**
 * ST-02a (2026-10-10) — 파일 이름에 붙이는 **사람 꼬리**. 사람 id(cuid)의 끝 8자 — 무작위 구간이라 같은 이름의 두 사람이 겹칠 일이 없고,
 * 같은 사람에게는 늘 같다. 이름만 쓰던 때는 한 부서의 동명이인이 같은 주에 내면 같은 경로(`김민지_v1.hwp`)를 써서 뒤에 낸 사람이
 * 앞사람 파일을 덮었다 — 앞사람의 행은 남의 글을 가리키고, 병합에는 한 사람 것만 두 번 들어가고, 한 사람이 취소하면 다른 사람 파일이 지워졌다.
 */
export function ownerTag(userId: string): string {
  return sanitizeSegment(userId).slice(-8);
}

/**
 * ST-02 — 제출 파일 상대경로. `{이름}_{사람 꼬리}_v{판}.hwp` (ST-02a — 꼬리는 2026-10-10부터. 그 전 행은 저장된 경로 그대로 쓴다).
 * `tag`는 **DB보다 먼저 쓰는** 경로(담당자 첨삭)에 붙는 고유 꼬리다 — 같은 v+1 자리를 다른 요청이
 * 동시에 노려도 서로의 파일을 덮거나 지우지 않게 한다 (`reviseSubmission`)
 */
export function submissionRelPath(
  divisionSlug: string,
  year: number,
  weekLabel: string,
  owner: { id: string; name: string },
  version: number,
  tag?: string,
): string {
  return path.join(
    'divisions',
    sanitizeSegment(divisionSlug),
    'submissions',
    String(year),
    sanitizeSegment(weekLabel.replace(/ /g, '_')),
    `${sanitizeSegment(owner.name)}_${ownerTag(owner.id)}_v${version}${tag ? `_${sanitizeSegment(tag)}` : ''}.hwp`,
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
