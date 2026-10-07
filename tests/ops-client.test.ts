// PG-64 — /ops 첫 화면은 불러오는 동안 「없다」고 말하지 않는다.
//
// 예전에는 부서 목록을 빈 배열로 시작해서, 불러오는 동안(실패하면 계속) 「제출 확인 0 · 이력 없음 0 ·
// 이 분류에 해당하는 부서가 없습니다」가 떴다 — 운영회의 화면에서 데이터가 날아간 것처럼 보였다.
// 첫 그림(서버 렌더)이 곧 불러오는 동안의 화면이다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));

describe('PG-64 운영 화면 — 불러오는 중과 없음을 가른다', () => {
  it('[PG-T91] 첫 그림은 「불러오는 중…」 — 「부서가 없습니다」도, 탭의 0도 없다', async () => {
    const { OpsClient } = await import('@/app/ops/OpsClient');
    const html = renderToStaticMarkup(createElement(OpsClient));
    expect(html).toContain('불러오는 중…');
    expect(html).not.toContain('이 분류에 해당하는 부서가 없습니다');
    // 탭 이름 뒤에 숫자 배지가 없다 (불러오기 전의 0은 「없다」로 읽힌다)
    expect(html).not.toMatch(/제출 확인\s*(<!-- -->)?\s*<span[^>]*>\s*0\s*<\/span>/);
  });
});
