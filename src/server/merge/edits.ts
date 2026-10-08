// HM-49 — 사람이 고친 병합본은 **말없이 덮지 않는다.**
//
// 병합본 수정 저장(API-50)은 그 실행의 파일을 덮어쓰고, 새 병합도 주차마다 같은 경로에 쓴다.
// 그래서 다시 병합하면 고친 내용은 어디에도 남지 않는다. 덮기 전에 반드시 보이려면
// 「누가 몇 곳을 고쳤나」가 그 실행에 남아 있어야 한다 — 이 파일이 그것을 쓰고 읽는다.
//
// 기록은 `MergeRun.reviewJson.edits`에 둔다. 새 열을 만들지 않은 이유: 이 정보를 읽는 곳이 검토 화면·
// 병합 재실행·스케줄러뿐이고(HM-26 검토 정보와 같은 무리), 배포 때 스키마를 바꾸지 않아도 된다.
import type { MergeRun } from '@prisma/client';
import { prisma } from '../db';
import { toKstIso } from '@/lib/week';

/**
 * 저장한 사람의 역할 (authz `unitEditorRole`). `operator` — 그 부서의 lead·head가 아닌 운영자(§3.2 「수정 — write(자기 부서)」).
 * 2026-10-08 전의 기록에는 `head`·`lead`뿐이다(그때는 운영자도 `lead`로 적혔다 — 가려낼 수 없으니 그대로 lead로 읽는다).
 */
export type EditorRole = 'head' | 'lead' | 'operator';

/**
 * 저장 한 번. `places`는 그 저장에서 바뀐 곳 수 (HM-47과 같은 비교).
 * `places: 0`인 줄도 있다(2026-10-08 결정 b) — 바뀐 곳은 없지만 바이트가 바뀐 저장, 또는 lead가 운영자의 판을 그대로 받아들인 저장.
 * 「누가 마지막으로 이 파일을 썼나」를 남기려는 것이라 HM-49의 「고친 곳」 셈(`editEntries`)에는 들지 않는다.
 */
export interface EditEntry {
  by: string;
  role: EditorRole;
  at: string;
  places: number;
}

/** 화면·409 응답·알림이 같이 쓰는 요약 */
export interface MergeEdits {
  /** 저장마다 센 바뀐 곳의 합 — 같은 줄을 두 번 고치면 두 번 센다 (덮이면 사라지는 수고의 크기) */
  places: number;
  saves: number;
  /** 고친 사람 — 「홍길동 실장」, 담당자는 이름만. 처음 고친 순서 */
  by: string[];
  /** 마지막 저장 시각 「10-08 14:12」 */
  lastAtKst: string;
}

function parse(reviewJson: string | null): Record<string, unknown> {
  if (!reviewJson) return {};
  try {
    const v = JSON.parse(reviewJson) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function editEntries(reviewJson: string | null): EditEntry[] {
  const list = parse(reviewJson).edits;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is EditEntry => !!e && typeof e === 'object' && typeof (e as EditEntry).places === 'number' && (e as EditEntry).places > 0,
  );
}

/**
 * RU-71 (2026-10-08 결정 b) — 이 실행의 파일을 **마지막으로 쓴 사람**. 병합 뒤 아무도 저장하지 않았으면 null(파일 = 병합 결과).
 * `places: 0`인 줄까지 본다 — HM-49와 달리 「얼마나 고쳤나」가 아니라 「누구의 판인가」를 묻는다.
 */
export function lastEditor(reviewJson: string | null): EditEntry | null {
  const list = parse(reviewJson).edits;
  if (!Array.isArray(list)) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i] as Partial<EditEntry> | null;
    if (e && typeof e === 'object' && typeof e.role === 'string') return e as EditEntry;
  }
  return null;
}

/**
 * RU-71 · TACP-23 v1.7.2 — 부서장 없는 단위에서 이 판이 **그 단위의 결론**인가. 병합 결과(마지막 저장 없음)이거나 그 단위의
 * lead(·head)가 마지막으로 저장했으면 참. 운영자가 마지막으로 고친 판은 그 단위의 결정이 아니다(TACP-3 「문서는 부서가」) —
 * 다음 병합이나 lead의 저장이 그때의 판을 올린다.
 */
export function decidesForUnit(last: Pick<EditEntry, 'role'> | null): boolean {
  return !last || last.role === 'lead' || last.role === 'head';
}

/** 이 실행을 사람이 고쳤나. 고친 기록이 없으면 null */
export function editsOf(run: Pick<MergeRun, 'reviewJson'>): MergeEdits | null {
  const list = editEntries(run.reviewJson);
  if (list.length === 0) return null;
  const by: string[] = [];
  for (const e of list) if (e.by && !by.includes(e.by)) by.push(e.by);
  const last = list[list.length - 1];
  const lastAt = new Date(last.at);
  return {
    places: list.reduce((n, e) => n + e.places, 0),
    saves: list.length,
    by,
    lastAtKst: Number.isNaN(lastAt.getTime()) ? '' : toKstIso(lastAt).slice(5, 16).replace('T', ' '),
  };
}

/** 저장 한 번을 덧붙인 `reviewJson`. 병합이 남긴 나머지(작성자·묶음)는 그대로 둔다 */
export function withEdit(reviewJson: string | null, entry: EditEntry): string {
  const obj = parse(reviewJson);
  const list = Array.isArray(obj.edits) ? (obj.edits as unknown[]) : [];
  return JSON.stringify({ ...obj, edits: [...list, entry] });
}

/** 그 주차의 **가장 최근 성공 실행**과 그 실행의 고친 기록. 다시 병합하면 덮이는 것이 바로 이 파일이다 */
export async function latestEdits(
  divisionId: string,
  weekSlotId: string,
): Promise<{ run: MergeRun; edits: MergeEdits | null } | null> {
  const run = await prisma.mergeRun.findFirst({
    where: { divisionId, weekSlotId, status: 'succeeded', outputPath: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  return run ? { run, edits: editsOf(run) } : null;
}

/** 409 문구 — 화면이 확인 창을 띄우기 전에도 이 한 줄로 무슨 일인지 알 수 있게 */
export function editedMessage(e: MergeEdits): string {
  const who = e.by.length ? ` (${e.by.join(', ')})` : '';
  return `병합본에 사람이 고친 곳이 ${e.places}곳 있어요${who}. 다시 병합하면 고친 내용이 사라져요.`;
}
