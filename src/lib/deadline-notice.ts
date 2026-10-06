// WS-19 — 기획조정실 공지 본문에서 **대외 마감**을 읽는다.
//
// 총괄은 공지를 이미 이렇게 쓴다:
//   ★ 이번 주 주간업무 제출 기한은 10월 07(수) 오후 3시입니다. ★
//   (연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)
// 그 본문을 그대로 붙여넣으면 날짜·시각·이유를 꺼낸다. 다시 입력하게 하면 그 사이에 오타가 끼고,
// 오타는 그대로 전 부서의 마감이 된다.
//
// 순수 함수다 — 화면(미리보기)과 서버(적용)가 같은 해석을 쓴다.
import { TZDate } from '@date-fns/tz';
import { KST } from './week';

export type NoticeParse =
  | {
      ok: true;
      /** 공지가 말하는 시각 — 대외 마감 */
      external: Date;
      /** 부서 마감 = 대외 마감 − 1시간 (WS-18) */
      department: Date;
      /** 「연휴 일정으로」 등. 공지에 없으면 「기획조정실 공지에 따라」 */
      reason: string;
      /** 어디를 읽었는지 — 미리보기에 그대로 보여 준다 */
      matched: string;
      /** 「오전/오후」 없이 1~7시라 오후로 읽었다 (WS-19e) */
      assumedPm: boolean;
    }
  | { ok: false; error: string };

/** 부서 마감은 대외 마감보다 이만큼 앞선다 (WS-18 — 2026-09-22에 한 시간이 틀렸던 그 규칙) */
export const DEPARTMENT_LEAD_MINUTES = 60;

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DEFAULT_REASON = '기획조정실 공지에 따라';

/*
 * 날짜 + 시각. 공백은 어디에나 들어갈 수 있다.
 *   10월 07(수) 오후 3시 · 9월 23일(수) 14:00 · 10월 7일 수요일 오후 3시 30분 · 10/7(수) 15시
 */
const DATE = String.raw`(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일?|(\d{1,2})\s*[./]\s*(\d{1,2}))`;
const WEEKDAY = String.raw`(?:\s*\(\s*([월화수목금토일])\s*\)|\s*([월화수목금토일])요일)?`;
const TIME = String.raw`\s*(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?:\s*(\d{1,2})\s*분|\s*(반))?)`;
const PATTERN = new RegExp(DATE + WEEKDAY + TIME);

export function parseDeadlineNotice(text: string, now: Date = new Date()): NoticeParse {
  const src = text.replace(/\r/g, '');
  if (!src.trim()) return { ok: false, error: '붙여넣은 내용이 없습니다.' };

  // WS-19a — 「제출 기한」·「마감」이 든 줄을 먼저 본다. 공지에는 다른 날짜(요청일 등)도 섞인다
  const lines = src.split('\n');
  const preferred = lines.filter((l) => /기한|마감/.test(l));
  let m: RegExpExecArray | null = null;
  for (const l of [...preferred, ...lines]) {
    m = PATTERN.exec(l);
    if (m) break;
  }
  if (!m) {
    return { ok: false, error: '날짜와 시각을 찾지 못했습니다. 「10월 7(수) 오후 3시」 꼴로 적혀 있는지 확인해 주세요.' };
  }

  const month = Number(m[1] ?? m[3]);
  const day = Number(m[2] ?? m[4]);
  const weekday = m[5] ?? m[6] ?? null;
  const ampm = m[7] ?? null;
  let hour = Number(m[8]);
  const minute = m[9] ? Number(m[9]) : m[10] ? Number(m[10]) : m[11] ? 30 : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, error: `날짜가 이상합니다: ${m[0].trim()}` };
  if (minute > 59) return { ok: false, error: `시각이 이상합니다: ${m[0].trim()}` };

  // WS-19e — 「오후」가 빠진 「3시」는 오후다. 업무 마감이 새벽 3시일 리는 없다
  let assumedPm = false;
  if (ampm === '오후' && hour < 12) hour += 12;
  else if (ampm === '오전' && hour === 12) hour = 0;
  else if (!ampm && hour >= 1 && hour <= 7) {
    hour += 12;
    assumedPm = true;
  }
  if (hour > 23) return { ok: false, error: `시각이 이상합니다: ${m[0].trim()}` };

  // WS-19c — 연도는 공지에 없다. 오늘에서 가장 가까운 해를 고른다 (12월 공지의 1월 마감)
  const thisYear = new TZDate(now.getTime(), KST).getFullYear();
  let best: Date | null = null;
  for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
    const t = new TZDate(y, month - 1, day, hour, minute, 0, 0, KST);
    if (t.getMonth() !== month - 1 || t.getDate() !== day) continue; // 2월 30일 같은 날
    const d = new Date(t.getTime());
    if (!best || Math.abs(d.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = d;
  }
  if (!best) return { ok: false, error: `없는 날짜입니다: ${month}월 ${day}일` };

  // WS-19d — 요일이 적혀 있으면 대조한다. 공지의 오타를 전 부서의 마감으로 만들지 않는다
  if (weekday) {
    const real = DOW[new TZDate(best.getTime(), KST).getDay()];
    if (real !== weekday) {
      return {
        ok: false,
        error: `요일이 맞지 않습니다 — ${month}월 ${day}일은 ${real}요일인데 공지에는 「${weekday}」로 적혀 있습니다. 공지를 확인해 주세요.`,
      };
    }
  }

  return {
    ok: true,
    external: best,
    department: new Date(best.getTime() - DEPARTMENT_LEAD_MINUTES * 60_000),
    reason: reasonOf(src),
    matched: m[0].trim(),
    assumedPm,
  };
}

/** WS-19f — 「(연휴 일정으로 인한 …)」에서 「연휴 일정으로」를 꺼낸다 */
export function reasonOf(text: string): string {
  const m = /([가-힣A-Za-z0-9·\s]{1,20}?)\s*(?:으로|로)\s*인한/.exec(text);
  if (m) {
    const core = m[1].replace(/^[\s(]+/, '').trim();
    if (core) return `${core}${/[가-힣]$/.test(core) && hasBatchim(core) ? '으로' : '로'}`;
  }
  if (/연휴|명절|추석|설날|공휴일/.test(text)) return '연휴 일정으로';
  return DEFAULT_REASON;
}

function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
