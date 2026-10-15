// CP-131~136 · WA-40 · LE-40~45 — 늦게 낸 사람 화면의 첫 그림(서버 렌더).
//
// 이 저장소에는 DOM 시험 도구가 없다 — 누르기·저장은 tests/late-entry.test.ts(API·서버)와 브라우저 실사용 확인이 보고,
// 여기서는 「누르기 전에 이미 보여야 하는 것」을 본다: 어느 행에 [대신 쓰기]가 붙는가 · 서랍의 머리와 빈 표 · 병합 카드의 안내가
// 누구에게, 언제 뜨는가 · 본인 화면의 「대신 입력」 표시.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SubmissionTableClient, type MemberRow } from '@/components/SubmissionTableClient';
import { ProxyEntryDrawer } from '@/components/ProxyEntryDrawer';
import { SubmissionEditor } from '@/components/SubmissionEditor';
import { MergePanel } from '@/components/MergePanel';
import { ThisWeekCard, type ThisWeekCardProps } from '@/components/ThisWeekCard';
import { PastWeeks } from '@/components/PastWeeks';
import { editedLabel } from '@/components/FileDrawer';
import { groupPast, type PastWeek } from '@/lib/week-groups';
import { appendedNote, nameList } from '@/lib/late';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));

const SRC = path.resolve(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

// ── 수합 관리의 부서원 표 ─────────────────────────────────────────────────────────
const row = (id: string, name: string, over: Partial<MemberRow> = {}): MemberRow => ({
  user: { id, name },
  status: 'missing',
  latest: null,
  versionCount: 0,
  ...over,
});
const sent = (id: string, name: string, over: Partial<MemberRow> = {}): MemberRow =>
  row(id, name, { status: 'submitted', latest: { id: `s-${id}`, version: 1, uploadedAtKst: '10-15 11:05' }, versionCount: 1, ...over });
const WEEK = { isoKey: '2026-W42', label: '10월 2주차', merged: false, appendable: false };
const table = (members: MemberRow[], proxyWeek: typeof WEEK | null = WEEK) =>
  renderToStaticMarkup(
    createElement(SubmissionTableClient, { members, caption: '부서원 제출 현황', title: '부서원 3명', proxyWeek: proxyWeek ?? undefined }),
  );

describe('[CP-T120] 부서원 표 — [대신 쓰기]는 서버가 정한 미제출 행에만 (CP-131 · TACP-9)', () => {
  const members = [row('a', '가온', { canProxy: true }), sent('b', '나래', { canProxy: false }), row('c', '다솜', { canProxy: false })];

  it('canProxy인 미제출 행에만 붙는다 — 낸 사람·canProxy가 아닌 행(본인·남의 부서)에는 없다', () => {
    const html = table(members);
    expect(html).toContain('aria-label="가온 대신 쓰기"');
    expect(html).not.toContain('aria-label="나래 대신 쓰기"');
    expect(html).not.toContain('aria-label="다솜 대신 쓰기"');
    // 낸 사람에게는 [열기]가 그대로
    expect(html).toContain('aria-label="나래 제출물 열기"');
  });

  it('canProxy가 거짓이면 — 서버가 허락하지 않은 화면에는 단추도 열 머리 글자도 없다 (화면이 다시 따지지 않는다)', () => {
    const html = table([row('a', '가온'), row('b', '나래', { canProxy: false })]);
    expect(html).not.toContain('대신 쓰기');
  });

  it('proxyWeek가 없으면 canProxy여도 그리지 않는다 — 서랍을 열 주차가 없다', () => {
    expect(table(members, null)).not.toContain('대신 쓰기');
  });

  it('열 머리는 「열람 · 대신 쓰기」 — 낸 사람만 있는 표에는 「열람」뿐', () => {
    expect(table(members)).toMatch(/<th[^>]*>열람 · 대신 쓰기<\/th>/);
    expect(table([sent('b', '나래')])).toMatch(/<th[^>]*>열람<\/th>/);
  });

  it('[LE-44] 대신 입력한 판은 「제출 · 대신 입력」, 직접 낸 판은 「제출」만', () => {
    const html = table([sent('b', '나래', { proxied: true }), sent('c', '다솜')]);
    expect(html.match(/· 대신 입력/g)?.length).toBe(2); // 표 + 좁은 화면 줄 목록
    expect(html).toContain('다솜');
    expect(table([sent('c', '다솜')])).not.toContain('대신 입력');
  });

  it('서랍은 눌러 열기 전에는 그려지지 않는다 · 사용자에게 보이는 글에 스펙 ID가 없다', () => {
    const html = table(members);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toMatch(/\b(LE|CP|WA|TACP)-\d/);
  });
});

// ── 대신 쓰기 서랍 ────────────────────────────────────────────────────────────────
describe('[WA-T70] 대신 쓰기 서랍 — 머리·안내·빈 표 (CP-132 · WA-40)', () => {
  const open = (name = '바다') =>
    renderToStaticMarkup(
      createElement(ProxyEntryDrawer, {
        target: { userId: 'u9', name },
        isoKey: '2026-W42',
        weekLabel: '10월 2주차',
        onClose: () => {},
        onSaved: () => {},
      }),
    );

  it('대상이 없으면 아무것도 그리지 않는다', () => {
    expect(
      renderToStaticMarkup(createElement(ProxyEntryDrawer, { target: null, isoKey: 'x', weekLabel: 'x', onClose: () => {}, onSaved: () => {} })),
    ).toBe('');
  });

  it('머리 「○○님 대신 입력 · 주차」 · 대화상자 이름 · 본인 화면 안내', () => {
    const html = open();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="바다님 대신 입력"');
    expect(html).toContain('바다님 대신 입력');
    expect(html).toContain('10월 2주차');
    expect(html).toContain('「담당자 대신 입력」');
    expect(html).not.toMatch(/\b(LE|CP|WA|TACP)-\d/);
  });

  it('표는 비어 있고 단추는 [대신 입력 저장] — [고쳐서 저장]이 아니다 (CP-133)', () => {
    const html = open();
    expect(html).toContain('대신 입력 저장');
    expect(html).not.toContain('고쳐서 저장');
    // 세 표 모두 한 줄씩의 빈 칸 — 채워진 값이 없다
    expect(html).toContain('1. 주요 업무실적');
    expect(html).toContain('2. 주요 업무계획');
    expect(html).toContain('3. 기타 특이사항');
    expect(html.match(/<textarea/g)?.length).toBeGreaterThanOrEqual(12);
    expect(html).not.toMatch(/<textarea[^>]*>[^<]+<\/textarea>/);
  });

  it('SubmissionEditor — proxy 없이 쓰면 [고쳐서 저장 (v+1)] (고치기와 같은 부품이 갈라지지 않는다)', () => {
    const base = { initial: { achievements: [], plans: [], notes: [] }, onSaved: () => {}, onCancel: () => {} };
    const edit = renderToStaticMarkup(createElement(SubmissionEditor, { ...base, submissionId: 's1', version: 2 }));
    expect(edit).toContain('고쳐서 저장 (v3)');
    expect(edit).not.toContain('대신 입력 저장');
  });

  it('저장 주소·본문은 소스가 못박는다 — POST /api/submissions/proxy · userId·isoKey', () => {
    const src = read('components/SubmissionEditor.tsx');
    expect(src).toContain("'/api/submissions/proxy'");
    expect(src).toMatch(/JSON\.stringify\(\{ \.\.\.data, userId: proxy\.userId, isoKey: proxy\.isoKey \}\)/);
  });
});

// ── 병합 카드 ────────────────────────────────────────────────────────────────────
describe('[CP-T121] 병합 카드 — 병합 뒤에 낸 사람 안내 (CP-134·135)', () => {
  type State = Parameters<typeof MergePanel>[0]['state'];
  const state = (over: Partial<State> = {}): State => ({
    runId: 'r1',
    sha256: 's',
    status: 'succeeded',
    finishedAtKst: '10-15 11:05',
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
  const html = (extra: Record<string, unknown>, s: State = state()) =>
    renderToStaticMarkup(
      createElement(MergePanel, {
        state: s,
        isoKey: '2026-W42',
        divisionSlug: 'x',
        title: '10월2주차 연구운영회의 주간업무(가부서)',
        canRun: true,
        canDownload: true,
        canEditMerged: true,
        submitted: 3,
        ...extra,
      } as never),
    );

  it('늦게 낸 사람이 있고 canAppend면 — 「병합 뒤에 낸 n명 · 이름」과 [맨 뒤에 붙이기]', () => {
    const out = html({ canAppend: true, late: ['라온', '바다'] });
    expect(out).toContain('data-guide="merge-late"');
    expect(out).toContain('병합 뒤에 낸 2명');
    expect(out).toContain('라온, 바다');
    expect(out).toMatch(/<button[^>]*>맨 뒤에 붙이기<\/button>/);
    expect(out).toContain('병합본 맨 뒤에 붙입니다');
    expect(out).not.toMatch(/\b(LE|CP|WA|TACP)-\d/);
  });

  it('canAppend가 거짓이면 이름이 와도 그리지 않는다 — 작성자 이름은 담당에게만 (TACP-17)', () => {
    const out = html({ canAppend: false, late: ['라온'], revised: ['마루'] });
    expect(out).not.toContain('merge-late');
    expect(out).not.toContain('merge-revised');
    expect(out).not.toContain('라온');
    expect(out).not.toContain('마루');
    expect(out).not.toContain('맨 뒤에 붙이기');
  });

  it('늦게 낸 사람이 없으면 카드는 아무것도 더하지 않는다 (기본값)', () => {
    const out = html({ canAppend: true });
    expect(out).not.toContain('merge-late');
    expect(out).not.toContain('merge-revised');
    expect(out).not.toContain('맨 뒤에 붙이기');
  });

  it('고쳐 낸 사람만 있으면 말만 한다 — 「다시 병합해야 해요」, [맨 뒤에 붙이기]는 없다 (LE-31)', () => {
    const out = html({ canAppend: true, revised: ['마루'] });
    expect(out).toContain('data-guide="merge-revised"');
    expect(out).toContain('고쳐 낸 1명은 다시 병합해야 해요');
    expect(out).toContain('마루');
    expect(out).not.toContain('merge-late');
    expect(out).not.toContain('맨 뒤에 붙이기');
  });

  it('둘 다 있으면 둘 다 — 붙일 수 있는 사람과 다시 병합해야 하는 사람이 갈린다', () => {
    const out = html({ canAppend: true, late: ['바다'], revised: ['마루'] });
    expect(out).toContain('병합 뒤에 낸 1명');
    expect(out).toContain('고쳐 낸 1명은 다시 병합해야 해요');
  });

  it('병합본이 없는(성공하지 않은) 주차에는 뜨지 않는다 — 붙일 병합본이 없다', () => {
    const out = html({ canAppend: true, late: ['라온'], revised: ['마루'] }, state({ status: 'failed', errorText: 'x' }));
    expect(out).not.toContain('merge-late');
    expect(out).not.toContain('merge-revised');
  });
});

// ── 본인 화면의 「대신 입력」 ───────────────────────────────────────────────────────
describe('[CP-T122] 본인 화면 — 담당자가 대신 입력한 판 (LE-44)', () => {
  const base: ThisWeekCardProps = {
    week: { isoKey: '2026-W42', label: '10월 2주차', month: 10, monthly: false, weekStartMs: Date.UTC(2026, 9, 11, 15) },
    deadline: { text: '10월 15일(목) 14:00', changedNote: null },
    phase: 'locked',
    openUntilText: null,
    refresh: null,
    mine: null,
    showMissing: true,
    canCompose: false,
    canCancel: false,
    noTemplate: false,
    doc: false,
    divisionSlug: 'Division_A',
    me: { id: 'u1', name: '본인' },
    emptyWordsRaw: '',
    layout: 'paired',
  };
  const mine = { id: 's1', at: '10-15 11:05', version: 1, edited: false, proxied: false };
  const card = (m: typeof mine) => renderToStaticMarkup(createElement(ThisWeekCard, { ...base, mine: m }));

  it('이번 주 카드 — 대신 입력한 판은 「· 대신 입력」, 고친 판은 「· 고침」, 직접 낸 판은 둘 다 없다', () => {
    expect(card({ ...mine, proxied: true })).toContain('<span class="text-warning"> · 대신 입력</span>');
    expect(card({ ...mine, edited: true })).toContain('<span class="text-warning"> · 고침</span>');
    const plain = card(mine);
    expect(plain).not.toContain('대신 입력');
    expect(plain).not.toContain('고침');
  });

  it('대신 입력이 먼저다 — 대신 입력한 판을 담당자가 다시 손봐 edited여도 「고침」으로 덮지 않는다', () => {
    const html = card({ ...mine, proxied: true, edited: true });
    expect(html).toContain('· 대신 입력');
    expect(html).not.toContain('· 고침');
  });

  it('지난 주차 줄 — 같은 규칙', () => {
    const week = (proxied: boolean, edited = false): PastWeek => ({
      isoKey: '2026-W41',
      label: '10월 1주차',
      year: 2026,
      month: 10,
      weekOfMonth: 1,
      monthly: false,
      mine: { id: 's', edited, proxied },
      doc: false,
    });
    const past = (w: PastWeek) =>
      renderToStaticMarkup(
        createElement(PastWeeks, { groups: groupPast([w], { year: 2026, month: 10 }), showMissing: true, divisionSlug: 'D', me: { id: 'u1', name: '본인' } }),
      );
    expect(past(week(true))).toContain('<span class="text-warning">· 대신 입력</span>');
    expect(past(week(false, true))).toContain('<span class="text-warning">· 고침</span>');
    expect(past(week(false))).not.toMatch(/대신 입력|고침/);
  });

  it('열었을 때 머리 — 「○○ 입력 · 시각」 / 「○○ 고침 · 시각」 (TACP-22: 제출 시각과 섞지 않는다)', () => {
    expect(editedLabel('담당자', '2026-10-15T11:05:00+09:00', true)).toBe('담당자 입력 · 11:05');
    expect(editedLabel('담당자', '2026-10-15T11:05:00+09:00')).toBe('담당자 고침 · 11:05');
    expect(editedLabel('담당자', null, true)).toBe('담당자 입력');
  });
});

// ── 글과 판정 ────────────────────────────────────────────────────────────────────
describe('[CP-T123] 이름 목록 · 붙인 뒤 한 줄 (CP-134)', () => {
  it('nameList — 4명까지 이어 쓰고 넘으면 「외 n명」', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['가온'])).toBe('가온');
    expect(nameList(['가온', '나래', '다솜', '라온'])).toBe('가온, 나래, 다솜, 라온');
    expect(nameList(['가온', '나래', '다솜', '라온', '마루', '바다'])).toBe('가온, 나래, 다솜, 라온 외 2명');
    expect(nameList(['가온', '나래', '다솜'], 2)).toBe('가온, 나래 외 1명');
  });

  it('appendedNote — 누가 · 표별 몇 줄. 특이는 있을 때만, 건너뛴 사람이 있으면 그 수까지', () => {
    const a = (name: string, achievements: number, plans: number, notes = 0) => ({ name, achievements, plans, notes });
    expect(appendedNote({ appended: [a('라온', 1, 1), a('바다', 1, 1)] })).toBe('라온, 바다 맨 뒤에 붙였어요 · 실적 2줄 · 계획 2줄');
    expect(appendedNote({ appended: [a('라온', 2, 1, 1)] })).toBe('라온 맨 뒤에 붙였어요 · 실적 2줄 · 계획 1줄 · 특이 1줄');
    expect(appendedNote({ appended: [a('라온', 1, 0)], skipped: [{}, {}] })).toBe(
      '라온 맨 뒤에 붙였어요 · 실적 1줄 · 계획 0줄 · 2명은 파일을 읽지 못해 건너뜀',
    );
    expect(appendedNote({ appended: [a('라온', 1, 1)], skipped: [] })).not.toContain('건너뜀');
  });
});

describe('[TACP-T120] 화면의 판정은 서버와 같은 식이다 (TACP-9 · TACP-12)', () => {
  it('canWriteOwnUnit — 담당(lead·head)이거나 운영자(자기 부서)만', async () => {
    // authz는 env를 읽는다 — 연결은 열지 않으므로 자리만 채운다
    process.env.DATABASE_URL ??= 'file:/tmp/late-entry-ui-unused.db';
    process.env.STORAGE_ROOT ??= '/tmp/late-entry-ui-unused';
    process.env.CF_ACCESS_TEAM ??= 'aidt-kei';
    const { canWriteOwnUnit } = await import('@/server/authz');
    const scope = (isManager: boolean, isOperator: boolean) => ({ isManager, user: { isOperator } }) as Parameters<typeof canWriteOwnUnit>[0];
    expect(canWriteOwnUnit(scope(true, false))).toBe(true);
    expect(canWriteOwnUnit(scope(false, true))).toBe(true);
    expect(canWriteOwnUnit(scope(true, true))).toBe(true);
    expect(canWriteOwnUnit(scope(false, false))).toBe(false);
  });

  it('붙이기 게이트(requireOwnManager)와 화면(page-scope)이 같은 함수를 쓴다 — 식이 두 벌이 아니다', () => {
    const authz = read('server/authz.ts');
    const body = authz.slice(authz.indexOf('export async function requireOwnManager'));
    expect(body.slice(0, body.indexOf('\n}\n'))).toContain('canWriteOwnUnit(scope)');
    expect(read('server/page-scope.ts')).toContain('canAppendLate: isOwn && canWriteOwnUnit(ps.scope)');
  });

  it('수합 관리 화면의 행별 [대신 쓰기]는 서버 함수 canProxySubmit으로 정한다 — 화면에 역할 비교가 없다', () => {
    const view = read('app/[division]/manage/ManageView.tsx');
    expect(view).toContain('canProxySubmit(proxyScope');
    expect(view).not.toMatch(/canProxy\s*[:=][^\n]*\b(isOperator|isCoordinator|divisionRole)\b/);
    for (const f of ['components/SubmissionTableClient.tsx', 'components/ProxyEntryDrawer.tsx', 'components/MergePanel.tsx']) {
      expect(read(f)).not.toMatch(/\.isOperator|\.isCoordinator|divisionRole\s*===/);
    }
  });
});
