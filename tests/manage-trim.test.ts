// PG-72·73 — 수합 관리 정리 (2026-10-08 기능 정리 · ADR-0018). 받기는 하나씩, 주차 고르기는 달마다.
//
// 드로어 둘은 열 때 불러오는 클라이언트 부품이라 첫 그림에 내용이 없다 — 지운 것이 다시 생기지 않는지는 소스로 본다
// (AU-T39·CP-T96과 같은 방식). 주차 고르기는 서버 렌더 결과로 본다 — 이 저장소에는 DOM 시험 도구가 없다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SlotSelector, type SlotOption } from '@/components/SlotSelector';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));

const root = path.resolve(__dirname, '..');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
/** 주석을 뺀 코드 — 「왜 지웠나」를 적은 주석이 단언에 걸리지 않게 */
const code = (f: string) =>
  src(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('[CP-T102] 받기는 하나씩 — 지운 것이 다시 생기지 않는다 (PG-73 · CP-116)', () => {
  it('전체 zip(R1)과 판 목록(R9) 라우트가 없다', () => {
    expect(existsSync(path.join(root, 'src/app/api/division/download-zip/route.ts'))).toBe(false);
    expect(existsSync(path.join(root, 'src/app/api/submissions/[id]/versions/route.ts'))).toBe(false);
  });

  it('부서원 표에 줄마다 받기 링크가 없다 (R8) — 받기는 드로어의 [원본 다운로드] 하나', () => {
    const table = code('src/components/SubmissionTableClient.tsx');
    expect(table).not.toContain('/download');
    expect(table).not.toContain('footnote');
    expect(code('src/components/FileDrawer.tsx')).toContain('/download');
  });

  it('제출물 드로어가 판 목록을 부르지 않는다 — 버전 고르기가 없다 (R9)', () => {
    const drawer = code('src/components/FileDrawer.tsx');
    expect(drawer).not.toContain('/versions');
    expect(drawer).not.toContain('버전 선택');
  });

  it('병합본 드로어에 [hwp로 받기]·[제목 복사]·[작성자 보기]가 없고, 작성자 열은 서버가 보냈는지로만 정한다 (S5 · S9)', () => {
    const drawer = code('src/components/MergedDrawer.tsx');
    for (const gone of ['hwp로 받기', '제목 복사', '작성자 보기', '작성자 숨기기', 'setShowAuthors', '/api/division/merged?']) {
      expect(drawer, gone).not.toContain(gone);
    }
    expect(drawer).toMatch(/const showAuthors = data\?\.canSeeAuthors === true;/);
  });

  it('[CP-T111] 작성자 칸이 줄을 바꾼다 — 여러 사람이 낸 줄이 내용 칸을 짜부라뜨리지 않는다 (2026-10-09 v2 전환 점검)', () => {
    const drawer = code('src/components/MergedDrawer.tsx');
    const cell = drawer.match(/\{showAuthors && \(\s*<td className="([^"]+)"/);
    expect(cell, '작성자 칸(td)을 찾지 못함').not.toBeNull();
    expect(cell![1]).not.toContain('whitespace-nowrap');
    expect(cell![1]).toContain('break-keep');
  });

  it('수합 관리 화면이 「규칙 바뀜」을 계산하지 않는다 (R4)', () => {
    expect(code('src/app/[division]/manage/ManageView.tsx')).not.toContain('rulesChanged');
    expect(code('src/components/MergePanel.tsx')).not.toContain('규칙 바뀜');
  });
});

describe('[PG-T99] 수합 관리 주차 고르기 — 첫 그림 (CP-115)', () => {
  const slots: SlotOption[] = [
    { isoKey: '2026-W41', label: '10월 1주차', year: 2026, month: 10, submitted: 7, isCurrent: true },
    { isoKey: '2026-W40', label: '9월 4주차', year: 2026, month: 9, submitted: 10, isCurrent: false, monthly: true },
    { isoKey: '2026-W39', label: '9월 3주차', year: 2026, month: 9, submitted: 9, isCurrent: false },
    // 해가 바뀌는 자리 — `2026-W01`은 월요일이 12월이라 2025년 12월 묶음이다(WS-04). 달은 라벨이 아니라 슬롯의 값이다
    { isoKey: '2026-W01', label: '12월 5주차', year: 2025, month: 12, submitted: 11, isCurrent: false, monthly: true },
  ];
  const sel = (selected: string) =>
    renderToStaticMarkup(createElement(SlotSelector, { slots, selected, roster: 11, baseHref: '/psd/manage' }));

  it('달마다 optgroup · 줄은 「9월 4주차 · 월간 (10/11)」 · 이번 주 표시', () => {
    const html = sel('2026-W40');
    expect([...html.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1])).toEqual(['2026년 10월', '2026년 9월', '2025년 12월']);
    expect(html).toContain('<option value="2026-W40" selected="">9월 4주차 · 월간 (10/11)</option>');
    expect(html).toContain('10월 1주차 (7/11) · 이번 주');
  });

  it('‹ ›는 이웃 주로 — 이번 주는 /manage, 다른 주는 /manage/{isoKey} · 양 끝에서는 그리지 않는다', () => {
    const mid = sel('2026-W40');
    expect(mid).toContain('href="/psd/manage/2026-W39" aria-label="이전 주차 9월 3주차"');
    expect(mid).toContain('href="/psd/manage" aria-label="다음 주차 10월 1주차"');
    expect(sel('2026-W41')).not.toContain('다음 주차');
    expect(sel('2026-W01')).not.toContain('이전 주차');
  });
});
