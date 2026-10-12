// PG-64 — /ops 첫 화면은 불러오는 동안 「없다」고 말하지 않는다.
//
// 예전에는 부서 목록을 빈 배열로 시작해서, 불러오는 동안(실패하면 계속) 「제출 확인 0 · 이력 없음 0 ·
// 이 분류에 해당하는 부서가 없습니다」가 떴다 — 운영회의 화면에서 데이터가 날아간 것처럼 보였다.
// 첫 그림(서버 렌더)이 곧 불러오는 동안의 화면이다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

// PG-94 — [편집]한 줄이 넓어지면 줄 끝 칸이 화면 밖으로 밀려 [완료]·[열기]가 안 보였다(운영자 2026-10-12 —
// 「저장 버튼이 없다 · 새로 고침해야 인원을 연다」). 바꾼 「업무일지」 값 때문에 줄이 다른 탭으로 사라지기도 했다.
describe('[PG-T173] 부서 표 — 고치는 동안에도 [완료]·[열기]가 보이고 줄이 사라지지 않는다 (PG-94)', () => {
  const actions = async (editing: boolean) => {
    const { RowActions } = await import('@/app/ops/OpsClient');
    const row = createElement(RowActions, { name: '가부서', editing, onEdit: () => {}, onOpen: () => {} });
    return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement('tr', null, row))));
  };

  it('줄 끝 칸은 오른쪽에 붙는다(sticky) — 바탕을 칠해 밑으로 지나가는 칸이 비치지 않는다 · 머리 칸도 같이', async () => {
    const read = await actions(false);
    expect(read).toMatch(/<td class="sticky right-0 z-10 [^"]*bg-canvas"/);
    const edit = await actions(true);
    expect(edit).toMatch(/<td class="sticky right-0 z-10 [^"]*bg-surface-soft"/);
    const { OpsClient } = await import('@/app/ops/OpsClient');
    expect(renderToStaticMarkup(createElement(OpsClient))).toMatch(/<th class="sticky right-0 z-10 [^"]*">편집 · 인원<\/th>/);
  });

  it('고치는 줄의 [완료]는 주 단추 · 읽는 줄의 [편집]은 가벼운 단추 · [열기]는 늘 있다 — 이름에 부서', async () => {
    const read = await actions(false);
    expect(read).toContain('aria-label="가부서 편집" class="btn-ghost">편집</button>');
    expect(read).toContain('aria-label="가부서 인원 열기" class="btn-ghost">열기</button>');
    const edit = await actions(true);
    expect(edit).toContain('aria-label="가부서 편집 완료" class="btn-primary h-8 px-3 text-sm">완료</button>');
    expect(edit).toContain('>열기</button>');
  });

  it('고치는 줄은 「업무일지」 값이 바뀌어도 지금 탭에 남는다 · 다른 줄은 값대로 · 옛 값(unclear)은 「이력 없음」', async () => {
    const { rowsInTab } = await import('@/app/ops/OpsClient');
    const rows = [
      { id: 'a', boardStatus: 'confirmed' },
      { id: 'b', boardStatus: 'none' },
      { id: 'c', boardStatus: 'unclear' },
    ];
    expect(rowsInTab(rows, 'confirmed', null).map((r) => r.id)).toEqual(['a']);
    expect(rowsInTab(rows, 'none', null).map((r) => r.id)).toEqual(['b', 'c']);
    // b를 고치다 「제출함」으로 바꿨다 → 「이력 없음」 탭에 그대로
    const moved = rows.map((r) => (r.id === 'b' ? { ...r, boardStatus: 'confirmed' } : r));
    expect(rowsInTab(moved, 'none', 'b').map((r) => r.id)).toEqual(['b', 'c']);
    expect(rowsInTab(moved, 'none', null).map((r) => r.id)).toEqual(['c']); // [완료] 뒤에는 제 탭으로
  });

  it('「저장됨」은 화면 아래에 떠 있다 — 표를 내려 본 채로도 보인다 · 고치는 줄에는 「바꾸면 바로 저장」', async () => {
    const src = readFileSync(path.join(__dirname, '../src/app/ops/OpsClient.tsx'), 'utf8');
    expect(src).toMatch(/aria-live="polite"\s+className="fixed bottom-6 [^"]*empty:hidden"/);
    expect(src).toContain('바꾸면 바로 저장돼요 · 끝나면 [완료]');
  });
});
