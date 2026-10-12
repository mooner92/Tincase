// PG-92 · PG-93 (2026-10-12 운영자) — 사용 안내의 「누르라는 손」을 마우스 커서로, 「자세히」는 닫을 때까지 펼친 채.
//
// 커서 그림(게임 커서 「일반 선택」)은 운영자가 고른 제3자 저작물이라 공개 저장소에 넣지 않는다 — 체크아웃의
// `public/guide/local/cursor.png`(.gitignore)에 있을 때만 빌드가 주소를 넣고, 없으면 저장소의 기본 화살표(브랜드색)를 그린다.
// 이 저장소에는 DOM 시험 도구가 없다 — 그리기는 서버 렌더로, 펼침 상태는 소스로 본다.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { handOf } from '@/lib/guide/coach';

const ROOT = path.resolve(__dirname, '..');
const hand = handOf({ x: 100, y: 100, w: 200, h: 80 }, 10);
const draw = async (src: string | undefined) => {
  vi.resetModules();
  if (src === undefined) delete process.env.GUIDE_CURSOR_SRC;
  else process.env.GUIDE_CURSOR_SRC = src;
  try {
    const { CoachCursor } = await import('@/components/GuideStage');
    return renderToStaticMarkup(createElement(CoachCursor, { hand }));
  } finally {
    delete process.env.GUIDE_CURSOR_SRC;
  }
};

describe('[PG-T174] 누르라는 커서 (PG-92)', () => {
  it('그림이 없으면 브랜드색 화살표(SVG) — 손 그림 없음 · 기울이거나 뒤집지 않는다 · 끝에 물결', async () => {
    for (const html of [await draw(undefined), await draw('')]) {
      expect(html).toContain('data-cursor="arrow"');
      expect(html).toMatch(/<svg viewBox="0 0 27 32" class="coach-hand-tap coach-cursor"><path d="M3\.5 0\.5 /);
      expect(html).not.toMatch(/rotate\(|scale\(|<img|<rect/);
      expect(html).toMatch(/class="coach-tap-ripple" style="left:[\d.]+px;top:[\d.]+px"/);
    }
  });

  it('체크아웃에 그림이 있으면 그 그림 — 끝(transform-origin)은 그림의 손가락 끝', async () => {
    const html = await draw('/guide/local/cursor.png');
    expect(html).toContain('data-cursor="image"');
    expect(html).toContain('<img src="/guide/local/cursor.png" alt="" draggable="false" class="coach-hand-tap coach-cursor"/>');
    expect(html).not.toContain('<svg');
    expect(html).toMatch(/transform-origin:12\.96\d*% 1\.56\d*%/);
  });

  it('그림은 공개 저장소에 없다 — .gitignore · 빌드가 파일이 있을 때만 주소를 넣는다', () => {
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^public\/guide\/local\/$/m);
    const tracked = execFileSync('git', ['ls-files', 'public/guide/local'], { cwd: ROOT, encoding: 'utf8' });
    expect(tracked.trim()).toBe('');
    const config = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    expect(config).toMatch(/existsSync\(path\.join\(process\.cwd\(\), "public", GUIDE_CURSOR\)\) \? GUIDE_CURSOR : ""/);
    expect(config).toMatch(/env: \{ GUIDE_CURSOR_SRC: guideCursorSrc \}/);
  });
});

describe('[PG-T175] 「자세히」는 한 번 펼치면 닫을 때까지 펼친 채 (PG-93)', () => {
  it('펼침은 슬라이드가 아니라 화면 하나가 기억한다 — 슬라이드마다 새로 만들지 않는다(key 없음)', () => {
    const src = readFileSync(path.join(ROOT, 'src/components/GuideSelf.tsx'), 'utf8');
    expect(src).toMatch(/const \[moreOpen, setMoreOpen\] = useState\(false\);/);
    const details = /<details\s+open=\{moreOpen\}\s+onToggle=\{\(e\) => setMoreOpen\(e\.currentTarget\.open\)\}/;
    expect(src).toMatch(details);
    expect(src).not.toMatch(/<details key=\{slide\.key\}/);
  });
});
