// UI-T92·T93 — **색은 토큰으로만, 없앤 모양은 돌아오지 않게** (CP-66 · CP-97~100).
//
// 2026-10-07 「전체적으로 가독성 좀 좋게 … 컴포넌트별로 구분이 잘 안되는 부분들이 있어」에서 나왔다.
// 화면을 재 보니 한 화면에 상자 모양이 다섯, 파랑이 넷(#5b82e0 · #1d4ed8 · #9db8f5 · blue-600)이었다.
// 하나하나는 그 자리에서 그럴듯해서 넣은 것이고, 코드 리뷰는 한 줄씩 보므로 **모이는 것을 못 본다.**
// 그래서 규칙을 검사로 둔다 — UI-T90(전각 기호)과 같은 방식이다.
//
// 「공유」 파랑(hwp의 #0000ff)도 예외가 아니다. 그 색은 `emphasis` 토큰으로만 쓴다 —
// 실제 문서 색과 같아야 한다는 이유는 토큰 정의(globals.css) 한 곳에만 적혀 있으면 된다.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(p) ? [p] : [];
  });
}

/** Tailwind 임의값 hex — `bg-[#5b82e0]`, `border-[#0000ff]` */
const HEX = /\[#[0-9a-fA-F]{3,8}\]/;
/** Tailwind 기본 팔레트 — 토큰 밖의 색 (`blue-600`, `hover:bg-amber-100`) */
const PALETTE =
  /\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|via|to|accent|caret|decoration|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
/** 없앤 모양 (CP-97~100) — 칠한 카드·흰 버튼·흰색과 같은 「표면」·12px 미만·대문자 자간 라벨 */
const RETIRED = /\b(?:card-feature|card-cream|btn-oncolor|surface-card)\b|text-\[1[01]px\]|tracking-\[0\.12em\]/;

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const file of walk(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = re.exec(line);
        if (m) out.push(`${path.relative(SRC, file)}:${i + 1}  「${m[0]}」  ${line.trim().slice(0, 80)}`);
      });
  }
  return out;
}

describe('UI-T92 색은 토큰으로만 (CP-66)', () => {
  it('[UI-T92] src/**/*.tsx에 hex 임의값과 Tailwind 기본 팔레트가 없다', () => {
    const found = [...hits(HEX), ...hits(PALETTE)];
    expect(
      found,
      `색은 globals.css의 토큰으로 씁니다 (info · success · warning · error · emphasis …):\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('[UI-T92b] 검사가 실제로 잡는지 — 예전에 있던 것들', () => {
    // 이 검사를 지워도 초록불이면 검사가 아니라 장식이다
    expect(HEX.test("'bg-[#5b82e0]'")).toBe(true);
    expect(HEX.test('border-[#0000ff] bg-[#0000ff]')).toBe(true);
    expect(PALETTE.test("'border-blue-600 text-ink'")).toBe(true);
    expect(PALETTE.test('hover:bg-amber-100')).toBe(true);
    expect(PALETTE.test("d.isActive ? 'bg-green-100 text-ink'")).toBe(true);
    // 토큰은 통과한다
    expect(PALETTE.test('bg-brand text-emphasis border-info bg-success-soft text-warning')).toBe(false);
    expect(HEX.test('shadow-[0_8px_24px_rgba(10,10,10,0.08)]')).toBe(false);
  });

  it('[UI-T92c] 「공유」 파랑은 토큰 하나 — emphasis = hwp의 #0000ff', () => {
    const css = readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/--color-emphasis:\s*#0000ff;/);
  });
});

describe('UI-T93 없앤 모양이 돌아오지 않는다 (CP-97~100)', () => {
  it('[UI-T93] 칠한 카드·흰 버튼·surface-card·11px 이하 글자·대문자 자간 라벨을 쓰지 않는다', () => {
    const found = hits(RETIRED);
    expect(
      found,
      `카드는 .card 한 단계, 안쪽은 .card-section·.callout, 상태는 .chip, 글자는 12px 이상입니다:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('[UI-T93b] 없앤 클래스·토큰은 정의도 없다 — 정의가 남아 있으면 누군가 다시 쓴다', () => {
    const css = readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    for (const retired of ['.card-feature', '.card-cream', '.btn-oncolor', '--color-surface-card']) {
      expect(css.includes(retired), retired).toBe(false);
    }
    // 이것들이 있어야 새 규칙을 쓸 수 있다
    for (const kept of ['--color-ground', '.card-section', '.callout', '.chip', '.btn-ghost', '.tab-line', 'details.disclosure']) {
      expect(css.includes(kept), kept).toBe(true);
    }
    expect(RETIRED.test('text-[11px]')).toBe(true);
    expect(RETIRED.test('text-xs')).toBe(false);
  });
});
