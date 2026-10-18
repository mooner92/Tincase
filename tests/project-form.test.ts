// RH-70~77 — 연구실 작성: 일자 칩 · 실 약칭 · 입력 검사와 hwp 만들기. 사람·과제 이름은 지어낸 것이다.
// hwp 만들기는 비공개 원본 취합본이 있어야 돈다(fixtures/README.md) — 없으면 건너뛴다.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { formatDays, parseDays, weekDayChips } from '@/lib/project-dates';
import { unitAbbr } from '@/lib/unit-abbr';

const MON_1012 = Date.UTC(2026, 9, 11, 15, 0); // 2026-10-12(월) 00:00 KST
const MON_0928 = Date.UTC(2026, 8, 27, 15, 0); // 2026-09-28(월) 00:00 KST

describe('RH-73 — 일자 칩', () => {
  it('[RH-T20] 그 주 월~금 · 다음 주 · 달이 바뀌는 주', () => {
    expect(weekDayChips(MON_1012).map((c) => `${c.dow}${c.md}`)).toEqual(['월10/12', '화10/13', '수10/14', '목10/15', '금10/16']);
    expect(weekDayChips(MON_1012, 1).map((c) => c.md)).toEqual(['10/19', '10/20', '10/21', '10/22', '10/23']);
    expect(weekDayChips(MON_0928).map((c) => c.md)).toEqual(['9/28', '9/29', '9/30', '10/1', '10/2']);
  });

  it('[RH-T21] 하루 · 이어진 날은 기간 · 달이 바뀌면 달을 다시 · 떨어진 날은 쉼표 · 고른 순서와 상관없다', () => {
    const w = weekDayChips(MON_1012);
    const sep = weekDayChips(MON_0928);
    expect(formatDays([w[4]])).toBe('10/16');
    expect(formatDays([w[2], w[0], w[1]])).toBe('10/12~14');
    expect(formatDays([sep[4], sep[2], sep[3]])).toBe('9/30~10/2');
    expect(formatDays([w[3], w[0]])).toBe('10/12, 10/15');
    expect(formatDays([])).toBe('');
  });

  it('[RH-T22] 글자를 칩으로 되돌린다 — 제출본의 흔한 모양들 · 칩으로 못 만들면 null(직접 입력으로 연다)', () => {
    const w = weekDayChips(MON_1012);
    const mds = (v: string) => parseDays(v, w)?.map((c) => c.md) ?? null;
    expect(mds('10/16')).toEqual(['10/16']);
    expect(mds('10/12~14')).toEqual(['10/12', '10/13', '10/14']);
    expect(mds('10/12~10/14')).toEqual(['10/12', '10/13', '10/14']);
    expect(mds('10/15-16')).toEqual(['10/15', '10/16']);
    expect(mds('10/12, 10/15')).toEqual(['10/12', '10/15']);
    expect(mds('')).toEqual([]);
    expect(mds('10월 중')).toBeNull();
    expect(mds('10/22')).toBeNull(); // 다음 주 날짜는 이번 주 칩에 없다
    expect(mds('10/14~12')).toBeNull();
  });
});

describe('RH-75 — 구분 칸의 실 약칭', () => {
  it('[RH-T23] 제출본에서 쓰던 약칭 · 표에 없으면 부서 이름 그대로', () => {
    expect(unitAbbr('물관리연구실')).toBe('물실');
    expect(unitAbbr('탄소중립에너지연구실')).toBe('탄중실');
    expect(unitAbbr('사회기반평가실')).toBe('기반');
    expect(unitAbbr('국가기후위기적응센터')).toBe('센터');
    expect(unitAbbr('새로생긴연구실')).toBe('새로생긴연구실');
  });
});

const SOURCE = 'fixtures/hq-source-2026-09-4.hwp';
const DONOR = 'fixtures/master-template.hwp';
const hasFix = existsSync(SOURCE) && existsSync(DONOR);
const t = hasFix ? it : it.skip;

describe('RH-75 · RH-77 — 입력 검사와 hwp 만들기 (비공개 원본)', () => {
  const template = async () => {
    const { buildHqTemplate } = await import('@/lib/hwp/hq-form');
    return buildHqTemplate(readFileSync(SOURCE), { name: '가나본부', units: ['물관리연구실'], consultFrom: '국토환경연구본부' }, readFileSync(DONOR));
  };
  const item = (content: string, extra: Record<string, unknown> = {}) => ({ content, date: '10/13', place: '본관', people: '갑', ...extra });

  t('[RH-T24] 실 약칭은 부서에서 · 항목 없는 과제는 빠진다 · 강조는 다시 읽어도 강조 · 서버가 다시 읽어 맞는지 본다', async () => {
    const { buildProjectHwp } = await import('@/server/project-form');
    const { parseHqForm } = await import('@/lib/hwp/hq-form');
    const { bytes } = buildProjectHwp(
      await template(),
      {
        kind: 'project',
        results: [
          { type: '수탁', title: '과제 하나', owner: '갑', items: [item('회의 A'), item('회의 B', { emphasis: true })] },
          { type: '기본', title: '빈 과제', owner: '을', items: [{ content: '', date: '', place: '', people: '' }] },
        ],
        plans: [{ type: 'R&D', title: '과제 둘', owner: '병', items: [item('착수 회의')] }],
        notes: [item('발표')],
      },
      '물관리연구실',
    );
    const back = parseHqForm(bytes);
    expect(back.results.map((x) => [x.unit, x.title, x.items.length])).toEqual([['물실', '과제 하나', 2]]);
    expect(back.results[0].items.map((i) => !!i.emphasis)).toEqual([false, true]);
    expect(back.plans[0]).toMatchObject({ unit: '물실', type: 'R&D', title: '과제 둘' });
    expect(back.notes.map((n) => n.content)).toEqual(['발표']);
  });

  t('[RH-T25] 거절 — 비었으면 · 과제명 없이 항목만 · 한도를 넘으면 · 연구실 양식이 아니면', async () => {
    const { buildProjectHwp } = await import('@/server/project-form');
    const tpl = await template();
    const status = (body: unknown, tb = tpl) => {
      try {
        buildProjectHwp(tb, body as never, '물관리연구실');
        return 200;
      } catch (e) {
        return (e as { status?: number; code?: string }).code ?? 'thrown';
      }
    };
    expect(status({ kind: 'project', results: [], plans: [], notes: [] })).toBe('empty_content');
    expect(status({ kind: 'project', results: [{ type: '수탁', title: ' ', owner: '', items: [item('회의')] }] })).toBe('invalid_request');
    expect(status({ kind: 'project', results: Array.from({ length: 31 }, (_, i) => ({ type: '수탁', title: `과제${i}`, owner: '', items: [item('회의')] })) })).toBe('too_many');
    expect(status({ kind: 'project', results: [{ type: '아주아주아주아주긴유형이름입니다이건너무길어', title: '과제', owner: '', items: [item('회의')] }] })).toBe('cell_too_long');
    expect(status({ kind: 'project', notes: [item('발표')] }, readFileSync(DONOR))).toBe('form_mismatch');
  });
});
