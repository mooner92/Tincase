// TACP-9 · AU-17c · ADR-0017 — 타 부서 열람 표시는 머리의 칩 하나다.
//
// 본문 위 띠(ForeignDivisionBanner)를 걷으면서 칩이 그 일을 넘겨받았다. 예전 칩은 640px 미만에서
// 부서 이름과 함께 숨었고, 그 폭에서는 띠가 유일한 표시였다 — 칩을 늘 보이게 하지 않으면 휴대폰에서 표시가 0개가 된다.
// 그 조건을 여기서 고정한다. 첫 그림(서버 렌더)으로 본다 — 머리는 열기 전의 모습이 곧 늘 보이는 모습이다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  usePathname: () => '/Other_Division/manage',
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));

const ROOT = path.resolve(__dirname, '..');

async function header(props: { foreign: boolean; ownSlug?: string }) {
  const { AppHeader } = await import('@/components/AppHeader');
  return renderToStaticMarkup(
    createElement(AppHeader, {
      slug: 'Other_Division',
      divisionName: '다른부서',
      userName: '총괄',
      isLead: true,
      isOperator: false,
      readAll: true,
      viaCloudflare: false,
      ...props,
    }),
  );
}

describe('TACP-9 타 부서 열람 표시 (ADR-0017)', () => {
  it('[AU-T88] ★ 열람 중이면 머리에 「열람」 칩과 [내 부서로] — 칩은 어느 폭에서도 감추지 않는다', async () => {
    const html = await header({ foreign: true, ownSlug: 'My_Division' });
    const chip = /<span class="([^"]*chip-warn[^"]*)"[^>]*>(.*?)<\/span><\/span>/.exec(html);
    expect(chip, html).not.toBeNull();
    expect(chip![2]).toContain('다른부서');
    expect(chip![2]).toContain('열람');
    // 좁은 화면에서 숨기는 클래스가 없다 — 이것이 띠를 걷어도 되는 조건이다
    expect(chip![1]).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(html).toContain('href="/My_Division"');
    expect(html).toContain('내 부서로');
    // 칩이 눌리지 않게 — 열람 중에는 메뉴가 1024px(lg)부터 로고 줄에 오른다. 768px에서 올리면 칩이 0px였다 (2026-10-08 실측)
    expect(html).toMatch(/<nav class="[^"]*hidden lg:flex[^"]*" aria-label="주요 메뉴"/);
    expect(html).not.toMatch(/<nav class="[^"]*md:flex/);
  });

  it('[AU-T88b] 내 부서면 칩도 [내 부서로]도 없다 · 본문 위 띠 부품은 없다', async () => {
    const html = await header({ foreign: false, ownSlug: 'My_Division' });
    expect(html).not.toContain('chip-warn');
    expect(html).not.toContain('내 부서로');
    expect(existsSync(path.join(ROOT, 'src/components/ForeignDivisionBanner.tsx'))).toBe(false);
  });
});

describe('NT-21 폐지 — 본인 알림 스위치', () => {
  it('[NT-T67] 사용자 메뉴에 「알림 받기」가 없고, 그 API도 없다 — 알림 끄기는 운영자 인원 드로어 한 곳(NT-22)', () => {
    expect(existsSync(path.join(ROOT, 'src/components/NotifyToggle.tsx'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'src/app/api/me/notify'))).toBe(false);
  });
});
