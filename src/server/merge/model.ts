// HM-24 — 모델 하네스 (ollama 클라이언트).
//
// 이 파일의 유일한 규칙: **모델은 문서 글자를 만들지 않는다.**
// 행 목록을 주고 id 묶음만 받는다. 검증에 조금이라도 걸리면 통째로 버리고
// 결정론 결과를 쓴다 — 병합본이 안 나오는 것보다 안 묶인 게 낫다.

import { env } from '../env';
import { MODEL_NOT_CONFIGURED } from '@/lib/merge-rows';
import { callModel, type FallbackKind } from './gate';
import type { MergeBudget } from './budget';
import {
  dropWeakGroups,
  exactDuplicates,
  expandToPartition,
  mergeDuplicateSets,
  validateGroups,
  type MergeRow,
  type RowGroup,
} from './dedupe';

export { exactDuplicates, validateGroups } from './dedupe';
export type { MergeRow, RowGroup } from './dedupe';

export interface GroupingResult {
  groups: RowGroup[];
  /** 모델을 실제로 썼는지 — 검토 화면에 그대로 표시한다 */
  usedModel: boolean;
  /** 모델을 못 쓴/안 쓴 이유 (사용했으면 null) */
  fallbackReason: string | null;
  elapsedMs: number;
  /** 글자 겹침이 모자라 버린 묶음 — 화면에 "이건 안 묶었다"로 보여줄 수 있다 */
  rejected: { ids: number[]; ratio: number }[];
  /**
   * HM-57 — 못 쓴 이유의 종류 (썼으면 null). 「시간 초과·연결 실패·5xx·예산」은 다시 하면 될 수 있는 폴백이고,
   * 나중에 알림·점검 요약·2차 병합이 이것으로 가른다. 옛 결과·흉내 낸 결과에는 없다
   */
  fallbackKind?: FallbackKind | null;
  /** HM-57 — 서버에 보낸 횟수 · 모델 문 앞에서 기다린 시간 (HM-52) */
  attempts?: number;
  waitedMs?: number;
}

/** 모델 없이 낸 결과 — 결정론 중복은 그대로 반영한다 (아무것도 안 묶는 게 아니다) */
function withoutModel(
  rows: readonly MergeRow[],
  reason: string,
  elapsedMs = 0,
  kind: FallbackKind = 'skipped',
  call: { attempts: number; waitedMs: number } = { attempts: 0, waitedMs: 0 },
): GroupingResult {
  return {
    groups: expandToPartition(rows, exactDuplicates(rows)),
    usedModel: false,
    fallbackReason: reason,
    elapsedMs,
    rejected: [],
    fallbackKind: kind,
    ...call,
  };
}

/**
 * 응답 스키마를 ollama에 직접 준다 (`format`).
 * `format: 'json'`은 "유효한 JSON"만 강제할 뿐 **모양은 강제하지 않는다** — 실측에서
 * 9B가 입력 행을 그대로 되돌려준 적이 있다. 스키마를 주면 그 실패 모드가 사라지고,
 * 덤으로 빨라진다 (8.6초 → 3.6초, 생성할 토큰이 줄어서).
 */
const DUPLICATES_SCHEMA = {
  type: 'object',
  properties: {
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' } },
          reason: { type: 'string' },
        },
        required: ['ids', 'reason'],
      },
    },
  },
  required: ['duplicates'],
} as const;

const SYSTEM = [
  '너는 한국 공공연구기관의 주간 업무일지 취합을 돕는다.',
  '너의 역할은 판단뿐이다. 문서에 들어갈 글자는 절대 만들지 않는다.',
  'JSON만 출력한다.',
].join(' ');

function buildPrompt(rows: readonly MergeRow[], extraRule: string): string {
  const payload = rows.map((r) => ({
    id: r.id,
    who: r.who,
    content: r.content,
    date: r.date,
    place: r.place,
    attendee: r.attendee,
  }));

  return [
    '다음은 한 부서 부서원들이 각자 제출한 주간 업무 행이다.',
    '여러 사람이 **같은 업무를 각자 적어 낸 것**을 찾아라. 글자가 똑같지 않아도 된다.',
    '',
    '중복으로 볼 것:',
    '- 같은 회의·행사에 여러 명이 참석하고 각자 적은 경우',
    '- 표현만 다르고 가리키는 일이 같은 경우 ("보도자료 배포" / "보도자료 2건 배포")',
    '- 한쪽이 다른 쪽에 포함되는 경우 ("A 시스템 고도화" / "A 시스템 고도화 참석")',
    '',
    '중복이 아닌 것:',
    '- 같은 사업의 서로 다른 활동 ("설문 설계" / "설문 결과 분석")',
    '- 주제만 비슷한 별개의 일',
    '',
    '출력 규칙:',
    '- id만 다룬다. 내용을 바꾸거나 요약하지 마라.',
    '- 중복인 묶음만 출력한다. 단독 행은 언급하지 마라.',
    '- 한 id는 최대 한 묶음에만 들어간다.',
    ...(extraRule ? ['', '부서 담당자가 정한 추가 지침:', extraRule] : []),
    '',
    JSON.stringify(payload, null, 1),
    '',
    'JSON만 출력: {"duplicates":[{"ids":[1,7],"reason":"같은 회의를 두 사람이 보고"}]}',
  ].join('\n');
}

/**
 * 중복 업무 묶기. 실패는 예외가 아니라 **폴백**이다 — 병합은 어떤 경우에도 완결된다.
 *
 * 모델은 문(HM-52)을 지나서만 부른다. 제한 시간은 문을 통과한 뒤부터 재고, 일시적 실패는 한 번 더 부른다(HM-57).
 * `budget`은 실행 예산 — 다 되면 부르지 않고 폴백한다.
 */
export async function groupDuplicates(
  rows: readonly MergeRow[],
  extraRule = '',
  opts: { budget?: MergeBudget | null; label?: string } = {},
): Promise<GroupingResult> {
  if (!env.MERGE_MODEL) return withoutModel(rows, MODEL_NOT_CONFIGURED);
  if (rows.length < 2) return withoutModel(rows, '묶을 행이 없습니다');
  if (rows.length > env.MERGE_MODEL_MAX_ROWS) {
    return withoutModel(rows, `행이 너무 많습니다 (${rows.length} > ${env.MERGE_MODEL_MAX_ROWS})`);
  }

  const started = Date.now();
  const reply = await callModel({
    label: opts.label ?? '중복 묶기',
    budget: opts.budget,
    body: {
      system: SYSTEM,
      prompt: buildPrompt(rows, extraRule),
      format: DUPLICATES_SCHEMA, // 모양까지 강제 — 'json'만으로는 부족했다
      options: { temperature: 0, num_ctx: 8192 }, // 재현 가능해야 감사할 수 있다
    },
  });
  const call = { attempts: reply.attempts, waitedMs: reply.waitedMs };
  if (!reply.ok) return withoutModel(rows, reply.reason, Date.now() - started, reply.kind, call);
  const text = reply.text;

  let duplicates: RowGroup[];
  try {
    const parsed = JSON.parse(text) as { duplicates?: RowGroup[] };
    if (!Array.isArray(parsed.duplicates)) {
      return withoutModel(rows, 'duplicates 배열이 없습니다', Date.now() - started, 'invalid', call);
    }
    duplicates = parsed.duplicates;
  } catch {
    return withoutModel(rows, '모델이 JSON을 내지 않았습니다', Date.now() - started, 'invalid', call);
  }

  const problem = validateGroups(rows, duplicates);
  if (problem) return withoutModel(rows, `묶음 검증 실패 — ${problem}`, Date.now() - started, 'invalid', call);

  // 글자가 너무 안 겹치는 묶음은 버린다 — 주제가 같은 것과 같은 업무인 것은 다르다
  const { kept, dropped } = dropWeakGroups(rows, duplicates);

  // 결정론 결과를 바닥에 깔고 모델 결과를 얹는다 — 모델은 **더하는 층**이다.
  // 겹치면 결정론이 이긴다 (글자가 같은 건 논쟁의 여지가 없다).
  const merged = mergeDuplicateSets(exactDuplicates(rows), kept);
  return {
    groups: expandToPartition(rows, merged),
    usedModel: true,
    fallbackReason: null,
    elapsedMs: Date.now() - started,
    rejected: dropped,
    fallbackKind: null,
    ...call,
  };
}
