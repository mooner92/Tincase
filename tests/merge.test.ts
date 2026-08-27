// S-08 §6 — 병합 규칙 파서(HM-18)와 모델 하네스(HM-24).
// 모델 호출 자체는 테스트하지 않는다 (외부 프로세스). **하네스가 모델을 못 믿는지**를 테스트한다.
import { describe, expect, it } from 'vitest';
import { parseCategories, toPlan, orderPeople } from '@/server/merge/rules';
import { sortByCategory, OTHER } from '@/server/merge/order';
import { parseTablePaste, parseHtmlTable, parseClipboardTable } from '@/lib/paste-table';
import { exactDuplicates, validateGroups, type MergeRow } from '@/server/merge/dedupe';

const row = (id: number, who: string, content: string, date = '', place = ''): MergeRow => ({
  id,
  who,
  content,
  date,
  place,
  attendee: '',
});

describe('HM-18 병합 규칙 — 문법 없는 설정', () => {
  it('[HM-T30] 부서가 실제로 보낸 원문을 그대로 받는다', () => {
    // 실제 수신 문구: "순서: AI-홍보(정간물 포함)-시스템-도서관"
    expect(parseCategories('AI-홍보(정간물 포함)-시스템-도서관')).toEqual([
      'AI', '홍보(정간물 포함)', '시스템', '도서관',
    ]);
  });

  it('[HM-T31] 구분자를 외우게 하지 않는다 — 쉼표·가운뎃점·하이픈 모두', () => {
    const want = ['AI', '홍보', '시스템'];
    for (const raw of ['AI, 홍보, 시스템', 'AI·홍보·시스템', 'AI-홍보-시스템', 'AI / 홍보 / 시스템']) {
      expect(parseCategories(raw), raw).toEqual(want);
    }
  });

  it('[HM-T32] 빈 값·중복·과다 입력을 조용히 정리한다 (오류로 막지 않는다)', () => {
    expect(parseCategories('')).toEqual([]);
    expect(parseCategories('  ,  , ')).toEqual([]);
    expect(parseCategories('AI, AI, 홍보')).toEqual(['AI', '홍보']);
    expect(parseCategories(Array.from({ length: 30 }, (_, i) => `분류${i}`).join(','))).toHaveLength(12);
  });

  it('[HM-T33] 설정 4종이 계획으로 옮겨진다', () => {
    const plan = toPlan({
      mergeCategories: 'AI, 홍보',
      mergeDedupe: false,
      mergeDropNotes: false,
      mergeRuleText: '  도서관 업무는 맨 뒤로  ',
    });
    expect(plan).toEqual({
      categories: ['AI', '홍보'],
      dedupe: false,
      dropEmptyNotes: false,
      guidance: '도서관 업무는 맨 뒤로',
    });
  });

  it('[HM-T34] 제출자 순서는 sortOrder — 규칙에 이름을 또 적게 하지 않는다', () => {
    const people = [
      { name: '나', sortOrder: 2 },
      { name: '가', sortOrder: 2 },
      { name: '다', sortOrder: 1 },
    ];
    expect(orderPeople(people).map((p) => p.name)).toEqual(['다', '가', '나']);
  });
});

describe('HM-27 분류 정렬', () => {
  const cats = ['AI', '홍보', '시스템'];
  const item = (id: number, cat: string) => ({ id, cat });

  it('[HM-T40] 분류 순서대로 재배치한다', () => {
    const got = sortByCategory([item(1, '시스템'), item(2, 'AI'), item(3, '홍보')], (x) => x.cat, cats);
    expect(got.map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it('[HM-T41] 같은 분류 안에서는 원래 순서를 유지한다 (ABS-6)', () => {
    const got = sortByCategory(
      [item(1, '홍보'), item(2, 'AI'), item(3, '홍보'), item(4, 'AI')],
      (x) => x.cat,
      cats,
    );
    expect(got.map((x) => x.id)).toEqual([2, 4, 1, 3]);
  });

  it('[HM-T42] 기타는 언제나 맨 뒤 — 분류에 없는 업무가 앞에 오면 규칙이 무의미해진다', () => {
    const got = sortByCategory(
      [item(1, OTHER), item(2, '시스템'), item(3, OTHER), item(4, 'AI')],
      (x) => x.cat,
      cats,
    );
    expect(got.map((x) => x.id)).toEqual([4, 2, 1, 3]);
  });

  it('[HM-T43] 행은 재배치될 뿐 사라지지 않는다', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, ['AI', '홍보', '시스템', OTHER, '없는분류'][i % 5]));
    const got = sortByCategory(items, (x) => x.cat, cats);
    expect(got).toHaveLength(items.length);
    expect(new Set(got.map((x) => x.id))).toEqual(new Set(items.map((x) => x.id)));
  });
});

describe('HM-24 모델 하네스', () => {
  const rows = [
    row(1, '최명헌', '정기간행물 발간 진행(10건)'),
    row(2, '최명헌', '보도자료 배포'),
    row(3, '김영인', '정기간행물 발간 진행 (10건)'), // 괄호·공백만 다름
    row(4, '김영인', '데이터기반행정 평가 컨설팅'),
  ];

  it('[HM-T35] 결정론 중복 — 정규화 후 같은 행만 묶는다 (모델 없이)', () => {
    const d = exactDuplicates(rows);
    expect(d).toHaveLength(1);
    expect(d[0].ids).toEqual([1, 3]);
  });

  it('[HM-T36] 빈 내용은 묶지 않는다 — 빈 행끼리 합쳐지면 표가 무너진다', () => {
    expect(exactDuplicates([row(1, 'A', ''), row(2, 'B', ''), row(3, 'C', '  ')])).toEqual([]);
  });

  it('[HM-T37] 다른 업무를 묶지 않는다', () => {
    expect(exactDuplicates([row(1, 'A', '설문 설계'), row(2, 'B', '설문 결과 분석')])).toEqual([]);
  });

  it('[HM-T38] 검증이 모델의 거짓말을 잡는다', () => {
    const cases: [string, unknown][] = [
      ['없는 id', [{ ids: [1, 99], reason: '' }]],
      ['id 겹침', [{ ids: [1, 2], reason: '' }, { ids: [2, 3], reason: '' }]],
      ['묶음이 1개짜리', [{ ids: [1], reason: '' }]],
      ['정수 아님', [{ ids: [1, 2.5], reason: '' }]],
      ['배열 아님', [{ ids: 'all', reason: '' }]],
    ];
    for (const [label, groups] of cases) {
      expect(validateGroups(rows, groups as never), label).not.toBeNull();
    }
  });

  it('[HM-T39] 정상 묶음은 통과한다', () => {
    expect(validateGroups(rows, [{ ids: [1, 3], reason: '같은 업무' }])).toBeNull();
    expect(validateGroups(rows, [])).toBeNull(); // 중복 없음도 정상
  });
});

// ── OPS-31 연속 미제출 (순수 규칙만 검증) ──────────────────────
// DB에 의존하는 집계는 통합 테스트가 아니라 **규칙**을 확인한다:
// "최신부터 세다가 낸 주차를 만나면 끊긴다"가 전부다.
describe('OPS-31 연속 미제출 계산 규칙', () => {
  /** missingStreaks 안의 계산과 동일한 규칙 — 여기서 규칙 자체를 고정한다 */
  const streakOf = (slotsNewestFirst: string[], submitted: Set<string>) => {
    let n = 0;
    for (const s of slotsNewestFirst) {
      if (submitted.has(s)) break;
      n++;
    }
    return n;
  };
  const W = ['W35', 'W34', 'W33', 'W32', 'W31'];

  it('[OPS-T01] 한 번도 안 냈으면 전 구간이 연속이다', () => {
    expect(streakOf(W, new Set())).toBe(5);
  });

  it('[OPS-T02] 최신 주차에 냈으면 0 — 지난주 안 낸 이력은 연속이 아니다', () => {
    expect(streakOf(W, new Set(['W35']))).toBe(0);
    expect(streakOf(W, new Set(['W35', 'W31']))).toBe(0);
  });

  it('[OPS-T03] 중간에 냈으면 거기서 끊긴다', () => {
    expect(streakOf(W, new Set(['W33']))).toBe(2); // W35·W34만 연속
    expect(streakOf(W, new Set(['W32', 'W31']))).toBe(3);
  });

  it('[OPS-T04] 오래된 주차 제출은 최근 연속을 줄이지 못한다', () => {
    expect(streakOf(W, new Set(['W31']))).toBe(4);
  });
});

// ── 표 붙여넣기 (한글에서 긁어 오는 경로) ─────────────────────
// 한 칸씩 옮겨 적으면 웹 작성을 쓸 이유가 없다. 이 해석이 틀리면 사람들은 그냥 안 쓴다.
describe('표 붙여넣기 해석', () => {
  it('[WA-T01] 한글 표 그대로 — 구분 열은 버린다 (시스템이 다시 매긴다)', () => {
    const text = ['1-1\t제10차 인사위원회\t8/13\tKEI 중회의실\t원장', '1-2\t보도자료 배포\t\t\t'].join('\n');
    expect(parseTablePaste(text)).toEqual([
      { content: '제10차 인사위원회', date: '8/13', place: 'KEI 중회의실', attendee: '원장' },
      { content: '보도자료 배포', date: '', place: '', attendee: '' },
    ]);
  });

  it('[WA-T02] 머리글 행이 딸려 와도 버린다', () => {
    const text = ['구분\t업무실적 내용\t일자\t장소\t참석자', '1-1\t회의 참석\t8/20\t\t'].join('\n');
    expect(parseTablePaste(text)).toHaveLength(1);
    expect(parseTablePaste(text)![0].content).toBe('회의 참석');
  });

  it('[WA-T03] 구분 없이 4열만 복사한 경우', () => {
    const text = '회의 참석\t8/20\t중회의실\t원장';
    expect(parseTablePaste(text)).toEqual([
      { content: '회의 참석', date: '8/20', place: '중회의실', attendee: '원장' },
    ]);
  });

  it('[WA-T04] 내용만 여러 줄 (탭 없음)', () => {
    expect(parseTablePaste('첫째 업무\n둘째 업무\n셋째 업무')).toEqual([
      { content: '첫째 업무', date: '', place: '', attendee: '' },
      { content: '둘째 업무', date: '', place: '', attendee: '' },
      { content: '셋째 업무', date: '', place: '', attendee: '' },
    ]);
  });

  it('[WA-T05] 평범한 글자는 표로 보지 않는다 — 한 칸에 긴 글을 붙이는 것도 정상이다', () => {
    expect(parseTablePaste('그냥 한 줄짜리 업무 내용입니다')).toBeNull();
    expect(parseTablePaste('')).toBeNull();
  });

  it('[WA-T06] 빈 줄은 버린다', () => {
    const text = ['1-1\t업무 A\t\t\t', '\t\t\t\t', '1-2\t업무 B\t\t\t'].join('\n');
    expect(parseTablePaste(text)!.map((r) => r.content)).toEqual(['업무 A', '업무 B']);
  });
});

// ── 한글 클립보드 (실측 기반) ─────────────────────────────────
// 한글은 평문에 셀을 **줄바꿈으로** 넣는다 (엑셀처럼 탭이 아니다).
// 평문만 보면 4열 4행이 16줄이 되어 칸 하나가 행 하나가 된다 — 실제로 그렇게 나왔다.
// 그래서 HTML을 먼저 본다.
describe('한글 클립보드 표', () => {
  const HWP_HTML = `<html><body><table border=1>
    <tr><td><p>구분</p></td><td><p>업무실적 내용</p></td><td><p>일자</p></td><td><p>장소</p></td><td><p>참석자</p></td></tr>
    <tr><td><p>1-1</p></td><td><p>제10차&nbsp;인사위원회</p></td><td><p>OO/OO</p></td><td><p>KEI 중회의실</p></td><td><p>원장, 연구부원장</p></td></tr>
    <tr><td><p>1-2</p></td><td><p>제5차 국가환경종합계획<br>수정계획 공청회</p></td><td><p>OO/OO</p></td><td><p>한국프레스센터</p></td><td><p></p></td></tr>
    </table></body></html>`;
  // 같은 표를 한글이 평문으로 내놓은 모습 — 셀마다 줄바꿈
  const HWP_TEXT = ['제10차 인사위원회', 'OO/OO', 'KEI 중회의실', '원장, 연구부원장'].join('\n');

  it('[WA-T10] HTML 표를 격자로 읽는다', () => {
    const grid = parseHtmlTable(HWP_HTML)!;
    expect(grid).toHaveLength(3);
    expect(grid[1]).toEqual(['1-1', '제10차 인사위원회', 'OO/OO', 'KEI 중회의실', '원장, 연구부원장']);
  });

  it('[WA-T11] 셀 안 줄바꿈은 한 줄로 합친다', () => {
    expect(parseHtmlTable(HWP_HTML)![2][1]).toBe('제5차 국가환경종합계획 수정계획 공청회');
  });

  it('[WA-T12] ★ HTML이 있으면 그쪽을 쓴다 — 평문만 보면 칸이 행이 된다', () => {
    const viaHtml = parseClipboardTable(HWP_HTML, HWP_TEXT)!;
    expect(viaHtml).toHaveLength(2); // 머리글 제외 2행
    expect(viaHtml[0]).toEqual({
      content: '제10차 인사위원회',
      date: 'OO/OO',
      place: 'KEI 중회의실',
      attendee: '원장, 연구부원장',
    });

    // 평문만 주면 (HTML 없는 앱) 칸이 행이 되는 건 어쩔 수 없다 — 그래서 HTML이 먼저다
    const viaText = parseClipboardTable('', HWP_TEXT)!;
    expect(viaText).toHaveLength(4);
  });

  it('[WA-T13] HTML에 표가 없으면 평문으로 넘어간다', () => {
    const rows = parseClipboardTable('<p>그냥 문단</p>', '업무 A\t8/20\n업무 B\t8/21')!;
    expect(rows.map((r) => r.content)).toEqual(['업무 A', '업무 B']);
  });
});

// ── HM-32 · WA-08 — 빈 표는 **비워야** 한다 ──────────────────────
//
// 이 결함은 사용자가 찾았다. 실적을 비우고 계획만 적으면 「검증에 실패했습니다」가 떴고,
// 그래서 부서원이 실적 칸에 «특이사항 없음»을 적어 우회했다.
//
// 원인은 검증이 아니라 **그 앞**이었다: 빈 표는 `fillTable`을 건너뛰었는데,
// 「양식의 표는 비어 있다」는 그 전제가 틀렸다 — 실제 양식의 실적 표에는 예시 4줄이
// 들어 있다(«제10차 인사위원회» 등). 건너뛰면 그 예시가 «내가 한 일»로 남는다.
//
// 검증은 제 일을 하고 있었다. 지우지 않은 쪽이 틀렸다.
describe('HM-32 빈 표 처리 — 양식의 예시가 남지 않는다', () => {
  const load = () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    return readFileSync('fixtures/master-template.hwp');
  };
  const hasFix = (() => {
    try {
      load();
      return true;
    } catch {
      return false;
    }
  })();
  const t = hasFix ? it : it.skip;

  t('[HM-T40] 양식 자체에 예시 행이 들어 있다 — 이 전제가 이 테스트의 이유다', async () => {
    const { readWorklog } = await import('@/lib/hwp/reader');
    expect(readWorklog(load()).worklog.achievements.length).toBeGreaterThan(0);
  });

  t('[HM-T41] 실적을 비우고 계획만 넣으면 **실적은 0행**이어야 한다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const out = composeMergedHwp(load(), {
      achievements: [],
      plans: [['2-1', '알림 시스템 개발', '', '', '']],
      notes: [],
    });
    const w = readWorklog(out.bytes).worklog;
    expect(w.achievements, '양식의 예시가 실적으로 남았다').toHaveLength(0);
    expect(w.plans).toHaveLength(1);
    expect(w.plans[0].content).toBe('알림 시스템 개발');
  });

  t('[HM-T42] 세 표 중 어느 조합을 비워도 남는 것이 없다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const one = (p: number) => [[`${p}-1`, `${p}번 표 내용`, '', '', '']];
    for (const [a, p, n] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
    ] as const) {
      const out = composeMergedHwp(load(), {
        achievements: a ? one(1) : [],
        plans: p ? one(2) : [],
        notes: n ? one(3) : [],
      });
      const w = readWorklog(out.bytes).worklog;
      expect(w.achievements, `실적 ${a}/${p}/${n}`).toHaveLength(a);
      expect(w.plans, `계획 ${a}/${p}/${n}`).toHaveLength(p);
      expect(w.notes, `특이 ${a}/${p}/${n}`).toHaveLength(n);
    }
  });
});

// ── HM-33 — 「없음」 탐지. **지우지 않고 알린다** ──────────────────
//
// 사용자가 제안한 설계다. 처음에 나는 «고정 목록으로 자동 제외»를 제안했는데,
// 사용자가 «감지해서 알림으로만 알려달라»고 했고 그쪽이 옳다:
// **처분이 알림 한 줄이면 오탐 비용이 거의 없어서, 탐지를 느슨하게 잡아도 안전하다.**
// 판정을 정확하게 만드는 대신 **틀려도 싼 자리**로 옮긴 것이다.
describe('HM-33 「없음」 탐지', () => {
  /** 부서가 정한 낱말. 설정이 비면 아무것도 걸리지 않는다 (HM-T56) */
  const WORDS = ['없음'];

  it('[HM-T50] 실제 사고 문구를 잡는다', async () => {
    const { flagWordOf } = await import('@/lib/empty-content');
    for (const c of ['특이사항 없음', '없음', '해당 없음', '특이사항없음', ' 없음 ']) {
      expect(flagWordOf(c, WORDS), c).toBe('없음');
    }
  });

  it('[HM-T51] **정상 업무를 잡지 않는다** — 실측 45행 중 오탐 0건이었다', async () => {
    const { flagWordOf } = await import('@/lib/empty-content');
    const real = [
      '보도자료 배포',
      '대담 영상 촬영',
      '글로벌환경동향지 제출',
      '국문 리플렛 업데이트',
      '정기간행물 발간 진행(9건)',
      '온라인 홍보 콘텐츠 제작 및 등록',
      '(더민주) 한민수 의원 국저감사 요구자료 제출 -2022년 ~ 현재까지 최근 5년간 기록물 관리 현황(생산, 이관, 폐기)',
      '공공데이터 업무 범위 확정을 위한 유관기관 담당자 미팅',
    ];
    for (const c of real) expect(flagWordOf(c, WORDS), c).toBeNull();
  });

  it('[HM-T52] 빈 칸은 잡지 않는다 — 안 쓴 것과 「없음」이라 쓴 것은 다르다', async () => {
    const { flagWordOf } = await import('@/lib/empty-content');
    expect(flagWordOf('', WORDS)).toBeNull();
    expect(flagWordOf('   ', WORDS)).toBeNull();
  });

  it('[HM-T53] 표·행 번호가 화면과 같아야 담당자가 그 행을 찾는다', async () => {
    const { findFlaggedRows } = await import('@/lib/empty-content');
    const row = (content: string) => ({ content, date: '', place: '', attendee: '' });
    const found = findFlaggedRows({
      achievements: [
        { row: row('보도자료 배포'), authors: ['장혜정'] },
        { row: row('특이사항 없음'), authors: ['김영인'] },
      ],
      plans: [{ row: row('없음'), authors: ['김정두'] }],
      notes: [],
    }, WORDS);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ bucket: 'achievements', no: '1-2', who: '김영인', word: '없음' });
    expect(found[1]).toMatchObject({ bucket: 'plans', no: '2-1', who: '김정두' });
  });

  it('[HM-T54] 알림 한 줄은 «어디·누구·무엇»을 담는다 — 받고 바로 찾을 수 있어야 한다', async () => {
    const { describeFlagged } = await import('@/lib/empty-content');
    expect(
      describeFlagged({ bucket: 'achievements', no: '1-6', who: '김영인', content: '특이사항 없음', word: '없음' }),
    ).toBe('실적 1-6 김영인 「특이사항 없음」');
  });

  it('[HM-T55] **병합이 행을 지우지 않는다** — 탐지는 알림용이고 문서는 그대로다', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const { readFileSync } = await import('node:fs');
    let base: Buffer;
    try {
      base = readFileSync('fixtures/master-template.hwp');
    } catch {
      return; // 픽스처 없는 환경
    }
    const out = composeMergedHwp(base, {
      achievements: [
        ['1-1', '보도자료 배포', '', '', ''],
        ['1-2', '특이사항 없음', '', '', ''],
      ],
      plans: [],
      notes: [],
    });
    const w = readWorklog(out.bytes).worklog;
    expect(w.achievements).toHaveLength(2); // 지우지 않는다
    expect(w.achievements[1].content).toBe('특이사항 없음');
  });
});

// 부서별 설정 — 남의 부서에 우리 습관을 강요하지 않는다
describe('HM-33 부서별 설정', () => {
  it('[HM-T56] **설정이 비면 아무것도 걸리지 않는다** — 기본은 꺼짐이다', async () => {
    const { flagWordOf, findFlaggedRows } = await import('@/lib/empty-content');
    expect(flagWordOf('특이사항 없음', [])).toBeNull();
    const row = (c: string) => ({ content: c, date: '', place: '', attendee: '' });
    expect(
      findFlaggedRows({ achievements: [{ row: row('없음'), authors: ['갑'] }], plans: [], notes: [] }, []),
    ).toEqual([]);
  });

  it('[HM-T57] 부서가 자기 낱말을 정한다 — 쉼표·가운뎃점 아무거나', async () => {
    const { parseFlagWords, flagWordOf } = await import('@/lib/empty-content');
    expect(parseFlagWords('없음, 해당사항없음 · 생략')).toEqual(['없음', '해당사항없음', '생략']);
    expect(parseFlagWords('')).toEqual([]);
    expect(parseFlagWords('없음,없음,없음')).toEqual(['없음']); // 중복은 하나로
    expect(flagWordOf('업무 생략', parseFlagWords('없음·생략'))).toBe('생략');
  });
});
