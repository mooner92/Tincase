// RH-73 — 연구실 작성 화면의 일자 칩. 실적은 이번 주차, 계획은 다음 주의 월~금.
// 칩 하나 = 하루 · 이어진 날 = 기간 · 떨어진 날 = 쉼표. 찍히는 모양은 제출본에서 가장 흔한 것(§1-2 — 64개 중 56개가 「10/16」).

const DAY = 86_400_000;
const KST = 9 * 3_600_000;
const NAMES = ['월', '화', '수', '목', '금'];

export interface DayChip {
  /** 「10/16」 */
  md: string;
  /** 「목」 */
  dow: string;
  /** 정렬·이어짐 판정용 — 그 날 0시(KST)의 epoch ms */
  ms: number;
}

/** `weekStartMs`(그 주 월요일 0시 KST)부터 `weeksAhead` 주 뒤의 월~금 */
export function weekDayChips(weekStartMs: number, weeksAhead = 0): DayChip[] {
  return NAMES.map((dow, i) => {
    const ms = weekStartMs + (weeksAhead * 7 + i) * DAY;
    const d = new Date(ms + KST);
    return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, dow, ms };
  });
}

/** 고른 칩들을 글자로 — 하루 `10/16` · 이어진 날 `10/12~14`(달이 바뀌면 `9/30~10/2`) · 떨어진 날 `10/12, 10/14` */
export function formatDays(chosen: readonly DayChip[]): string {
  const days = [...chosen].sort((a, b) => a.ms - b.ms);
  if (days.length === 0) return '';
  const contiguous = days.every((d, i) => i === 0 || d.ms - days[i - 1].ms === DAY);
  if (days.length === 1) return days[0].md;
  if (contiguous) {
    const [m1] = days[0].md.split('/');
    const [m2, d2] = days[days.length - 1].md.split('/');
    return `${days[0].md}~${m1 === m2 ? d2 : `${m2}/${d2}`}`;
  }
  return days.map((d) => d.md).join(', ');
}

/** 글자를 칩으로 되돌린다 — 다시 열었을 때 칩을 켜 두려고. 칩으로 만들 수 없는 글자(「10월 중」)면 null */
export function parseDays(text: string, chips: readonly DayChip[]): DayChip[] | null {
  const t = text.replace(/\s+/g, '');
  if (!t) return [];
  const byMd = new Map(chips.map((c) => [c.md, c]));
  const range = /^(\d{1,2})\/(\d{1,2})[~\-](?:(\d{1,2})\/)?(\d{1,2})$/.exec(t);
  if (range) {
    const from = byMd.get(`${Number(range[1])}/${Number(range[2])}`);
    const to = byMd.get(`${Number(range[3] ?? range[1])}/${Number(range[4])}`);
    if (!from || !to || to.ms < from.ms) return null;
    return chips.filter((c) => c.ms >= from.ms && c.ms <= to.ms);
  }
  const parts = t.split(',');
  const out: DayChip[] = [];
  for (const p of parts) {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(p);
    const c = m ? byMd.get(`${Number(m[1])}/${Number(m[2])}`) : undefined;
    if (!c) return null;
    out.push(c);
  }
  return out;
}
