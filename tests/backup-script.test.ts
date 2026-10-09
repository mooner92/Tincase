// OPS-08 · OPS-08a — 야간 파일 백업(scripts/backup.sh files)이 **복원에 필요한 디렉터리를 모두** 묶는다.
//
// 2026-10-10 점검: files 묶음은 divisions/(와 있으면 org/)만 담았다. 전사 표준 양식(ST-20 — templates/standard.hwp와 이력)은 빠져 있어,
// DB로 복원하면 StandardTemplate 행은 있는데 파일이 없다 — 각 부서가 양식을 만드는 원본이 사라진다.
//   OPS-T42  divisions · org · templates를 묶는다(있을 때만 — 없는 서버에서 tar가 실패하지 않게) · NFS가 안 붙어 있으면 아무것도 쓰지 않고 멈춘다
//
// 운영 경로(/data/worklog · /mnt/backup)는 건드리지 않는다 — 시험만 쓰는 두 변수(BACKUP_DATA_ROOT · BACKUP_MOUNT)로 임시 디렉터리를 가리키고,
// `mountpoint`는 바꿔 끼운다. docker도 sudo도 부르지 않는다(files 모드는 둘 다 쓰지 않는다).
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/backup.sh');
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};
const put = (root: string, rel: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), 'x');
};

/** files 모드를 돌린다 — mounted면 `mountpoint`가 0을 돌려준다 */
function runFiles(data: string, mounted = true) {
  const mount = tmp('tincase-bk-mnt-');
  const bin = tmp('tincase-bk-bin-');
  writeFileSync(path.join(bin, 'mountpoint'), `#!/bin/sh\nexit ${mounted ? 0 : 1}\n`);
  chmodSync(path.join(bin, 'mountpoint'), 0o755);
  const r = spawnSync('bash', [SCRIPT, 'files'], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, BACKUP_DATA_ROOT: data, BACKUP_MOUNT: mount },
  });
  const filesDir = path.join(mount, 'worklog', 'files');
  const tarball = existsSync(filesDir) ? readdirSync(filesDir).find((f) => /^divisions-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f)) : undefined;
  const listing = tarball ? spawnSync('tar', ['tzf', path.join(filesDir, tarball)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : [];
  return { ...r, tarball, listing, mount };
}

describe('[OPS-T42] ★ 파일 백업은 divisions · org · templates를 묶는다 (OPS-08a)', () => {
  it('셋 다 있으면 셋 다 — 전사 표준 양식(templates/)이 들어간다', () => {
    const data = tmp('tincase-bk-data-');
    put(data, 'divisions/Some_Div/template/active.hwp');
    put(data, 'org/sections/upload.hwp');
    put(data, 'templates/standard.hwp');
    put(data, 'templates/standard-v1.hwp');
    put(data, 'db/worklog.db'); // DB는 files 묶음이 아니다(db 모드가 .backup으로)
    const r = runFiles(data);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\[backup\] files ok: .*\[divisions org templates\]/);
    expect(r.listing).toEqual(expect.arrayContaining(['divisions/Some_Div/template/active.hwp', 'org/sections/upload.hwp', 'templates/standard.hwp', 'templates/standard-v1.hwp']));
    expect(r.listing.some((f) => f.startsWith('db/'))).toBe(false);
  });

  it('없는 디렉터리는 빼고 묶는다 — org·templates가 없는 서버에서도 tar가 실패하지 않는다', () => {
    const data = tmp('tincase-bk-data-');
    put(data, 'divisions/Some_Div/template/active.hwp');
    const r = runFiles(data);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('[divisions]');
    expect(r.listing).toContain('divisions/Some_Div/template/active.hwp');
  });

  it('NFS가 붙어 있지 않으면 아무것도 쓰지 않고 멈춘다 (OPS-08)', () => {
    const data = tmp('tincase-bk-data-');
    put(data, 'divisions/Some_Div/template/active.hwp');
    const r = runFiles(data, false);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[backup] FATAL');
    expect(existsSync(path.join(r.mount, 'worklog'))).toBe(false);
  });
});
