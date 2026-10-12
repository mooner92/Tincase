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

// PG-91 — 부서 표 「알림」. 이 저장소에는 DOM 시험 도구가 없다 — 그리기는 칸 부품(`NotifyCell`)과 첫 그림으로,
// 누른 뒤의 일(바로 바꿔 그리기 · 실패하면 되돌리기)은 그 일을 맡은 함수(`toggleNotify`)에 가짜 저장을 물려 본다.
describe('[PG-T171] 부서 표 「알림」 (PG-91)', () => {
  const cell = async (on: boolean, editing: boolean, busy = false) => {
    const { NotifyCell } = await import('@/app/ops/OpsClient');
    return renderToStaticMarkup(createElement(NotifyCell, { name: '가부서', on, editing, busy, onToggle: () => {} }));
  };

  it('읽기는 칩 하나 — 켬 chip-ok · 끔 chip-muted, 단추 없음', async () => {
    expect(await cell(true, false)).toBe('<span class="chip text-xs chip-ok">켬</span>');
    expect(await cell(false, false)).toBe('<span class="chip text-xs chip-muted">끔</span>');
  });

  it('[편집]한 줄은 켜짐과 같은 꼴의 단추 — aria-pressed가 지금 값, 이름에 부서, 저장하는 동안은 눌리지 않는다', async () => {
    const on = await cell(true, true);
    expect(on).toMatch(/^<button [^>]*aria-pressed="true"[^>]*>켬 · 끄기<\/button>$/);
    expect(on).toContain('aria-label="가부서 알림 켬 · 끄기"');
    expect(on).toContain('class="btn-secondary h-8 px-3 text-sm"');
    expect(on).not.toContain('disabled');
    const off = await cell(false, true);
    expect(off).toMatch(/aria-pressed="false"[^>]*>끔 · 켜기<\/button>$/);
    expect(await cell(false, true, true)).toContain('disabled=""');
  });

  it('표 머리 — 「알림」은 「상태」 바로 다음 · 빈 줄이 머리 칸을 모두 덮는다', async () => {
    const { OpsClient } = await import('@/app/ops/OpsClient');
    const html = renderToStaticMarkup(createElement(OpsClient));
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['부서', '인원', '양식', '마감', '업무일지', '상태', '알림', '편집 · 인원']);
    expect(html).toMatch(new RegExp(`colSpan="${heads.length}"`, 'i'));
  });

  it('누르면 저장이 끝나기 전에 바뀐 값으로 그리고, 성공이면 그대로 둔다 — 보내는 것은 { id, notifyEnabled } 하나', async () => {
    const { toggleNotify } = await import('@/app/ops/OpsClient');
    const shown: boolean[] = [];
    const sent: unknown[] = [];
    let answer!: (r: Response) => void;
    const done = toggleNotify({ id: 'd1', notifyEnabled: false }, (v) => shown.push(v), (body) => {
      sent.push(body);
      return new Promise<Response>((r) => (answer = r));
    });
    expect(shown).toEqual([true]); // 응답 전
    expect(sent).toEqual([{ id: 'd1', notifyEnabled: true }]);
    answer(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await done).toEqual({ ok: true, message: '저장됨' });
    expect(shown).toEqual([true]);
  });

  it('저장이 거절되면 원래 값으로 되돌리고 서버 문구를 · 문구가 없으면 「실패」 · 네트워크가 끊겨도 되돌린다', async () => {
    const { toggleNotify } = await import('@/app/ops/OpsClient');
    const run = async (put: () => Promise<Response>) => {
      const shown: boolean[] = [];
      const r = await toggleNotify({ id: 'd1', notifyEnabled: true }, (v) => shown.push(v), put);
      return { ...r, shown };
    };
    const refused = await run(async () => new Response(JSON.stringify({ error: 'unauthenticated', message: '인증이 필요합니다.' }), { status: 401 }));
    expect(refused).toEqual({ ok: false, message: '인증이 필요합니다.', shown: [false, true] });
    const bare = await run(async () => new Response('Bad Gateway', { status: 502 }));
    expect(bare).toEqual({ ok: false, message: '실패', shown: [false, true] });
    const offline = await run(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(offline).toEqual({ ok: false, message: '네트워크 오류로 저장하지 못했습니다.', shown: [false, true] });
  });
});

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
