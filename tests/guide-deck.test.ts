// PG-57~63 — 사용 안내(슬라이드). 그림·앵커·키·역할 거르기·카메라를 네트워크 없이 고정한다.
//
// 이 안내는 **조용히 낡는다**: 버튼 이름이 바뀌어도, 앵커가 사라져도, 그림을 다시 안 찍어도 화면은 멀쩡히 뜬다.
// 강당에서 「저 버튼이 어디 있죠?」가 나온 뒤에야 안다. 그래서 낡음을 테스트가 먼저 잡는다(PG-63).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CHAPTER_ORDER, DECK, presentSlides, selfChapters, shotSteps, type GuideCap } from '@/lib/guide/deck';
import { deckNav, isDeckKey, type DeckNavState } from '@/lib/guide/nav';
import {
  APP_HEADER,
  BOTTOM_SLACK,
  cameraFor,
  coverScale,
  cropFor,
  fitCamera,
  MAX_ZOOM,
  OVERZOOM,
  overviewCamera,
  union,
  type Size,
} from '@/lib/guide/camera';
import { MANIFEST } from '@/lib/guide/manifest';

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

  it('단계는 25~34장, 장 제목 슬라이드는 역할 장마다 하나', () => {
    expect(steps.length).toBeGreaterThanOrEqual(25);
    expect(steps.length).toBeLessThanOrEqual(34);
    const titles = presentSlides().filter((s) => s.step === null).map((s) => s.chapter.id);
    expect(titles).toEqual(['member', 'lead', 'head', 'hq', 'org']);
    // 장 제목 슬라이드에는 앞 장에서 넘어가는 메모가 있다 (발표자 창)
    for (const c of DECK.filter((c) => c.lede)) expect(c.notes?.length ?? 0, c.id).toBeGreaterThan(10);
  });

  it('제목은 프로젝터에서 한 줄 (24자 이하 — 줄임표 없이) · 본문 1~3줄 · 메모가 있다', () => {
    for (const s of steps) {
      expect([...s.caption].length, `${s.id}: ${s.caption}`).toBeLessThanOrEqual(24);
      expect(s.body.length, s.id).toBeGreaterThanOrEqual(1);
      expect(s.body.length, s.id).toBeLessThanOrEqual(3);
      expect(s.notes.length, s.id).toBeGreaterThan(20);
    }
  });

  it('[PG-57] 버튼 이름은 화면 그대로 — 화면에 없는 줄임 이름을 쓰지 않는다', () => {
    const text = JSON.stringify(DECK);
    // 화면의 버튼: 「고칠 것 없음 · 승인」 · 「{본부 이름}에 제출」 · 「총괄(기획조정실)에 제출」
    expect(text).not.toMatch(/\[승인\]|\[본부에 제출\]|\[총괄에 제출\]/);
    // 역할 이름표는 「부서담당자」 — 흐름 그림과 정리 장
    const flow = DECK.flatMap((c) => c.steps).find((s) => s.kind === 'flow');
    expect(flow?.kind === 'flow' && flow.flow.map((f) => f.who)).toEqual(['부서원', '부서담당자', '실·팀장', '본부', '총괄']);
    const summary = DECK.flatMap((c) => c.steps).find((s) => s.kind === 'buttons');
    expect(summary?.kind === 'buttons' && summary.rows.map((r) => r.who)).toEqual(['부서원', '부서담당자', '실·팀장', '본부', '총괄']);
    // 실·팀장 장은 화면이 부르는 이름(「부서장」)을 밝힌다
    expect(DECK.find((c) => c.id === 'head')?.lede).toContain('부서장');
  });

  it('[PG-59] 발표는 36장 — 혼자 보기 전용(연휴 마감 미리보기)은 빠지고, 총괄 장은 다섯 장', () => {
    const slides = presentSlides();
    expect(slides.length).toBe(36);
    expect(slides.map((s) => s.step?.id)).not.toContain('org-preview');
    const org = slides.filter((s) => s.chapter.id === 'org' && s.step);
    expect(org.map((s) => `${s.n}/${s.of}`)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(org.find((s) => s.step?.id === 'org-download')?.n).toBe(4);
  });

  it('[WA-32] 웹 작성만 — 한글 파일을 올려 내는 단계가 없다', () => {
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
  const at = (index: number, extra: Partial<DeckNavState> = {}): DeckNavState => ({ index, black: false, buffer: '', ...extra });
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
    expect(presentSlides().filter((s) => s.step).length).toBe(steps.length - 1);
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

  // 실제 그림으로 — 1080p 발표 무대. 1920×914는 2026-10-08 검토 때 잰 무대, 1920×901은 지금 제목 띠로 잰 무대
  for (const view of [
    { w: 1920, h: 914 },
    { w: 1920, h: 901 },
  ] as Size[]) {
    describe(`발표 무대 ${view.w}×${view.h}`, () => {
      const opts = { captureScale: MANIFEST.scale, header: APP_HEADER };
      const img = { w: MANIFEST.viewport.width, h: MANIFEST.viewport.height };
      const present = new Set(presentSlides().map((s) => s.step?.id));
      const shots = shotSteps()
        .filter((s) => present.has(s.id) && MANIFEST.shots[s.id])
        .map((s) => {
          const shot = MANIFEST.shots[s.id];
          return { s, shot, c: cameraFor(view, img, union(shot.frame, shot.focus), opts) };
        });

      it('그림을 2배로 찍었다 — 1.5배 그림을 2.2배로 키우면 번진다', () => {
        expect(MANIFEST.scale).toBeGreaterThanOrEqual(2);
      });

      it('버튼 단계는 배율 2.0 이상 (앱 15px 글자가 30px), 영역 단계는 1.4 이상', () => {
        for (const { s, c } of shots) {
          expect(c.scale, s.id).toBeGreaterThanOrEqual(s.target === 'button' ? 2.0 : 1.4);
        }
      });

      it('누를 곳은 무대 높이 85% 위에 있다 (아래쪽은 앞사람 머리에 가린다)', () => {
        for (const { s, shot, c } of shots) {
          expect(c.y + (shot.focus.y + shot.focus.h) * c.scale, s.id).toBeLessThanOrEqual(view.h * 0.85 + 0.5);
          expect(c.y + shot.focus.y * c.scale, s.id).toBeGreaterThanOrEqual(-0.5);
        }
      });

      it('보이는 위 끝이 앱 머리(메뉴 줄)를 반쯤 자르지 않는다', () => {
        for (const { s, c } of shots) {
          const top = -c.y / c.scale;
          expect(top <= 1 || top >= APP_HEADER - 2, `${s.id}: 위 끝 ${top.toFixed(1)}`).toBe(true);
        }
      });

      it('양옆에 검은 띠가 없다', () => {
        for (const { s, c } of shots) {
          expect(c.x, s.id).toBeLessThanOrEqual(0.5);
          expect(c.x + img.w * c.scale, s.id).toBeGreaterThanOrEqual(view.w - 0.5);
        }
      });
    });
  }

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
