// CP-106a · CP-117 — 수합 관리 병합 카드가 **사실대로, 할 일만** 말하는가.
//
// 다시 병합은 사람이 고친 병합본을 지운다 — 무엇이 사라지는지는 [다시 병합]을 누른 자리의 확인(CP-106)이 말하고,
// 카드에는 시키는 문장을 늘어놓지 않는다. 2026-10-08 기능 정리(PG-73)로 「규칙 바뀜」 칩(R4)·「빠진 사람」 줄(R7)·
// 합쳐진 행 목록(S8)을 걷고, 병합본 받기는 카드 하나 + 그 옆 [제목 복사](S5)가 되었다.
//
// 화면은 서버 렌더 결과(첫 그림)로 본다 — 이 저장소에는 DOM 시험 도구가 없고, 여기서 보려는 것은
// 누르기 전에 이미 보여야 하는 글이다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MergePanel } from '@/components/MergePanel';
import { RuleEditor, savedNote } from '@/components/RuleEditor';
import { differingGroups } from '@/lib/merge-rows';
import { ruleSnapshotOf } from '@/server/merge/rule-snapshot';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

describe('CP-106a · CP-117 — 병합 카드의 첫 그림', () => {
  type State = Parameters<typeof MergePanel>[0]['state'];
  const state = (over: Partial<State> = {}): State => ({
    runId: 'r1',
    sha256: 's',
    status: 'succeeded',
    finishedAtKst: '10-08 14:01',
    rowCounts: { achievements: 3, plans: 2, notes: 0 },
    warnings: [],
    errorText: null,
    differing: 0,
    modelUsed: false,
    modelReason: '끔',
    sourceCount: 3,
    flagged: [],
    review: null,
    hasHead: false,
    edits: null,
    ...over,
  });
  const html = (s: State, canRun = true, canDownload = true) =>
    renderToStaticMarkup(
      createElement(MergePanel, {
        state: s,
        isoKey: '2026-W41',
        divisionSlug: 'x',
        title: '10월1주차 연구운영회의 주간업무(가부서)',
        canRun,
        canDownload,
        canEditMerged: canRun,
        submitted: 3,
      }),
    );
  const edits = { places: 3, saves: 1, by: ['머리 실장'], lastAtKst: '10-08 14:12' };

  it('[CP-T98] 고친 병합본이어도 [다시 병합]을 시키는 지시문이 없다 — 확인은 누른 자리에서 (CP-106)', () => {
    for (const s of [state(), state({ edits })]) {
      expect(html(s)).not.toContain('[다시 병합]을 눌러주세요');
      expect(html(s)).not.toContain('고친 내용은 사라집니다');
    }
  });

  it('[CP-T101] 받기는 카드 하나, [제목 복사]가 그 옆 — 내용 보기와 같은 사람(canDownload)에게만 (S5)', () => {
    const out = html(state());
    const at = (t: string) => out.indexOf(t);
    expect(at('받기')).toBeGreaterThan(-1);
    expect(at('제목 복사')).toBeGreaterThan(at('받기'));
    expect(out).toContain('href="/api/division/merged?division=x&amp;isoKey=2026-W41"');
    const viewer = html(state(), false, false);
    expect(viewer).not.toContain('제목 복사');
    expect(viewer).not.toContain('>받기<');
    // 병합 전에는 받을 것도 복사할 제목도 없다
    expect(html(state({ status: 'none', rowCounts: null }))).not.toContain('제목 복사');
  });

  it('[CP-T101] 합쳐진 행은 「내용 다른 묶음 n건」 한 줄 — 같은 글자 묶음뿐이면 아무것도 없다 (S8)', () => {
    expect(html(state({ differing: 2 }))).toContain('내용 다른 묶음 2건');
    const none = html(state({ differing: 0 }));
    expect(none).not.toContain('내용 다른 묶음');
    for (const gone of ['합쳐진 행', '문서에 들어감', '안 씀', '빠짐']) expect(none, gone).not.toContain(gone);
  });

  it('[CP-T101] 진단 줄이 없다 — 「규칙 바뀜」(R4) · 「빠진 사람」(R7)', () => {
    const out = html(state({ edits, differing: 1 }));
    for (const gone of ['규칙 바뀜', '빠진 사람', '기준']) expect(out, gone).not.toContain(gone);
  });

  it('[CP-T101] 「내용 다른 묶음」은 글자까지 같은 묶음을 세지 않는다 · 옛 실행(identical 없음)은 원문으로 되짚는다', () => {
    const src = (...c: string[]) => c.map((content) => ({ content }));
    expect(
      differingGroups([
        { identical: true, sources: src('보도자료 배포', '보도자료 배포') },
        { identical: false, sources: src('포럼 개최', '포럼 개최(2건)') },
        { sources: src('회의 참석', ' 회의 참석 ') }, // 옛 실행 — 앞뒤 공백만 다르면 같다
        { sources: src('발간(8건)', '발간(10건)') }, // 옛 실행 — 다르다
      ]),
    ).toBe(2);
    expect(differingGroups([])).toBe(0);
  });
});

describe('CP-118 · CP-108 부서 설정의 분류 순서', () => {
  it('[CP-T99] 이번 주 병합본이 있고 분류를 바꿨을 때만 [다시 병합]을 말한다 · 고친 병합본이면 사라진다고', () => {
    expect(savedNote(false, { edited: true })).toBe('저장되었습니다.'); // 적는 꼴만 바꿈(「AI, 홍보」→「AI-홍보」)
    expect(savedNote(true, null)).toBe('저장되었습니다.'); // 아직 병합 전 — 마감 병합에 들어간다
    expect(savedNote(true, { edited: false })).toBe('저장되었습니다. 이번 주 병합본에는 [다시 병합]해야 적용됩니다.');
    expect(savedNote(true, { edited: true })).toBe(
      '저장되었습니다. 이번 주 병합본에는 [다시 병합]해야 적용됩니다 — 병합본을 고친 내용은 사라집니다.',
    );
  });

  it('[CP-T103] 첫 그림은 분류 순서 칸 · 칩 · [저장]뿐 — 나머지 설정은 고정값이다 (R3 · R5 · S7)', () => {
    const out = renderToStaticMarkup(createElement(RuleEditor, { initialCategories: 'AI-홍보', thisWeekMerged: null }));
    expect(out).toContain('aria-label="분류 순서"');
    expect(out).toContain('data-guide="merge-settings"');
    expect(out).toContain('data-guide="merge-categories"');
    for (const chip of ['AI', '홍보', '기타']) expect(out).toContain(`>${chip}</span>`);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>저장<\/button>/); // 바꾼 것이 없으면 꺼져 있다
    for (const gone of ['작성 안내', '정렬', '일자 순', '날짜 없는 줄', '병합 동작', '중복 묶기', '3번 표', '고급 설정', '확인할 낱말', '공유 표시 낱말', '병합 지침']) {
      expect(out, gone).not.toContain(gone);
    }
  });

  it('[HM-T147b] DM-13 스냅샷은 분류 순서뿐 — 고정값은 담지 않는다 (HM-51)', () => {
    expect(ruleSnapshotOf({ mergeCategories: 'AI-홍보' })).toEqual({ categories: 'AI-홍보' });
  });
});
