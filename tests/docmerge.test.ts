// RU-60~62 — 서식 번호를 옮겨 적는 섹션 복제와 전사 취합본 조립.
//
// 이 엔진의 약속: **원본 섹션은 꼴 그대로**, 대상 문서는 **한글이 열 수 있는 상태로**.
// 한글을 테스트에서 돌릴 수 없으므로, 한글이 「손상」으로 보는 지점 셋을 대신 본다:
//   ① 본문이 가리키는 서식 번호가 전부 DocInfo 범위 안 (checkReferences)
//   ② 문단 머리가 밝힌 글자·서식 구간·줄 수 = 뒤따르는 레코드 (HM-46)
//   ③ 구역 정의는 문서 첫 문단에 하나, 「목록 마지막 문단」 표시는 마지막에 하나
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { openHwp } from '@/lib/hwp/ole';
import { parseRecords, paraText, TAG, type HwpRecord } from '@/lib/hwp/record';
import { DocInfoMerger, remapBody, checkReferences } from '@/lib/hwp/docmerge';
import { composeOrgDocument, extractSectionBody } from '@/lib/hwp/orgdoc';
import { readWorklog } from '@/lib/hwp/reader';

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

async function merged(name: string, rows: string[], emphasis?: boolean[]) {
  const { composeMergedHwp } = await import('@/server/merge');
  return composeMergedHwp(
    load('master-template.hwp'),
    { achievements: rows.map((c, i) => [`1-${i + 1}`, c, '', '', '']), plans: [['2-1', `${name} 계획`, '', '', '']], notes: [] },
    emphasis ? { achievements: emphasis } : undefined,
    name,
  ).bytes;
}
/** 부서명이 맨 위에 있는 양식 — 운영 양식 꼴 (제목 문단 + 1·2·3 표) */
const namedTemplate = () => merged('기획조정실', []);

function headerMismatches(recs: readonly HwpRecord[]) {
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
    if ((d.readUInt32LE(0) & 0x7fffffff) !== (text < 0 ? 1 : text)) bad.push(`#${i} 글자`);
    if (d.readUInt16LE(12) !== runs) bad.push(`#${i} 서식`);
    if (d.readUInt16LE(16) !== segs) bad.push(`#${i} 줄`);
  }
  return bad;
}

const topTexts = (recs: readonly HwpRecord[]) => {
  const out: { text: string; pageBreak: boolean; ctrls: number }[] = [];
  recs.forEach((r, i) => {
    if (r.tag !== TAG.PARA_HEADER || r.level !== 0) return;
    let text = '';
    let ctrls = 0;
    for (let k = i + 1; k < recs.length && recs[k].level > 0; k++) {
      if (recs[k].level === 1 && recs[k].tag === TAG.PARA_TEXT) text = paraText(recs[k].data);
      if (recs[k].level === 1 && recs[k].tag === TAG.CTRL_HEADER) ctrls++;
    }
    out.push({ text, pageBreak: (r.data[11] & 0x04) !== 0, ctrls });
  });
  return out;
};

describe('RU-62 서식 번호 옮겨 적기', () => {
  t('[RU-T50] 같은 양식에서 나온 문서는 DocInfo가 늘지 않는다 — 같은 레코드를 찾아 쓴다', async () => {
    const tpl = openHwp(await namedTemplate());
    const src = openHwp(await merged('AI홍보전략실', ['인포그래픽 제작']));
    const m = new DocInfoMerger(parseRecords(tpl.docInfo));
    const body = remapBody(parseRecords(src.sections[0]), m.from(parseRecords(src.docInfo)));
    const di = m.build();
    expect(di.filter((r) => r.tag === 21).length).toBe(parseRecords(tpl.docInfo).filter((r) => r.tag === 21).length);
    expect(checkReferences(di, body)).toEqual([]);
  });

  t('[RU-T51] 원본에만 있는 서식(파란 「공유」)은 대상에 붙여 오고 번호를 바꿔 단다 — 색이 그대로 남는다', async () => {
    const tpl = await namedTemplate();
    const src = await merged('AI홍보전략실', ['보통 줄', '공유할 줄'], [false, true]);
    const r = composeOrgDocument(tpl, [{ title: '기획경영본부(AI홍보전략실)', source: src }]);
    const back = readWorklog(r.bytes).worklog.achievements;
    expect(back.map((x) => [x.content, x.emphasis])).toEqual([
      ['보통 줄', false],
      ['공유할 줄', true],
    ]);
  });

  t('[RU-T52] 서로 다른 DocInfo의 원본 여럿(옛 양식·실제 제출본) — 번호 범위·문단 머리 모두 맞다', async () => {
    const r = composeOrgDocument(await namedTemplate(), [
      { title: '임원실', source: load('sample-filled-w1.hwp') },
      { title: '기획경영본부(기획조정실)', source: await merged('기획조정실', ['예산 협의'], [true]) },
      { title: '경영지원실', source: load('sample-filled-w2.hwp') },
    ]);
    const f = openHwp(r.bytes);
    const recs = parseRecords(f.sections[0]);
    expect(checkReferences(parseRecords(f.docInfo), recs)).toEqual([]);
    expect(headerMismatches(recs)).toEqual([]);
  });
});

describe('RU-60·61 전사 취합본 조립', () => {
  t('[RU-T53] ★ 섹션 제목은 생성하고, 원본 제목은 뺀다 — AI홍보전략실 제목이 빠지던 일이 없다', async () => {
    const r = composeOrgDocument(await namedTemplate(), [
      { title: '임원실', source: await merged('임원실', ['원장 일정']) },
      { title: '기획경영본부(AI홍보전략실)', source: await merged('AI홍보전략실', ['보도자료 배포']) },
    ]);
    const tops = topTexts(parseRecords(openHwp(r.bytes).sections[0]));
    const titles = tops.filter((x) => /임원실|기획경영본부/.test(x.text)).map((x) => x.text);
    expect(titles).toEqual(['임원실', '기획경영본부(AI홍보전략실)']); // 원본의 「AI홍보전략실」 줄은 없다
    expect(r.outcomes.map((o) => o.dropped)).toEqual([['제목 「임원실」'], ['제목 「AI홍보전략실」']]);
  });

  t('[RU-T54] 섹션마다 새 쪽 · 구역 정의는 첫 문단에만 · 「마지막 문단」 표시는 하나', async () => {
    const r = composeOrgDocument(await namedTemplate(), [
      { title: '가', source: load('sample-filled-w1.hwp') }, // 첫 문단에 구역 정의가 붙은 옛 양식
      { title: '나', source: await merged('나', ['x']) },
      { title: '다', source: null },
    ]);
    const recs = parseRecords(openHwp(r.bytes).sections[0]);
    const tops = topTexts(recs);
    expect(tops.filter((x) => x.pageBreak).map((x) => x.text)).toEqual(['나', '다']);
    expect(recs.filter((x) => x.tag === TAG.CTRL_HEADER && x.data.toString('latin1', 0, 4) === 'dces')).toHaveLength(1);
    expect(tops[0]).toMatchObject({ text: '가', ctrls: 2 }); // secd·cold
    // 원본의 첫 문단(「1. 주요 업무실적」)은 컨트롤을 걷고 남는다 — 구역 나누기 표시도 같이 걷힌다
    const body1 = recs.findIndex((x, i) => x.tag === TAG.PARA_HEADER && x.level === 0 && i > 0);
    expect(recs[body1].data[11] & 0x01).toBe(0);
    const flagged = recs.filter((x) => x.tag === TAG.PARA_HEADER && x.level === 0 && (x.data.readUInt32LE(0) & 0x80000000) !== 0);
    expect(flagged).toHaveLength(1);
  });

  t('[RU-T55] 미제출 섹션은 제목 + 「미제출」 — 자리를 지킨다 (분석 Q3)', async () => {
    const r = composeOrgDocument(await namedTemplate(), [{ title: '국가지속가능발전연구센터', source: null }]);
    const tops = topTexts(parseRecords(openHwp(r.bytes).sections[0]));
    expect(tops.map((x) => x.text).slice(0, 2)).toEqual(['국가지속가능발전연구센터', '미제출 — 이번 주 제출이 없습니다']);
    expect(r.outcomes[0].status).toBe('missing');
  });

  t('[RU-T56] 원본을 못 읽으면 그 섹션만 실패로 적고 나머지는 만든다 (HM-21)', async () => {
    const r = composeOrgDocument(await namedTemplate(), [
      { title: '가', source: Buffer.from('not a hwp') },
      { title: '나', source: await merged('나', ['x']) },
    ]);
    expect(r.outcomes.map((o) => o.status)).toEqual(['failed', 'copied']);
    expect(readWorklog(r.bytes).worklog.achievements.map((x) => x.content)).toEqual(['x']);
  });

  t('[RU-T57] 본문 고르기 — 표 앞의 제목은 빼고 표 제목부터 남긴다', async () => {
    const { body, dropped } = extractSectionBody(await merged('인사관리실', ['채용 공고']));
    expect(dropped).toEqual(['제목 「인사관리실」']);
    const first = body.findIndex((x) => x.tag === TAG.PARA_TEXT && x.level === 1);
    expect(paraText(body[first].data)).toBe('1. 주요 업무실적');
  });
});

describe('RU-63·64 정규화·검증', () => {
  t('[RU-T58] 번호만 남은 빈 줄은 지우고, 번호는 내용 있는 줄에 차례로, 빈 3번 표는 「특이사항 없음」', async () => {
    const r = composeOrgDocument(await namedTemplate(), [{ title: '시험실', source: load('master-template.hwp') }]);
    const o = r.outcomes[0];
    expect(o.fixed?.some((x) => x.startsWith('빈 줄'))).toBe(true);
    expect(o.fixed).toContain('빈 3번 표에 「특이사항 없음」');
    expect(o.warnings?.[0]).toContain('양식 잔재');
    const w = readWorklog(r.bytes).worklog;
    expect(w.notes.map((x) => x.content)).toEqual(['특이사항 없음']);
    const f = openHwp(r.bytes);
    const recs = parseRecords(f.sections[0]);
    expect(checkReferences(parseRecords(f.docInfo), recs)).toEqual([]);
    expect(headerMismatches(recs)).toEqual([]);
  });

  t('[RU-T59] 번호가 어긋난 줄(복사해 온 「2-1」 등)을 표 머리에 맞춰 다시 매긴다 — 분석 §9.1', async () => {
    const { composeMergedHwp } = await import('@/server/merge');
    // 실적 표에 「2-n」 번호를 단 원본 — 8월 4주차 임원실 사례
    const src = composeMergedHwp(load('master-template.hwp'), {
      achievements: [['2-1', '원장 일정 A', '10/1', '', ''], ['2-2', '원장 일정 B', '10/2', '', '']],
      plans: [],
      notes: [],
    }).bytes;
    // composeMergedHwp는 번호를 그대로 쓴다 — 원본이 틀린 번호를 들고 있는 상태
    const r = composeOrgDocument(await namedTemplate(), [{ title: '임원실', source: src }]);
    const recs = parseRecords(openHwp(r.bytes).sections[0]);
    const nums = recs.filter((x) => x.tag === TAG.PARA_TEXT && /^\d-\d$/.test(paraText(x.data))).map((x) => paraText(x.data));
    expect(nums.slice(0, 2)).toEqual(['1-1', '1-2']);
    expect(r.outcomes[0].fixed?.[0]).toMatch(/번호 \d+곳/);
  });
});
