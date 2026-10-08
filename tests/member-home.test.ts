// PG-66~69 · PG-72 — 부서원 홈의 첫 그림(서버 렌더). 상태표(PG-67a)의 칸마다 무엇이 있고 무엇이 없는지를 본다.
//
// 클릭·펼침 같은 상호작용은 순수 함수 시험(week-groups · composer · deadline)과 수동 확인으로 나눈다 — 여기는 node 환경이다.
// 데이터(남의 이름이 없는가 — PG-T97)는 DB가 필요해 tests/integration.test.ts가 본다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ThisWeekCard, type ThisWeekCardProps } from '@/components/ThisWeekCard';
import { PastWeeks } from '@/components/PastWeeks';
import { SlotSelector, type SlotOption } from '@/components/SlotSelector';
import { drawerControls } from '@/lib/merged-drawer';
import { groupPast, type PastWeek } from '@/lib/week-groups';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));

const base: ThisWeekCardProps = {
  week: { isoKey: '2026-W41', label: '10월 1주차', month: 10, monthly: false, weekStartMs: Date.UTC(2026, 9, 4, 15) },
  deadline: { text: '10월 15일(목) 14:00', changedNote: null },
  phase: 'open',
  openUntilText: null,
  refresh: { atMs: 0, serverNowMs: 0 },
  mine: null,
  showMissing: true,
  canCompose: true,
  canCancel: false,
  noTemplate: false,
  doc: false,
  divisionSlug: 'Division_A',
  me: { id: 'u1', name: '본인' },
  emptyWordsRaw: '',
  layout: 'paired',
};
const mine = { id: 's1', at: '10-08 10:57', version: 2, edited: false };
const card = (p: Partial<ThisWeekCardProps>) => renderToStaticMarkup(createElement(ThisWeekCard, { ...base, ...p }));
/** 첫 그림에 있는 버튼 글자 — 주 버튼·[병합본]·제출 취소 */
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('[PG-T95] 이번 주 카드 — 상태표 S1~S11 (PG-67a)', () => {
  it('S1 마감 전 · 안 냄 · 명단 안 — 「미제출」 · 마감 한 줄 · [작성하기] 하나', () => {
    const html = card({});
    expect(html).toContain('chip chip-muted">미제출');
    expect(html).toContain('마감 <span class="">10월 15일(목) 14:00</span>');
    expect(buttons(html)).toEqual(['작성하기']);
    expect(html).toMatch(/<button[^>]*data-guide="compose-open"[^>]*class="btn-primary"/);
    // D18 — 카드 제목이 h1(주차)
    expect(html).toMatch(/<h1 id="this-week"[^>]*>10월 1주차<\/h1>/);
  });

  it('S2 명단 밖(부서장·휴직) — 칩이 없다 (D17)', () => {
    const html = card({ showMissing: false });
    expect(html).not.toContain('미제출');
    expect(buttons(html)).toEqual(['작성하기']);
  });

  it('S3·S4 낸 뒤 마감 전 — 「제출 완료」 · 낸 시각 · [열기] · 제출 취소 · 고친 판이면 「고침」(이름 없이)', () => {
    const html = card({ mine, canCancel: true });
    expect(html).toContain('제출 완료');
    expect(html).toContain('10-08 10:57 제출');
    expect(buttons(html)).toEqual(['열기', '제출 취소']);
    expect(html).toMatch(/<button[^>]*data-guide="compose-open"[^>]*class="btn-secondary"/);
    expect(html).not.toContain('고침');
    expect(card({ mine: { ...mine, edited: true }, canCancel: true })).toContain('<span class="text-warning"> · 고침</span>');
  });

  it('S5·S6 마감 후 열림(TACP-18) — 「마감 후 열림 · 15:30까지」 · 낼 수 있고 취소도 된다', () => {
    const open = { phase: 'opened' as const, openUntilText: '15:30' };
    expect(card(open)).toContain('chip chip-warn">마감 후 열림 · 15:30까지');
    expect(buttons(card(open))).toEqual(['작성하기']);
    expect(buttons(card({ ...open, mine, canCancel: true }))).toEqual(['열기', '제출 취소']);
  });

  it('S7 마감 뒤 · 냄 — 「마감됨」 · [열기](읽기) · 병합본이 있으면 [병합본] · 작성하기·제출 취소 DOM 없음 (PG-08)', () => {
    const locked = { phase: 'locked' as const, canCompose: false, canCancel: false };
    const html = card({ ...locked, mine, doc: true });
    expect(html).toContain('마감됨');
    expect(buttons(html)).toEqual(['열기', '병합본']);
    expect(html).not.toContain('작성하기');
    expect(html).not.toContain('제출 취소');
    expect(buttons(card({ ...locked, mine }))).toEqual(['열기']);
  });

  it('S8·S9 마감 뒤 · 안 냄 — 주 버튼 없음 · 명단 안이면 「미제출」 · [병합본]만', () => {
    const locked = { phase: 'locked' as const, canCompose: false };
    const s8 = card({ ...locked, doc: true });
    expect(s8).toContain('미제출');
    expect(buttons(s8)).toEqual(['병합본']);
    const s9 = card({ ...locked, showMissing: false });
    expect(s9).not.toContain('미제출');
    expect(buttons(s9)).toEqual([]);
    expect(s9).not.toContain('data-guide="my-actions"');
  });

  it('S10·S11 양식 없음(PG-09) — 경고 한 줄, 안 냈으면 버튼 없음 · 냈으면 [열기](읽기)와 제출 취소', () => {
    const none = { canCompose: false, noTemplate: true };
    const s10 = card(none);
    expect(s10).toContain('callout callout-warn');
    expect(s10).toContain('등록된 부서 양식이 없습니다');
    expect(buttons(s10)).toEqual([]);
    expect(buttons(card({ ...none, mine, canCancel: true }))).toEqual(['열기', '제출 취소']);
  });

  it('공통 — WS-18 사유 줄 · 월간 칩 · 카운트다운·버전·명단·설명 상자가 없다 (PG-67e · R14)', () => {
    const changed = card({ deadline: { text: '내일 14:00', changedNote: '연휴로 당김' } });
    expect(changed).toContain('<span class="font-semibold text-error">내일 14:00</span>');
    expect(changed).toContain('이번 주만 변경</strong> · 연휴로 당김');
    const monthly = card({ week: { ...base.week, label: '9월 4주차', month: 9, monthly: true } });
    expect(monthly).toMatch(/<h1[^>]*>9월 4주차<span class="chip chip-ok">월간<\/span><\/h1>/);
    expect(monthly).not.toContain('callout-info'); // 월간 안내 상자
    const done = card({ mine, canCancel: true });
    for (const gone of ['남음', '시간 ', 'v2', '부서 제출 현황', '집계 제외', '다음 주차', '양식 받기', '내 파일 받기', '다시 작성']) {
      expect(done, gone).not.toContain(gone);
    }
  });

  it('PG-66b·d 배치 — 지난 주차가 있으면 5칸 sticky, 없으면 7칸', () => {
    expect(card({})).toMatch(/class="card lg:sticky lg:top-\[88px\] lg:col-span-5"/);
    expect(card({ layout: 'alone' })).toMatch(/class="card lg:col-span-7"/);
  });
});

const week = (isoKey: string, label: string, month: number, w: number, extra: Partial<PastWeek> = {}): PastWeek => ({
  isoKey,
  label,
  year: 2026,
  month,
  weekOfMonth: w,
  monthly: false,
  mine: { id: `s-${isoKey}`, edited: false },
  doc: true,
  ...extra,
});
const weeks: PastWeek[] = [
  week('2026-W40', '9월 4주차', 9, 4, { monthly: true }),
  week('2026-W39', '9월 3주차', 9, 3, { mine: { id: 's-w39', edited: true } }),
  week('2026-W38', '9월 2주차', 9, 2, { mine: null }),
  week('2026-W36', '8월 5주차', 8, 5, { doc: false }),
  week('2026-W31', '7월 5주차', 7, 5),
  { ...week('2026-W01', '12월 5주차', 12, 5), year: 2025 },
];
const past = (showMissing = true) =>
  renderToStaticMarkup(
    createElement(PastWeeks, {
      groups: groupPast(weeks, { year: 2026, month: 10 }),
      showMissing,
      divisionSlug: 'Division_A',
      me: { id: 'u1', name: '본인' },
    }),
  );

describe('[PG-T96] 지난 주차 — 첫 그림 (PG-68·69)', () => {
  it('펼친 달은 최근 두 달(<details open>) · 나머지는 접힘 · 해가 바뀌는 자리에 구분선(aria-hidden)과 숨은 해', () => {
    const html = past();
    expect(html.match(/<details class="fold" open="">/g)?.length).toBe(2);
    expect(html.match(/<details class="fold">/g)?.length).toBe(2); // 7월 · 2025년 12월
    expect(html).toMatch(/<li aria-hidden="true"[^>]*>.*?2025.*?<\/li>/);
    expect(html).toContain('<span class="sr-only">2025년 </span>12월');
    expect(html).toContain('<h2 id="past-weeks-title" class="card-title');
  });

  it('줄의 버튼은 있는 것만 · 이름에 주차가 들어간다 · 「고침」은 이름 없이 · 줄에 시각·버전이 없다', () => {
    const html = past();
    expect(html).toContain('aria-label="9월 3주차 내 일지 열기"');
    expect(html).toContain('aria-label="9월 3주차 병합본 열기"');
    expect(html).not.toContain('aria-label="9월 2주차 내 일지 열기"'); // 안 낸 주
    expect(html).not.toContain('aria-label="8월 5주차 병합본 열기"'); // 병합본 없는 주
    expect(html).toContain('<span class="text-warning">· 고침</span>');
    expect(html).not.toMatch(/\d{2}:\d{2}|v\d/);
    // CP-104 — 사용 안내의 앵커는 하나씩
    expect(html.match(/data-guide="past-open"/g)?.length).toBe(1);
    expect(html.match(/data-guide="past-weeks"/g)?.length).toBe(1);
  });

  it('점·수·「미제출」 — 명단 안이면 있고(오래된 것부터), 명단 밖이면 하나도 없다 (69e · D17)', () => {
    const on = past(true);
    expect(on).toContain('aria-label="3주 중 2주 제출"'); // 9월 — 2주차만 안 냈다
    // 오래된 것부터: 2주차(○) · 3주차(●) · 4주차 월간(●) — 월간은 마지막 점
    expect(on).toContain(
      '<span class="dot dot-hollow text-border-strong"></span><span class="dot text-success"></span><span class="dot text-success"></span>',
    );
    expect(on).toContain('미제출');
    expect(on).toMatch(/>2\/3</);
    const off = past(false);
    expect(off).not.toContain('role="img"');
    expect(off).not.toContain('미제출');
    expect(off).not.toMatch(/>\d+\/\d+</);
  });
});

describe('[CP-T100] 병합본 드로어의 view 변형 — 고치기·승인 띠·복사·받기 없음 (CP-114)', () => {
  it('view는 canEdit·canApprove가 와도 아무것도 그리지 않는다 · edit은 예전 그대로', () => {
    const review = { changedAfter: true };
    expect(drawerControls('view', true, { review, canApprove: true })).toEqual({
      edit: false,
      reviewBand: false,
      approve: false,
      headActions: false,
    });
    expect(drawerControls('edit', true, { review, canApprove: true })).toEqual({
      edit: true,
      reviewBand: true,
      approve: true,
      headActions: true,
    });
    expect(drawerControls('edit', false, { review: null, canApprove: false })).toMatchObject({ edit: false, reviewBand: false, approve: false });
    expect(drawerControls('edit', true, { review: { changedAfter: false }, canApprove: true }).approve).toBe(false);
  });

  it('홈의 [병합본]은 모두 view로 연다 — 카드와 지난 주차 둘 다', () => {
    for (const f of ['ThisWeekCard', 'PastWeeks']) {
      const src = readFileSync(path.resolve(__dirname, `../src/components/${f}.tsx`), 'utf8');
      const drawer = src.slice(src.indexOf('<MergedDrawer'));
      expect(drawer, f).toContain('variant="view"');
      expect(drawer, f).toContain('canEdit={false}');
    }
  });
});

describe('[PG-T99] 수합 관리 주차 고르기 — 첫 그림 (CP-115)', () => {
  const slots: SlotOption[] = [
    { isoKey: '2026-W41', label: '10월 1주차', year: 2026, submitted: 7, isCurrent: true },
    { isoKey: '2026-W40', label: '9월 4주차', year: 2026, submitted: 10, isCurrent: false, monthly: true },
    { isoKey: '2026-W39', label: '9월 3주차', year: 2026, submitted: 9, isCurrent: false },
    { isoKey: '2025-W52', label: '12월 4주차', year: 2025, submitted: 11, isCurrent: false },
  ];
  const sel = (selected: string) =>
    renderToStaticMarkup(createElement(SlotSelector, { slots, selected, roster: 11, baseHref: '/psd/manage' }));

  it('달마다 optgroup · 줄은 「9월 4주차 · 월간 (10/11)」 · 이번 주 표시', () => {
    const html = sel('2026-W40');
    expect([...html.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1])).toEqual(['2026년 10월', '2026년 9월', '2025년 12월']);
    expect(html).toContain('<option value="2026-W40" selected="">9월 4주차 · 월간 (10/11)</option>');
    expect(html).toContain(' · 이번 주');
  });

  it('‹ ›는 이웃 주로 — 이번 주는 /manage, 다른 주는 /manage/{isoKey} · 양 끝에서는 그리지 않는다', () => {
    const mid = sel('2026-W40');
    expect(mid).toContain('href="/psd/manage/2026-W39" aria-label="이전 주차 9월 3주차"');
    expect(mid).toContain('href="/psd/manage" aria-label="다음 주차 10월 1주차"');
    expect(sel('2026-W41')).not.toContain('다음 주차');
    expect(sel('2025-W52')).not.toContain('이전 주차');
  });
});
