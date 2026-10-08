// PG-49f · PG-51 · WS-19l — 「전사」는 한 화면, 일정 카드는 하나.
//
// 2026-10-07 하루에 「전사」가 두 번 줄었다: 메뉴 둘 → 메뉴 하나·탭 둘(PG-49e) → 화면 하나(PG-49f). 탭 둘은 같은 부서를
// 두 모양(본부별 팀 막대 · 섹션 판)으로 두 번 보여 주었고, 일정 카드는 그 전에 이미 양쪽에 하나씩 있었다(「주차 마감」·「단계 일정」).
// 다시 갈라지지 않게 여기서 고정한다. (누가 무엇을 보나 — 게이트와 페이지가 실제로 그리는 것 — 는 DB가 필요해
// integration.test.ts의 PG-T79·T80, rollup-access.test.ts의 PG-T81이 본다)
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stageCells } from '@/server/rollup/schedule';
import { upcomingWeeks } from '@/server/slot-deadline';
import { OrgRunCard } from '@/components/OrgRunCard';
import { RuleEditor } from '@/components/RuleEditor';
import { offsetLabel, WeekSchedule } from '@/components/WeekSchedule';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const root = path.resolve(__dirname, '..');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
  );

describe('WS-19l 「주차 일정」 줄의 단계 기한 (RU-51·58)', () => {
  it('[WS-T76] 부서 마감과 같은 날이면 시각만, 날이 넘어가면 날짜까지', () => {
    const anchor = new Date('2026-10-08T05:00:00Z'); // 목 14:00 KST
    expect(stageCells(anchor, { unitDueMinutes: 60, hqDueMinutes: 120 })).toEqual({
      unitDue: '2026-10-08T15:00:00+09:00',
      unitDueKo: '15:00',
      hqDue: '2026-10-08T16:00:00+09:00',
      hqDueKo: '16:00',
    });
    // 「다음 날 같은 시각」(1440분) — 시각만 적으면 같은 날로 읽힌다
    const late = stageCells(anchor, { unitDueMinutes: 60, hqDueMinutes: 1440 });
    expect(late.unitDueKo).toBe('15:00');
    expect(late.hqDueKo).toBe('10월 9일(금) 14:00');
  });

  it('[WS-T76b] 연휴로 마감이 하루 당겨지면 단계 기한도 하루 — 같은 간격으로 따라간다 (RU-50)', () => {
    const normal = stageCells(new Date('2026-10-08T05:00:00Z'), { unitDueMinutes: 60, hqDueMinutes: 120 });
    const holiday = stageCells(new Date('2026-10-07T05:00:00Z'), { unitDueMinutes: 60, hqDueMinutes: 120 });
    expect(new Date(normal.hqDue).getTime() - new Date(holiday.hqDue).getTime()).toBe(24 * 3600_000);
    expect(holiday.hqDueKo).toBe('16:00');
  });

  it('[WS-T76c] 간격 이름은 짧게 — 「+1시간」 꼴 (2026-10-08: 「부서 마감 1시간 뒤」를 줄였다)', () => {
    expect([30, 60, 90, 120, 1440].map(offsetLabel)).toEqual(['+30분', '+1시간', '+1시간 30분', '+2시간', '다음 날']);
  });
});

describe('PG-49f 「전사」 한 화면 · WS-19l 일정은 머리글 한 곳', () => {
  const all = () => walk('src').map((f) => [f, src(f)] as const);

  it('[PG-T78] ★ 탭 막대와 옛 판이 되살아나지 않는다 — 화면은 orgPageView 하나로 그린다 (TACP-9·12)', () => {
    // 지운 부품: 탭 막대 · 본부별 카드 · 섹션 판 (PG-51 「지운 것」)
    for (const f of ['OrgTabs', 'OrgProgress', 'SectionBoard']) {
      expect(existsSync(path.join(root, `src/components/${f}.tsx`)), f).toBe(false);
    }
    expect(all().filter(([, s]) => /\b(OrgTabs|OrgProgress|SectionBoard|groupByHq|canOpenMonitor|orgTabs)\b/.test(s)).map(([f]) => f)).toEqual([]);

    const org = src('src/app/org/page.tsx');
    expect(org).toContain('const can = await orgPageView(scope);');
    expect(org).toContain('if (!can.open) notFound();');
    // 열·카드·링크는 판정 값으로만 — 페이지가 역할 플래그를 읽어 길을 정하거나 게이트를 복사하지 않는다
    expect(org).toContain('columns={{ progress: can.progress, final: can.desk }}');
    expect(org).not.toMatch(/\{\s*scope\.(readAll|user\.(isOperator|isCoordinator))\s*&&/);
    expect(org).not.toMatch(/\b(canOpenOrgDesk|canRunOrgRollup|canScheduleDeadlines|canOperate)\(/);
    // /hq의 「← 전사」도 취합과 같은 문
    expect(src('src/app/hq/page.tsx')).toContain('{nav.orgDesk && (');
  });

  it('[PG-T78b] ★ 일정은 머리글 한 곳 — 다가올 주차 줄과 [일정 바꾸기]. 누르면 바로 입력칸 (2026-10-08: 두 번 누르기 → 한 번)', () => {
    // 지운 카드·부품이 되살아나지 않는다 — 접는 틀(ScheduleFold)과 그 안의 [마감 바꾸기]도 (2026-10-08)
    for (const f of ['DeadlineScheduler', 'OrgSchedulePanel', 'ScheduleFold']) {
      expect(existsSync(path.join(root, `src/components/${f}.tsx`)), f).toBe(false);
    }
    expect(all().filter(([, s]) => /OrgSchedulePanel|DeadlineScheduler|ScheduleFold/.test(s)).map(([f]) => f)).toEqual([]);
    expect(all().filter(([, s]) => s.includes('data-guide="deadline-edit"')).map(([f]) => f)).toEqual([]);
    // 「주차 일정」 카드 제목·설명 문장은 없다 — 줄과 버튼이 말한다
    expect(all().filter(([f, s]) => f.startsWith('src/components') && /^\s*주차 일정\s*$/m.test(s)).map(([f]) => f)).toEqual([]);

    const org = src('src/app/org/page.tsx');
    expect(org.match(/<WeekSchedule\b/g)).toHaveLength(1);
    // 다가올 주차만 넘긴다 — 지난 마감 줄은 그리지 않는다 (사용자: 「저번 주 몇 시 마감했는지 안 봐도 상관없어」)
    expect(org).toContain('const upcoming = upcomingWeeks(schedule.weeks);');
    expect(org).toMatch(/<WeekSchedule\s+weeks=\{upcoming\}/);
    // 머리글 버튼이 곧 입력칸을 연다 — 같은 부품 안에서 aria-controls ↔ id
    const card = src('src/components/WeekSchedule.tsx');
    expect(card).toContain('aria-controls="schedule"');
    expect(card).toContain('id="schedule"');
    expect(card).toContain('data-guide="schedule-open"');
    // 사용 안내가 가리키는 자리는 그대로 (guide-deck.test가 deck 쪽을 본다)
    for (const a of ['deadline-paste-box', 'deadline-paste', 'deadline-preview', 'deadline-plan', 'deadline-apply']) {
      expect(card, a).toContain(`data-guide="${a}"`);
    }
    // 알림·병합 시각 표는 화면에서 걷었다 — 놓치는 알림은 서버 경고(plan.warnings)가 말한다
    expect(card).not.toContain('plan.schedule');
    // 옛 [현황] 주소는 보내기만 한다 — 화면을 따로 그리지 않는다
    const monitor = src('src/app/ops/monitor/page.tsx');
    expect(monitor).not.toMatch(/<(WeekSchedule|AppHeader|OrgBoard)\b/);
    expect(monitor).toContain('redirect(');
    expect(monitor).toContain('orgPageView(ps.scope)');
  });

  it('[PG-T78f] 머리글 첫 그림 — 주차마다 한 줄, 예외 주차는 문구와 [평소대로], 버튼 하나. 입력칸은 누르기 전에는 없다', () => {
    const week = (isoKey: string, label: string, deadlineKo: string, extra: object = {}) => ({
      isoKey, label, deadlineKo, overridden: false, note: null, passed: false, stages: { unitDueKo: '15:00', hqDueKo: '16:00' }, ...extra,
    });
    const weeks = [
      week('2026-W41', '10월 2주차', '10월 14일(수) 14:00', { overridden: true, note: '연휴 일정으로 이번 주만 수요일 14:00 마감입니다.' }),
      week('2026-W42', '10월 3주차', '10월 22일(목) 14:00'),
    ];
    const html = renderToStaticMarkup(
      createElement(WeekSchedule, { weeks, canSchedule: true, rollup: { enabled: false, unitDueMinutes: 60, hqDueMinutes: 120 } }),
    );
    expect(html).toContain('10월 2주차');
    expect(html).toContain('10월 3주차');
    expect(html).toContain('실·팀 → 본부');
    expect(html).toContain('연휴 일정으로 이번 주만');
    expect(html).toContain('평소대로');
    expect(html).toContain('3단계 꺼짐');
    expect(html.match(/일정 바꾸기/g)).toHaveLength(1);
    // 누르기 전에는 입력칸·제목·설명이 없다
    for (const gone of ['주차 일정', '마감 바꾸기', '공지 붙여넣기', 'id="schedule"', '한꺼번에']) expect(html, gone).not.toContain(gone);
    // 바꿀 것이 없는 사람에게는 버튼도 없다
    expect(renderToStaticMarkup(createElement(WeekSchedule, { weeks, canSchedule: false, rollup: null }))).not.toContain('일정 바꾸기');
  });

  it('[PG-T78g] 다가올 주차 = 그 주 마지막 기한이 안 지난 주차 — 부서 마감 뒤 단계 기한까지는 이번 주 줄이 남는다', () => {
    // 목 14:00 부서 마감 · 실·팀 → 본부 15:00 · 본부 → 총괄 16:00 (KST)
    const thisWeek = {
      isoKey: '2026-W41',
      deadline: '2026-10-08T14:00:00+09:00',
      passed: true,
      stages: { unitDue: '2026-10-08T15:00:00+09:00', hqDue: '2026-10-08T16:00:00+09:00' },
    };
    const next = { isoKey: '2026-W42', deadline: '2026-10-15T14:00:00+09:00', passed: false, stages: null };
    const keys = (at: string, ws: (typeof thisWeek | typeof next)[] = [thisWeek, next]) =>
      upcomingWeeks(ws, new Date(at)).map((w) => w.isoKey);
    // 14:30 — 부서 마감은 지났지만 총괄이 16:00 기한을 보는 때다
    expect(keys('2026-10-08T14:30:00+09:00')).toEqual(['2026-W41', '2026-W42']);
    // 16:00 — 마지막 기한이 지나면 사라진다
    expect(keys('2026-10-08T16:00:00+09:00')).toEqual(['2026-W42']);
    // 3단계를 안 쓰면 부서 마감이 마지막 기한이다
    expect(keys('2026-10-08T14:30:00+09:00', [{ ...thisWeek, stages: null }, next])).toEqual(['2026-W42']);
    // 줄은 남아도 지난 예외는 되돌릴 수 없다 — [평소대로]는 마감 전 주차에만
    expect(src('src/components/WeekSchedule.tsx')).toContain('{canSchedule && w.overridden && !w.passed && clearing !== w.isoKey && (');
  });

  it('[PG-T78c] 바꾸는 칸도 권한대로 — 마감 바꾸기는 schedule, 3단계 부분은 취합과 같은 문(desk). 둘 다 없으면 버튼이 없다', () => {
    const org = src('src/app/org/page.tsx');
    expect(org).toContain('canSchedule={can.schedule}');
    expect(org).toContain('const setting = can.desk ? await loadOrgSetting() : null;');
    expect(org).toContain('const schedule = await deadlineStatus();');
    const card = src('src/components/WeekSchedule.tsx');
    expect(card).toContain('const canChange = canSchedule || !!rollup;');
    expect(card).toMatch(/\{canChange && \(\s*<button[^>]*data-guide="schedule-open"/);
    expect(card).toMatch(/\{canSchedule && \(\s*<>\s*<div className="flex gap-2 text-sm">/);
    expect(card).toContain('{rollup && <RollupStages');
  });

  it('[PG-T78d] RU-60 · WA-30 — 게시판 hwp [올리기]는 hwp 스위치를 따른다. 스위치는 submit-mode 하나에서 읽는다', () => {
    const org = src('src/app/org/page.tsx');
    expect(org).toContain('const uploadOpen = hwpUploadOpen();');
    expect(org).toContain('canUpload={can.desk && uploadOpen}');
    // 열 판정(columns)은 그대로 — 올리기는 따로 받는다
    expect(org).toContain('columns={{ progress: can.progress, final: can.desk }}');
    const board = src('src/components/OrgBoard.tsx');
    expect(board).toContain('{columns.final && canUpload && (');
    expect(board).toMatch(/\{canUpload && f\.source !== 'tincase' && \(\s*<button data-guide="org-upload"/);
  });

  it('[PG-T78e] 「전사」 화면에 각주·설명 문장이 돌아오지 않는다 (2026-10-08 사용자: 주석 걷기)', () => {
    // 표 밑 각주(세지 않는 부서 수·명단 기준·읽기 전용 기록)는 그리지 않는다. 서버 값(board.excludedNote)은 감사 문서와 테스트가 쓴다
    expect(src('src/app/org/page.tsx')).not.toContain('excludedNote');

    // 전사 취합본 카드 — 「섹션별 처리」 접기가 없다. 할 일이 있는 것만: 몇 섹션이 들어갔나 · 미제출 섹션 이름 · 확인할 곳
    const section = (title: string, status: 'copied' | 'missing' | 'failed', extra: object = {}) => ({
      title, status, label: status === 'copied' ? '제출 10-07 22:15 · 담당' : '', fixed: [], warnings: [], dropped: [], ...extra,
    });
    const run = {
      id: 'r1',
      status: 'succeeded',
      finishedAtKst: '10-07 22:15',
      template: '전사 양식 v1',
      sections: [
        section('가섹션', 'copied', { fixed: ['번호 3곳'], dropped: ['제목'] }),
        section('나섹션', 'missing'),
        section('다섹션', 'missing'),
        section('라섹션', 'copied', { warnings: ['빈 표'] }),
      ],
      warnings: [],
      errorText: null,
      stale: false,
    };
    const html = renderToStaticMarkup(createElement(OrgRunCard, { run, isoKey: '2026-W41', ready: 2, coverage: [] }));
    expect(html).toContain('4섹션 중 2개 들어감');
    expect(html).toContain('미제출: 나섹션 · 다섹션');
    expect(html).toContain('한글에서 확인할 곳');
    for (const gone of ['섹션별 처리', '미제출 자리', '뺀 것', '자동 수정', '번호 3곳', '전사 양식 v1']) expect(html, gone).not.toContain(gone);
    // 섹션이 바뀌면 칩과 주 버튼이 말한다 — 설명 상자는 없다
    const stale = renderToStaticMarkup(createElement(OrgRunCard, { run: { ...run, stale: true }, isoKey: '2026-W41', ready: 2, coverage: [] }));
    expect(stale).toContain('섹션이 바뀜');
    expect(stale).not.toContain('만든 뒤 섹션이 바뀌었습니다');

    // 부서 설정 — 사용자가 짚은 두 문장
    const rules = renderToStaticMarkup(
      createElement(RuleEditor, {
        initialCategories: 'AI-홍보',
        initialDedupe: true,
        initialDropNotes: true,
        initialSort: 'input',
        initialUndated: 'last',
        initialRule: '',
        initialGuide: '',
        initialEmptyWords: '없음',
        initialEmphasisWords: '하이라이트',
      }),
    );
    expect(rules).toContain('확인할 낱말');
    for (const gone of ['어떤 설정으로도 바꿀 수 없습니다', '뺄지는 사람이 정합니다', '문서는 그대로 둡니다']) expect(rules, gone).not.toContain(gone);
  });
});
