// OPS-51 — 분류 순서 초안 스크립트(`scripts/apply-merge-rule-drafts.ts`)의 순수한 부분. 시험(`tests/merge-rule-drafts.test.ts`)이 DB 없이 부른다.
//
// 초안은 여러 부서 것인데 부서는 하나씩 켠다(LAUNCH-v2 §6). `--only`가 없으면 분류가 빈 초안 부서를 한꺼번에 써서,
// 10/12처럼 기획조정실만 켜는 날에는 꺼져 있고 담당 확인 전인 부서의 분류까지 들어간다.

/**
 * `--only=<부서명>[,<부서명>…]`을 읽는다. 없으면 null — 초안 전부(예전과 같다).
 * 값이 없는 `--only`(`--only` · `--only=` · `--only=,`)는 던진다 — 「전부」로 읽으면 고르려던 사람이 모든 부서를 쓰게 된다.
 * 여러 번 주면 합친다. 이름은 앞뒤 공백을 떼고 한 번씩만.
 */
export function onlyNames(argv: readonly string[]): string[] | null {
  const given = argv.filter((a) => a === '--only' || a.startsWith('--only='));
  if (given.length === 0) return null;
  const names = given.map((a) => (a === '--only' ? '' : a.slice('--only='.length)));
  const list = names.flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
  if (names.some((v) => !v.trim()) || list.length === 0) {
    throw new Error('--only=<부서명>[,<부서명>…] 꼴로 부서 이름을 적어 주세요');
  }
  return [...new Set(list)];
}

/**
 * 초안 중 무엇을 다룰지 — 순서는 초안 순서 그대로. `only`가 null이면 전부.
 * `unknown`(초안에 없는 이름)이 하나라도 있으면 부르는 쪽은 아무것도 하지 않고 멈춘다 — 오타가 「건너뜀」 줄 사이에 묻히면
 * 운영자는 넣었다고 믿고 지나간다.
 */
export function pickDrafts(
  draftNames: readonly string[],
  only: readonly string[] | null,
): { picked: string[]; skipped: string[]; unknown: string[] } {
  if (!only) return { picked: [...draftNames], skipped: [], unknown: [] };
  const want = new Set(only);
  return {
    picked: draftNames.filter((n) => want.has(n)),
    skipped: draftNames.filter((n) => !want.has(n)),
    unknown: only.filter((n) => !draftNames.includes(n)),
  };
}
