// PG-57~63 — 사용 안내(게임 튜토리얼식 코치 마크). 그림·앵커·키·클릭·역할 거르기·카메라·말풍선 자리를 네트워크 없이 고정한다.
//
// 이 안내는 **조용히 낡는다**: 버튼 이름이 바뀌어도, 앵커가 사라져도, 그림을 다시 안 찍어도 화면은 멀쩡히 뜬다.
// 강당에서 「저 버튼이 어디 있죠?」가 나온 뒤에야 안다. 그래서 낡음을 테스트가 먼저 잡는다(PG-63).
// 말풍선이 구멍을 가리거나 무대 밖으로 나가는 것도 눈으로는 서른 장을 다 못 본다 — 자리 계산을 실제 그림으로 잰다(PG-T89).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  chapterHeadline,
  CHAPTER_ORDER,
  DECK,
  isCoachStep,
  presentSlides,
  selfChapters,
  shotSteps,
  type GuideCap,
  type GuideStep,
} from '@/lib/guide/deck';
import { CLICK_PRESS_MS, clickPressMs, deckNav, isDeckKey, KEY_PRESS_MS, keyPressMs, stageClick, type DeckNavState } from '@/lib/guide/nav';
import {
  APP_HEADER,
  BOTTOM_SLACK,
  cameraFor,
  coverScale,
  cropAround,
  cropFor,
  CROP_MARGIN,
  fitCamera,
  MAX_ZOOM,
  OVERZOOM,
  overviewCamera,
  union,
  type Rect,
  type Size,
} from '@/lib/guide/camera';
import {
  BUBBLE,
  BUBBLE_WIDTHS,
  coachLayout,
  coachPlan,
  estimateBubble,
  footOf,
  GAP,
  HAND,
  handOf,
  inside,
  intersects,
  labelOwnLine,
  MARGIN,
  pillRect,
  SELF_K,
  ZOOM_STEPS,
} from '@/lib/guide/coach';
import { groundAt, groundCss, MANIFEST } from '@/lib/guide/manifest';

const ROOT = path.resolve(__dirname, '..');
const DECK_DIR = path.join(ROOT, 'public/guide/deck');
const steps = DECK.flatMap((c) => c.steps);

describe('[PG-T84] 단계 목록 무결성', () => {
  it('장 순서는 한 주의 이야기 순서다', () => {
    expect(DECK.map((c) => c.id)).toEqual([...CHAPTER_ORDER]);
    expect(CHAPTER_ORDER).toEqual(['intro', 'why', 'member', 'lead', 'head', 'hq', 'org', 'outro']);
  });

  it('단계 id는 유일하고, 주소 조각(#lead-3)도 유일하다', () => {
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = presentSlides().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('lead-3');
  });

  it('단계는 25~34장, 장 카드는 역할 장마다 하나', () => {
    expect(steps.length).toBeGreaterThanOrEqual(25);
    expect(steps.length).toBeLessThanOrEqual(34);
    const titles = presentSlides().filter((s) => s.step === null).map((s) => s.chapter.id);
    expect(titles).toEqual(['member', 'lead', 'head', 'hq', 'org']);
    // 장 카드에는 앞 장에서 넘어가는 메모가 있다 (발표자 창)
    for (const c of DECK.filter((c) => c.lede)) expect(c.notes?.length ?? 0, c.id).toBeGreaterThan(10);
    // 장 카드의 큰 줄은 「이번엔 ○○ 차례예요」 — 한 줄은 32자까지 해요체
    expect(chapterHeadline(DECK.find((c) => c.id === 'lead')!)).toBe('이번엔 부서담당자 차례예요');
    for (const c of DECK.filter((c) => c.lede)) {
      expect([...c.lede!].length, c.id).toBeLessThanOrEqual(32);
      expect(c.lede, c.id).toMatch(/요$/);
    }
  });

  // 2026-10-08 사용자: 「거창한 설명보다 게임처럼 — 『인벤토리: 습득한 아이템은 여기서 확인할 수 있어요』」
  it('[PG-57] 말풍선은 「이름: 한 문장」 — 이름 16자 · 문장 32자 · 생각 하나 · 해요체 · 「자세히」는 한 줄 · 메모가 있다', () => {
    for (const s of steps) {
      const says = `${s.id}: ${s.label} / ${s.say}`;
      // 그림·알림 단계는 말풍선의 머리(화면 이름 — 긴 버튼 이름을 줄이지 않는다), 글자 슬라이드는 큰 줄 — 둘 다 한 줄에 읽힌다
      expect([...s.label].length, says).toBeLessThanOrEqual(isCoachStep(s) ? 16 : 24);
      expect([...s.say].length, says).toBeLessThanOrEqual(32);
      // 2026-10-08 검토 — 말풍선 문장에 「—」로 두 생각을 잇지 않는다(둘째 생각은 「자세히」로)
      if (isCoachStep(s)) expect(s.say, says).not.toMatch(/—|\[|\]/);
      expect(s.say, says).toMatch(/요$/);
      expect(`${s.label} ${s.say} ${s.more ?? ''}`, says).not.toMatch(/습니다|합니다|입니다|\n/);
      if (s.more) expect([...s.more].length, `${s.id} more`).toBeLessThanOrEqual(64);
      expect(s.notes.length, s.id).toBeGreaterThan(20);
      // 예전의 제목(caption)·본문(body)은 없다 — 글이 길면 화면을 안 보고 글을 읽는다
      expect(Object.keys(s), s.id).not.toContain('body');
      expect(Object.keys(s), s.id).not.toContain('caption');
    }
  });

  it('[PG-57] 그림 단계의 이름은 화면에 있는 그 글자다 — 소스에 그대로(또는 이름을 끼워 만드는 틀로) 있다', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? (p.endsWith(path.join('lib', 'guide')) ? [] : walk(p)) : /\.tsx?$/.test(p) ? [p] : [];
      });
    const src = walk(path.join(ROOT, 'src'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    // 화면이 숫자·부서 이름을 끼워 만드는 버튼 — 소스에는 틀만 있다. label은 그림(가짜 조직)에 찍힌 그대로다
    const DYNAMIC: Record<string, RegExp> = {
      '미제출 2명 이름 복사': /`미제출 \$\{[^}]+\}명 이름 복사`/,
      '계획 2줄을 이번 주 실적으로': /계획 \{rows\.plans\.length\}줄을 이번 주 실적으로/,
      // 2026-10-08 자동 진행(RU-80) — 「위로」 상태 카드의 제목. 받는 곳 이름을 끼운다
      '기획경영본부에 올라가는 병합본': /\{view\.target\}에 올라가는 병합본/,
    };
    for (const s of shotSteps()) {
      if (DYNAMIC[s.label]) expect(src, s.label).toMatch(DYNAMIC[s.label]);
      else expect(src.includes(s.label), `${s.id}: 「${s.label}」이 화면 소스에 없다`).toBe(true);
    }
  });

  it('[RU-84] 자동 진행 — 없어진 버튼([본부에 제출]·[이어 붙이기]·[총괄에 제출]·[전사 취합본 만들기])을 가리키지 않는다', () => {
    const names = DECK.flatMap((c) => c.steps).flatMap((s) => [s.label, s.say, s.more ?? '', ...(s.kind === 'buttons' ? s.rows.flatMap((r) => r.buttons) : [])]);
    for (const gone of ['이어 붙이기', '전사 취합본 만들기', '다시 만들기', '다시 제출', '에 제출', '전사본 만들기']) {
      expect(names.filter((n) => n.includes(gone)), gone).toEqual([]);
    }
    // 본부·총괄 장의 「위로」 단계는 누르는 버튼이 아니라 상태 줄이다 — 손을 그리지 않는다
    const status = shotSteps().filter((s) => ['head-report', 'hq-run', 'hq-submit', 'org-run'].includes(s.id));
    expect(status.map((s) => `${s.id}:${s.target}`)).toEqual(['head-report:area', 'hq-run:area', 'hq-submit:area', 'org-run:area']);
  });

  it('[PG-57] 버튼 이름은 화면 그대로 — 화면에 없는 줄임 이름을 쓰지 않는다', () => {
    const text = JSON.stringify(DECK);
    // 화면의 버튼: 「고칠 것 없음 · 승인」 · 「검토 완료 · 승인」 — 위로 보내는 버튼은 2026-10-08부터 없다(RU-84)
    expect(text).not.toMatch(/\[승인\]|\[본부에 제출\]|\[총괄에 제출\]/);
    // 역할 이름표는 「부서담당자」 — 흐름 그림과 정리 장
    const flow = DECK.flatMap((c) => c.steps).find((s) => s.kind === 'flow');
    expect(flow?.kind === 'flow' && flow.flow.map((f) => f.who)).toEqual(['부서원', '부서담당자', '실·팀장', '본부', '총괄']);
    const summary = DECK.flatMap((c) => c.steps).find((s) => s.kind === 'buttons');
    expect(summary?.kind === 'buttons' && summary.rows.map((r) => r.who)).toEqual(['부서원', '부서담당자', '실·팀장', '본부', '총괄']);
    // 실·팀장 장은 화면이 부르는 이름(「부서장」)을 밝힌다
    expect(DECK.find((c) => c.id === 'head')?.lede).toContain('부서장');
  });

  it('[PG-59] 발표는 35장 — 혼자 보기 전용(연휴 마감 미리보기 · 다음 장과 같은 화면의 현황 카드 둘)은 빠지고, 총괄 장은 다섯 장', () => {
    const slides = presentSlides();
    expect(slides.length).toBe(35);
    // 「제출 현황」·「산하 제출」은 바로 다음 단계와 같은 화면이다 — 강당에서 같은 화면이 두 장 이어지면 넘긴 줄 모른다
    expect(slides.map((s) => s.step?.id)).not.toContain('lead-status');
    expect(slides.map((s) => s.step?.id)).not.toContain('hq-status');
    expect(slides.filter((s) => s.chapter.id === 'lead' && s.step).map((s) => `${s.step!.id} ${s.n}/${s.of}`)).toEqual([
      'lead-nudge 1/4',
      'lead-merge 2/4',
      'lead-merged 3/4',
      'lead-rules 4/4',
    ]);
    // 부서원 장은 여덟 장 — 2026-10-08 「공유」를 따로 짚는다(말풍선 하나에 버튼 하나)
    expect(slides.filter((s) => s.chapter.id === 'member' && s.step).map((s) => s.step!.id)).toEqual([
      'member-login',
      'member-week',
      'member-compose',
      'member-previous',
      'member-share',
      'member-submit',
      'member-done',
      'member-history',
    ]);
    expect(slides.map((s) => s.step?.id)).not.toContain('org-preview');
    const org = slides.filter((s) => s.chapter.id === 'org' && s.step);
    expect(org.map((s) => `${s.n}/${s.of}`)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(org.find((s) => s.step?.id === 'org-download')?.n).toBe(4);
  });

  it('[WA-39] 웹 작성만 — 한글 파일을 올려 내는 단계가 없다', () => {
    const text = JSON.stringify(DECK);
    expect(text).not.toMatch(/파일 올리기|드롭존|양식 다운로드|끌어다 놓/);
  });

  it('그림 단계마다 webp와 manifest 항목이 있고, 찍을 때의 앵커가 지금 앵커와 같다', () => {
    for (const s of shotSteps()) {
      const shot = MANIFEST.shots[s.id];
      expect(shot, `${s.id} — node scripts/guide-capture.cjs로 다시 찍을 것`).toBeTruthy();
      expect(shot.anchor, `${s.id} — 앵커가 바뀌었다. 다시 찍을 것`).toBe(s.anchor);
      const file = path.join(DECK_DIR, shot.file);
      expect(existsSync(file), file).toBe(true);
      // 장당 약 200KB (PG-62) — 강당 와이파이에서 넘길 때 기다리지 않게
      expect(statSync(file).size, shot.file).toBeLessThanOrEqual(210 * 1024);
      expect(shot.width / shot.height).toBeCloseTo(16 / 9, 2);
      // 바닥색 — 그림 아래를 비울 때 칠할 색(CP-101). 왼쪽부터 늘어서고 첫 토막은 0에서 시작한다
      expect(shot.ground.length, s.id).toBeGreaterThan(0);
      expect(shot.ground[0].x, s.id).toBe(0);
      for (const [i, g] of shot.ground.entries()) {
        expect(g.color, s.id).toMatch(/^#[0-9a-f]{6}$/);
        if (i > 0) expect(g.x, s.id).toBeGreaterThan(shot.ground[i - 1].x);
        expect(g.x, s.id).toBeLessThan(1);
      }
    }
  });

  it('[PG-58] 발표의 구멍은 누르는 것 하나 — 그림의 절반을 뚫지 않는다 (2026-10-08 검토: 서른 단계 중 열둘이 패널 전체였다)', () => {
    const { width, height } = MANIFEST.viewport;
    // 혼자 보기 전용 현황 카드(「제출 현황」·「산하 제출」)는 카드 전체가 볼 것이다 — 발표에는 나오지 않는다
    for (const s of shotSteps().filter((x) => !x.selfOnly)) {
      const f = MANIFEST.shots[s.id].focus;
      // 버튼은 버튼 크기, 보기만 하는 것(칩·합계·칸 묶음)도 그림의 12%를 넘지 않는다 — 예전 표·카드는 25–80%였다
      expect((f.w * f.h) / (width * height), `${s.id} ${f.w}×${f.h}`).toBeLessThanOrEqual(s.target === 'button' ? 0.02 : 0.12);
    }
  });

  it('스포트라이트·카메라 사각형은 그림 안에 있다', () => {
    const { width, height } = MANIFEST.viewport;
    for (const s of shotSteps()) {
      const shot = MANIFEST.shots[s.id];
      for (const [what, r] of [['focus', shot.focus], ['frame', shot.frame]] as const) {
        expect(r.w, `${s.id}.${what}`).toBeGreaterThan(0);
        expect(r.h, `${s.id}.${what}`).toBeGreaterThan(0);
        expect(r.x, `${s.id}.${what}`).toBeGreaterThanOrEqual(0);
        expect(r.y, `${s.id}.${what}`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${s.id}.${what}`).toBeLessThanOrEqual(width + 0.5);
        expect(r.y + r.h, `${s.id}.${what}`).toBeLessThanOrEqual(height + 0.5);
      }
    }
  });

  it('쓰지 않는 그림이 남아 있지 않다', () => {
    const used = new Set(Object.values(MANIFEST.shots).map((s) => s.file));
    const files = readdirSync(DECK_DIR).filter((f) => f.endsWith('.webp'));
    expect(files.filter((f) => !used.has(f))).toEqual([]);
    expect(Object.keys(MANIFEST.shots).sort()).toEqual(shotSteps().map((s) => s.id).sort());
  });
});

describe('[PG-T85] 발표 키 → 슬라이드 번호', () => {
  const N = 10;
  const at = (index: number, extra: Partial<DeckNavState> = {}): DeckNavState => ({ index, black: false, buffer: '', hint: 0, ...extra });
  const press = (s: DeckNavState, ...keys: string[]) => keys.reduce((st, key) => deckNav(st, { type: 'key', key }, N), s);

  it('다음 — → ↓ PageDown Space Enter (무선 프레젠터는 PageDown)', () => {
    for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']) expect(press(at(3), k).index, k).toBe(4);
  });

  it('이전 — ← ↑ PageUp Backspace (프레젠터는 PageUp)', () => {
    for (const k of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) expect(press(at(3), k).index, k).toBe(2);
  });

  it('끝에서 더 가지 않는다 · Home/End', () => {
    expect(press(at(N - 1), 'PageDown').index).toBe(N - 1);
    expect(press(at(0), 'PageUp').index).toBe(0);
    expect(press(at(5), 'Home').index).toBe(0);
    expect(press(at(5), 'End').index).toBe(N - 1);
  });

  it('숫자 + Enter — 그 번호로 (1부터, 범위 밖이면 끝)', () => {
    expect(press(at(0), '7', 'Enter')).toEqual(at(6));
    expect(press(at(0), '1', '2', 'Enter').index).toBe(N - 1);
    expect(press(at(4), '0', 'Enter').index).toBe(4); // 0번은 없다 — 제자리
    expect(press(at(0), '3').buffer).toBe('3');
    expect(press(at(0), '3', '4', 'Backspace').buffer).toBe('3'); // 숫자를 누르는 중의 Backspace는 숫자를 지운다
    expect(press(at(2), '3', 'Escape')).toEqual(at(2));
  });

  it('B · . — 검은 화면을 켜고 끈다', () => {
    expect(press(at(2), 'b').black).toBe(true);
    expect(press(at(2), '.').black).toBe(true);
    expect(press(at(2), 'B', 'B').black).toBe(false);
  });

  it('검은 화면에서 넘기기 키는 넘기지 않고 화면만 돌아온다', () => {
    const s = press(at(2), 'b', 'PageDown');
    expect(s).toEqual(at(2));
    expect(press(at(2), 'b', 'Escape')).toEqual(at(2));
  });

  it('모르는 키는 상태를 그대로 돌려준다 (브라우저 기본 동작을 막지 않게)', () => {
    const s = at(3);
    expect(deckNav(s, { type: 'key', key: 'x' }, N)).toBe(s);
    expect(isDeckKey('x')).toBe(false);
    expect(isDeckKey('PageDown')).toBe(true);
    expect(isDeckKey('F')).toBe(false); // 전체 화면은 컴포넌트가 직접 (사용자 동작이 필요하다)
  });

  it('다른 창에서 온 상태는 그대로 받는다 — 번호만 범위 안으로', () => {
    expect(deckNav(at(0), { type: 'sync', index: 4, black: true }, N)).toEqual(at(4, { black: true }));
    expect(deckNav(at(0), { type: 'sync', index: 99, black: false }, N).index).toBe(N - 1);
    expect(deckNav(at(0), { type: 'goto', index: -3 }, N).index).toBe(0);
  });
});

describe('[PG-T90] 무대 클릭 — 밝은 곳은 다음, 어두운 곳은 다시 알려 주기', () => {
  const N = 10;
  const at = (index: number, extra: Partial<DeckNavState> = {}): DeckNavState => ({ index, black: false, buffer: '', hint: 0, ...extra });
  const click = (s: DeckNavState, target: 'cutout' | 'next' | 'dim' | 'card') => deckNav(s, { type: 'click', target }, N);

  it('누른 곳 → 할 일', () => {
    expect(stageClick('cutout')).toBe('next');
    expect(stageClick('next')).toBe('next');
    expect(stageClick('card')).toBe('next');
    expect(stageClick('dim')).toBe('hint');
  });

  it('구멍·[다음]·글자 슬라이드를 누르면 다음 장 (그 버튼을 누른 뒤의 화면)', () => {
    for (const t of ['cutout', 'next', 'card'] as const) expect(click(at(3), t), t).toEqual(at(4));
  });

  it('어두운 곳을 누르면 넘기지 않고 hint만 하나 늘린다 — 무대가 테두리·손을 다시 움직인다', () => {
    const s = click(click(at(3), 'dim'), 'dim');
    expect(s.index).toBe(3);
    expect(s.hint).toBe(2);
  });

  it('검은 화면 위의 클릭은 키와 같다 — 넘기지 않고 화면만 돌아온다 · 마지막 장에서는 그대로', () => {
    expect(click(at(3, { black: true }), 'cutout')).toEqual(at(3));
    expect(click(at(N - 1), 'cutout')).toEqual(at(N - 1));
  });

  it('다른 창에서 온 상태는 hint를 건드리지 않는다 (hint는 창마다)', () => {
    expect(deckNav(at(0, { hint: 5 }), { type: 'sync', index: 4, black: false }, N)).toEqual(at(4, { hint: 5 }));
  });

  it('눌린 모양 — 구멍을 누르면 160ms, [다음]·어두운 곳·글자 슬라이드는 기다리지 않는다', () => {
    expect(CLICK_PRESS_MS).toBe(160);
    expect(clickPressMs('cutout')).toBe(CLICK_PRESS_MS);
    for (const t of ['next', 'dim', 'card'] as const) expect(clickPressMs(t), t).toBe(0);
  });

  it('눌린 모양 — 버튼 단계에서 넘기기 키(프레젠터)면 200ms, 그 밖에는 바로', () => {
    expect(KEY_PRESS_MS).toBe(200);
    for (const k of ['PageDown', 'ArrowRight', ' ', 'Enter']) expect(keyPressMs(at(3), k, N, true), k).toBe(KEY_PRESS_MS);
    expect(keyPressMs(at(3), 'PageDown', N, false)).toBe(0); // 보기만 하는 단계·글자 슬라이드
    expect(keyPressMs(at(3), 'PageUp', N, true)).toBe(0); // 이전은 누른 것이 아니다
    expect(keyPressMs(at(3, { black: true }), 'PageDown', N, true)).toBe(0); // 검은 화면 — 돌아오기만
    expect(keyPressMs(at(3, { buffer: '7' }), 'Enter', N, true)).toBe(0); // 숫자 + Enter는 이동
    expect(keyPressMs(at(N - 1), 'PageDown', N, true)).toBe(0); // 마지막 장 — 넘어가지 않는다
  });
});

describe('[PG-T86] 앵커가 코드에 있다 (CP-104)', () => {
  it('단계가 가리키는 data-guide가 src/**/*.tsx에 있다', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
      });
    const found = new Set<string>();
    for (const file of walk(path.join(ROOT, 'src'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('data-guide')) continue;
        for (const m of line.matchAll(/["']([a-z0-9-]+)["']/g)) found.add(m[1]);
      }
    }
    const wanted = shotSteps().flatMap((s) => [s.anchor, ...(s.frame ? [s.frame] : [])]);
    expect(wanted.filter((a) => !found.has(a))).toEqual([]);
  });
});

describe('[PG-T87] 혼자 보기 — 역할 거르기와 순서', () => {
  const ids = (caps: GuideCap[]) => selfChapters(caps).map((c) => c.chapter.id);
  const mine = (caps: GuideCap[]) => selfChapters(caps).filter((c) => c.mine).map((c) => c.chapter.id);
  const stepIds = (caps: GuideCap[], ch: string) =>
    selfChapters(caps).find((c) => c.chapter.id === ch)?.slides.map((s) => s.step!.id) ?? [];

  it('부서원 — 부서원 장이 맨 앞, 담당자·본부·총괄 장은 없다', () => {
    expect(ids(['all'])).toEqual(['member', 'why', 'outro']); // 표지는 발표에만 — 혼자 보기는 페이지 머리가 표지다
    expect(mine(['all'])).toEqual(['member']);
  });

  it('담당자 — 담당자 장이 맨 앞, 「위로 제출」은 담당자 장의 마지막 (실·팀장 장은 내 장이 아니다)', () => {
    const caps: GuideCap[] = ['all', 'manager', 'report'];
    expect(ids(caps)[0]).toBe('lead');
    expect(mine(caps)).toEqual(['lead']);
    expect(stepIds(caps, 'lead').at(-1)).toBe('head-report');
    const lead = selfChapters(caps).find((c) => c.chapter.id === 'lead')!;
    expect(lead.slides.map((s) => `${s.n}/${s.of}`).at(-1)).toBe('6/6'); // 「부서담당자 · 6/6」
    expect(ids(caps)).not.toContain('head');
    expect(ids(caps)).not.toContain('hq');
    expect(ids(caps)).not.toContain('org');
  });

  it('부서장 — 담당자·실·팀장 장이 앞에, 승인 단계가 있다', () => {
    const caps: GuideCap[] = ['all', 'manager', 'head', 'report'];
    expect(mine(caps)).toEqual(['lead', 'head']);
    expect(stepIds(caps, 'head')).toContain('head-approve');
    expect(stepIds(caps, 'head')).not.toContain('head-report');
  });

  it('「내 역할」은 그 장의 주인일 때만 — 빌려 온 단계 하나로 붙지 않는다', () => {
    // 장의 who를 가진 사람만 내 장. 부서원은 역할 장이 없어 부서원 장이 내 장
    expect(mine(['all'])).toEqual(['member']);
    expect(mine(['all', 'org'])).toEqual(['org']);
    expect(mine(['all', 'hq', 'report'])).toEqual(['hq']);
  });

  it('3단계가 꺼진 담당자 — 위로 제출 단계도 없다', () => {
    expect(ids(['all', 'manager'])).not.toContain('head');
    expect(stepIds(['all', 'manager'], 'lead')).not.toContain('head-report');
  });

  it('총괄 — 전사 장의 취합·일정 단계는 그 문이 있을 때만', () => {
    expect(stepIds(['all', 'org'], 'org')).toEqual(['org-board']);
    expect(stepIds(['all', 'org', 'orgDesk', 'schedule'], 'org')).toEqual([
      'org-board',
      'org-final',
      'org-run',
      'org-download',
      'org-schedule',
      'org-preview',
    ]);
  });

  it('발표에서만 쓰는 단계(표지·주소)는 혼자 보기에 없고, 혼자 보기 전용(연휴 미리보기)은 발표에 없다', () => {
    const all: GuideCap[] = ['all', 'manager', 'head', 'report', 'hq', 'org', 'orgDesk', 'schedule'];
    const self = selfChapters(all).flatMap((c) => c.slides.map((s) => s.step!.id));
    expect(self).not.toContain('outro-address');
    expect(self).not.toContain('intro-cover');
    expect(self).toContain('org-preview');
    expect(self.length).toBe(steps.length - 2);
    expect(self).toContain('lead-status');
    expect(self).toContain('hq-status');
    expect(presentSlides().filter((s) => s.step).length).toBe(steps.length - 3);
  });

  it('주소 조각은 이야기 순서 기준 — 옮겨 둔 단계도 거른 뒤에도 같은 단계는 같은 #', () => {
    const lead = selfChapters(['all', 'manager', 'report']).find((c) => c.chapter.id === 'lead')!;
    expect(lead.slides.at(-1)?.key).toBe('head-5');
    expect(presentSlides().find((s) => s.key === 'head-5')?.step?.id).toBe('head-report');
    expect(presentSlides().find((s) => s.key === 'head-5')?.chapter.id).toBe('head'); // 발표는 이야기 순서
  });

  it('[TACP-12] 거르기의 판정은 authz.ts의 guideCaps 하나 — 안내 페이지는 역할 플래그를 보지 않는다', () => {
    const page = readFileSync(path.join(ROOT, 'src/app/guide/page.tsx'), 'utf8');
    expect(page).toContain('guideCaps(scope)');
    expect(page).not.toMatch(/scope\.isHead|scope\.isManager\s*&&|canScheduleDeadlines\(/);
    expect(readFileSync(path.join(ROOT, 'src/server/authz.ts'), 'utf8')).toMatch(/export async function guideCaps\(/);
  });
});

describe('[PG-T88] 카메라', () => {
  const image = { w: 1600, h: 900 };

  it('사각형이 없으면 창을 다 덮는 배율로, 위(어느 화면인가)부터 보인다', () => {
    const view = { w: 1920, h: 860 };
    const c = cameraFor(view, image, null);
    expect(c).toEqual(overviewCamera(view, image));
    expect(c.scale).toBeCloseTo(1920 / 1600);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBe(0);
  });

  it('사각형은 창 안에 다 들어오고, 옆에 검은 띠가 없고, 아래 빈 곳은 BOTTOM_SLACK까지', () => {
    const view = { w: 1920, h: 860 };
    const frames = [
      { x: 0, y: 0, w: 300, h: 120 }, // 왼쪽 위 구석
      { x: 1300, y: 780, w: 300, h: 120 }, // 오른쪽 아래 구석
      { x: 600, y: 400, w: 400, h: 200 }, // 가운데
    ];
    for (const f of frames) {
      const c = cameraFor(view, image, f, { captureScale: 2 });
      expect(c.scale).toBeLessThanOrEqual(Math.min(fitCamera(view, image).scale * MAX_ZOOM, 2 * OVERZOOM) + 1e-9);
      expect(c.scale).toBeGreaterThanOrEqual(coverScale(view, image) - 1e-9);
      // 사각형이 창 안
      expect(c.x + f.x * c.scale).toBeGreaterThanOrEqual(-0.5);
      expect(c.y + f.y * c.scale).toBeGreaterThanOrEqual(-0.5);
      expect(c.x + (f.x + f.w) * c.scale).toBeLessThanOrEqual(view.w + 0.5);
      expect(c.y + (f.y + f.h) * c.scale).toBeLessThanOrEqual(view.h + 0.5);
      // 가로는 창 끝까지 그림, 위도 그림, 아래는 BOTTOM_SLACK까지만 빈다
      expect(c.x).toBeLessThanOrEqual(0.5);
      expect(c.x + image.w * c.scale).toBeGreaterThanOrEqual(view.w - 0.5);
      expect(c.y).toBeLessThanOrEqual(0.5);
      expect(c.y + image.h * c.scale).toBeGreaterThanOrEqual(view.h * (1 - BOTTOM_SLACK) - 0.5);
    }
  });

  it('찍은 배율의 1.15배를 넘게 키우지 않는다 (그림을 늘려 그리면 글자가 번진다)', () => {
    const c = cameraFor({ w: 1920, h: 900 }, image, { x: 700, y: 400, w: 60, h: 30 }, { captureScale: 1.5 });
    expect(c.scale).toBeCloseTo(1.5 * OVERZOOM);
  });

  it('큰 사각형은 창을 다 덮는 배율보다 작아지지 않는다 (줄여서 빈 곳을 보이지 않는다)', () => {
    const view = { w: 1280, h: 720 };
    const c = cameraFor(view, image, { x: 0, y: 0, w: 1600, h: 900 });
    expect(c.scale).toBeCloseTo(coverScale(view, image));
  });

  it('보이는 위 끝이 앱 머리를 반쯤 자르면, 머리를 다 감추거나 다 보인다', () => {
    const view = { w: 1920, h: 900 };
    const c = cameraFor(view, image, { x: 600, y: 120, w: 400, h: 120 }, { captureScale: 2, header: APP_HEADER });
    const top = -c.y / c.scale;
    expect(top <= 0.5 || top >= APP_HEADER - 0.5, `top=${top}`).toBe(true);
  });

  it('maxZoom — 코치 마크는 덜 다가간다 (전체가 보이는 배율의 몇 배까지)', () => {
    const view = { w: 1920, h: 1080 };
    const tiny = { x: 700, y: 400, w: 60, h: 30 };
    const fit = fitCamera(view, image).scale;
    expect(cameraFor(view, image, tiny, { captureScale: 2, maxZoom: 1.5 }).scale).toBeCloseTo(fit * 1.5);
    expect(cameraFor(view, image, tiny, { captureScale: 2 }).scale).toBeCloseTo(Math.min(fit * MAX_ZOOM, 2 * OVERZOOM));
  });

  it('휴대폰 잘라 보기 — 4:3, 그림 안, 카메라 사각형을 담는다', () => {
    for (const s of shotSteps()) {
      const shot = MANIFEST.shots[s.id];
      if (!shot) continue;
      const u = union(shot.frame, shot.focus);
      const k = cropFor(image, u);
      expect(k.w / k.h, s.id).toBeCloseTo(4 / 3, 5);
      expect(k.x, s.id).toBeGreaterThanOrEqual(-1e-9);
      expect(k.y, s.id).toBeGreaterThanOrEqual(-1e-9);
      expect(k.x + k.w, s.id).toBeLessThanOrEqual(image.w + 1e-6);
      expect(k.y + k.h, s.id).toBeLessThanOrEqual(image.h + 1e-6);
      if (u.w <= k.w && u.h <= k.h) {
        expect(k.x, s.id).toBeLessThanOrEqual(u.x + 1e-6);
        expect(k.y, s.id).toBeLessThanOrEqual(u.y + 1e-6);
        expect(k.x + k.w, s.id).toBeGreaterThanOrEqual(u.x + u.w - 1e-6);
        expect(k.y + k.h, s.id).toBeGreaterThanOrEqual(u.y + u.h - 1e-6);
      }
    }
  });
});

/**
 * 실제 그림으로 — 그림 단계마다 카메라·구멍·말풍선·손을 무대 크기별로 잰다.
 *   발표 무대 1920×1080(강당 1080p) · 1280×720(노트북 프로젝터·발표자 창) — 말풍선 배율 1
 *   혼자 보기 무대 816×459(lg 화면의 목차 옆) — 말풍선 배율 SELF_K
 */
const STAGES: { name: string; view: Size; k: number; pill: boolean; slides: ReturnType<typeof presentSlides> }[] = [
  { name: '발표 1920×1080', view: { w: 1920, h: 1080 }, k: 1, pill: true, slides: presentSlides() },
  { name: '발표 1280×720', view: { w: 1280, h: 720 }, k: 1, pill: true, slides: presentSlides() },
  {
    // 혼자 보기에는 구석 알약이 없다 — 목차·진행 막대가 자리를 말한다
    name: '혼자 보기 816×459',
    view: { w: 816, h: 459 },
    k: SELF_K,
    pill: false,
    slides: selfChapters(['all', 'manager', 'head', 'report', 'hq', 'org', 'orgDesk', 'schedule']).flatMap((c) => c.slides),
  },
];
const IMG = { w: MANIFEST.viewport.width, h: MANIFEST.viewport.height };

function planFor(sl: ReturnType<typeof presentSlides>[number], view: Size, k: number, withPill: boolean) {
  const s = sl.step as Extract<GuideStep, { kind: 'shot' }>;
  const pill = withPill ? pillRect(view, `${sl.chapter.title} ${sl.n}/${sl.of}`, k) : null;
  const shot = MANIFEST.shots[s.id];
  const bubble = (maxW: number) => estimateBubble(s.label, s.say, footOf(s.target), view, k, maxW);
  return {
    pill,
    ...coachPlan(view, IMG, shot, bubble, {
      captureScale: MANIFEST.scale,
      header: APP_HEADER,
      avoid: pill ? [pill] : [],
      hand: s.target === 'button',
    }),
  };
}

/** 돌리고 뒤집은 손 그림의 가운데 (무대 좌표) — 손이 구멍 **밖**으로 뻗었는지 본다 */
function handCenter(h: NonNullable<ReturnType<typeof handOf>>) {
  const a = (HAND.angle * Math.PI) / 180;
  const dx = h.box.x + h.box.w / 2 - h.tipX;
  const dy = h.box.y + h.box.h / 2 - h.tipY;
  return { x: h.tipX + h.fx * (dx * Math.cos(a) - dy * Math.sin(a)), y: h.tipY + h.fy * (dx * Math.sin(a) + dy * Math.cos(a)) };
}

describe('[PG-T89] 코치 마크 — 말풍선 자리', () => {
  for (const { name, view, k, pill: withPill, slides } of STAGES) {
    describe(name, () => {
      const stage: Rect = { x: 0, y: 0, w: view.w, h: view.h };
      const u = view.w / 100;
      const shots = slides
        .filter((sl) => sl.step?.kind === 'shot' && MANIFEST.shots[sl.step.id])
        .map((sl) => ({ sl, ...planFor(sl, view, k, withPill) }));

      it('그림 단계가 다 있다', () => {
        expect(shots.length).toBe(slides.filter((sl) => sl.step?.kind === 'shot').length);
      });

      it('말풍선은 무대 안(가장자리 MARGIN 안쪽)에 들어가고, 구멍을 덮지 않는다', () => {
        for (const { sl, hole, layout } of shots) {
          const id = `${sl.step!.id} (${layout.side})`;
          expect(layout.fits, id).toBe(true);
          expect(inside(layout.bubble, { x: MARGIN * u, y: MARGIN * u, w: view.w - 2 * MARGIN * u, h: view.h - 2 * MARGIN * u }), id).toBe(true);
          expect(intersects(layout.bubble, hole), id).toBe(false);
        }
      });

      it('손은 누르는 단계에만 — 무대 안, 말풍선과 겹치지 않고, 손끝은 구멍 안 · 손은 구멍 밖으로 뻗는다', () => {
        for (const { sl, hole, layout } of shots) {
          const s = sl.step as Extract<typeof sl.step, { kind: 'shot' }>;
          const hand = layout.hand;
          expect(!!hand, s.id).toBe(s.target === 'button');
          if (!hand) continue;
          expect(inside(hand, stage), s.id).toBe(true);
          expect(intersects(hand, layout.bubble), s.id).toBe(false);
          expect(inside({ x: hand.tipX, y: hand.tipY, w: 0, h: 0 }, hole), s.id).toBe(true);
          // 손 그림의 가운데가 구멍 밖 — 손가락이 버튼 글자(「이름」·「(새 버전)」·「만들기」)를 덮지 않는다
          const c = handCenter(hand);
          expect(inside({ x: c.x, y: c.y, w: 0, h: 0 }, hole, -1), `${s.id} 손 가운데 ${c.x.toFixed(0)},${c.y.toFixed(0)}`).toBe(false);
        }
      });

      if (withPill) {
        it('구석 알약(「부서원 3/8」)은 구멍도 말풍선도 손도 덮지 않는다', () => {
          for (const { sl, hole, layout, pill } of shots) {
            expect(intersects(pill!, hole), sl.step!.id).toBe(false);
            expect(intersects(pill!, layout.bubble), sl.step!.id).toBe(false);
            if (layout.hand) expect(intersects(pill!, layout.hand), sl.step!.id).toBe(false);
          }
        });
      }

      it('꼬리는 말풍선 변 위, 둥근 모서리 밖 — 구멍 쪽 변에서 나온다', () => {
        for (const { sl, hole, layout } of shots) {
          const { bubble: b, arrow } = layout;
          const len = arrow.edge === 'left' || arrow.edge === 'right' ? b.h : b.w;
          expect(arrow.at, sl.step!.id).toBeGreaterThanOrEqual((BUBBLE.radius + BUBBLE.arrow) * u - 0.5);
          expect(arrow.at, sl.step!.id).toBeLessThanOrEqual(len - (BUBBLE.radius + BUBBLE.arrow) * u + 0.5);
          // 구멍 쪽 변 — 말풍선이 오른쪽이면 왼쪽 변, 아래면 위 변
          if (arrow.edge === 'left') expect(b.x, sl.step!.id).toBeGreaterThanOrEqual(hole.x + hole.w);
          if (arrow.edge === 'right') expect(b.x + b.w, sl.step!.id).toBeLessThanOrEqual(hole.x);
          if (arrow.edge === 'top') expect(b.y, sl.step!.id).toBeGreaterThanOrEqual(hole.y + hole.h);
          if (arrow.edge === 'bottom') expect(b.y + b.h, sl.step!.id).toBeLessThanOrEqual(hole.y);
        }
      });

      it('카메라는 적당히 — 무대를 덮는 배율 이상, 전체 배율의 1.5배 이하 · 버튼은 1.35배 이상 다가간다', () => {
        const fit = fitCamera(view, IMG).scale;
        for (const { sl, cam } of shots) {
          const s = sl.step as Extract<typeof sl.step, { kind: 'shot' }>;
          expect(cam.scale, s.id).toBeGreaterThanOrEqual(coverScale(view, IMG) - 1e-9);
          expect(cam.scale, s.id).toBeLessThanOrEqual(fit * ZOOM_STEPS[0] + 1e-9);
          if (s.target === 'button') expect(cam.scale / fit, s.id).toBeGreaterThanOrEqual(1.35 - 1e-9);
        }
      });

      it('버튼(구멍)은 무대 높이 85% 위 — 아래쪽은 앞사람 머리에 가린다 · 양옆에 검은 띠 없음 · 앱 머리를 반쯤 자르지 않음', () => {
        for (const { sl, hole, cam } of shots) {
          const s = sl.step as Extract<typeof sl.step, { kind: 'shot' }>;
          if (s.target === 'button') expect(hole.y + hole.h, s.id).toBeLessThanOrEqual(view.h * 0.85 + 0.5);
          expect(cam.x, s.id).toBeLessThanOrEqual(0.5);
          expect(cam.x + IMG.w * cam.scale, s.id).toBeGreaterThanOrEqual(view.w - 0.5);
          const top = -cam.y / cam.scale;
          expect(top <= 1 || top >= APP_HEADER - 2, `${s.id}: 위 끝 ${top.toFixed(1)}`).toBe(true);
        }
      });
    });
  }

  it('그림을 2배로 찍었다 — 무대가 다가가도 글자가 번지지 않게', () => {
    expect(MANIFEST.scale).toBeGreaterThanOrEqual(2);
  });

  it('말풍선은 한 줄을 먼저 해 본다 — 너비 38 → 31 → 24cqw, 1080p 발표에서 짧은 이름의 말풍선은 대부분 한 줄', () => {
    expect(BUBBLE_WIDTHS).toEqual([38, 31, 24]);
    expect(BUBBLE.maxW).toBe(38);
    const view = { w: 1920, h: 1080 };
    const u = view.w / 100;
    // 한 줄 말풍선의 높이 — 이름 줄 하나 + 꼬리말
    const oneLine = estimateBubble('제출', '다 적었으면 여기를 눌러요', footOf('button'), view).h;
    const plans = presentSlides()
      .filter((sl) => sl.step?.kind === 'shot' && !labelOwnLine(sl.step.label))
      .map((sl) => ({ id: sl.step!.id, ...planFor(sl, view, 1, true) }));
    const single = plans.filter((p) => p.bubble.h <= oneLine + 0.5);
    expect(single.length / plans.length, plans.filter((p) => p.bubble.h > oneLine + 0.5).map((p) => p.id).join(', ')).toBeGreaterThanOrEqual(0.75);
    // 꼬리는 2.0cqw 마름모 — 변에서 1.4cqw 튀어나온다. 구멍과 말풍선 사이는 2.0cqw
    expect(BUBBLE.arrow).toBe(1.4);
    expect(GAP).toBe(2);
    expect(u).toBeGreaterThan(0);
  });
});

describe('[PG-61] 잘라 보기(휴대폰·인쇄) — 구멍은 가장자리에서 12% 넘게 안쪽', () => {
  it('그림 단계마다 4:3 · 구멍 둘레 12% · 그림 밖으로 나간 곳은 바닥색', () => {
    expect(CROP_MARGIN).toBe(0.12);
    for (const s of shotSteps()) {
      const shot = MANIFEST.shots[s.id];
      const hole = { x: shot.focus.x - 6, y: shot.focus.y - 6, w: shot.focus.w + 12, h: shot.focus.h + 12 };
      const c = cropAround(IMG, union(shot.frame, shot.focus), hole);
      expect(c.w / c.h, s.id).toBeCloseTo(4 / 3, 5);
      expect(hole.x - c.x, s.id).toBeGreaterThanOrEqual(CROP_MARGIN * c.w - 1e-6);
      expect(c.x + c.w - (hole.x + hole.w), s.id).toBeGreaterThanOrEqual(CROP_MARGIN * c.w - 1e-6);
      expect(hole.y - c.y, s.id).toBeGreaterThanOrEqual(CROP_MARGIN * c.h - 1e-6);
      expect(c.y + c.h - (hole.y + hole.h), s.id).toBeGreaterThanOrEqual(CROP_MARGIN * c.h - 1e-6);
      // 그림 밖으로는 꼭 필요한 만큼만 — 한 변에서 잘라 낸 폭의 15%를 넘지 않는다
      expect(Math.max(0, -c.x, c.x + c.w - IMG.w) / c.w, s.id).toBeLessThanOrEqual(0.15);
      expect(Math.max(0, -c.y, c.y + c.h - IMG.h) / c.h, s.id).toBeLessThanOrEqual(0.15);
    }
    // 드로어 바닥 오른쪽 끝의 [제출] — 그림 밖까지 자르고, 그 자리는 흰 드로어 색이 이어진다
    const submit = MANIFEST.shots['member-submit'];
    const c = cropAround(IMG, union(submit.frame, submit.focus), submit.focus);
    expect(c.x + c.w).toBeGreaterThan(IMG.w);
    expect(groundAt(submit.ground, 1)).toBe('#ffffff');
  });

  it('바닥색 CSS — 한 색이면 그 색, 여럿이면 경계가 딱 떨어지는 가로 띠', () => {
    expect(groundCss([{ x: 0, color: '#ffffff' }])).toBe('#ffffff');
    expect(groundCss([
      { x: 0, color: '#a0a0a0' },
      { x: 0.36, color: '#ffffff' },
    ])).toBe('linear-gradient(90deg, #a0a0a0 0% 36%, #ffffff 36% 100%)');
    expect(groundAt([{ x: 0, color: '#a0a0a0' }, { x: 0.36, color: '#ffffff' }], 0.2)).toBe('#a0a0a0');
  });
});

describe('[PG-T89] 코치 마크 — 순수 함수', () => {
  const view = { w: 1920, h: 1080 };
  const u = view.w / 100;
  const bubble = { w: 560, h: 190 };

  it('꼬리말은 무엇을 누르나만 — 순번은 알약·목차가 말한다', () => {
    expect(footOf('button')).toBe('버튼을 눌러 계속');
    expect(footOf('area')).toBe('밝은 곳을 눌러 계속');
  });

  it('오른쪽에 자리가 있으면 오른쪽, 없으면 왼쪽 — 꼬리는 구멍 가운데 높이를 가리킨다', () => {
    const left = coachLayout(view, { x: 300, y: 500, w: 150, h: 80 }, bubble);
    expect(left.side).toBe('right');
    expect(left.bubble.y + left.arrow.at).toBeCloseTo(540, 0);
    const right = coachLayout(view, { x: 1650, y: 500, w: 150, h: 80 }, bubble);
    expect(right.side).toBe('left');
    expect(right.bubble.x + right.bubble.w).toBeLessThanOrEqual(1650);
  });

  it('가로로 넓은 구멍은 아래, 아래가 모자라면 위 — 보기만 하는 것에는 손이 없다', () => {
    const wide = coachLayout(view, { x: 150, y: 200, w: 1620, h: 300 }, bubble);
    expect(wide.side).toBe('below');
    expect(wide.hand).toBeNull();
    const low = coachLayout(view, { x: 150, y: 560, w: 1620, h: 300 }, bubble);
    expect(low.side).toBe('above');
  });

  it('손은 말풍선 반대쪽으로 뻗는다 — 오른쪽 말풍선이면 왼쪽 아래로, 아래 말풍선이면 위에서 내려온다', () => {
    const right = coachLayout(view, { x: 300, y: 500, w: 150, h: 80 }, bubble, { hand: true });
    expect(right.side).toBe('right');
    expect(right.hand!.fx).toBe(-1);
    expect(right.hand!.x + right.hand!.w).toBeLessThan(right.bubble.x);
    // 양옆이 다 막힌 넓은 버튼 — 말풍선은 아래, 손은 위
    const btn = { x: 700, y: 300, w: 420, h: 80 };
    const l = coachLayout(view, btn, { w: 900, h: 190 }, { hand: true });
    expect(l.side).toBe('below');
    expect(l.hand!.fy).toBe(-1);
    expect(intersects(l.bubble, l.hand!)).toBe(false);
    // 무대 아래 끝의 버튼 — 손이 무대 밖으로 나가지 않게 위로
    const low = coachLayout(view, { x: 300, y: 1000, w: 150, h: 70 }, bubble, { hand: true });
    expect(low.hand!.fy).toBe(-1);
    expect(inside(low.hand!, { x: 0, y: 0, w: view.w, h: view.h })).toBe(true);
  });

  it('무대 위·아래 끝에 붙은 구멍 — 말풍선은 가장자리 안으로 밀린다(구멍 쪽으로는 밀리지 않는다)', () => {
    const top = coachLayout(view, { x: 300, y: 10, w: 150, h: 60 }, bubble);
    expect(top.bubble.y).toBeGreaterThanOrEqual(MARGIN * u - 0.5);
    expect(intersects(top.bubble, { x: 300, y: 10, w: 150, h: 60 })).toBe(false);
    const bottom = coachLayout(view, { x: 300, y: 1000, w: 150, h: 60 }, bubble);
    expect(bottom.bubble.y + bottom.bubble.h).toBeLessThanOrEqual(view.h - MARGIN * u + 0.5);
  });

  it('알약을 피한다 — 구멍 옆 자리가 알약에 걸리면 알약 밑으로', () => {
    const pill = pillRect(view, '부서담당자 3/5');
    const l = coachLayout(view, { x: 20, y: 40, w: 30, h: 30 }, { w: 400, h: 150 }, { avoid: [pill] });
    expect(intersects(l.bubble, pill)).toBe(false);
  });

  it('네 쪽 다 안 되면 fits=false — 카메라가 덜 다가가 다시 해 본다', () => {
    const full = coachLayout(view, { x: 100, y: 100, w: 1720, h: 880 }, bubble);
    expect(full.fits).toBe(false);
  });

  it('손끝은 버튼의 오른쪽 아래 모서리 쪽(0.78·0.90)에 얹고, 손은 20° 기울여 구멍 밖으로 뻗는다', () => {
    const hole = { x: 100, y: 100, w: 200, h: 80 };
    const h = handOf(hole, u);
    expect(h.tipX).toBeCloseTo(100 + 200 * 0.78);
    expect(h.tipY).toBeCloseTo(100 + 80 * 0.9);
    expect(HAND.angle).toBe(-20);
    const c = handCenter(h);
    expect(c.x).toBeGreaterThan(h.tipX); // 오른쪽 아래로 뻗는다
    expect(c.y).toBeGreaterThan(hole.y + hole.h);
    // 거울 — 왼쪽 아래 모서리 쪽을 짚고 왼쪽으로 뻗는다
    const m = handOf(hole, u, -1, 1);
    expect(m.tipX).toBeCloseTo(100 + 200 * 0.22);
    expect(handCenter(m).x).toBeLessThan(m.tipX);
  });

  it('말풍선 어림 — 38cqw를 넘지 않고, 글이 길면 높아진다 · 긴 이름은 제 줄 · 무대 크기에 비례한다', () => {
    const short = estimateBubble('제출', '다 적었으면 여기를 눌러요', footOf('button'), view);
    const long = estimateBubble('총괄(기획조정실)에 제출', '본부본을 올리면 본부 일은 끝이에요 정말로 끝이에요', footOf('button'), view);
    expect(long.w).toBeLessThanOrEqual(BUBBLE.maxW * u + 0.5);
    expect(long.h).toBeGreaterThan(short.h);
    // 8자 넘는 이름은 제 줄 — 짧은 문장이어도 한 줄이 더 든다
    expect(labelOwnLine('미제출 2명 이름 복사')).toBe(true);
    expect(labelOwnLine('제출')).toBe(false);
    expect(estimateBubble('미제출 2명 이름 복사', '알려요', footOf('button'), view).h).toBeGreaterThan(short.h);
    const half = estimateBubble('제출', '다 적었으면 여기를 눌러요', footOf('button'), { w: 960, h: 540 });
    expect(half.w).toBeCloseTo(short.w / 2, 5);
    expect(half.h).toBeCloseTo(short.h / 2, 5);
  });
});

