// OPS-51 — 분류 순서 초안 스크립트(`scripts/apply-merge-rule-drafts.ts`)의 `--only`.
//
// 운영 DB에 손으로 돌리는 스크립트라 지키는 것은 셋이다: 고른 부서만 쓴다 · 모르는 이름이면 아무것도 쓰지 않고 멈춘다 ·
// `--only`가 없으면 예전과 같다. 이름 읽기·고르기는 DB 없이, 나머지는 임시 DB에 실제로 돌려 본다(운영과 같은 `npx tsx` 길).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { onlyNames, pickDrafts } from '../scripts/lib/merge-rule-drafts';

const root = path.resolve(__dirname, '..');

describe('[OPS-T38] --only — 이름 읽기 · 고르기', () => {
  it('없으면 null — 초안 전부(예전과 같다)', () => {
    expect(onlyNames([])).toBeNull();
    expect(onlyNames(['--apply'])).toBeNull();
  });

  it('쉼표로 여럿 · 앞뒤 공백을 뗀다 · 여러 번 주면 합치고 한 번씩', () => {
    expect(onlyNames(['--only=기획조정실'])).toEqual(['기획조정실']);
    expect(onlyNames(['--apply', '--only= 기획조정실 , 인사관리실,'])).toEqual(['기획조정실', '인사관리실']);
    expect(onlyNames(['--only=가', '--only=나,가'])).toEqual(['가', '나']);
  });

  it('값이 없는 --only는 던진다 — 「전부」로 읽으면 고르려던 사람이 모든 부서를 쓴다', () => {
    for (const argv of [['--only'], ['--only='], ['--only=,'], ['--only=  '], ['--only', '기획조정실'], ['--only=가', '--only']]) {
      expect(() => onlyNames(argv), argv.join(' ')).toThrow('--only=<부서명>');
    }
  });

  it('고르기 — 초안 순서대로 · 나머지는 건너뜀 · 초안에 없는 이름은 따로 모은다', () => {
    const drafts = ['기획조정실', '인사관리실'];
    expect(pickDrafts(drafts, null)).toEqual({ picked: drafts, skipped: [], unknown: [] });
    expect(pickDrafts(drafts, ['기획조정실'])).toEqual({ picked: ['기획조정실'], skipped: ['인사관리실'], unknown: [] });
    expect(pickDrafts(drafts, ['인사관리실', '기획조정실'])).toEqual({ picked: drafts, skipped: [], unknown: [] });
    expect(pickDrafts(drafts, ['기획조정싫', '인사관리실'])).toEqual({ picked: ['인사관리실'], skipped: ['기획조정실'], unknown: ['기획조정싫'] });
  });
});

describe('[OPS-T38] 실제로 돌려 본다 — 임시 DB · tsx', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'merge-rule-drafts-'));
  const url = `file:${path.join(tmp, 'w.db')}`;
  let prisma: PrismaClient;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url } } });
    // 초안이 있는 두 부서 — 둘 다 분류가 비어 있다(월요일 아침 그대로). 이름은 스크립트가 찾는 이름 그대로여야 한다
    for (const [i, nameKo] of ['기획조정실', '인사관리실'].entries()) {
      ids[nameKo] = (await prisma.division.create({ data: { slug: `Drafts_${i}`, nameKo, nameEn: `D${i}` } })).id;
    }
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    rmSync(tmp, { recursive: true, force: true });
  });

  const run = (...args: string[]) =>
    spawnSync('npx', ['tsx', 'scripts/apply-merge-rule-drafts.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url, ACTOR: 'op@test.local' },
      timeout: 60_000,
    });
  const categories = async () =>
    Object.fromEntries((await prisma.division.findMany()).map((d) => [d.nameKo, d.mergeCategories]));

  it('초안에 없는 이름 → 종료 코드 2 · 그 이름을 말한다 · 아무것도 쓰지 않는다', async () => {
    const r = run('--only=기획조정싫', '--apply');
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stderr).toContain('기획조정싫');
    expect(r.stdout).not.toContain('반영했습니다');
    expect(await categories()).toEqual({ 기획조정실: '', 인사관리실: '' });
    expect(await prisma.auditLog.count()).toBe(0);
    expect(run('--only', '기획조정실', '--apply').status).toBe(2); // 값 없는 --only도 같다
    expect(await categories()).toEqual({ 기획조정실: '', 인사관리실: '' });
  }, 90_000);

  it('--only=기획조정실 --apply → 기획조정실만 쓴다 · 인사관리실은 「건너뜀」으로 찍고 비운 채 · 감사 한 줄', async () => {
    const r = run('--only=기획조정실', '--apply');
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('• 기획조정실: mergeCategories');
    expect(r.stdout).toContain('- 인사관리실: 건너뜀 (--only 밖)');
    expect(r.stdout).toContain('반영했습니다.');
    const after = await categories();
    expect(after.기획조정실).not.toBe('');
    expect(after.인사관리실).toBe('');
    const audits = await prisma.auditLog.findMany();
    expect(audits.map((a) => [a.actor, a.action, a.divisionId, JSON.parse(a.detail ?? '{}')])).toEqual([
      ['op@test.local', 'rule_update', ids.기획조정실, { fields: ['mergeCategories'], via: 'apply-merge-rule-drafts' }],
    ]);
  }, 90_000);

  it('--only 없는 미리 보기는 예전과 같다 — 초안 부서를 모두 보고(건너뜀 없음) 쓰지 않는다', async () => {
    const r = run();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('= 기획조정실: 바꿀 것 없음');
    expect(r.stdout).toContain('• 인사관리실: mergeCategories');
    expect(r.stdout).not.toContain('건너뜀');
    expect(r.stdout).toContain('미리 보기입니다');
    expect((await categories()).인사관리실).toBe('');
    expect(await prisma.auditLog.count()).toBe(1);
  }, 90_000);
});
