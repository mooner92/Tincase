// PG-49e · WS-19l — 「전사」는 메뉴 하나·탭 둘, 일정 카드는 하나.
//
// 2026-10-07까지 총괄의 전사 화면은 상단 메뉴 둘(「전사 현황」·「전사 취합」)이었고, 일정 카드도 양쪽에
// 하나씩(「주차 마감」·「단계 일정」) 있었다. 둘 다 그 주 부서 마감 하나에서 출발하는 숫자라, 갈라져 있으면
// 마감을 옮긴 뒤 단계 기한이 따라왔는지 보러 다른 화면에 가야 했다. 다시 둘로 갈라지지 않게 여기서 고정한다.
// (게이트 자체 — 누가 어느 탭을 여나 — 는 DB가 필요해 integration.test.ts의 PG-T79가 본다)
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stageCells } from '@/server/rollup/schedule';

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
});

describe('PG-49e 「전사」 탭 막대 · WS-19l 일정 카드 하나', () => {
  it('[PG-T78] ★ 두 화면 위에 같은 탭 막대 — 탭은 authz의 판정(orgTabs)으로만 그린다 (TACP-9·12)', () => {
    const monitor = src('src/app/ops/monitor/page.tsx');
    const org = src('src/app/org/page.tsx');
    expect(monitor).toContain('<OrgTabs current="monitor" tabs={tabs}');
    expect(org).toContain('<OrgTabs current="org" tabs={tabs}');
    for (const [f, s] of [['monitor', monitor], ['org', org]] as const) {
      expect(s, f).toContain('orgTabs(scope)');
      // 페이지가 역할 플래그를 직접 읽어 길을 정하지 않는다
      expect(s, f).not.toMatch(/\{\s*scope\.user\.(isOperator|isCoordinator)\s*&&/);
    }
    // /hq의 「← 전사 · 취합」도 [취합] 탭의 문과 같은 판정
    expect(src('src/app/hq/page.tsx')).toContain('{nav.orgDesk && (');
  });

  it('[PG-T78b] ★ 일정 카드는 하나 — [현황]의 「주차 일정」. [취합]에는 일정 카드가 없고 그리로 가는 길만 있다', () => {
    // 지운 카드가 되살아나지 않는다
    expect(existsSync(path.join(root, 'src/components/DeadlineScheduler.tsx'))).toBe(false);
    expect(existsSync(path.join(root, 'src/components/OrgSchedulePanel.tsx'))).toBe(false);
    const all = walk('src').map((f) => [f, src(f)] as const);
    expect(all.filter(([, s]) => /OrgSchedulePanel|DeadlineScheduler/.test(s)).map(([f]) => f)).toEqual([]);
    // 「주차 일정」 카드 제목은 한 곳에서만 그린다
    const titled = all.filter(([f, s]) => f.startsWith('src/components') && /^\s*주차 일정\s*$/m.test(s)).map(([f]) => f);
    expect(titled).toEqual(['src/components/WeekSchedule.tsx']);
    const monitor = src('src/app/ops/monitor/page.tsx');
    expect(monitor.match(/<WeekSchedule\b/g)).toHaveLength(1);
    const org = src('src/app/org/page.tsx');
    expect(org).not.toMatch(/<WeekSchedule\b/);
    expect(org, '[취합]에 일정 카드 제목이 다시 생겼다').not.toMatch(/<h2[^>]*>\s*[^<{]*일정/);
    expect(org).toContain('href="/ops/monitor#schedule"');
    expect(src('src/components/WeekSchedule.tsx')).toContain('id="schedule"');
  });

  it('[PG-T78c] 카드 안도 권한대로 — 마감 바꾸기는 canScheduleDeadlines, 3단계 부분은 [취합] 탭과 같은 문', () => {
    const monitor = src('src/app/ops/monitor/page.tsx');
    expect(monitor).toContain('canScheduleDeadlines(scope.user)');
    expect(monitor).toMatch(/const setting = tabs\.org \?/);
    const card = src('src/components/WeekSchedule.tsx');
    expect(card).toContain('{canSchedule && !editing && (');
    expect(card).toContain('{rollup && <RollupStages');
  });
});
