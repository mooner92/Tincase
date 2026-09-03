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

/**
 * HM-39 — 한 칸에 **두 줄**을 적은 제출물.
 *
 * 2026-09-03 14:01, 자동 병합이 1분마다 재시도하며 계속 실패했다:
 *   「결과 검증 실패 — 1번 표 24행의 내용이 다릅니다」
 *
 * 한 부서원이 낸 칸이 두 줄이었다. 읽으면 `\n`이 들어오는데(HM-13), 그걸 그대로 써 넣으면
 * 0x0A로 저장되고, **다시 읽을 때 다른 제어 문자와 같이 버려졌다.** 그래서 자체 점검이
 * 「내용이 다르다」로 판단하고 그 주 병합이 통째로 멈췄다.
 *
 * 아무도 코드를 건드리지 않았는데 **어느 주 갑자기 멈추는** 종류다 — 두 줄짜리 칸을
 * 낸 사람이 그날 처음 있었을 뿐이다. 그래서 왕복으로 못박는다.
 */
d('HM-39 한 칸 두 줄 — 줄바꿈이 살아남는다', () => {
  const two = '국립세종도서관 정책정보종합목록 구축 자료 제공\n2026년 1월~현재 도서관 소장자료';

  function roundTrip(text: string): string {
    const src = readFileSync(TEMPLATE);
    const recs = parseRecords(openHwp(src).sections[0]);
    fillTable(recs, 0, [['1-1', text, '', '', '']]);
    return readWorklog(packHwp(src, [serializeRecords(recs)])).worklog.achievements[0].content;
  }

  it('[HM-T90] 줄바꿈이 든 칸이 **그대로** 왕복한다 — 이게 그날의 버그다', () => {
    expect(roundTrip(two)).toBe(two);
  });

  it('[HM-T91] 줄바꿈이 없는 칸은 전과 같다', () => {
    expect(roundTrip('보통 한 줄짜리 업무')).toBe('보통 한 줄짜리 업무');
  });

  it('[HM-T92] 세 줄도 된다 — 두 줄만 맞춘 것이 아니다', () => {
    const three = '첫 줄\n둘째 줄\n셋째 줄';
    expect(roundTrip(three)).toBe(three);
  });

  it('[HM-T93] 줄바꿈 + 강조가 함께 살아남는다', () => {
    const src = readFileSync(TEMPLATE);
    const file = openHwp(src);
    const recs = parseRecords(file.sections[0]);
    const diRecs = parseRecords(file.docInfo);
    const blue = ensureColorShape(diRecs, plainShapeIdOf(recs, 0)!, BLUE);
    fillTable(recs, 0, [['1-1', two, '', '', '']], { emphasis: [true], emphasisShapeId: blue });
    const back = readWorklog(packHwp(src, [serializeRecords(recs)], serializeRecords(diRecs)))
      .worklog.achievements[0];
    expect(back.content).toBe(two);
    expect(back.emphasis).toBe(true);
  });
});

/**
 * HM-42 — **왕복 불변식**: 셀에 넣은 글자는 그대로 다시 읽혀야 한다.
 *
 * 2026-09-03에 줄바꿈 하나 때문에 그 주 병합이 통째로 멈췄다. 고쳤지만 문제는
 * 「줄바꿈」이 아니라 **「reader가 만들 수 있는 글자를 writer가 못 지키는 경우가 있다」**였다.
 * 다음 주에는 다른 글자로 같은 일이 난다.
 *
 * 그래서 낱개 버그가 아니라 **불변식**을 지킨다. 사람이 실제로 한글에 치는 것들 —
 * 눈에 안 보이는 제어 문자, 전각, 따옴표, 아주 긴 줄, 이모지 — 을 한 번에 두드린다.
 * 새 글자가 문제를 일으키면 여기에 한 줄 더한다.
 */
d('HM-42 셀 글자 왕복 — 넣은 대로 읽힌다', () => {
  const CASES: [string, string][] = [
    ['보통', '보도자료 배포 및 인포그래픽 제작'],
    ['줄바꿈', '첫 줄\n둘째 줄'],
    ['줄바꿈 여러 번', 'ㄱ\nㄴ\nㄷ\nㄹ'],
    ['탭 → 공백', '앞\t뒤'],
    ['괄호·기호', '정기간행물 발간(10건) · 진행 [8건] ※ 확인'],
    ['따옴표', '큐레이션 뉴스레터 “KEI 북 큐레이션” 제2호 발행'],
    ['전각', 'ＡＩ 홍보（정간물 포함）'],
    ['물결·화살표', '2026년 1월~현재 → 배포 완료'],
    ['숫자·기호 섞임', 'ScienceDirect/Scopus 온라인 교육(9/2~9/3)'],
    ['이모지', '완료 ✅ 진행 ▶ 보류 ⏸'],
    ['아주 긴 줄', '가나다라마바사아자차카타파하'.repeat(20)],
    ['앞뒤 공백', '  앞뒤 공백  '],
    ['한 글자', '가'],
  ];

  function roundTrip(text: string): string {
    const src = readFileSync(TEMPLATE);
    const recs = parseRecords(openHwp(src).sections[0]);
    fillTable(recs, 0, [['1-1', text, '', '', '']]);
    return readWorklog(packHwp(src, [serializeRecords(recs)])).worklog.achievements[0]?.content ?? '(사라짐)';
  }

  /** writer가 넣을 수 없는 글자는 바꾼다 — 그 규칙까지가 불변식이다 (HM-42) */
  const expected = (t: string) => t.replace(/\t/g, ' ').trim();

  for (const [name, text] of CASES) {
    it(`[HM-T95] ${name}`, () => {
      // reader가 앞뒤 공백을 다듬으므로(HM-15g) 비교도 다듬은 값으로 한다
      expect(roundTrip(text)).toBe(expected(text));
    });
  }

  it('[HM-T97] 눈에 안 보이는 제어 문자는 버린다 — 문서를 깨뜨리는 대신', () => {
    // 붙여넣기로 섞여 들어오는 것들. 그대로 쓰면 한글이 8유닛 컨트롤로 읽어 뒤 글자를 삼킨다
    expect(roundTrip('앞\u0001\u0002\u001f뒤')).toBe('앞뒤');
  });

  it('[HM-T96] 여러 줄을 한꺼번에 넣어도 각자 제자리로', () => {
    const src = readFileSync(TEMPLATE);
    const recs = parseRecords(openHwp(src).sections[0]);
    const rows = CASES.map(([, t], i) => [`1-${i + 1}`, t, '', '', '']);
    fillTable(recs, 0, rows);
    const back = readWorklog(packHwp(src, [serializeRecords(recs)])).worklog.achievements;
    expect(back.map((r) => r.content)).toEqual(CASES.map(([, t]) => expected(t)));
  });
});
