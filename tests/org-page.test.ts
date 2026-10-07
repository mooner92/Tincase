// PG-49f · PG-51 · WS-19l — 「전사」는 한 화면, 일정 카드는 하나.
//
// 2026-10-07 하루에 「전사」가 두 번 줄었다: 메뉴 둘 → 메뉴 하나·탭 둘(PG-49e) → 화면 하나(PG-49f). 탭 둘은 같은 부서를
// 두 모양(본부별 팀 막대 · 섹션 판)으로 두 번 보여 주었고, 일정 카드는 그 전에 이미 양쪽에 하나씩 있었다(「주차 마감」·「단계 일정」).
// 다시 갈라지지 않게 여기서 고정한다. (누가 무엇을 보나 — 게이트와 페이지가 실제로 그리는 것 — 는 DB가 필요해
// integration.test.ts의 PG-T79·T80, rollup-access.test.ts의 PG-T81이 본다)
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

describe('PG-49f 「전사」 한 화면 · WS-19l 일정 카드 하나', () => {
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

  it('[PG-T78b] ★ 일정 카드는 하나 — 「전사」 머리글의 [일정 바꾸기] 아래. 옛 주소에는 아무것도 그리지 않는다', () => {
    // 지운 카드가 되살아나지 않는다
    expect(existsSync(path.join(root, 'src/components/DeadlineScheduler.tsx'))).toBe(false);
    expect(existsSync(path.join(root, 'src/components/OrgSchedulePanel.tsx'))).toBe(false);
    expect(all().filter(([, s]) => /OrgSchedulePanel|DeadlineScheduler/.test(s)).map(([f]) => f)).toEqual([]);
    // 「주차 일정」 카드 제목은 한 곳에서만 그린다
    const titled = all().filter(([f, s]) => f.startsWith('src/components') && /^\s*주차 일정\s*$/m.test(s)).map(([f]) => f);
    expect(titled).toEqual(['src/components/WeekSchedule.tsx']);
    const org = src('src/app/org/page.tsx');
    expect(org.match(/<WeekSchedule\b/g)).toHaveLength(1);
    // 접어 둔다 — 매주 보는 것은 마감 줄이고 카드는 연휴 때나 연다
    expect(org).toMatch(/<ScheduleFold summary=\{summary\}>\s*<WeekSchedule\b/);
    expect(src('src/components/ScheduleFold.tsx')).toContain('aria-controls="schedule"');
    expect(src('src/components/WeekSchedule.tsx')).toContain('id="schedule"');
    // 옛 [현황] 주소는 보내기만 한다 — 화면을 따로 그리지 않는다
    const monitor = src('src/app/ops/monitor/page.tsx');
    expect(monitor).not.toMatch(/<(WeekSchedule|AppHeader|OrgBoard)\b/);
    expect(monitor).toContain('redirect(');
    expect(monitor).toContain('orgPageView(ps.scope)');
  });

  it('[PG-T78c] 카드 안도 권한대로 — 마감 바꾸기는 schedule, 3단계 부분은 취합과 같은 문(desk). 둘 다 없으면 카드가 없다', () => {
    const org = src('src/app/org/page.tsx');
    expect(org).toContain('canSchedule={can.schedule}');
    expect(org).toContain('const setting = can.desk ? await loadOrgSetting() : null;');
    expect(org).toContain('const schedule = can.schedule || setting ? await deadlineStatus() : null;');
    const card = src('src/components/WeekSchedule.tsx');
    expect(card).toContain('{canSchedule && !editing && (');
    expect(card).toContain('{rollup && <RollupStages');
  });
});
