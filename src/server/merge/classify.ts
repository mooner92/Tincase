// HM-27 — 업무 분류 (부서가 정한 순서로 병합본을 정렬하기 위해).
//
// 부서 규칙 "순서: AI-홍보(정간물 포함)-시스템-도서관"을 지키려면 각 행이 어느 분류인지
// 알아야 한다. 이건 판단이라 모델이 맡는다. **분류는 재배치만 시킬 뿐 글자를 건드리지 않는다** —
// 최악의 경우가 "엉뚱한 묶음에 들어감"이고, 사라지거나 바뀌는 건 없다.

import { env } from '../env';
import type { MergeRow } from './dedupe';
import { callModel, type FallbackKind } from './gate';
import type { MergeBudget } from './budget';
import { OTHER } from './order';
import { MODEL_NOT_CONFIGURED } from '@/lib/merge-rows';

export { OTHER, sortByCategory } from './order';

export interface ClassifyResult {
  /** 행 id → 분류 이름. 판정 못 한 행은 여기 없다 (호출자가 기타로 본다) */
  assigned: Map<number, string>;
  usedModel: boolean;
  fallbackReason: string | null;
  elapsedMs: number;
  /** HM-57 — 못 쓴 이유의 종류 (썼으면 null) · 보낸 횟수 · 모델 문 앞에서 기다린 시간 (model.ts와 같다) */
  fallbackKind?: FallbackKind | null;
  attempts?: number;
  waitedMs?: number;
}

const empty = (
  reason: string,
  elapsedMs = 0,
  kind: FallbackKind = 'skipped',
  call: { attempts: number; waitedMs: number } = { attempts: 0, waitedMs: 0 },
): ClassifyResult => ({
  assigned: new Map(),
  usedModel: false,
  fallbackReason: reason,
  elapsedMs,
  fallbackKind: kind,
  ...call,
});

/** id → 분류 이름. 분류 이름은 부서가 정한 목록 + 기타로 제한된다 (enum) */
function assignSchema(rows: readonly MergeRow[], categories: readonly string[]) {
  return {
    type: 'object',
    properties: {
      assign: {
        type: 'object',
        properties: Object.fromEntries(
          rows.map((r) => [String(r.id), { type: 'string', enum: [...categories, OTHER] }]),
        ),
        required: rows.map((r) => String(r.id)),
      },
    },
    required: ['assign'],
  };
}

const SYSTEM = '너는 한국 공공연구기관의 업무 분류를 돕는다. 판단만 하고 글자는 만들지 않는다. JSON만 출력한다.';

function buildPrompt(rows: readonly MergeRow[], categories: readonly string[], guidance: string): string {
  const payload = rows.map((r) => ({ id: r.id, content: r.content }));
  return [
    '다음 업무 행들을 부서가 정한 분류 중 하나로 나눠라.',
    '',
    `분류: ${categories.join(', ')}, ${OTHER}`,
    '',
    '규칙:',
    '- 각 id를 정확히 하나의 분류에 넣는다.',
    `- 위 분류에 맞지 않으면 "${OTHER}"로 보낸다. 새 분류를 만들지 마라.`,
    '- 내용을 바꾸거나 요약하지 마라. id와 분류 이름만 다룬다.',
    ...(guidance ? ['', '부서 담당자가 정한 지침:', guidance] : []),
    '',
    JSON.stringify(payload, null, 1),
    '',
    `JSON만 출력: {"assign":{"1":"${categories[0] ?? OTHER}","2":"${OTHER}"}}`,
  ].join('\n');
}

/**
 * 분류 실행. 실패하면 빈 결과를 돌려주고, 호출자는 원래 순서를 그대로 쓴다 —
 * 정렬이 안 되는 건 불편이지만, 병합이 안 되는 건 사고다.
 */
export async function classifyRows(
  rows: readonly MergeRow[],
  categories: readonly string[],
  guidance = '',
  // HM-52 · HM-57 — 모델 문을 지나서 부르고, 실행 예산이 다 되면 부르지 않는다 (model.ts와 같은 길)
  opts: { budget?: MergeBudget | null; label?: string } = {},
): Promise<ClassifyResult> {
  if (categories.length === 0) return empty('분류가 설정되지 않았습니다');
  if (!env.MERGE_MODEL) return empty(MODEL_NOT_CONFIGURED);
  if (rows.length === 0) return empty('분류할 행이 없습니다');
  if (rows.length > env.MERGE_MODEL_MAX_ROWS) {
    return empty(`행이 너무 많습니다 (${rows.length} > ${env.MERGE_MODEL_MAX_ROWS})`);
  }

  const started = Date.now();
  const reply = await callModel({
    label: opts.label ?? '분류',
    budget: opts.budget,
    body: {
      system: SYSTEM,
      prompt: buildPrompt(rows, categories, guidance),
      format: assignSchema(rows, categories), // 분류 이름까지 enum으로 강제
      options: { temperature: 0, num_ctx: 8192 },
    },
  });
  const call = { attempts: reply.attempts, waitedMs: reply.waitedMs };
  if (!reply.ok) return empty(reply.reason, Date.now() - started, reply.kind, call);
  const text = reply.text;

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as { assign?: Record<string, unknown> };
    if (!parsed.assign || typeof parsed.assign !== 'object') {
      return empty('assign 객체가 없습니다', Date.now() - started, 'invalid', call);
    }
    raw = parsed.assign;
  } catch {
    return empty('모델이 JSON을 내지 않았습니다', Date.now() - started, 'invalid', call);
  }

  // 모르는 분류·없는 id는 **조용히 버린다**. 여기서 전체를 폐기하지 않는 이유:
  // 분류는 정렬에만 쓰이고, 빠진 행은 기타로 가면 그만이라 손실이 없다.
  const valid = new Set(categories);
  const known = new Set(rows.map((r) => r.id));
  const assigned = new Map<number, string>();
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !known.has(id)) continue;
    const name = String(value).trim();
    assigned.set(id, valid.has(name) ? name : OTHER);
  }

  return { assigned, usedModel: true, fallbackReason: null, elapsedMs: Date.now() - started, fallbackKind: null, ...call };
}

