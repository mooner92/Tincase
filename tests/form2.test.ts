// RH-110~114 — 양식 ②(실형 + 자문회의 표, 국가지속가능발전연구센터). 집계표를 건너뛰고 업무 표 셋을 채운다 — 집계표 없는 양식은 그대로.
// hwp를 만드는 시험은 비공개 원본 취합본이 있어야 돈다(fixtures/README.md) — 없으면 건너뛴다.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { isConsultHeader } from '@/lib/hwp/worklog-tables';

const SOURCE = 'fixtures/hq-source-2026-09-4.hwp';
const DONOR = 'fixtures/master-template.hwp';
const NAME = '국가지속가능발전연구센터';
const t = existsSync(SOURCE) && existsSync(DONOR) ? it : it.skip;

describe('RH-111 — 자문회의 집계표 알아보기', () => {
  it('[RH-T50] 머리 「구분 | 자문회의 | …」만 집계표 — 업무 표 · 띄어쓰기 흔들림', () => {
    expect(isConsultHeader(['구분', '자문회의', '전문가 세미나', '포럼, 워크샵 등', '기타 회의'])).toBe(true);
    expect(isConsultHeader([' 구 분', '자문 회의'])).toBe(true);
    expect(isConsultHeader(['구분', '업무실적 내용', '일자', '장소', '참석자'])).toBe(false);
    expect(isConsultHeader(['구분', '유형', '과제명', '책임자'])).toBe(false);
  });
});

describe('RH-110 · RH-113 — 양식 ② 쓰기·병합 (비공개 원본)', () => {
  t('[RH-T51] 양식은 업무 표 셋 + 자문회의 한 줄 · 담당 값은 그 줄에 · 안 주면 「-」 · 병합도 같다 · 집계표 없는 양식은 그대로', async () => {
    const { buildConsultUnitTemplate } = await import('@/lib/hwp/hq-form');
    const { readWorklog } = await import('@/lib/hwp/reader');
    const { buildWorklogHwp } = await import('@/server/worklog-doc');
    const { composeMergedHwp } = await import('@/server/merge/index');
    const tpl = buildConsultUnitTemplate(readFileSync(SOURCE), NAME, readFileSync(DONOR));
    const empty = readWorklog(tpl);
    expect(empty.tables).toHaveLength(3);
    expect(empty.consult).toEqual([{ label: NAME, values: ['-', '-', '-', '-'] }]);
    expect(empty.warnings).toEqual([]);

    const row = { content: '정례회의', date: '10/13', place: '공동연구실', attendee: '갑 외' };
    const lead = readWorklog(buildWorklogHwp(tpl, { achievements: [row] }, {}, { consult: ['1', '', '-', '2'], consultLabel: NAME }).bytes);
    expect(lead.consult[0].values).toEqual(['1', '-', '-', '2']);
    expect(lead.worklog.achievements.map((r) => r.content)).toEqual(['정례회의']);
    const member = readWorklog(buildWorklogHwp(tpl, { plans: [row] }).bytes);
    expect(member.consult[0].values).toEqual(['-', '-', '-', '-']);
    expect(member.worklog.plans).toHaveLength(1);

    const merged = composeMergedHwp(tpl, { achievements: [['1-1', '정례회의', '10/13', '', '']], plans: [], notes: [] }, undefined, NAME, ['3', '-', '-', '-']);
    expect(merged.tableCount).toBe(3);
    expect(readWorklog(merged.bytes).consult[0].values).toEqual(['3', '-', '-', '-']);

    const plain = readFileSync(DONOR); // 집계표 없는 실형 — 값을 줘도 쓸 자리가 없고 표 셋은 그대로
    const m2 = composeMergedHwp(plain, { achievements: [['1-1', '가', '10/1', '', '']], plans: [], notes: [] }, undefined, '가실', ['9', '9', '9', '9']);
    expect(m2.tableCount).toBe(3);
    expect(readWorklog(m2.bytes).consult).toEqual([]);
    expect(readWorklog(m2.bytes).worklog.achievements.map((r) => r.content)).toEqual(['가']);
  });
});
