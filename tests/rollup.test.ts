// RU-10~15 — 본부·전사 이어 붙이기 엔진.
//
// 이 엔진의 약속은 하나다: **단위 안의 것은 하나도 바뀌지 않고, 순서만 바뀐다** (RU-11).
// 그래서 테스트도 거의 전부 「넣은 것 = 다시 읽은 것」의 꼴이다. 문서가 한글에서 열리는지는
// 테스트로 볼 수 없으므로, 한글이 「손상」으로 판정하는 지점(문단 자기 기술 — HM-46)을 대신 본다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeRollupHwp, readUnits, titleBucket, type UnitBlock } from '@/lib/hwp/rollup';

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

describe('RU-10 이어 붙이기', () => {
  t('[RU-T10] ★ 넣은 단위가 그대로 다시 읽힌다 — 이름·행·구분 번호·강조 (RU-11·14)', async () => {
    const units = [
      ...readUnits(await teamDoc('AI홍보전략실', A, { achievements: [false, true, false] }), 'x').units,
      ...readUnits(await teamDoc('기획조정실', B, { notes: [true] }), 'x').units,
      ...readUnits(load('sample-filled-w2.hwp'), '연구관리실').units,
    ];
    const out = composeRollupHwp(await namedTemplate('기획경영본부'), units, { pageBreak: true });
    expect(out.warnings).toEqual([]);
    const back = readUnits(out.bytes, 'x');
    expect(back.warnings).toEqual([]);
    expect(plain(back.units)).toEqual(plain(units));
  });

  t('[RU-T11] ★ 모든 문단의 자기 기술(글자·서식 구간·줄 수)이 맞는다 — 한글이 「손상」으로 보는 지점', async () => {
    const units = [
      ...readUnits(await teamDoc('AI홍보전략실', A, { achievements: [true, false, false] }), 'x').units,
      ...readUnits(await teamDoc('국가기후위기적응센터 기후적응정책실', B), 'x').units,
    ];
    for (const tpl of [await namedTemplate('기획경영본부'), load('master-template.hwp')]) {
      const out = composeRollupHwp(tpl, units, { pageBreak: true });
      expect(await headerMismatches(out.bytes)).toEqual([]);
    }
  });

  t('[RU-T12] 구역 정의는 첫 문단에만 — 단위 이름 줄에 컨트롤이 딸려 오지 않는다', async () => {
    const units = readUnits(await teamDoc('AI홍보전략실', A), 'x').units;
    const three = [units[0], { ...units[0], name: '기획조정실' }, { ...units[0], name: '연구관리실' }];
    const p = await topParas(composeRollupHwp(await namedTemplate('기획경영본부'), three, { pageBreak: true }).bytes);
    const heads = p.filter((x) => ['AI홍보전략실', '기획조정실', '연구관리실'].includes(x.text));
    expect(heads.map((x) => x.text)).toEqual(['AI홍보전략실', '기획조정실', '연구관리실']);
    expect(heads[0].ctrls).toEqual(['secd', 'cold']);
    expect(heads[1].ctrls).toEqual([]);
    expect(heads[2].ctrls).toEqual([]);
    expect(p.filter((x) => x.ctrls.includes('secd'))).toHaveLength(1);
  });

  t('[RU-T13] 쪽 나누기는 둘째 단위부터, 끄면 하나도 없다', async () => {
    const u = readUnits(await teamDoc('AI홍보전략실', A), 'x').units[0];
    const units = [u, { ...u, name: '기획조정실' }, { ...u, name: '연구관리실' }];
    const tpl = await namedTemplate('기획경영본부');
    const on = await topParas(composeRollupHwp(tpl, units, { pageBreak: true }).bytes);
    expect(on.filter((x) => x.pageBreak).map((x) => x.text)).toEqual(['기획조정실', '연구관리실']);
    const off = await topParas(composeRollupHwp(tpl, units, { pageBreak: false }).bytes);
    expect(off.filter((x) => x.pageBreak)).toEqual([]);
  });

  t('[RU-T14] 본부본을 다시 이어 붙이면 단위가 펼쳐진다 — 본부 → 전사', async () => {
    const tpl = await namedTemplate('기획조정실');
    const a = readUnits(await teamDoc('AI홍보전략실', A), 'x').units;
    const b = readUnits(await teamDoc('기획조정실', B), 'x').units;
    const hq = composeRollupHwp(tpl, [...a, ...b], { pageBreak: true }).bytes;
    const solo = await teamDoc('글로벌대외협력단', B);
    const org = composeRollupHwp(tpl, [...readUnits(hq, 'x').units, ...readUnits(solo, 'x').units], { pageBreak: true });
    expect(readUnits(org.bytes, 'x').units.map((u) => u.name)).toEqual(['AI홍보전략실', '기획조정실', '글로벌대외협력단']);
    expect(plain(readUnits(org.bytes, 'x').units)).toEqual(plain([...a, ...b, ...readUnits(solo, 'x').units]));
  });

  t('[RU-T15] 같은 입력이면 같은 파일 — 결과가 실행마다 달라지지 않는다', async () => {
    const units = [...readUnits(await teamDoc('AI홍보전략실', A), 'x').units, ...readUnits(await teamDoc('기획조정실', B), 'x').units];
    const tpl = await namedTemplate('기획경영본부');
    const x = composeRollupHwp(tpl, units, { pageBreak: true }).bytes;
    const y = composeRollupHwp(tpl, units, { pageBreak: true }).bytes;
    expect(Buffer.compare(x, y)).toBe(0);
  });

  t('[RU-T16] 복제한 표는 저마다 다른 인스턴스 ID를 갖는다', async () => {
    const { openHwp } = await import('@/lib/hwp/ole');
    const { parseRecords, TAG } = await import('@/lib/hwp/record');
    const u = readUnits(await teamDoc('AI홍보전략실', A), 'x').units[0];
    const out = composeRollupHwp(await namedTemplate('기획경영본부'), [u, { ...u, name: 'B' }, { ...u, name: 'C' }]);
    const ids = parseRecords(openHwp(out.bytes).sections[0])
      .filter((r) => r.tag === TAG.CTRL_HEADER && r.data.toString('latin1', 0, 4) === ' lbt')
      .map((r) => r.data.readUInt32LE(36));
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
  });

  t('[RU-T17] 부서명 줄이 없는 옛 양식으로도 만든다 (첫 문단이 「1. 주요 업무실적」)', async () => {
    const units = [...readUnits(await teamDoc('AI홍보전략실', A), 'x').units, ...readUnits(await teamDoc('기획조정실', B), 'x').units];
    const out = composeRollupHwp(load('master-template.hwp'), units);
    expect(plain(readUnits(out.bytes, 'x').units)).toEqual(plain(units));
  });

  t('[RU-T18] 행이 하나도 없는 단위도 자리를 지킨다 — 빈 표로 들어간다', async () => {
    const empty: UnitBlock = { name: '인사관리실', tables: { achievements: [], plans: [], notes: [] } };
    const a = readUnits(await teamDoc('AI홍보전략실', A), 'x').units;
    const out = composeRollupHwp(await namedTemplate('기획경영본부'), [...a, empty]);
    expect(readUnits(out.bytes, 'x').units.map((u) => u.name)).toEqual(['AI홍보전략실', '인사관리실']);
  });

  t('[RU-T19] ★ 「목록의 끝」 표시는 본문 마지막 문단 하나에만 — 몸통을 복제해도 한가운데 생기지 않는다', async () => {
    const { openHwp } = await import('@/lib/hwp/ole');
    const { parseRecords, TAG } = await import('@/lib/hwp/record');
    /** 본문(레벨 0) 문단마다 최상위 비트가 켜졌나 */
    const flags = (bytes: Buffer) =>
      parseRecords(openHwp(bytes).sections[0])
        .filter((r) => r.tag === TAG.PARA_HEADER && r.level === 0)
        .map((r) => (r.data.readUInt32LE(0) & 0x80000000) !== 0);
    const lastOnly = (f: boolean[]) => f.length > 0 && f.filter(Boolean).length === 1 && f[f.length - 1];

    // 전제 — 양식 자체가 그렇게 생겼다 (운영 양식 전부 같다, 2026-10-07 실측)
    const tpl = await namedTemplate('기획경영본부');
    expect(lastOnly(flags(tpl))).toBe(true);
    expect(lastOnly(flags(load('master-template.hwp')))).toBe(true);

    const u = readUnits(await teamDoc('AI홍보전략실', A), 'x').units[0];
    const three = [u, { ...u, name: '기획조정실' }, { ...u, name: '연구관리실' }];
    for (const [template, opts] of [
      [tpl, { pageBreak: true }],
      [tpl, { pageBreak: false }],
      [load('master-template.hwp'), { pageBreak: true }], // 옛 양식 — HM-46이 문단을 하나 더 만든다
    ] as const) {
      const f = flags(composeRollupHwp(template, three, opts).bytes);
      expect(f.filter(Boolean), '켜진 문단 수').toHaveLength(1);
      expect(f[f.length - 1], '마지막 문단').toBe(true);
    }
    // 단위 하나면 양식과 같다
    expect(lastOnly(flags(composeRollupHwp(tpl, [u]).bytes))).toBe(true);
  });
});
