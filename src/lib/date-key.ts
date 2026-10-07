// HM-48 — 일자 칸 → **정렬 키**. 순수 함수 (DB·env·시간대 없음).
//
// ── 왜 필요한가 ─────────────────────────────────────────────
// 실제 최종 취합본을 보면 대부분의 부서가 줄을 **일자 오름차순**으로 놓고, 날짜 없는 줄
// (상시·계속·집계성)은 맨 뒤에 둔다. 담당자가 매주 손으로 하던 일이다.
// 병합이 그걸 하려면 「9/30(목)」「~10/2」「9월 7일」을 같은 축에 올려야 한다.
//
// ── 왜 모델이 아니라 여기서 읽나 ─────────────────────────────
// 날짜는 판단이 아니라 읽기다. 모델은 같은 입력에도 매번 다르게 놓고(HM-24),
// 「왜 이 순서」를 설명하지 못한다. 여기는 같은 칸이면 언제나 같은 키를 낸다.
//
// ── 무엇을 날짜로 보나 ★ ────────────────────────────────────
// 일자 칸의 **첫 날짜 하나**. 기간이면 시작일, 「~10/2」(기한)는 그날, 여러 날이면 첫 날.
// 읽을 수 없으면 **날짜 없음(null)** — 「10월 중」처럼 달만 있는 것도 그렇다.
// 어느 날인지 모르는 줄에 순서를 지어내면, 틀린 자리가 맞는 자리처럼 보인다.

/** 기준 주 — `WeekSlot.year`·`month` (월요일 기준, WS-01) */
export interface WeekRef {
  year: number;
  month: number;
}

export interface FirstDate {
  year: number;
  month: number;
  day: number;
  /** 그날의 시각(분). 안 적었으면 null */
  minutes: number | null;
}

/*
 * 실제 보고서에 나온 꼴만 받는다. 세 갈래를 한 정규식에 두는 이유: **칸에서 먼저 나온 것**이
 * 첫 날짜여야 해서다. 꼴마다 따로 찾으면 「9월 7일, 9/8」에서 뒤의 9/8을 고를 수 있다.
 *
 *   y  — 2026.9.30 · 2026-09-30 · 2026년 9월 30일   (연도를 적었으면 적은 대로)
 *   k  — 9월 7일 · 9월 7~8일                         (「일」이 있어야 날짜 — 「9월 2주차」는 날짜가 아니다)
 *   s  — 9/30 · 8.28 · 8. 28.
 *
 * 앞뒤 `(?<!\d)`·`(?!\d)` — 「26.9.30」에서 「6.9」를 6월 9일로 읽지 않게 한다.
 */
const DATE_RE = new RegExp(
  String.raw`(?<!\d)(?:` +
    String.raw`(?<y>\d{4})\s*(?:[./-]|년)\s*(?<ym>\d{1,2})\s*(?:[./-]|월)\s*(?<yd>\d{1,2})` +
    String.raw`|(?<km>\d{1,2})\s*월\s*(?<kd>\d{1,2})\s*(?:일|(?=[~∼〜–-]\s*\d{1,2}\s*일))` +
    // 「3/4분기」는 날짜가 아니라 분기다 — 3월 4일로 읽으면 없는 순서를 지어낸다
    String.raw`|(?<sm>\d{1,2})\s*[./]\s*(?<sd>\d{1,2})(?!\s*분기)` +
    String.raw`)(?!\d)`,
  'g',
);

/*
 * 날짜 바로 뒤에 올 수 있는 것 — 점 꼴의 끝 점(「8. 28.」)과 요일 괄호. 시각·기간 끝을 읽기 전에 건너뛴다.
 * 끝 점을 안 건너뛰면 「10. 1.(수) 14:00」의 시각과 「1. 2.~12. 31.」의 기간 끝을 놓친다.
 */
const AFTER_DATE = String.raw`^\s*\.?\s*(?:\([^)]*\))?\s*`;

/**
 * 첫 날짜 바로 뒤의 시각 — 「10/1 14:00」 「10/1(수) 오후 2시」 「10/1 14시 30분」.
 * 「2시간」은 길이지 시각이 아니다.
 */
const TIME_RE = new RegExp(
  AFTER_DATE + String.raw`(?:(오전|오후)\s*)?(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)(?:\s*(\d{1,2})\s*분)?)`,
);

/** 첫 날짜가 기간의 시작이면 끝의 달 — 「1/2~12/31」의 12. 연도 넘김 판단에만 쓴다 */
const RANGE_END_RE = new RegExp(
  AFTER_DATE + String.raw`[~∼〜–-]\s*(?:\d{4}\s*(?:[./-]|년)\s*)?(\d{1,2})\s*(?:[./]|월)\s*\d{1,2}`,
);

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * HM-48 연도 넘김 — **12월 주의 1월은 다음 해**, **그 주보다 반년 넘게 뒤의 달은 지난 해.** 그 밖에는 같은 해.
 *
 * 「기준 주에서 가장 가까운 날」로 읽지 않는 이유: 업무일지에는 연초부터 이어진 사업이 흔하다.
 * 8월 주의 「1/10~」을 가장 가까운 날로 읽으면 다음 해 1월이 되어 맨 뒤로 간다.
 * 그래서 **앞으로** 넘기는 것은 해가 바뀌는 한 달(12월 주의 1월)뿐이다 — 계획은 몇 주 앞이다.
 *
 * **뒤로**는 넓게 본다. 1월 주의 「11/30~」, 2월 주의 「12/1~」은 지난해 시작한 사업이다 —
 * 반년도 더 남은 날을 이번 주 업무일지에 적는 일은 드물다. 같은 해로 읽으면 날짜 있는 줄 맨 뒤로 간다.
 *
 * 12월 주의 「1/2~12/31」(연간 사업)은 넘기지 않는다 — 이번 달까지 이어지는 기간은 올해 시작이다.
 */
function yearOf(month: number, week: WeekRef, rangeEndMonth: number | null): number {
  if (week.month === 12 && month === 1 && rangeEndMonth !== 12) return week.year + 1;
  if (month - week.month > 6) return week.year - 1;
  return week.year;
}

function timeAfter(rest: string): number | null {
  const t = TIME_RE.exec(rest);
  if (!t) return null;
  let h = Number(t[2]);
  const min = Number(t[3] ?? t[4] ?? 0);
  if (t[1] === '오후' && h < 12) h += 12;
  if (t[1] === '오전' && h === 12) h = 0; // 오전 12시는 자정이다 — 정오(오후 12시) 뒤로 가면 안 된다
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** 일자 칸의 첫 날짜. 날짜가 없거나 읽을 수 없으면 null */
export function firstDate(cell: string, week: WeekRef): FirstDate | null {
  // 전각 숫자·빗금(U+FF10~FF19, U+FF0F)을 반각으로 — 한글에서 붙여 넣으면 섞여 온다.
  // 글자로 적지 않는 이유: src에는 전각 글자를 두지 않는다 (UI-T90)
  const s = cell.normalize('NFKC');
  const re = new RegExp(DATE_RE.source, 'g');
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const g = m.groups!;
    const month = Number(g.ym ?? g.km ?? g.sm);
    const day = Number(g.yd ?? g.kd ?? g.sd);
    const rest = s.slice(m.index + m[0].length);
    const explicit = g.y === undefined ? null : Number(g.y);
    const rangeEnd = RANGE_END_RE.exec(rest);
    const year = explicit ?? yearOf(month, week, rangeEnd ? Number(rangeEnd[1]) : null);
    if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
      // 없는 날짜(13/1·2/30)는 날짜가 아니다. **한 글자 뒤에서 다시** 찾는다 —
      // 「26.9.30」의 「26.9」가 「9.30」을 삼키지 않게
      re.lastIndex = m.index + 1;
      continue;
    }
    return { year, month, day, minutes: timeAfter(rest) };
  }
  return null;
}

/**
 * 정렬 키 — 작을수록 앞. 날짜가 없으면 null.
 *
 * 같은 날 안에서는 **시각 없는 줄이 먼저**, 그 다음 시각 순이다. 시각 없는 줄을 0시로 두면
 * 「10/1 00:00」과 구별되지 않으므로 시각에는 1을 더한다.
 */
export function dateKey(cell: string, week: WeekRef): number | null {
  const d = firstDate(cell, week);
  if (!d) return null;
  return ((d.year * 100 + d.month) * 100 + d.day) * 10_000 + (d.minutes === null ? 0 : d.minutes + 1);
}
