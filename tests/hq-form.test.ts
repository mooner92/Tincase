// RH-30~36 — 연구 본부·센터 양식(두 층 6칸 표). 사람·과제 이름은 지어낸 것이다.
// 양식 만들기·채우기는 비공개 원본 취합본이 있어야 돈다(fixtures/README.md) — 없으면 건너뛴다. 줄 펼치기 규칙은 늘 돈다.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as CFB from 'cfb';
import {
  PLAIN_PROTO,
  PROJECT_PROTO,
  buildHqTemplate,
  fillHqForm,
  noteRows,
  projectRows,
  readHqTables,
  tableKindOf,
  type HqFormData,
  type HqTask,
} from '@/lib/hwp/hq-form';
import { openHwp } from '@/lib/hwp/ole';
import { stripCellControls } from '@/lib/hwp/proto-rows';
import { TAG, paraText, type HwpRecord } from '@/lib/hwp/record';

const item = (content: string, date = '10/16', place = '본관', people = '가나다') => ({ content, date, place, people });

describe('RH-32 · RH-33 — 과제·항목을 표 줄로', () => {
  const tasks: HqTask[] = [
    { unit: '가실', type: '수탁', title: '과제 하나', owner: '갑', items: [item('회의 A'), item('회의 B')] },
    { unit: '가실', type: '기본', title: '과제 둘', owner: '을', items: [item('회의 C', '10/12~10/14')] },
    { unit: '가실', type: '수시', title: '항목 없는 과제', owner: '병', items: [{ content: '', date: '', place: '', people: '' }] },
    { unit: '나실', type: 'R&D', title: '과제 셋', owner: '정', items: [{ ...item('회의 D'), emphasis: true }] },
  ];

  it('[RH-T01] 실 약칭은 그 실의 첫 과제 줄에만 · 번호는 표 안에서 이어진다 · 항목 없는 과제는 빠진다', () => {
    const rows = projectRows(tasks, 1);
    expect(rows.map((r) => r.proto)).toEqual([
      PROJECT_PROTO.taskFirst,
      PROJECT_PROTO.item,
      PROJECT_PROTO.item,
      PROJECT_PROTO.taskCont,
      PROJECT_PROTO.item,
      PROJECT_PROTO.taskFirst,
      PROJECT_PROTO.itemLast,
    ]);
    expect(rows[0].texts).toEqual({ 0: '가실', 1: '수탁', 2: '과제 하나', 5: '갑' });
    expect(rows[3].texts[0]).toBe('');
    expect(rows.filter((r) => r.proto !== PROJECT_PROTO.taskFirst && r.proto !== PROJECT_PROTO.taskCont).map((r) => r.texts[1])).toEqual([
      '1-1',
      '1-2',
      '1-3',
      '1-4',
    ]);
    expect(rows[4].texts[3]).toBe('10/12~10/14');
    expect(rows.find((r) => r.texts[2] === '항목 없는 과제')).toBeUndefined();
  });

  it('[RH-T02] 계획은 2-n · 강조 항목은 내용 칸 · 마지막 줄은 마지막 항목 원형', () => {
    const rows = projectRows(tasks, 2);
    expect(rows[1].texts[1]).toBe('2-1');
    expect(rows[6]).toMatchObject({ proto: PROJECT_PROTO.itemLast, emphasisCol: 2 });
    expect(rows[1].emphasisCol).toBeUndefined();
  });

  it('[RH-T03] 비면 마지막 항목 원형 한 줄에 빈 표기 · 특이사항은 3-n과 마지막 줄 원형', () => {
    expect(projectRows([], 1)).toEqual([{ proto: PROJECT_PROTO.itemLast, texts: { 1: '-', 2: '-', 3: '-', 4: '-', 5: '-' } }]);
    expect(projectRows([tasks[2]], 1, '없음')[0].texts[2]).toBe('없음');
    const notes = noteRows([item('발표'), item(''), item('수상', '10/7')]);
    // 내용이 비어도 일자 등이 있으면 남는다 — 빼는 것은 글자가 하나도 없는 줄뿐
    expect(notes.map((r) => [r.proto, r.texts[0], r.texts[1]])).toEqual([
      [PLAIN_PROTO.middle, '3-1', '발표'],
      [PLAIN_PROTO.middle, '3-2', ''],
      [PLAIN_PROTO.last, '3-3', '수상'],
    ]);
    expect(noteRows([])).toEqual([{ proto: PLAIN_PROTO.last, texts: { 0: '-', 1: '-', 2: '-', 3: '-', 4: '-' } }]);
  });

  it('[RH-T04] 표 제목으로 종류를 안다 — 띄어쓰기가 흔들려도', () => {
    expect(tableKindOf('※ 자문회의 실적')).toBe('consult');
    expect(tableKindOf('※ 평가실적')).toBe('evaluation');
    expect(tableKindOf('※  평가 실적')).toBe('evaluation');
    expect(tableKindOf('1. 주요 업무실적')).toBe('results');
    expect(tableKindOf('2.주요 업무계획')).toBe('plans');
    expect(tableKindOf('3. 기타 특이사항')).toBe('notes');
    expect(tableKindOf('국토환경연구본부')).toBeNull();
  });
});

describe('RH-36 — 칸 속 숨은 컨트롤', () => {
  it('[RH-T05] 칸 문단에 딸린 컨트롤은 본체와 글자 속 자리 표시째 걷힌다 — 한쪽만 지우면 한글이 파일을 거부한다', () => {
    // 원본 평가 실적 「2건」 칸처럼: 글자 맨 앞에 단 정의(cold) 8칸 + CTRL_HEADER
    const ctrl = Buffer.alloc(16);
    ctrl.writeUInt16LE(2, 0);
    ctrl.writeUInt16LE(2, 14);
    const text = Buffer.concat([ctrl, Buffer.from('2건\r', 'ucs2')]);
    const head = Buffer.alloc(22);
    head.writeUInt32LE(text.length / 2, 0);
    head.writeUInt16LE(1, 12);
    const rec = (tag: number, level: number, data: Buffer): HwpRecord => ({ tag, level, data, extended: false });
    const recs: HwpRecord[] = [
      rec(TAG.LIST_HEADER, 2, Buffer.alloc(34)),
      rec(TAG.PARA_HEADER, 2, head),
      rec(TAG.PARA_TEXT, 3, text),
      rec(TAG.PARA_CHAR_SHAPE, 3, Buffer.alloc(8)),
      rec(TAG.CTRL_HEADER, 3, Buffer.from('dloc', 'latin1')),
      rec(TAG.CTRL_HEADER + 100, 4, Buffer.alloc(4)), // 컨트롤 안쪽 레코드도 같이 간다
      rec(TAG.LIST_HEADER, 2, Buffer.alloc(34)),
    ];
    stripCellControls(recs, { row: 0, col: 0, start: 0, end: 6 });
    expect(recs.map((r) => r.tag)).toEqual([TAG.LIST_HEADER, TAG.PARA_HEADER, TAG.PARA_TEXT, TAG.PARA_CHAR_SHAPE, TAG.LIST_HEADER]);
    expect(paraText(recs[2].data)).toBe('2건');
    expect(recs[2].data.length / 2).toBe(3);
  });
});

const SOURCE = 'fixtures/hq-source-2026-09-4.hwp';
const DONOR = 'fixtures/master-template.hwp';
const hasFix = existsSync(SOURCE) && existsSync(DONOR);
const t = hasFix ? it : it.skip;

describe('RH-30 · RH-31 · RH-36 — 양식 만들기와 채우기 (비공개 원본)', () => {
  const spec = {
    name: '가나본부',
    units: ['가실연구실', '나실연구실'],
    consultFrom: '국가기후위기적응센터',
    evaluation: { from: '국가기후위기적응센터', place: 'afterConsult' as const },
  };
  const build = () => buildHqTemplate(readFileSync(SOURCE), spec, readFileSync(DONOR));

  t('[RH-T10] 양식 — 제목 · 자문회의(본부+실) · 평가 · 6칸 원형 넷 · 특이사항 원형 둘, 값 칸은 비어 있다', () => {
    const back = readHqTables(build());
    expect(back.consult!.map((r) => r[0][1])).toEqual(['구분', '가나본부', '가실연구실', '나실연구실']);
    expect(back.consult!.slice(1).flatMap((r) => r.slice(1).map(([, v]) => v))).toEqual(Array(12).fill(''));
    expect(back.evaluation![0].map(([, v]) => v)).toEqual(['기후변화영향평가서(적응 부문) 등 검토', '']);
    for (const k of ['results', 'plans'] as const) {
      const rows = back[k]!;
      expect(rows.map((r) => r.length)).toEqual([4, 4, 4, 6, 6]); // 머리 · 과제 첫 · 과제 이은 · 항목 · 마지막 항목
      expect(rows[0].map(([, v]) => v)).toEqual(['구분', '유형', '과제명', '책임자']);
      expect(rows.slice(1).flatMap((r) => r.map(([, v]) => v)).every((v) => v === '')).toBe(true);
    }
    expect(back.notes!.length).toBe(1 + 2);
  });

  t('[RH-T11] 양식에 원본의 흔적이 없다 — 미리보기 그림 없음 · 문서 정보는 빌려 온 것 · 미리보기 글자는 양식 자신', () => {
    const tpl = build();
    const cf = CFB.read(tpl, { type: 'buffer' });
    expect(CFB.find(cf, 'PrvImage')).toBeNull();
    const donor = CFB.read(readFileSync(DONOR), { type: 'buffer' });
    const sum = (c: CFB.CFB$Container) => Buffer.from(CFB.find(c, '\u0005HwpSummaryInformation')!.content as Uint8Array);
    expect(sum(cf).equals(sum(donor))).toBe(true);
    const prv = openHwp(tpl).previewText ?? '';
    expect(prv.startsWith('가나본부')).toBe(true);
    expect(prv).not.toContain('임원실');
  });

  t('[RH-T12] 채우기 — 과제 4칸 · 항목 6칸 · 번호 · 실 약칭 · 자문회의는 줄 이름으로 · 평가 값 · 빈 값은 「-」 · 다시 읽으면 넣은 대로', () => {
    const data: HqFormData = {
      title: '가나본부',
      consult: [
        { label: '가실연구실', values: ['1', '', '2건(1건)', ''] },
        { label: '가나 본부', values: ['3', '', '', ''] },
      ],
      evaluation: ['5건'],
      results: [
        { unit: '가실', type: '수탁', title: '과제 하나', owner: '갑', items: [item('회의 A'), item('회의 B', '10/12~10/14', '온라인', '갑 외')] },
        { unit: '나실', type: '기본', title: '과제 둘', owner: '을', items: [item('회의 C')] },
      ],
      plans: [],
      notes: [item('발표')],
    };
    const back = readHqTables(fillHqForm(build(), data));
    const v = (r: [number, string][]) => r.map(([, s]) => s);
    expect(back.results!.map((r) => r.length)).toEqual([4, 4, 6, 6, 4, 6]);
    expect(v(back.results![1])).toEqual(['가실', '수탁', '과제 하나', '갑']);
    expect(v(back.results![3])).toEqual(['', '1-2', '회의 B', '10/12~10/14', '온라인', '갑 외']);
    expect(v(back.results![4])).toEqual(['나실', '기본', '과제 둘', '을']);
    expect(v(back.results![5])[1]).toBe('1-3');
    expect(back.plans!.map((r) => r.length)).toEqual([4, 6]);
    expect(v(back.plans![1])).toEqual(['', '-', '-', '-', '-', '-']);
    expect(back.consult!.map(v)).toEqual([
      ['구분', '자문회의', '전문가 세미나', '포럼, 워크샵 등', '기타 회의'],
      ['가나본부', '3', '-', '-', '-'],
      ['가실연구실', '1', '-', '2건(1건)', '-'],
      ['나실연구실', '-', '-', '-', '-'],
    ]);
    expect(v(back.evaluation![0])).toEqual(['기후변화영향평가서(적응 부문) 등 검토', '5건']);
    expect(v(back.notes![1])).toEqual(['3-1', '발표', '10/16', '본관', '가나다']);
  });
});
