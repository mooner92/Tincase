// PG-100~102 — 사용 안내의 갈래(실형 · 연구 본부형 · 평가본부형). 실형 갈래는 guide-deck.test.ts가 이미 본다 — 여기서는 새 두 갈래에
// 같은 규칙(글 한도 · 앵커가 화면에 있다 · 그림 목록이 단계와 맞다)을 걸고, 세 갈래가 서로 섞이지 않는 것을 본다.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CHAPTER_ORDER, isCoachStep, LABEL_MAX, presentSlides, SAY_MAX, selfChapters, shotSteps, TITLE_MAX, type DeckKey } from '@/lib/guide/deck';
import { DECK_KEYS, DECKS, isDeckKey } from '@/lib/guide/decks';
import { MANIFESTS, shotOf } from '@/lib/guide/manifest';

const ROOT = path.resolve(__dirname, '..');
const NEW: DeckKey[] = ['project', 'erp'];
const DIR: Record<DeckKey, string> = { unit: 'public/guide/deck', project: 'public/guide/project', erp: 'public/guide/erp' };
const ALL_CAPS = ['all', 'manager', 'head', 'report', 'hq', 'org', 'orgDesk', 'schedule'] as const;

describe('[PG-T200] 갈래 — 세 갈래가 따로 서고 섞이지 않는다', () => {
  it('갈래 열쇠 셋 · 주소의 v= 판정', () => {
    expect(DECK_KEYS).toEqual(['unit', 'project', 'erp']);
    expect(isDeckKey('project')).toBe(true);
    expect(isDeckKey('old')).toBe(false);
    expect(isDeckKey(undefined)).toBe(false);
  });

  it('단계 id는 세 갈래를 통틀어 겹치지 않는다 — 그림 폴더가 달라도 주소 조각·메모가 섞이지 않게', () => {
    const ids = DECK_KEYS.flatMap((k) => DECKS[k].chapters.flatMap((c) => c.steps.map((s) => s.id)));
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('장 순서는 이야기 순서의 부분열이다 — 총괄 장은 실형 갈래에만', () => {
    for (const k of NEW) {
      const order = DECKS[k].chapters.map((c) => c.id);
      expect(order, k).toEqual(CHAPTER_ORDER.filter((c) => order.includes(c)));
      expect(order, k).not.toContain('org');
    }
  });

  it('슬라이드는 제 갈래를 들고 다닌다(그림 목록을 고른다)', () => {
    for (const k of DECK_KEYS) {
      expect(new Set(presentSlides(DECKS[k].chapters, k).map((s) => s.deck)), k).toEqual(new Set([k]));
      expect(new Set(selfChapters([...ALL_CAPS], DECKS[k].chapters, k).flatMap((c) => c.slides.map((s) => s.deck))), k).toEqual(new Set([k]));
    }
  });

  it('평가본부형은 부서원 장이 없다(부서원이 내지 않는다) · 부서원 역할로는 볼 장이 없어 페이지가 모든 장으로 보인다', () => {
    expect(DECKS.erp.chapters.map((c) => c.id)).not.toContain('member');
    expect(selfChapters(['all'], DECKS.erp.chapters, 'erp')).toEqual([]);
    expect(selfChapters([...ALL_CAPS], DECKS.erp.chapters, 'erp').length).toBeGreaterThan(0);
  });
});

describe('[PG-T201] 새 갈래의 글 — 실형과 같은 한도', () => {
  for (const k of NEW) {
    it(`${k}: 이름 13자 · 문장 30자 · 큰 제목 24자`, () => {
      for (const c of DECKS[k].chapters) {
        for (const s of c.steps) {
          if (isCoachStep(s)) {
            expect([...s.label].length, `${s.id} label`).toBeLessThanOrEqual(LABEL_MAX);
            expect([...s.say].length, `${s.id} say`).toBeLessThanOrEqual(SAY_MAX);
          } else {
            expect([...s.label].length, `${s.id} label`).toBeLessThanOrEqual(TITLE_MAX);
          }
          expect(s.notes.length, `${s.id} notes`).toBeGreaterThan(5);
        }
        if (c.lede) expect(c.notes?.length ?? 0, c.id).toBeGreaterThan(10);
      }
    });
  }

  it('버튼 정리표의 줄은 사람마다 하나다 — 줄의 열쇠가 사람 이름이다 (흐름 칸은 같은 사람이 두 번 나와도 된다)', () => {
    for (const k of DECK_KEYS) {
      for (const s of DECKS[k].chapters.flatMap((c) => c.steps)) {
        if (s.kind !== 'buttons') continue;
        const who = s.rows.map((r) => r.who);
        expect(who.length, s.id).toBe(new Set(who).size);
      }
    }
  });

  it('앵커(구멍·카메라)는 화면 소스의 data-guide에 있다 — 지워지면 여기서 먼저 깨진다', () => {
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
    const wanted = NEW.flatMap((k) => shotSteps(DECKS[k].chapters).flatMap((s) => [s.anchor, ...(s.frame ? [s.frame] : [])]));
    expect([...new Set(wanted.filter((a) => !found.has(a)))]).toEqual([]);
  });
});

describe('[PG-T202] 새 갈래의 그림 — 찍은 목록이 단계와 맞다', () => {
  it('그림 목록의 창·배율은 세 갈래가 같다(무대의 좌표계가 하나)', () => {
    for (const k of NEW) {
      expect(MANIFESTS[k].viewport, k).toEqual(MANIFESTS.unit.viewport);
      expect(MANIFESTS[k].scale, k).toBe(MANIFESTS.unit.scale);
    }
  });

  for (const k of NEW) {
    it(`${k}: 그림 단계마다 webp와 목록 항목 · 앵커가 같다 · 남는 그림 없음 · 주소는 그 갈래 폴더`, () => {
      const m = MANIFESTS[k];
      for (const s of shotSteps(DECKS[k].chapters)) {
        const shot = m.shots[s.id];
        expect(shot, `${s.id} — GUIDE_VARIANT=${k} node scripts/guide-capture.cjs로 찍을 것`).toBeTruthy();
        expect(shot.anchor, s.id).toBe(s.anchor);
        const file = path.join(ROOT, DIR[k], shot.file);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, shot.file).toBeLessThanOrEqual(210 * 1024);
        expect(shotOf(s.id, k)?.src.startsWith(`/${DIR[k].replace(/^public\//, '')}/`), s.id).toBe(true);
      }
      const used = new Set(Object.values(m.shots).map((s) => s.file));
      expect(readdirSync(path.join(ROOT, DIR[k])).filter((f) => f.endsWith('.webp') && !used.has(f))).toEqual([]);
      expect(Object.keys(m.shots).sort()).toEqual(shotSteps(DECKS[k].chapters).map((s) => s.id).sort());
    });
  }
});
