// WA-35 · WA-36 — 웹 작성 화면의 첫 그림.
//
// 시작점 고르기와 일자 예시의 계산은 src/lib/composer.test.ts가 본다. 여기서는 그 결과가 **화면에 그대로
// 나오는가**를 본다 — 「지금 낸 v2에서 시작합니다」 한 줄, 「공유」 머리글과 뜻, 이번 주 날짜 예시.
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
    createElement(WebComposer, { isoKey: '2026-W41', guideLines: [], weekStartMs: W41, onClose: () => {}, ...props }),
  );

describe('WA-35 「다시 작성」은 지금 낸 판에서', () => {
  it('[WA-T48] 낸 판의 줄과 「공유」를 채워 열고, 어디서 시작했는지 한 줄로 말한다', () => {
    const html = render({
      initial: { achievements: [row('보도자료 배포', { emphasis: true }), row('홍보 회의')], plans: [row('다음 주 계획')], notes: [] },
      initialVersion: 2,
    });
    expect(html).toContain('지금 낸 v2에서 시작합니다');
    // 2026-10-08 — 「고쳐서 제출하면 v3로 저장됩니다」는 걷었다(사용자: 주석 걷기). 시작점 한 줄만 남는다
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
  it('[WA-T50] 머리글에 「공유」가 있고, 표 아래 한 줄이 뜻을 말한다 (툴팁은 터치에서 안 뜬다)', () => {
    const html = render();
    expect(html).toMatch(/<span class="w-10[^"]*"><span aria-hidden="true"[^>]*><\/span>공유<\/span>/);
    expect(html).toMatch(/<span class="[^"]*text-emphasis[^"]*">공유<\/span> = 전 직원 공유 사항\(파란색\)/);
  });

  it('[WA-T49] 일자 예시는 이번 주 화요일 · 계획 표는 다음 주 — 고정 「8/20」이 아니다', () => {
    const html = render();
    expect(html).not.toContain('placeholder="8/20"');
    expect(html.match(/placeholder="(\d+\/\d+)"/g)).toEqual(['placeholder="10/6"', 'placeholder="10/13"', 'placeholder="10/6"']);
  });
});
