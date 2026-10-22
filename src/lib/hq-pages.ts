// RH-123 — 본부본 분량 어림(§6 안 A). 주간 1쪽 · 월간 2쪽(국토환경 취합 규칙 · 양식의 「1페이지 이내」 안내).
// 줄 수로 어림한다 — 한글의 실제 줄바꿈·자간 조절과 조금 다르다. 막지 않고 보여 주기만 한다.
// 계수: 2026-10-22 국토 양식(칸 배분 RH-41)으로 표 크기를 바꿔 가며 만든 본부본 15벌을 LibreOffice로 그려 잰 값(pt) — 10월 3주 실제 판
// (0.98쪽)·생활 시험 판(1.04쪽)과 맞춰 봄. 다른 본부 양식도 같은 6칸 표라 같은 계수를 쓴다.
import type { HqFormData, HqItem, HqTask } from './hwp/hq-form';

/** 본문 한 쪽 높이 — 위 85pt부터 아래 770pt */
const PAGE = 685;
/** 제목 · 자문회의 표(본부 + 실 셋) · 표 제목 셋 · 머리 줄 셋 */
const BASE = 321;
/** 자문회의 줄이 넷보다 많거나 적을 때 한 줄 */
const CONSULT_ROW = 16;
/** 평가 실적 표(환경평가본부) */
const EVALUATION = 92;
const LINE = 14.5;
const ROW = { task: 12.7, item: 18.5, note: 15.5 } as const;
/** 칸에 들어가는 글자(한글 한 자 = 1) */
const CAP = { title: 34, content: 23, date: 6, place: 10, people: 13, note: 21 } as const;

/** 글자 너비 어림 — 한글 1 · 영문·숫자 0.55 · 띄어쓰기 0.3 */
function units(s: string): number {
  let n = 0;
  for (const ch of s) n += ch === ' ' ? 0.3 : /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
  return n;
}

export function linesOf(text: string, cap: number): number {
  const parts = text.split(/\r?\n/);
  return Math.max(1, parts.reduce((a, p) => a + Math.max(1, Math.ceil(units(p.trim()) / cap)), 0));
}

const itemLines = (it: HqItem) => Math.max(linesOf(it.content, CAP.content), linesOf(it.date, CAP.date), linesOf(it.place, CAP.place), linesOf(it.people, CAP.people));
const taskLines = (t: HqTask) => Math.max(linesOf(t.title, CAP.title), linesOf(t.owner, CAP.people));
const noteLines = (it: HqItem) => Math.max(linesOf(it.content, CAP.note), linesOf(it.date, CAP.date), linesOf(it.place, CAP.place), linesOf(it.people, CAP.people));

function tableHeight(tasks: readonly HqTask[]): number {
  if (tasks.length === 0) return ROW.item; // 빈 표의 「-」 줄
  let h = 0;
  for (const t of tasks) {
    h += ROW.task + LINE * (taskLines(t) - 1);
    for (const it of t.items) h += ROW.item + LINE * (itemLines(it) - 1);
  }
  return h;
}

export interface PageOptions {
  /** 양식의 자문회의 줄 수(본부 + 실) — 데이터의 줄(채운 줄만)이 아니다. 기본 4(국토) */
  consultRows?: number;
}

/** 본문 높이(pt) 어림 */
export function estimateHeight(d: HqFormData, opts: PageOptions = {}): number {
  const consultRows = opts.consultRows ?? 4;
  const notes = d.notes.length === 0 ? ROW.note : d.notes.reduce((a, it) => a + ROW.note + LINE * (noteLines(it) - 1), 0);
  return (
    BASE +
    CONSULT_ROW * (Math.max(consultRows, 1) - 4) +
    (d.evaluation?.length ? EVALUATION : 0) +
    tableHeight(d.results) +
    tableHeight(d.plans) +
    notes
  );
}

/** 쪽 수 어림(소수 한 자리로 보인다). 표 줄은 쪽을 넘어 쪼개지지 않아 넘을 때마다 조금 더 든다 — 어림이라 따로 두지 않는다 */
export function estimatePages(d: HqFormData, opts: PageOptions = {}): number {
  return estimateHeight(d, opts) / PAGE;
}

/** 이 주의 기준 — 주간 1쪽 · 월간 2쪽 */
export function pageLimit(monthly: boolean): number {
  return monthly ? 2 : 1;
}
