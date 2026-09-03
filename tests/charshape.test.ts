// HM-37 — 글자 색. **왕복으로 확인한다**: 파랗게 써 넣고 → 다시 읽어 강조로 잡히는가.
//
// 이 스위트가 지키는 건 「색이 보인다」가 아니라 **「낸 사람이 표시한 뜻이 살아남는가」**다.
// 색은 조용히 사라지는 종류의 정보다 — 병합본을 열어 보지 않으면 아무도 모른다.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openHwp } from '@/lib/hwp/ole';
import { parseRecords, serializeRecords } from '@/lib/hwp/record';
import { fillTable, packHwp, plainShapeIdOf } from '@/lib/hwp/writer';
import { readWorklog } from '@/lib/hwp/reader';
import {
  BLUE,
  charShapeColors,
  colorToHex,
  declaredCharShapeCount,
  ensureColorShape,
  isEmphasis,
  DI_TAG,
} from '@/lib/hwp/charshape';

const FIX = path.resolve(__dirname, '../fixtures');
const TEMPLATE = path.join(FIX, 'master-template.hwp');
const hasFixtures = existsSync(TEMPLATE);
const d = hasFixtures ? describe : describe.skip;

describe('HM-37 색 해석 — 순수 계산', () => {
  /*
   * **바이트 순서를 여기서 못박는다.** COLORREF는 0x00BBGGRR이라 눈으로는 절대 안 보인다:
   * 0x0000ff를 「파랑」으로 읽으면 코드가 조용히 반대로 동작하고, 그때 증상은
   * «빨간 줄이 강조로 나가고 파란 줄이 사라지는» 것이다.
   *
   * 근거는 charshape.ts 머리주석에 적었다 — fixtures 3종 전부에 0x0000ff(빨강)가 있고,
   * 그건 전사 양식의 빨간 ※ 안내문 색이다.
   */
  it('[HM-T60] COLORREF는 BGR — 0x0000ff는 빨강, 0xff0000이 파랑', () => {
    expect(colorToHex(0x0000ff)).toBe('#ff0000'); // 빨강
    expect(colorToHex(0xff0000)).toBe('#0000ff'); // 파랑
    expect(colorToHex(BLUE)).toBe('#0000ff');
  });

  it('[HM-T61] 검정·회색은 강조가 아니다 — 색을 안 쓴 것이다', () => {
    expect(isEmphasis(0x000000)).toBe(false);
    expect(isEmphasis(0xffffff)).toBe(false); // 흰색
    expect(isEmphasis(0xc0c0c0)).toBe(false); // 회색
    expect(isEmphasis(0x333333)).toBe(false);
  });

  it('[HM-T62] 규칙은 파랑이지만 판정은 넓다 — 빨강·남색도 강조로 본다', () => {
    // 사람은 규칙대로만 쓰지 않는다. 놓친 강조는 낸 사람의 뜻이 사라지는 것이라,
    // 좁게 잡아 놓치는 것보다 넓게 잡아 담당자가 끄는 편이 싸다
    expect(isEmphasis(BLUE)).toBe(true);
    expect(isEmphasis(0x0000ff)).toBe(true); // 빨강
    expect(isEmphasis(0x800000)).toBe(true); // 남색(BGR) — 진한 파랑
  });
});

d('HM-37 DocInfo 서식 추가', () => {
  const di = () => parseRecords(openHwp(readFileSync(TEMPLATE)).docInfo);

  it('[HM-T63] ID_MAPPINGS가 말하는 개수와 실제 레코드 수가 같다', () => {
    const recs = di();
    const actual = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;
    expect(declaredCharShapeCount(recs)).toBe(actual);
  });

  it('[HM-T64] 서식을 넣으면 개수도 같이 오른다 — 안 맞으면 한글이 문서를 못 읽는다', () => {
    const recs = di();
    const before = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;

    const id = ensureColorShape(recs, 14, BLUE);
    expect(id).toBe(before); // 새 번호 = 기존 개수

    const after = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;
    expect(after).toBe(before + 1);
    expect(declaredCharShapeCount(recs)).toBe(after);
    expect(charShapeColors(recs)[id!]).toBe(BLUE);
  });

  it('[HM-T65] 두 번 불러도 하나만 생긴다 — 매주 병합할 때마다 불어나면 안 된다', () => {
    const recs = di();
    const before = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;
    const a = ensureColorShape(recs, 14, BLUE);
    const b = ensureColorShape(recs, 14, BLUE);
    expect(b).toBe(a);
    expect(recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length).toBe(before + 1);
  });

  it('[HM-T66] 복제본은 **색만** 다르다 — 글꼴·크기가 바뀌면 강조가 아니라 사고로 보인다', () => {
    const recs = di();
    const base = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE)[14];
    const id = ensureColorShape(recs, 14, BLUE)!;
    const made = recs.filter((r) => r.tag === DI_TAG.CHAR_SHAPE)[id];

    expect(made.data.length).toBe(base.data.length);
    for (let i = 0; i < base.data.length; i++) {
      if (i >= 52 && i < 56) continue; // 글자색
      expect(made.data[i], `offset ${i}`).toBe(base.data[i]);
    }
  });

  it('[HM-T67] 없는 서식번호를 주면 null — 조용히 엉뚱한 것을 복제하지 않는다', () => {
    expect(ensureColorShape(di(), 9999, BLUE)).toBeNull();
  });
});

d('HM-37 왕복 — 파랗게 쓰고 다시 읽는다', () => {
  /** 양식에 세 줄을 넣되 가운데 줄만 강조로 */
  function build(): Buffer {
    const src = readFileSync(TEMPLATE);
    const file = openHwp(src);
    const recs = parseRecords(file.sections[0]);
    const diRecs = parseRecords(file.docInfo);

    const plain = plainShapeIdOf(recs, 0);
    expect(plain).not.toBeNull();
    const blue = ensureColorShape(diRecs, plain!, BLUE);
    expect(blue).not.toBeNull();

    const rows = [
      ['1-1', '보통 줄입니다', '', '', ''],
      ['1-2', '파란 줄입니다', '', '', ''],
      ['1-3', '또 보통 줄', '', '', ''],
    ];
    fillTable(recs, 0, rows, { emphasis: [false, true, false], emphasisShapeId: blue });
    return packHwp(src, [serializeRecords(recs)], serializeRecords(diRecs));
  }

  it('[HM-T68] 강조한 줄만 강조로 다시 읽힌다', () => {
    const out = readWorklog(build()).worklog.achievements;
    expect(out.map((r) => `${r.content}:${r.emphasis ? '강조' : '보통'}`)).toEqual([
      '보통 줄입니다:보통',
      '파란 줄입니다:강조',
      '또 보통 줄:보통',
    ]);
  });

  it('[HM-T69] 강조 줄의 색이 실제로 파랑이다', () => {
    const file = openHwp(build());
    const colors = charShapeColors(parseRecords(file.docInfo));
    expect(colors.some((c) => c === BLUE)).toBe(true);
    expect(colorToHex(BLUE)).toBe('#0000ff');
  });

  it('[HM-T70] 강조가 없으면 DocInfo에 서식이 늘지 않는다', () => {
    const src = readFileSync(TEMPLATE);
    const file = openHwp(src);
    const recs = parseRecords(file.sections[0]);
    const before = parseRecords(file.docInfo).filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;

    fillTable(recs, 0, [['1-1', '보통 줄', '', '', '']], { emphasis: [false] });
    const out = packHwp(src, [serializeRecords(recs)]);

    const after = parseRecords(openHwp(out).docInfo).filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;
    expect(after).toBe(before);
  });

  it('[HM-T71] 만든 파일이 다시 열린다 — 표·행 수가 그대로다', () => {
    const parsed = readWorklog(build());
    expect(parsed.tables.length).toBeGreaterThanOrEqual(2);
    expect(parsed.worklog.achievements).toHaveLength(3);
  });
});

d('HM-37 병합까지 살아남는가 — 끝에서 끝까지', () => {
  /*
   * 색은 **조용히 사라지는 정보**다. 중간 어느 단계에서 뭉개져도 화면은 멀쩡하고,
   * 병합본을 한글로 열어 본 사람만 안다. 그래서 단계마다 끊어 보지 않고
   * 「낸 것 → 병합본」 한 줄로 확인한다.
   */
  const templateBytes = () => readFileSync(TEMPLATE);

  /** 제출본 하나를 만든다 (웹 작성 경로가 하는 일과 같은 순서) */
  function submission(rows: [string, boolean][]): Buffer {
    const src = templateBytes();
    const file = openHwp(src);
    const recs = parseRecords(file.sections[0]);
    const diRecs = parseRecords(file.docInfo);
    const wantEmph = rows.some(([, e]) => e);
    const blue = wantEmph ? ensureColorShape(diRecs, plainShapeIdOf(recs, 0)!, BLUE) : null;
    fillTable(
      recs,
      0,
      rows.map(([c], i) => [`1-${i + 1}`, c, '', '', '']),
      { emphasis: rows.map(([, e]) => e), emphasisShapeId: blue },
    );
    return packHwp(src, [serializeRecords(recs)], blue === null ? undefined : serializeRecords(diRecs));
  }

  it('[HM-T72] 낸 파일의 강조가 병합본까지 간다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');

    // 두 사람이 냈고, 각자 한 줄씩 「공유」로 표시했다
    const a = readWorklog(submission([['가 부서원의 보통 업무', false], ['가 부서원의 공유 사항', true]]));
    const b = readWorklog(submission([['나 부서원의 공유 사항', true], ['나 부서원의 보통 업무', false]]));

    const all = [...a.worklog.achievements, ...b.worklog.achievements];
    expect(all.map((r) => r.emphasis)).toEqual([false, true, true, false]);

    const merged = composeMergedHwp(
      templateBytes(),
      {
        achievements: all.map((r, i) => [`1-${i + 1}`, r.content, '', '', '']),
        plans: [],
        notes: [],
      },
      { achievements: all.map((r) => r.emphasis === true) },
    );

    const back = readWorklog(merged.bytes).worklog.achievements;
    expect(back.map((r) => `${r.content}:${r.emphasis ? '파랑' : '검정'}`)).toEqual([
      '가 부서원의 보통 업무:검정',
      '가 부서원의 공유 사항:파랑',
      '나 부서원의 공유 사항:파랑',
      '나 부서원의 보통 업무:검정',
    ]);
    expect(merged.warnings).toEqual([]);
  });

  it('[HM-T73] 강조가 하나도 없으면 DocInfo를 건드리지 않는다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    const before = parseRecords(openHwp(templateBytes()).docInfo).filter(
      (r) => r.tag === DI_TAG.CHAR_SHAPE,
    ).length;

    const merged = composeMergedHwp(templateBytes(), {
      achievements: [['1-1', '보통 업무', '', '', '']],
      plans: [],
      notes: [],
    });

    const after = parseRecords(openHwp(merged.bytes).docInfo).filter(
      (r) => r.tag === DI_TAG.CHAR_SHAPE,
    ).length;
    expect(after).toBe(before);
  });

  it('[HM-T74] 병합을 두 번 돌려도 서식이 불어나지 않는다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    const args = [
      { achievements: [['1-1', '공유 사항', '', '', '']], plans: [], notes: [] },
      { achievements: [true] },
    ] as const;

    const once = composeMergedHwp(templateBytes(), args[0], args[1]);
    const twice = composeMergedHwp(once.bytes, args[0], args[1]);

    const n = (b: Buffer) =>
      parseRecords(openHwp(b).docInfo).filter((r) => r.tag === DI_TAG.CHAR_SHAPE).length;
    expect(n(twice.bytes)).toBe(n(once.bytes));
    expect(readWorklog(twice.bytes).worklog.achievements[0].emphasis).toBe(true);
  });
});
