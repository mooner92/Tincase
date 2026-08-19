// S-02 주차 계산. 전부 순수 함수 — DB·서버 TZ에 의존하지 않는다 (WS-07).
// 요구사항 ID: WS-01 ~ WS-13 (docs/spec/02-week-slot.md)
import { TZDate } from '@date-fns/tz';

export const KST = 'Asia/Seoul';

export interface WeekDescriptor {
  year: number; //          2026 (월요일 기준 연도)
  month: number; //         8    (월요일 기준 월, 1-12)
  weekOfMonth: number; //   1..5 (WS-03)
  label: string; //         "8월 2주차" (WS-02)
  isoKey: string; //        "2026-W33" — DB 유니크 키 (WS-09)
  opensAt: Date; //         월 00:00 KST 인스턴트
  /** WS-14 — 이 주에 내는 것이 주간인가 월간인가 */
  kind: WeekKind;
}

export type WeekKind = 'weekly' | 'monthly';

export interface DeadlinePolicy {
  deadlineDow: number; //   1=월 … 7=일 (DM-10)
  deadlineTime: string; //  "HH:mm" KST
}

/** WS-01 — t가 속한 주의 월요일 00:00 KST (인스턴트로 반환) */
export function mondayOf(t: Date): Date {
  const k = new TZDate(t.getTime(), KST);
  const dow = k.getDay(); //                0=일 … 1=월
  const diff = (dow + 6) % 7; //            일요일(0)은 직전 월요일로 6일 회귀
  const m = new TZDate(k.getFullYear(), k.getMonth(), k.getDate() - diff, 0, 0, 0, 0, KST);
  return new Date(m.getTime());
}

/**
 * WS-09 — ISO 주차 키. 실행 TZ와 무관한 순수 달력 산술 (UTC 메서드만 사용).
 * 월요일 (y, m0, d)의 ISO 주 = 그 주 목요일이 속한 연도에서 목요일의 연중 서수를 7로 나눈 몫+1.
 * (ISO 8601: 1주차는 그 해 첫 목요일을 포함하는 주)
 */
function isoWeekKey(y: number, m0: number, d: number): string {
  const thu = new Date(Date.UTC(y, m0, d + 3)); // 월요일 + 3일 = 목요일
  const isoYear = thu.getUTCFullYear();
  const dayOfYear = (thu.getTime() - Date.UTC(isoYear, 0, 1)) / 86400_000 + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * WS-14 — 그 달의 **마지막 주**인가. 마지막 주에 내는 것이 월간 업무일지다.
 *
 * 판정: 이 주의 월요일이 그 달의 **마지막 월요일**인가.
 * 같은 말로 — **그 달의 마지막 날이 이 주에 들어 있는가**. (둘은 항상 일치한다:
 * 마지막 날이 속한 주의 월요일이 곧 그 달 마지막 월요일이다. 달은 최소 28일이라
 * 그 월요일이 전달로 넘어가는 일은 없다.)
 *
 * 주가 다음 달로 넘어가도 **월요일이 있는 달**의 마지막 주다:
 *   2026-06-29(월) ~ 07-05(일) → 6월 30일이 들어 있으므로 **6월** 월간
 *   2026-05-25(월) ~ 05-31(일) → 5월 31일로 딱 끝나므로 **5월** 월간
 *
 * 달력에서 세는 방식 그대로다 — "이번 주에 말일이 있으면 이번이 마지막 주".
 */
export function isMonthlyWeek(monday: Date): boolean {
  const k = new TZDate(monday.getTime(), KST);
  const daysInMonth = new Date(Date.UTC(k.getFullYear(), k.getMonth() + 1, 0)).getUTCDate();
  return k.getDate() + 7 > daysInMonth; // 다음 월요일은 이미 다음 달
}

/** WS-02/03/09/14 — 월요일 인스턴트 → 슬롯 서술자 */
export function describeWeek(monday: Date): WeekDescriptor {
  const k = new TZDate(monday.getTime(), KST);
  const year = k.getFullYear();
  const month = k.getMonth() + 1;
  const weekOfMonth = Math.floor((k.getDate() - 1) / 7) + 1; // WS-03: O(1)
  const isoKey = isoWeekKey(k.getFullYear(), k.getMonth(), k.getDate());
  return {
    year,
    month,
    weekOfMonth,
    // 라벨은 **주차 그대로 둔다**. 마지막 주도 그 달의 N주차인 것은 변함없고,
    // 라벨은 DB에 저장돼 파일명·이력에 남으므로 의미를 덧붙이면 과거 데이터와 갈라진다.
    // "월간이냐"는 kind로 따로 답한다 (WS-15).
    label: `${month}월 ${weekOfMonth}주차`,
    isoKey,
    opensAt: new Date(monday.getTime()),
    kind: isMonthlyWeek(monday) ? 'monthly' : 'weekly',
  };
}

/** WS-15 — 화면에 쓰는 이름. 월간 주에는 "5월 월간"이 제목이고 주차는 부제다 */
export function kindLabel(kind: WeekKind): string {
  return kind === 'monthly' ? '월간 업무일지' : '주간 업무일지';
}

/**
 * WS-16 — 그 달의 월간 주가 시작하는 **월요일**.
 *
 * 화면에 "이번 달은 언제가 월간인지"를 보여줄 때 쓴다. 안내 문구에 특정 연도를
 * 적어두면 해가 바뀌는 순간 낡은 정보가 되므로, 예시도 오늘 날짜에서 만든다.
 */
export function monthlyMondayOf(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return mondayOf(new Date(Date.UTC(year, month - 1, lastDay, -9))); // KST 자정
}

/** 슬롯 레코드(월요일만 알면 된다)에서 바로 판정 — 페이지·API 공용 */
export function slotKind(slot: { opensAt: Date }): WeekKind {
  return isMonthlyWeek(slot.opensAt) ? 'monthly' : 'weekly';
}

/** WS-08 — 지금 기준 현재 슬롯 */
export function currentWeek(now: Date = new Date()): WeekDescriptor {
  return describeWeek(mondayOf(now));
}

/** WS-13 — 슬롯(월요일)과 부서 정책으로 이번 주 유효 마감을 계산 */
export function deadlineFor(slot: { opensAt: Date }, div: DeadlinePolicy): Date {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(div.deadlineTime);
  if (!m) throw new Error(`invalid deadlineTime: ${div.deadlineTime}`);
  if (!Number.isInteger(div.deadlineDow) || div.deadlineDow < 1 || div.deadlineDow > 7) {
    throw new Error(`invalid deadlineDow: ${div.deadlineDow}`);
  }
  const k = new TZDate(slot.opensAt.getTime(), KST); // 월 00:00 KST 벽시계
  const d = new TZDate(
    k.getFullYear(),
    k.getMonth(),
    k.getDate() + (div.deadlineDow - 1),
    Number(m[1]),
    Number(m[2]),
    0,
    0,
    KST,
  );
  return new Date(d.getTime());
}

/**
 * DM-10 — 마감 정책 저장 시점 검증.
 * dow=1 + "00:00"은 마감=개시가 되는 퇴화 정책이므로 거부한다 (WS-13).
 */
export function validateDeadlinePolicy(div: DeadlinePolicy): string | null {
  if (!Number.isInteger(div.deadlineDow) || div.deadlineDow < 1 || div.deadlineDow > 7) {
    return '마감 요일은 1(월)~7(일) 사이여야 합니다';
  }
  if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(div.deadlineTime)) {
    return '마감 시각은 HH:mm 형식이어야 합니다';
  }
  if (div.deadlineDow === 1 && div.deadlineTime === '00:00') {
    return '마감이 주 시작(월 00:00)과 같을 수 없습니다';
  }
  return null;
}

/** WS-06 — 잠금 판정. 정각까지는 허용 (`>` 비교, WS-T14) */
export function isLocked(slot: { opensAt: Date }, div: DeadlinePolicy, now: Date = new Date()): boolean {
  return now.getTime() > deadlineFor(slot, div).getTime();
}

/** 남은 시간(ms). 음수면 마감 지남 */
export function msUntilDeadline(deadline: Date, now: Date = new Date()): number {
  return deadline.getTime() - now.getTime();
}

/**
 * WS-17 — 제출 시각 표시. **오늘인지 아닌지가 먼저 보여야 한다.**
 *
 *   오늘   `16:26`        — 기본값이라 굳이 날짜를 붙이지 않는다
 *   어제   `어제 10:24`
 *   그 외  `8/17 10:24`
 *
 * 시각만 찍으면 어제 낸 것과 오늘 낸 것이 구별되지 않는다. 주차 단위 화면이라
 * 목록에 며칠치가 섞이는데, 담당자는 "오늘 들어온 게 몇 건인가"를 본다.
 * 그렇다고 전부 `8/18 16:26`으로 쓰면 좁은 목록에서 시각이 묻힌다 — 그래서 셋으로 나눈다.
 */
export function formatSubmittedKo(at: Date, now: Date = new Date()): string {
  const k = new TZDate(at.getTime(), KST);
  const n = new TZDate(now.getTime(), KST);
  const hhmm = `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;

  // 날짜 차이는 **달력 날짜**로 센다 — 24시간 차이가 아니다 (23시 제출 → 다음날 01시면 '어제')
  const day = (d: TZDate) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((day(n) - day(k)) / 86400_000);

  if (diff === 0) return hhmm;
  if (diff === 1) return `어제 ${hhmm}`;
  return `${k.getMonth() + 1}/${k.getDate()} ${hhmm}`;
}

/** 표시용: KST 기준 "8월 11일(화) 14:00" */
export function formatDeadlineKo(deadline: Date): string {
  const k = new TZDate(deadline.getTime(), KST);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const hh = String(k.getHours()).padStart(2, '0');
  const mm = String(k.getMinutes()).padStart(2, '0');
  return `${k.getMonth() + 1}월 ${k.getDate()}일(${dayNames[k.getDay()]}) ${hh}:${mm}`;
}

/** ISO+09:00 직렬화 (API-04) — 클라이언트 재계산 방지 */
export function toKstIso(d: Date): string {
  const k = new TZDate(d.getTime(), KST);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${k.getFullYear()}-${p(k.getMonth() + 1)}-${p(k.getDate())}` +
    `T${p(k.getHours())}:${p(k.getMinutes())}:${p(k.getSeconds())}+09:00`
  );
}
