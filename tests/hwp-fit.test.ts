// RH-39 — 긴 칸을 한 줄 덜 쓰게 자간을 조금 줄인다(어림). 사람이 손으로 하던 범위(-21)까지만.
import { describe, expect, it } from 'vitest';
import { FLOOR, estimateLines, fitSpacing } from '@/lib/hwp/fit';

const m = { size: 1000, ratio: 100, relSize: 100, spacing: -6 }; // 10pt · 장평 100 · 자간 -6 (연구 본부 항목 칸)

describe('RH-39 — 자간 자동 맞춤', () => {
  it('[RH-T40] 한글 1em · 그 밖 0.5em로 어림한다 · 줄바꿈은 줄마다', () => {
    expect(estimateLines('가'.repeat(10), 20000, m, 0)).toBe(1);
    expect(estimateLines('가'.repeat(30), 20000, m, 0)).toBe(2);
    expect(estimateLines('a'.repeat(30), 20000, m, 0)).toBe(1);
    expect(estimateLines('가나\n다라', 20000, m, 0)).toBe(2);
  });

  it('[RH-T41] 한 줄을 아낄 수 있으면 가장 덜 줄인 자간 · 이미 한 줄이거나 바닥까지 줄여도 못 아끼면 손대지 않는다', () => {
    const s = fitSpacing('가'.repeat(22), 20000, m);
    expect(s).not.toBeNull();
    expect(s!).toBeLessThan(-6);
    expect(s!).toBeGreaterThanOrEqual(FLOOR);
    expect(estimateLines('가'.repeat(22), 20000, m, s!)).toBe(1);
    expect(fitSpacing('가'.repeat(5), 20000, m)).toBeNull();
    expect(fitSpacing('가'.repeat(40), 20000, m)).toBeNull(); // 2줄 → 1줄은 바닥으로도 못 한다
    expect(fitSpacing('', 20000, m)).toBeNull();
  });
});
