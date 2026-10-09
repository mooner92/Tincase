// ST-19a (2026-10-10) — 부서 양식의 **모양**: 첫 구역(Section0)에 5칸짜리 표 셋(1. 실적 · 2. 계획 · 3. 특이사항).
//
// 웹 작성(`buildWorklogHwp`)과 병합(`composeMergedHwp`)은 **첫 구역의 표를 순번으로** 채운다(writer `locateTables`).
// 읽기(`readWorklog`)는 「표가 둘이면 3번(특이사항)을 지운 것 — 관례상 정상」이라 받아 주는데, 그건 **낸 파일**의 관례다.
// 양식이 그 모양이면 부서 전원의 웹 작성이 500(「3번째 표가 없습니다」)이 되고, 병합은 3번 줄을 경고 한 줄로 버린다
// (2026-10-10 점검에서 실측). 그래서 양식은 받을 때 이 모양을 본다 — 판정은 여기 하나다(등록 검사와 작성 경로가 같이 쓴다).
import type { HwpRecord } from './record';
import { locateTables } from './writer';

/** 양식 표의 칸 수 — 구분 · 업무실적 내용 · 일자 · 장소 · 참석자 (reader `TABLE_COLUMNS`) */
export const WORKLOG_TABLE_COLS = 5;
/** 1. 주요 업무실적 · 2. 주요 업무계획 · 3. 기타 특이사항 */
export const WORKLOG_TABLE_COUNT = 3;

/**
 * 첫 구역 레코드가 업무일지 양식 모양이 아니면 그 이유(짧은 한국어), 맞으면 null.
 * 표가 셋보다 많은 것은 막지 않는다 — 앞의 셋만 채우고 나머지는 그대로 둔다(병합·작성이 원래 그렇게 한다).
 */
export function worklogShapeProblem(section0: readonly HwpRecord[]): string | null {
  const tables = locateTables(section0);
  if (tables.length < WORKLOG_TABLE_COUNT) {
    return `양식에 표 셋(1. 실적 · 2. 계획 · 3. 특이사항)이 모두 있어야 합니다 — 이 파일은 ${tables.length}개입니다.`;
  }
  for (const [i, t] of tables.slice(0, WORKLOG_TABLE_COUNT).entries()) {
    if (t.cols !== WORKLOG_TABLE_COLS) {
      return `${i + 1}번 표가 ${WORKLOG_TABLE_COLS}칸(구분·내용·일자·장소·참석자)이 아닙니다 — ${t.cols}칸입니다.`;
    }
    if (t.rows < 2) return `${i + 1}번 표에 머리행 아래 줄이 없습니다.`;
  }
  return null;
}
