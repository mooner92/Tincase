// UI-T90 — **화면에 글꼴이 섞이지 않게 한다.**
//
// 「글씨체가 왜 섞여있는 것 같지?」라는 실제 피드백에서 나왔다. 확인해 보니 글꼴 지정은
// 어디나 페이퍼로지로 일관됐다 — 섞인 것은 **글자 단위**였다. 페이퍼로지에 없는 글자는
// 그 글자만 시스템 글꼴로 그려지고, 한 줄 안에서 서체가 바뀐다.
//
// 실측(브라우저에서 글자 폭 비교)한 결과 전각 「＋」와 「⋮」가 대체됐다. ASCII `+`는 있다.
// 전각과 반각은 눈으로 거의 구별되지 않아서 **코드 리뷰로는 절대 못 잡는다** — 그래서 검사다.
//
// 왜 폰트 파일을 직접 뜯지 않는가: woff2 cmap을 파싱하려면 압축 해제부터 해야 하고,
// 그렇게 얻은 「전체 글자 목록」은 이 검사가 답해야 할 질문(=우리가 실수로 전각을 썼는가)보다
// 훨씬 큰 것이다. 규칙 하나로 족하다 — **화면 글에는 전각 기호를 쓰지 않는다.**
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');

/** 전각 영숫자·기호 (U+FF01–FF5E) + 실측으로 확인된 개별 누락 글자 */
const BANNED = /[！-～⋮]/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
}

describe('UI-T90 글꼴 일관성 — 페이퍼로지에 없는 글자를 쓰지 않는다', () => {
  it('[UI-T90] src 전체에 전각 기호가 없다', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const m = BANNED.exec(line);
          if (m) hits.push(`${path.relative(SRC, file)}:${i + 1}  「${m[0]}」  ${line.trim().slice(0, 70)}`);
        });
    }
    expect(hits, `전각 기호는 그 글자만 시스템 글꼴로 그려집니다. 반각으로 바꾸세요:\n${hits.join('\n')}`).toEqual(
      [],
    );
  });

  it('[UI-T91] 검사가 실제로 잡는지 — 전각 더하기를 알아본다', () => {
    // 이 검사를 지워도 초록불이면 검사가 아니라 장식이다
    expect(BANNED.test('＋')).toBe(true);
    expect(BANNED.test('⋮')).toBe(true);
    expect(BANNED.test('+ · 「」 → ← ✓ ✕ ▾ ● ○')).toBe(false); // 이것들은 페이퍼로지에 있다
  });
});
