// CP-109 — 복사는 모두 `copyText`를 거친다.
//
// 사내망은 평문 http라 `navigator.clipboard`가 **아예 없다** (src/lib/clipboard.ts 실측). 그 객체를 바로 부른
// 버튼(전사 현황의 [안내문 복사])은 눌러도 아무 일이 없었다 — 시험 화면을 localhost(보안 컨텍스트)에서 찍어
// 아무도 몰랐다. 눈으로는 못 잡는 종류라 소스를 검사한다: 대체 경로를 가진 한 곳 밖에서는 부르지 않는다.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');
const ALLOWED = path.join('lib', 'clipboard.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

describe('CP-109 클립보드는 한 곳에서', () => {
  it('[CP-T96] src/lib/clipboard.ts 밖에서 navigator.clipboard를 부르지 않는다', () => {
    const hits = walk(SRC)
      .filter((f) => path.relative(SRC, f) !== ALLOWED)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${path.relative(SRC, f)}:${i + 1}` }))
          .filter(({ line }) => /navigator\s*\.\s*clipboard/.test(line) && !/^\s*(\/\/|\*)/.test(line)),
      )
      .map((h) => h.at);
    expect(hits, '복사는 copyText()로 — 사내망 http에는 navigator.clipboard가 없다').toEqual([]);
  });

  it('[CP-T96] 복사 버튼들은 copyText를 쓴다 — 결과(참·거짓)를 보고 「복사됨」을 정한다', () => {
    for (const f of ['components/NudgeButton.tsx', 'components/CopyMissingButton.tsx', 'app/ops/OpsClient.tsx']) {
      const src = readFileSync(path.join(SRC, f), 'utf8');
      expect(src, f).toContain("from '@/lib/clipboard'");
      expect(src, f).toMatch(/const ok = await copyText\(/);
    }
  });
});
