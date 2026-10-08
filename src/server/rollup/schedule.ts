// RU-50·51 — 3단계 기한. **그 주의 기준 시각 하나**에서 계산한다.
//
// 총괄이 연휴 공지로 부서 마감을 옮기면(WS-19) 실·팀 → 본부 → 총괄의 기한과 알림이 같은 간격으로 따라간다 —
// 단계마다 따로 시각을 적어 두면 옮길 때 하나를 빠뜨린다 (2026-10-07 요청).
import type { WeekSlot } from '@prisma/client';
import { weekAnchor } from '../slot-deadline';
import { formatDeadlineKo, toKstIso } from '@/lib/week';
import { loadOrgSetting } from './tree';

export interface StageTimes {
  /** 그 주 부서 마감 중 가장 이른 것 */
  anchor: Date;
  /** 실·팀 → 위로 제출 기한 */
  unitDue: Date;
  /** 본부 → 총괄 제출 기한 */
  hqDue: Date;
}

/** 순수 — 기준 시각 + 간격 → 단계 시각 */
export function stagesFrom(anchor: Date, s: { unitDueMinutes: number; hqDueMinutes: number }): StageTimes {
  return {
    anchor,
    unitDue: new Date(anchor.getTime() + s.unitDueMinutes * 60_000),
    hqDue: new Date(anchor.getTime() + s.hqDueMinutes * 60_000),
  };
}

/** 「전사」 머리글 주차 줄의 단계 기한 (KST ISO + 글자) */
export interface StageCells {
  unitDue: string;
  unitDueKo: string;
  hqDue: string;
  hqDueKo: string;
}

/**
 * WS-19l · RU-58 — 「전사」 머리글 주차 한 줄(과 마감 바꾸기 미리보기 한 줄)에 붙이는 단계 기한. 순수 — 기준 시각(그 주 부서 마감)에서 센다.
 *
 * 부서 마감과 **같은 날이면 시각만** 적는다. 대개 같은 날 한두 시간 뒤라 날짜를 세 번 되풀이하면
 * 정작 달라지는 숫자(시각)가 묻힌다. 날이 넘어가면(「다음 날 같은 시각」) 날짜까지 적는다 — 그때는 날짜가 정보다.
 */
export function stageCells(anchor: Date, s: { unitDueMinutes: number; hqDueMinutes: number }): StageCells {
  const t = stagesFrom(anchor, s);
  const day = (d: Date) => toKstIso(d).slice(0, 10);
  const ko = (d: Date) => (day(d) === day(anchor) ? toKstIso(d).slice(11, 16) : formatDeadlineKo(d));
  return { unitDue: toKstIso(t.unitDue), unitDueKo: ko(t.unitDue), hqDue: toKstIso(t.hqDue), hqDueKo: ko(t.hqDue) };
}

export async function stageTimes(slot: WeekSlot): Promise<StageTimes & { enabled: boolean; unitDueMinutes: number; hqDueMinutes: number }> {
  const setting = await loadOrgSetting();
  return {
    ...stagesFrom(await weekAnchor(slot), setting),
    enabled: setting.enabled,
    unitDueMinutes: setting.unitDueMinutes,
    hqDueMinutes: setting.hqDueMinutes,
  };
}

/** RU-52 — 3단계를 쓰는가. 꺼져 있으면 카드·메뉴·알림이 나타나지 않는다 */
export async function rollupEnabled(): Promise<boolean> {
  return (await loadOrgSetting()).enabled;
}
