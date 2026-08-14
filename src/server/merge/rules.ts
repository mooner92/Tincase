// HM-18 — 부서 병합 규칙 파서.
// 문법은 **결정적**이다: 같은 입력 + 같은 규칙이면 언제나 같은 출력.
// 규칙 텍스트로 HM-ABS를 건드릴 수 있는 지시어는 존재하지 않는다 (표현 자체가 불가능).

export interface MergePlan {
  /** 부서원 배치 순서 (이름). 미기재 인원은 뒤에 sortOrder → 이름 순 */
  order: string[];
  /** 표별 최소 행 수 — 내용이 적어도 이만큼은 빈 행을 남긴다 */
  minRows: { achievements: number; plans: number; notes: number };
  /** 특이사항이 비었을 때 3번 표를 지울지 */
  dropEmptyNotes: boolean;
  /** 모델에게 중복 묶기를 맡길지 (기본 켜짐, `중복묶기: 끔`으로 해제) */
  dedupe: boolean;
}

export const DEFAULT_PLAN: MergePlan = {
  order: [],
  minRows: { achievements: 8, plans: 8, notes: 4 },
  dropEmptyNotes: true,
  dedupe: true,
};

export class RuleParseError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = 'RuleParseError';
  }
}

const TABLE_KEY: Record<string, keyof MergePlan['minRows']> = {
  실적: 'achievements',
  계획: 'plans',
  특이: 'notes',
};

/**
 * 규칙 텍스트 → 실행 계획.
 * 모르는 지시어·잘못된 값은 **행 번호와 함께** 던진다 (저장 시점 422).
 * 조용히 무시하면 담당자는 규칙이 먹은 줄 안다.
 */
export function parseMergeRule(text: string): MergePlan {
  const plan: MergePlan = {
    ...DEFAULT_PLAN,
    order: [],
    minRows: { ...DEFAULT_PLAN.minRows },
  };
  if (!text.trim()) return plan;

  const lines = text.split('\n');
  for (const [i, raw] of lines.entries()) {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const sep = line.indexOf(':');
    if (sep < 0) throw new RuleParseError(n, `'지시어: 값' 형식이 아닙니다 — "${line}"`);
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();

    switch (key) {
      case '순서': {
        plan.order = value
          .split(/[,·]/)
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      }
      case '빈행유지': {
        // "실적 8, 계획 8, 특이 4"
        for (const part of value.split(',')) {
          const m = /^\s*(실적|계획|특이)\s+(\d+)\s*$/.exec(part);
          if (!m) throw new RuleParseError(n, `'실적 8, 계획 8, 특이 4' 형식이어야 합니다 — "${part.trim()}"`);
          const rows = Number(m[2]);
          if (rows > 200) throw new RuleParseError(n, `행 수가 너무 큽니다 (${rows}) — 200 이하여야 합니다`);
          plan.minRows[TABLE_KEY[m[1]]] = rows;
        }
        break;
      }
      case '특이사항': {
        if (value === '비면 표 삭제') plan.dropEmptyNotes = true;
        else if (value === '항상 유지') plan.dropEmptyNotes = false;
        else throw new RuleParseError(n, `'비면 표 삭제' 또는 '항상 유지'여야 합니다 — "${value}"`);
        break;
      }
      case '중복묶기': {
        if (value === '켬') plan.dedupe = true;
        else if (value === '끔') plan.dedupe = false;
        else throw new RuleParseError(n, `'켬' 또는 '끔'이어야 합니다 — "${value}"`);
        break;
      }
      default:
        throw new RuleParseError(n, `모르는 지시어입니다 — "${key}"`);
    }
  }
  return plan;
}

/**
 * 규칙의 `순서`에 따라 사람을 줄 세운다.
 * 미기재 인원은 뒤에 붙되 부서가 정한 순서(sortOrder → 이름)를 따른다 — 이름이
 * 빠졌다고 사람이 사라지면 안 된다.
 */
export function orderPeople<T extends { name: string; sortOrder: number }>(people: T[], plan: MergePlan): T[] {
  const rank = new Map(plan.order.map((name, i) => [name, i]));
  return [...people].sort((a, b) => {
    const ra = rank.get(a.name);
    const rb = rank.get(b.name);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1; // 규칙에 있는 사람이 앞
    if (rb !== undefined) return 1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko');
  });
}
