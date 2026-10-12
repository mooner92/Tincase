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

/**
 * UI-T94 · PG-82 — **흰 무대의 대비.** 사용자: 「배경을 검은색 말고 흰색으로 — 프레젠터로 발표할 거라 흰 배경」.
 * 강당 프로젝터는 바탕에 빛이 더해져 대비가 떨어진다 — 무대 글자는 7:1 이상(AAA), 경계(말풍선·고리·구멍)는 3:1 이상(WCAG 1.4.11),
 * 주변광(흰색 휘도의 +0.1)을 더해 계산해도 3:1 이상. 값은 globals.css의 토큰에서 읽는다 — 토큰을 바꾸면 이 표가 다시 잰다.
 */
describe('UI-T94 흰 무대 대비 (PG-82 · CP-105 개정)', () => {
  const css = readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
  const token = (name: string): string => {
    const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`토큰 없음: ${name}`);
    return m[1];
  };
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a: number[], b: number[], ambient = 0) => {
    const [x, y] = [lum(a) + ambient, lum(b) + ambient].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** 그늘(검정 α) 밑의 색 */
  const dimmed = (c: number[], alpha: number) => c.map((v) => v * (1 - alpha));
  const DIM = 0.55;

  it('[UI-T94] 그늘은 55% 하나 — 무대·둘러보기 같은 값', () => {
    expect(css).toMatch(/rgb\(0 0 0 \/ var\(--coach-dim, 0\.55\)\)/);
    expect(readFileSync(path.join(SRC, 'components/Tour.tsx'), 'utf8')).toMatch(/rgb\(0 0 0 \/ 0\.55\)/);
    // 휴대폰·인쇄 잘라 보기는 45%
    expect(css).toMatch(/0 0 0 3000px rgb\(0 0 0 \/ 0\.45\)/);
  });

  it('[UI-T94] 무대 글자 7:1 이상 · 보조 글자 · 강조 · 진행 막대', () => {
    const stage = rgb(token('stage'));
    expect(token('stage').toLowerCase()).toBe('#ffffff');
    expect(token('blackout').toLowerCase()).toBe('#000000');
    expect(ratio(rgb(token('stage-ink')), stage)).toBeGreaterThanOrEqual(7);
    expect(ratio(rgb(token('body')), stage)).toBeGreaterThanOrEqual(7); // 장 카드의 한 줄
    expect(ratio(rgb(token('stage-muted')), stage)).toBeGreaterThanOrEqual(7);
    expect(ratio(rgb(token('stage-muted')), rgb(token('stage-soft')))).toBeGreaterThanOrEqual(4.5); // 흐름 칸 — 31px 큰 글자
    expect(ratio(rgb(token('brand')), stage)).toBeGreaterThanOrEqual(7); // 주소의 /guide · 칩
    expect(ratio(rgb(token('canvas')), rgb(token('brand')))).toBeGreaterThanOrEqual(7); // 칩·버튼 그림 위 흰 글자
    expect(ratio(rgb(token('brand')), rgb(token('stage-line')))).toBeGreaterThanOrEqual(3); // 진행 막대
    // brand-tint는 흰 바탕에서 3:1도 안 된다 — 무대에서 쓰지 않는 이유
    expect(ratio(rgb(token('brand-tint')), stage)).toBeLessThan(3);
  });

  it('[UI-T94] 경계 3:1 이상 — 55% 그늘 위의 흰 말풍선·고리 (주변광 +0.1에서도)', () => {
    const white = rgb(token('canvas'));
    const onWhite = dimmed(rgb(token('stage')), DIM); // 그늘 밑 흰 화면 ≈ #737373
    const onGround = dimmed(rgb(token('ground')), DIM); // 그늘 밑 회색 바닥
    expect(ratio(white, onWhite)).toBeGreaterThanOrEqual(3);
    expect(ratio(white, onGround)).toBeGreaterThanOrEqual(3);
    expect(ratio(white, onGround, 0.1)).toBeGreaterThanOrEqual(3);
    expect(ratio(white, onWhite, 0.1)).toBeGreaterThanOrEqual(3);
    // 말풍선 안 글자는 흰 면 위 — 꼬리말(stage-muted)도 4.5:1 이상
    expect(ratio(rgb(token('stage-muted')), white)).toBeGreaterThanOrEqual(4.5);
  });

  it('[UI-T94] 무대 파일은 brand-tint를 쓰지 않고, 검은 화면은 bg-blackout · 검은 무대(theme="dark")는 없다', () => {
    for (const f of ['GuideStage', 'GuideSelf', 'GuidePresent', 'CoachParts', 'Tour']) {
      const src = readFileSync(path.join(SRC, `components/${f}.tsx`), 'utf8');
      expect(src, f).not.toMatch(/brand-tint/);
      expect(src, f).not.toMatch(/theme="dark"|StageTheme/);
    }
    const present = readFileSync(path.join(SRC, 'components/GuidePresent.tsx'), 'utf8');
    expect(present).toMatch(/aria-label="검은 화면" className="fixed inset-0 z-50 bg-blackout"/);
    // 손 윤곽은 짙은 잉크 — 흰 구멍 위에서 사라지지 않게
    expect(css).toMatch(/\.coach-hand rect \{\s*fill: var\(--color-canvas\);\s*stroke: var\(--color-stage-ink\);/);
  });
});
