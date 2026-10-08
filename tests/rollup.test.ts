// RU-10~18 — 본부 이어 붙이기. RU-12·16 — 단위로 읽기.
//
// 본부 단계의 약속은 하나다: **단위 안의 것은 바뀌지 않고, 순서만 바뀐다** (RU-11) — 전사와 같은 정규화(RU-63)만 빼고.
// 그래서 테스트도 거의 전부 「넣은 것 = 다시 읽은 것」의 꼴이다. 문서가 한글에서 열리는지는
// 테스트로 볼 수 없으므로, 한글이 「손상」으로 판정하는 지점(문단 자기 기술 — HM-46)을 대신 본다.
//
// 2026-10-07 중복 제거 — 본부 단계가 실형 5열 표를 다시 그리던 composeRollupHwp를 빼고 전사와 같은 엔진
// (orgdoc.ts composeOrgDocument, RU-62)을 쓴다. RU-T10~19는 그 엔진으로 옮겼다. ID는 요구가 같으면 그대로 두었다:
//   T10 넣은 것 = 다시 읽은 것  → 이름은 섹션 제목, 빈 3번 표만 「특이사항 없음」(RU-63)
//   T11 문단 자기 기술 · T12 구역 정의 하나 · T13 쪽 나누기 켬/끔 · T15 같은 입력 같은 파일
//   T16 표 인스턴스 ID 겹치지 않음 · T17 부서명 줄 없는 옛 양식 · T19 「목록의 끝」 하나 → 같은 요구, 엔진만 바뀜
//   T18 빈 단위도 자리를 지킨다 → 빈 표가 아니라 「특이사항 없음」이 든 섹션으로 (RU-63)
//   T14 본부본 → 전사 펼치기 → **뺐다.** 전사는 본부본을 다시 읽지 않고 본부본에 든 실·팀 사본을 섹션으로 쓴다(sections.ts)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readUnits, titleBucket, type UnitBlock, type UnitRow } from '@/lib/hwp/rollup';
import { composeOrgDocument } from '@/lib/hwp/orgdoc';

const load = (f: string) => readFileSync(`fixtures/${f}`);
const hasFix = (() => {
  try {
    load('master-template.hwp');
    load('sample-filled-w1.hwp');
    return true;
  } catch {
    return false;
  }
})();
const t = hasFix ? it : it.skip;

type Rows = Record<'achievements' | 'plans' | 'notes', string[][]>;

/** Tincase가 만드는 실·팀 병합본과 같은 문서 — 부서명이 맨 위에 있고(HM-46) 강조가 섞여 있다 */
async function teamDoc(name: string, rows: Rows, emphasis?: Partial<Record<keyof Rows, boolean[]>>) {
  const { composeMergedHwp } = await import('@/server/merge');
  return composeMergedHwp(load('master-template.hwp'), rows, emphasis, name).bytes;
}

/** 기획조정실 양식 꼴 — 첫 문단이 부서명인 양식 (전 부서 양식이 이렇다, 2026-10-07 실측) */
async function namedTemplate(name: string) {
  return teamDoc(name, { achievements: [], plans: [], notes: [] });
}

const A: Rows = {
  achievements: [
    ['1-1', '인포그래픽 제작', '10/1', '', ''],
    ['1-2', '정기간행물 발간 진행(10건)', '', '', ''],
    ['1-3', '홈페이지 조직도 개정사항 반영', '10/2', '본관', '홍보팀'],
  ],
  plans: [['2-1', '보도자료 배포 및 인포그래픽 제작', '', '', '']],
  notes: [],
};
const B: Rows = {
  achievements: [['1-1', '대정부 예산 협의', '9/30', '세종', '']],
  plans: [
    ['2-1', '연구운영회의 자료 취합', '10/7', '', ''],
    ['2-2', '국정감사 대응 자료 정리', '', '', ''],
  ],
  notes: [['3-1', '추석 연휴로 제출 기한 조정', '', '', '']],
};

/** 문단 머리가 밝힌 수와 뒤따르는 레코드가 어긋난 문단 — 한글이 「손상」으로 보는 지점 (HM-46) */
async function headerMismatches(bytes: Buffer) {
  const { openHwp } = await import('@/lib/hwp/ole');
  const { parseRecords, TAG } = await import('@/lib/hwp/record');
  const recs = parseRecords(openHwp(bytes).sections[0]);
  const bad: string[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].tag !== TAG.PARA_HEADER) continue;
    const lv = recs[i].level;
    let text = -1;
    let runs = 0;
    let segs = 0;
    for (let k = i + 1; k < recs.length && recs[k].level > lv; k++) {
      if (recs[k].level !== lv + 1) continue;
      if (recs[k].tag === TAG.PARA_TEXT) text = recs[k].data.length / 2;
      if (recs[k].tag === TAG.PARA_CHAR_SHAPE) runs = recs[k].data.length / 8;
      if (recs[k].tag === TAG.PARA_LINE_SEG) segs = recs[k].data.length / 36;
    }
    const d = recs[i].data;
    const nChars = d.readUInt32LE(0) & 0x7fffffff;
    if (nChars !== (text < 0 ? 1 : text)) bad.push(`#${i} 글자 ${nChars}≠${text}`);
    if (d.readUInt16LE(12) !== runs) bad.push(`#${i} 서식 ${d.readUInt16LE(12)}≠${runs}`);
    if (d.readUInt16LE(16) !== segs) bad.push(`#${i} 줄 ${d.readUInt16LE(16)}≠${segs}`);
  }
  return bad;
}

/** 본문 문단: 보이는 글자 · 붙은 컨트롤 · 쪽 나누기 */
async function topParas(bytes: Buffer) {
  const { openHwp } = await import('@/lib/hwp/ole');
  const { parseRecords, paraText, TAG } = await import('@/lib/hwp/record');
  const recs = parseRecords(openHwp(bytes).sections[0]);
  const out: { text: string; ctrls: string[]; pageBreak: boolean }[] = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].tag !== TAG.PARA_HEADER || recs[i].level !== 0) continue;
    let text = '';
    const ctrls: string[] = [];
    for (let k = i + 1; k < recs.length && recs[k].level > 0; k++) {
      if (recs[k].level !== 1) continue;
      if (recs[k].tag === TAG.PARA_TEXT) text = paraText(recs[k].data);
      if (recs[k].tag === TAG.CTRL_HEADER) {
        const d = recs[k].data;
        ctrls.push(Buffer.from([d[3], d[2], d[1], d[0]]).toString('latin1'));
      }
    }
    out.push({ text, ctrls, pageBreak: (recs[i].data[11] & 0x04) !== 0 });
  }
  return out;
}

/** 본부 이어 붙이기와 같은 부름 — 사본 하나 = 섹션 하나 (server/rollup/run.ts composeHq) */
const hq = (template: Buffer, sections: { title: string; source: Buffer }[], pageBreak = true) =>
  composeOrgDocument(template, sections, { pageBreak });

/** RU-63 — 비어 있던 3번 표는 「특이사항 없음」 한 줄이 된다 (실·팀이 적은 줄이 아니라 정규화가 넣은 줄) */
const NOTES_NONE: UnitRow = { no: '3-1', content: '특이사항 없음', date: '', place: '', attendee: '', emphasis: false };

/** 넣은 단위가 섹션으로 들어가면 이렇게 다시 읽혀야 한다 — 이름은 섹션 제목, 나머지는 그대로 */
const asSection = (u: UnitBlock, title: string, hasNotesTable = true): UnitBlock => ({
  name: title,
  tables: { ...u.tables, notes: u.tables.notes.length || !hasNotesTable ? u.tables.notes : [NOTES_NONE] },
});

const plain = (units: UnitBlock[]) =>
  units.map((u) => ({
    name: u.name,
    a: u.tables.achievements.map((r) => [r.no, r.content, r.date, r.place, r.attendee, r.emphasis]),
    p: u.tables.plans.map((r) => [r.no, r.content, r.date, r.place, r.attendee, r.emphasis]),
    n: u.tables.notes.map((r) => [r.no, r.content, r.date, r.place, r.attendee, r.emphasis]),
  }));

describe('RU-12 단위로 읽기', () => {
  t('[RU-T01] 실·팀 병합본은 단위 하나 — 이름은 맨 위 부서명, 행·구분·강조는 그대로', async () => {
    const doc = await teamDoc('AI홍보전략실', A, { achievements: [false, true, false] });
    const r = readUnits(doc, '대체이름');
    expect(r.warnings).toEqual([]);
    expect(r.units).toHaveLength(1);
    expect(r.units[0].name).toBe('AI홍보전략실');
    expect(r.units[0].tables.achievements.map((x) => [x.no, x.content, x.emphasis])).toEqual([
      ['1-1', '인포그래픽 제작', false],
      ['1-2', '정기간행물 발간 진행(10건)', true],
      ['1-3', '홈페이지 조직도 개정사항 반영', false],
    ]);
    expect(r.units[0].tables.achievements[2]).toMatchObject({ date: '10/2', place: '본관', attendee: '홍보팀' });
  });

  t('[RU-T02] 부서명이 없는 옛 문서는 넘겨준 이름을 쓴다 (사람이 낸 지난 자료)', () => {
    const r = readUnits(load('sample-filled-w1.hwp'), 'AI홍보전략실');
    expect(r.units).toHaveLength(1);
    expect(r.units[0].name).toBe('AI홍보전략실');
    expect(r.units[0].tables.achievements.length).toBeGreaterThan(5);
  });

  it('[RU-T03] 표 제목은 번호가 아니라 낱말로 알아본다 · 긴 문장은 제목이 아니다', () => {
    expect(titleBucket('1. 주요 업무실적')).toBe('achievements');
    expect(titleBucket('Ⅱ. 주요 업무계획')).toBe('plans');
    expect(titleBucket('□ 기타 특이사항')).toBe('notes');
    expect(titleBucket('※ 주요 업무실적은 전주 금요일부터 이번 주 목요일까지의 실적을 적습니다')).toBeNull();
    expect(titleBucket('AI홍보전략실')).toBeNull();
  });

  t('[RU-T04] 표 밖에 적힌 글은 옮기지 않지만 **조용히 버리지 않는다** — 경고로 알린다', async () => {
    const { openHwp } = await import('@/lib/hwp/ole');
    const { parseRecords, serializeRecords } = await import('@/lib/hwp/record');
    const { appendBodyParagraph, packHwp } = await import('@/lib/hwp/writer');
    const base = await teamDoc('기획조정실', B);
    const recs = parseRecords(openHwp(base).sections[0]);
    appendBodyParagraph(recs, '※ 국정감사 일정은 추후 공지');
    const doc = packHwp(base, [serializeRecords(recs)]);
    const r = readUnits(doc, '기획조정실');
    expect(r.units).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('표 밖의 글 1줄');
    expect(r.warnings.join(' ')).toContain('국정감사 일정은 추후 공지');
  });
});

describe('RU-10 본부 이어 붙이기 — 섹션 조립 엔진(RU-62)', () => {
  t('[RU-T10] ★ 넣은 단위가 그대로 다시 읽힌다 — 행·구분 번호·강조, 이름은 섹션 제목 (RU-11·14)', async () => {
    const a = await teamDoc('AI홍보전략실', A, { achievements: [false, true, false] });
    const b = await teamDoc('기획조정실', B, { notes: [true] });
    const w2 = load('sample-filled-w2.hwp'); // 사람이 3번 표를 지운 실제 제출본
    const out = hq(await namedTemplate('기획경영본부'), [
      { title: '기획경영본부(AI홍보전략실)', source: a },
      { title: '기획경영본부(기획조정실)', source: b },
      { title: '기획경영본부(연구관리실)', source: w2 },
    ]);
    expect(out.warnings).toEqual([]);
    expect(out.outcomes.map((o) => o.status)).toEqual(['copied', 'copied', 'copied']);
    const back = readUnits(out.bytes, 'x');
    expect(back.warnings).toEqual([]);
    expect(plain(back.units)).toEqual(
      plain([
        asSection(readUnits(a, 'x').units[0], '기획경영본부(AI홍보전략실)'),
        asSection(readUnits(b, 'x').units[0], '기획경영본부(기획조정실)'),
        asSection(readUnits(w2, 'x').units[0], '기획경영본부(연구관리실)', false),
      ]),
    );
    // 「공유」 행 수가 그대로 — 파란 서식은 원본 DocInfo에서 옮겨 온다(RU-62)
    const shared = (u: UnitBlock) => u.tables.achievements.filter((r) => r.emphasis).length + u.tables.notes.filter((r) => r.emphasis).length;
    expect(back.units.map(shared)).toEqual([1, 1, 0]);
  });

  t('[RU-T11] ★ 모든 문단의 자기 기술(글자·서식 구간·줄 수)이 맞는다 — 한글이 「손상」으로 보는 지점', async () => {
    const sections = [
      { title: '기획경영본부(AI홍보전략실)', source: await teamDoc('AI홍보전략실', A, { achievements: [true, false, false] }) },
      { title: '국가기후위기적응센터', source: await teamDoc('국가기후위기적응센터 기후적응정책실', B) },
    ];
    for (const tpl of [await namedTemplate('기획경영본부'), load('master-template.hwp')]) {
      expect(await headerMismatches(hq(tpl, sections).bytes)).toEqual([]);
    }
  });

  t('[RU-T12] 구역 정의는 첫 문단에만 — 둘째 섹션부터의 제목 줄에 컨트롤이 딸려 오지 않는다', async () => {
    const a = await teamDoc('AI홍보전략실', A);
    const titles = ['기획경영본부(AI홍보전략실)', '기획경영본부(기획조정실)', '기획경영본부(연구관리실)'];
    const p = await topParas(hq(await namedTemplate('기획경영본부'), titles.map((title) => ({ title, source: a }))).bytes);
    const heads = p.filter((x) => titles.includes(x.text));
    expect(heads.map((x) => x.text)).toEqual(titles);
    expect(heads[0].ctrls).toEqual(['secd', 'cold']);
    expect(heads[1].ctrls).toEqual([]);
    expect(heads[2].ctrls).toEqual([]);
    expect(p.filter((x) => x.ctrls.includes('secd'))).toHaveLength(1);
  });

  t('[RU-T13] 쪽 나누기는 둘째 섹션부터, 끄면(본부 설정 rollupPageBreak) 하나도 없다 (RU-18)', async () => {
    const a = await teamDoc('AI홍보전략실', A);
    const sections = ['AI홍보전략실', '기획조정실', '연구관리실'].map((title) => ({ title, source: a }));
    const tpl = await namedTemplate('기획경영본부');
    const on = await topParas(hq(tpl, sections, true).bytes);
    expect(on.filter((x) => x.pageBreak).map((x) => x.text)).toEqual(['기획조정실', '연구관리실']);
    const off = await topParas(hq(tpl, sections, false).bytes);
    expect(off.filter((x) => x.pageBreak)).toEqual([]);
    // 기본값은 켬 — 전사 최종본은 옵션 없이 부른다(섹션마다 새 쪽, 분석 §3.1)
    const dflt = await topParas(composeOrgDocument(tpl, sections).bytes);
    expect(dflt.filter((x) => x.pageBreak).map((x) => x.text)).toEqual(['기획조정실', '연구관리실']);
  });

  t('[RU-T15] 같은 입력이면 같은 파일 — RU-02 「바뀜」은 내용으로 판정하므로 결과가 실행마다 달라지면 안 된다', async () => {
    const sections = [
      { title: 'AI홍보전략실', source: await teamDoc('AI홍보전략실', A) },
      { title: '기획조정실', source: await teamDoc('기획조정실', B) },
    ];
    const tpl = await namedTemplate('기획경영본부');
    expect(Buffer.compare(hq(tpl, sections).bytes, hq(tpl, sections).bytes)).toBe(0);
  });

  t('[RU-T16] 같은 양식에서 나온 표들도 저마다 다른 인스턴스 ID를 갖는다 (RU-17)', async () => {
    const { openHwp } = await import('@/lib/hwp/ole');
    const { parseRecords, TAG } = await import('@/lib/hwp/record');
    const a = await teamDoc('AI홍보전략실', A);
    const out = hq(await namedTemplate('기획경영본부'), ['A', 'B', 'C'].map((title) => ({ title, source: a })));
    const ids = parseRecords(openHwp(out.bytes).sections[0])
      .filter((r) => r.tag === TAG.CTRL_HEADER && r.data.toString('latin1', 0, 4) === ' lbt')
      .map((r) => r.data.readUInt32LE(36));
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
  });

  t('[RU-T17] 부서명 줄이 없는 옛 양식으로도 만든다 (첫 문단이 「1. 주요 업무실적」)', async () => {
    const a = await teamDoc('AI홍보전략실', A);
    const b = await teamDoc('기획조정실', B);
    const out = hq(load('master-template.hwp'), [
      { title: 'AI홍보전략실', source: a },
      { title: '기획조정실', source: b },
    ]);
    expect(plain(readUnits(out.bytes, 'x').units)).toEqual(
      plain([asSection(readUnits(a, 'x').units[0], 'AI홍보전략실'), asSection(readUnits(b, 'x').units[0], '기획조정실')]),
    );
  });

  t('[RU-T18] 행이 하나도 없는 단위도 자리를 지킨다 — 제목과 표가 들어가고, 빈 3번 표는 「특이사항 없음」 (RU-63)', async () => {
    const out = hq(await namedTemplate('기획경영본부'), [
      { title: '기획경영본부(AI홍보전략실)', source: await teamDoc('AI홍보전략실', A) },
      { title: '기획경영본부(인사관리실)', source: await teamDoc('인사관리실', { achievements: [], plans: [], notes: [] }) },
    ]);
    const back = readUnits(out.bytes, 'x').units;
    expect(back.map((u) => u.name)).toEqual(['기획경영본부(AI홍보전략실)', '기획경영본부(인사관리실)']);
    expect(plain([back[1]])).toEqual(plain([{ name: '기획경영본부(인사관리실)', tables: { achievements: [], plans: [], notes: [NOTES_NONE] } }]));
    expect(out.outcomes[1].fixed).toContain('빈 3번 표에 「특이사항 없음」');
  });

  t('[RU-T19] ★ 「목록의 끝」 표시는 본문 마지막 문단 하나에만 — 섹션을 이어도 한가운데 생기지 않는다', async () => {
    const { openHwp } = await import('@/lib/hwp/ole');
    const { parseRecords, TAG } = await import('@/lib/hwp/record');
    /** 본문(레벨 0) 문단마다 최상위 비트가 켜졌나 */
    const flags = (bytes: Buffer) =>
      parseRecords(openHwp(bytes).sections[0])
        .filter((r) => r.tag === TAG.PARA_HEADER && r.level === 0)
        .map((r) => (r.data.readUInt32LE(0) & 0x80000000) !== 0);
    const lastOnly = (f: boolean[]) => f.length > 0 && f.filter(Boolean).length === 1 && f[f.length - 1];

    // 전제 — 양식도 원본도 그렇게 생겼다(운영 양식 전부 같다, 2026-10-07 실측). 원본마다 하나씩 들고 온다
    const tpl = await namedTemplate('기획경영본부');
    const a = await teamDoc('AI홍보전략실', A);
    expect(lastOnly(flags(tpl))).toBe(true);
    expect(lastOnly(flags(a))).toBe(true);
    expect(lastOnly(flags(load('master-template.hwp')))).toBe(true);

    const three = ['AI홍보전략실', '기획조정실', '연구관리실'].map((title) => ({ title, source: a }));
    for (const [template, pageBreak] of [
      [tpl, true],
      [tpl, false],
      [load('master-template.hwp'), true], // 옛 양식 — 첫 문단이 「1. 주요 업무실적」
    ] as const) {
      const f = flags(hq(template, three, pageBreak).bytes);
      expect(f.filter(Boolean), '켜진 문단 수').toHaveLength(1);
      expect(f[f.length - 1], '마지막 문단').toBe(true);
    }
    // 섹션 하나여도 같다
    expect(lastOnly(flags(hq(tpl, [three[0]]).bytes))).toBe(true);
  });
});
