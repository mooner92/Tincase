// CP-119 — 칸 높이 맞추기. 브라우저 레이아웃은 node에서 잴 수 없으므로 **순서**를 본다:
// 읽기(scrollHeight·offsetHeight·clientHeight)와 쓰기(style.height)가 섞이면 읽을 때마다 레이아웃을 다시 계산한다.
// 병합본 112칸에서 한 글자 1초(운영 빌드 실측, 2026-10-08)였던 원인이 바로 그 섞임이었다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fitTextarea, fitTextareas } from '@/lib/fit-textarea';

/** 읽기·쓰기를 기록하는 가짜 칸 — 높이는 내용 줄 수 × 20, 테두리 2 */
function fake(name: string, lines: number, log: string[]) {
  let h = '';
  return {
    style: {
      get height() {
        return h;
      },
      set height(v: string) {
        log.push(`w:${name}:${v}`);
        h = v;
      },
    },
    get scrollHeight() {
      log.push(`r:${name}`);
      return lines * 20;
    },
    get offsetHeight() {
      log.push(`r:${name}`);
      return 22;
    },
    get clientHeight() {
      log.push(`r:${name}`);
      return 20;
    },
  } as unknown as HTMLTextAreaElement;
}

describe('[CP-T104] 칸 높이 맞추기 (CP-119)', () => {
  it('여러 칸 — auto를 모두 쓰고, 높이를 모두 읽고, 높이를 쓴다 (읽기와 쓰기가 섞이지 않는다)', () => {
    const log: string[] = [];
    const els = [fake('a', 1, log), fake('b', 3, log), fake('c', 2, log)];
    fitTextareas(els);
    const kinds = log.map((x) => (x.startsWith('r:') ? 'r' : x.endsWith(':auto') ? 'auto' : 'px'));
    // auto…auto r…r px…px — 한 번 바뀐 종류로 되돌아가지 않는다
    const runs = kinds.filter((k, i) => i === 0 || k !== kinds[i - 1]);
    expect(runs).toEqual(['auto', 'r', 'px']);
    // 테두리(offset − client = 2)를 더한다
    expect(els.map((e) => e.style.height)).toEqual(['22px', '62px', '42px']);
  });

  it('한 칸 — 같은 높이를 낸다 (입력하는 그 칸)', () => {
    const log: string[] = [];
    const el = fake('x', 2, log);
    fitTextarea(el);
    expect(el.style.height).toBe('42px');
    fitTextarea(null); // ref가 떨어질 때 — 아무 일도 없다
  });

  it('병합본 드로어·담당자 고치기는 컴포넌트 안에서 높이 맞춤 함수를 만들지 않는다 — 그리면 ref가 모든 칸에 다시 불린다', () => {
    for (const f of ['src/components/MergedDrawer.tsx', 'src/components/SubmissionEditor.tsx']) {
      const src = readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src, f).toContain("from '@/lib/fit-textarea'");
      expect(src, f).toMatch(/fitTextareas\(/);
      // 칸마다 하나씩 맞추던 예전 모양이 없다
      expect(src, f).not.toMatch(/querySelectorAll\('textarea'\)\.forEach/);
    }
    const drawer = readFileSync(path.join(process.cwd(), 'src/components/MergedDrawer.tsx'), 'utf8');
    expect(drawer).toContain('ref={fitTextarea}');
    expect(drawer).not.toMatch(/const fit = \(el/);
  });
});
