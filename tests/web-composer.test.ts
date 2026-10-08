// WA-35 · WA-36 — 웹 작성 화면의 첫 그림.
//
// 시작점 고르기와 일자 예시의 계산은 src/lib/composer.test.ts가 본다. 여기서는 그 결과가 **화면에 그대로
// 나오는가**를 본다 — 낸 판의 줄, 「공유」 머리글, 이번 주 날짜 예시, 제목(WA-38), 꺼진 [제출](WA-37).
// 첫 그림(서버 렌더)에는 브라우저 임시본이 없다 — 임시본이 먼저인 경우는 순수 함수 쪽 시험이 본다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebComposer } from '@/components/WebComposer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// 2026-10-05(월) 00:00 KST
const W41 = Date.UTC(2026, 9, 4, 15);
const row = (content: string, extra: object = {}) => ({ content, date: '', place: '', attendee: '', emphasis: false, ...extra });

const render = (props: Partial<Parameters<typeof WebComposer>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(WebComposer, { isoKey: '2026-W41', title: '10월 1주차 업무일지', weekStartMs: W41, onClose: () => {}, ...props }),
  );

describe('WA-35 「다시 작성」은 지금 낸 판에서', () => {
  it('[WA-T48] 낸 판의 줄과 「공유」를 채워 연다 — 시작점 줄은 없다(R15 · WA-T52)', () => {
    const html = render({
      initial: { achievements: [row('보도자료 배포', { emphasis: true }), row('홍보 회의')], plans: [row('다음 주 계획')], notes: [] },
      initialVersion: 2,
    });
    // 2026-10-08 — 「고쳐서 제출하면 v3로 저장됩니다」에 이어 「지금 낸 v2에서 시작합니다」도 걷었다(R15)
    expect(html).not.toContain('v3로 저장됩니다');
    expect(html).toContain('value="보도자료 배포"');
    expect(html).toContain('value="다음 주 계획"');
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="1번째 줄 공유 표시"/);
  });

  it('[WA-T48] 낸 판을 못 불러왔으면 빈 표로 열되 그렇다고 말한다 · 처음 쓰는 사람에게는 아무 말도 없다', () => {
    expect(render({ initial: null, initialVersion: 2, initialFailed: true })).toContain('지금 낸 판을 불러오지 못해 빈 표로 시작합니다');
    const fresh = render();
    expect(fresh).not.toContain('시작합니다');
  });

  it('[WA-T48] 「다시 열면 빈 화면으로 시작합니다」는 어디에도 없다 — 이제 거짓이다', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/components/WebComposer.tsx'), 'utf8');
    expect(src).not.toContain('빈 화면으로 시작');
  });
});

describe('WA-36 「공유」 칸의 이름과 뜻 · 일자 예시', () => {
  it('[WA-T50] 머리글에 「공유」가 있다 — 표 아래 범례 줄은 걷었다(R15, 2026-10-08)', () => {
    const html = render();
    expect(html).toMatch(/<span class="w-10[^"]*"><span aria-hidden="true"[^>]*><\/span>공유<\/span>/);
    expect(html).not.toContain('= 전 직원 공유 사항');
  });

  it('[WA-T49] 일자 예시는 이번 주 화요일 · 계획 표는 다음 주 — 고정 「8/20」이 아니다', () => {
    const html = render();
    expect(html).not.toContain('placeholder="8/20"');
    expect(html.match(/placeholder="(\d+\/\d+)"/g)).toEqual(['placeholder="10/6"', 'placeholder="10/13"', 'placeholder="10/6"']);
  });
});

describe('WA-37·38 — 낸 판으로 연 화면 · 제목 · 군더더기 (2026-10-08)', () => {
  const initial = { achievements: [row('보도자료 배포')], plans: [row('다음 주 계획')], notes: [] };

  it('[WA-T51] 낸 판으로 연 첫 그림의 [제출]은 꺼져 있다 · 빈 표에 내용이 없어도 꺼져 있다', () => {
    const submitOf = (html: string) => html.match(/<button[^>]*data-guide="compose-submit"[^>]*>/)?.[0] ?? '';
    expect(submitOf(render({ initial, initialVersion: 1 }))).toContain('disabled');
    expect(submitOf(render())).toContain('disabled');
  });

  it('[WA-T52] 제목은 그 주(월간이면 「9월 월간 업무일지」) · role=dialog가 제목을 가리킨다 · 고친 판이면 한 줄, 아니면 없음', () => {
    const html = render({ initial, initialVersion: 2, editedNote: '담당자 고침 · 10-07 15:20' });
    expect(html).toMatch(/role="dialog"[^>]*aria-labelledby="composer-title"/);
    expect(html).toMatch(/<h2 id="composer-title"[^>]*>10월 1주차 업무일지<\/h2>/);
    expect(html).toContain('담당자 고침 · 10-07 15:20');
    expect(html).not.toContain('업무일지 작성');
    expect(render({ title: '9월 월간 업무일지' })).toContain('>9월 월간 업무일지</h2>');
    expect(render({ initial, initialVersion: 2 })).not.toContain('고침');
  });

  it('[WA-T52] 「지금 낸 vN에서 시작합니다」·작성 안내 접힘·[비우기]·[전체 지우기]·합계가 없다 (R5 · R15)', () => {
    const html = render({ initial, initialVersion: 2 });
    for (const gone of ['에서 시작합니다', '부서 작성 안내', '비우기', '전체 지우기', '실적 1 · 계획 1']) expect(html, gone).not.toContain(gone);
    const src = readFileSync(path.resolve(__dirname, '../src/components/WebComposer.tsx'), 'utf8');
    expect(src).not.toContain('guideLines');
    // 닫을 때 임시본을 바로 쓰고 묻지 않는다 — 「닫을까요?」 확인이 없다
    expect(src).not.toMatch(/confirm\([^)]*닫을까요/);
  });
});
