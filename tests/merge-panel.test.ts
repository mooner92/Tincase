// CP-106a · CP-107 — 수합 관리 병합 카드가 **사실대로 말하는가**.
//
// 규칙 저장은 병합을 다시 돌리지 않고(그래서 「규칙 바뀜」), 다시 병합은 사람이 고친 병합본을 지운다
// (그래서 「[다시 병합]을 누르세요」에는 무엇이 사라지는지가 붙는다). 둘 다 화면이 말하지 않으면
// 「설정이 안 먹는다」·「실장 수정이 왜 사라졌나」가 된다.
//
// 화면은 서버 렌더 결과(첫 그림)로 본다 — 이 저장소에는 DOM 시험 도구가 없고, 여기서 보려는 것은
// 누르기 전에 이미 보여야 하는 글이다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rulesChangedSince, ruleSnapshotOf, type SnapshotFields } from '@/server/merge/rule-snapshot';
import { MergePanel } from '@/components/MergePanel';
import { savedNote } from '@/components/RuleEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const base: SnapshotFields = {
  mergeCategories: 'AI-홍보',
  mergeDedupe: true,
  mergeDropNotes: true,
  mergeRuleText: '',
  mergeSort: 'input',
  mergeUndated: 'last',
  emphasisWords: '하이라이트',
};
const snap = (d: SnapshotFields, drop: string[] = []) => {
  const o: Record<string, unknown> = { trigger: 'auto', ...ruleSnapshotOf(d) };
  for (const k of drop) delete o[k];
  return JSON.stringify(o);
};

describe('CP-107 「규칙 바뀜」 — 실행의 스냅샷과 지금 설정', () => {
  it('[CP-T97] 같은 설정이면 없음 · 표기만 다른 분류(「AI, 홍보」)도 같다 (엔진과 같은 해석)', () => {
    expect(rulesChangedSince(snap(base), base)).toEqual([]);
    expect(rulesChangedSince(snap(base), { ...base, mergeCategories: 'AI, 홍보' })).toEqual([]);
  });

  it('[CP-T97] 바뀐 설정을 부서 설정 카드 이름으로', () => {
    expect(rulesChangedSince(snap(base), { ...base, mergeSort: 'date' })).toEqual(['정렬']);
    expect(rulesChangedSince(snap(base), { ...base, mergeCategories: '홍보-AI' })).toEqual(['분류 순서']);
    expect(rulesChangedSince(snap(base), { ...base, mergeDedupe: false })).toEqual(['병합 동작']);
    expect(rulesChangedSince(snap(base), { ...base, mergeRuleText: '도서관은 맨 뒤로' })).toEqual(['병합 지침']);
    expect(rulesChangedSince(snap(base), { ...base, emphasisWords: '하이라이트, 중요' })).toEqual(['공유 표시 낱말']);
  });

  it('[CP-T97] 「날짜 없는 줄」은 일자 순일 때만 문서에 닿는다', () => {
    expect(rulesChangedSince(snap(base), { ...base, mergeUndated: 'first' })).toEqual([]);
    const dated = { ...base, mergeSort: 'date' };
    expect(rulesChangedSince(snap(dated), { ...dated, mergeUndated: 'first' })).toEqual(['정렬']);
  });

  it('[CP-T97] 옛 실행 — sort가 없으면 제출자 순으로 돌았다 · emphasisWords가 없으면 모르므로 말하지 않는다', () => {
    const old = snap(base, ['sort', 'undated', 'emphasisWords']);
    expect(rulesChangedSince(old, base)).toEqual([]);
    expect(rulesChangedSince(old, { ...base, mergeSort: 'date' })).toEqual(['정렬']);
    expect(rulesChangedSince(old, { ...base, emphasisWords: '중요' })).toEqual([]);
  });

  it('[CP-T97] 깨진 스냅샷은 「바뀜」이라고 하지 않는다 — 모르는 것을 바뀌었다고 하면 고친 병합본을 덮게 한다', () => {
    expect(rulesChangedSince('not json', { ...base, mergeSort: 'date' })).toEqual([]);
    expect(rulesChangedSince(null, base)).toEqual([]);
  });
});

describe('CP-106a · CP-107 — 병합 카드의 첫 그림', () => {
  type State = Parameters<typeof MergePanel>[0]['state'];
  const state = (over: Partial<State> = {}): State => ({
    runId: 'r1',
    sha256: 's',
    status: 'succeeded',
    finishedAtKst: '10-08 14:01',
    trigger: 'auto',
    rowCounts: { achievements: 3, plans: 2, notes: 0 },
    warnings: [],
    errorText: null,
    groups: [],
    modelUsed: false,
    modelReason: '끔',
    categoryOrder: [],
    sourceCount: 3,
    missing: ['늦은이'],
    flagged: [],
    review: null,
    hasHead: false,
    edits: null,
    rulesChanged: [],
    ...over,
  });
  const html = (s: State, canRun = true) =>
    renderToStaticMarkup(
      createElement(MergePanel, {
        state: s,
        isoKey: '2026-W41',
        divisionSlug: 'x',
        canRun,
        canDownload: true,
        canEditMerged: canRun,
        submitted: 3,
      }),
    );
  const edits = { places: 3, saves: 1, by: ['머리 실장'], lastAtKst: '10-08 14:12' };

  it('[CP-T98] 고친 병합본이면 「[다시 병합]을 눌러주세요」에 고친 내용이 사라진다는 말이 붙는다', () => {
    expect(html(state())).toContain('[다시 병합]을 눌러주세요');
    expect(html(state())).not.toContain('고친 내용은 사라집니다');
    expect(html(state({ edits }))).toContain('[다시 병합]을 눌러주세요 — 병합본을 고친 내용은 사라집니다');
  });

  it('[CP-T98] 규칙이 바뀌었으면 칩과 바뀐 설정 이름 · 안 바뀌었으면 칩 없음', () => {
    expect(html(state())).not.toContain('규칙 바뀜');
    const out = html(state({ rulesChanged: ['정렬'] }));
    expect(out).toContain('규칙 바뀜');
    expect(out).toContain('정렬 — 이 병합본에는 [다시 병합]해야 적용됩니다');
    expect(out).not.toContain('고친 내용은 사라집니다');
    expect(html(state({ rulesChanged: ['정렬'], edits }))).toContain('[다시 병합]해야 적용됩니다 (병합본을 고친 내용은 사라집니다)');
  });

  it('[CP-T98] 누를 수 없는 사람(총괄 열람)에게는 [다시 병합]을 시키지 않는다 (TACP-9)', () => {
    const out = html(state({ edits, rulesChanged: ['정렬'] }), false);
    expect(out).toContain('규칙 바뀜');
    expect(out).not.toContain('[다시 병합]');
  });
});

describe('CP-108 병합 설정 저장 뒤 한 줄', () => {
  it('[CP-T99] 이번 주 병합본이 있고 문서를 바꾸는 설정을 바꿨을 때만 [다시 병합]을 말한다 · 고친 병합본이면 사라진다고', () => {
    expect(savedNote(false, { edited: true })).toBe('저장되었습니다.'); // 작성 안내만 바꿈
    expect(savedNote(true, null)).toBe('저장되었습니다.'); // 아직 병합 전 — 마감 병합에 들어간다
    expect(savedNote(true, { edited: false })).toBe('저장되었습니다. 이번 주 병합본에는 [다시 병합]해야 적용됩니다.');
    expect(savedNote(true, { edited: true })).toBe(
      '저장되었습니다. 이번 주 병합본에는 [다시 병합]해야 적용됩니다 — 병합본을 고친 내용은 사라집니다.',
    );
  });
});
