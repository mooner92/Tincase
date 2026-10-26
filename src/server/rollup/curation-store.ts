// RH-120 · RH-124 — 본부 다듬기 저장값(HqCuration) 읽기와 본부본 입력 열쇠의 몫. run.ts(본부본 만들기)와 다듬기 API가 같이 쓴다.
// 이 파일은 run.ts를 읽지 않는다 — run.ts가 이것을 읽는다(서로 부르면 순환).
import type { WeekSlot } from '@prisma/client';
import { prisma } from '../db';
import { curateRulesOf, curationFingerprint, mondayDay, type CurateContext, type SavedCuration } from '@/lib/hq-curate';
import { isMonthlyWeek } from '@/lib/week';

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export interface StoredCuration extends SavedCuration {
  updatedBy: string;
  updatedAt: Date;
}

export async function loadCuration(divisionId: string, weekSlotId: string): Promise<StoredCuration | null> {
  const row = await prisma.hqCuration.findUnique({ where: { divisionId_weekSlotId: { divisionId, weekSlotId } } });
  if (!row) return null;
  return {
    decisions: parseJson<Record<string, boolean>>(row.decisions, {}),
    consult: parseJson<Record<string, string[]>>(row.consult, {}),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export function curateContext(hqNameKo: string, slot: Pick<WeekSlot, 'opensAt'>): CurateContext {
  return { hqNameKo, monday: mondayDay(slot.opensAt), monthly: isMonthlyWeek(slot.opensAt), rules: curateRulesOf(hqNameKo) };
}

/** RH-124 — 본부본 입력 열쇠의 몫. 규칙도 다듬기도 없으면 null — 그때는 열쇠가 다듬기 전과 같다(다른 본부의 판이 다시 만들어지지 않게) */
export async function curationRef(node: { id: string; nameKo: string }, slot: Pick<WeekSlot, 'id'>): Promise<string | null> {
  const saved = await loadCuration(node.id, slot.id);
  return curationFingerprint(saved, curateRulesOf(node.nameKo));
}
