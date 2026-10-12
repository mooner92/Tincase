// 취합 화면 공통 — 서버 값(날짜)을 화면용 글자로. 화면 부품은 Date를 받지 않는다
import type { WeekSlot } from '@prisma/client';
import { toKstIso, currentWeek } from '@/lib/week';
import type { DeskRow, RunView, StatusChip } from '@/components/RollupDesk';
import type { RunCell, UnitStatus } from './run';
import { rollupWeeks } from './run';

export const kst = (d: Date | null | undefined) => (d ? toKstIso(d).slice(5, 16).replace('T', ' ') : null);

/**
 * RU-82 — 산하 칩. 칩에는 상태와 시각만, 누가(승인한 사람·올린 사람)는 칩 옆에 흐리게 — 칩 하나에 낱말 셋이면 칩이 문장이 된다 (CP-100).
 *   올라옴(승인) · 부서장 없음(자동) · 주황 「부서장 승인 없이」 · 부서장 승인 전 · 미제출
 */
export function chipOf(u: Pick<UnitStatus, 'report' | 'merged' | 'final' | 'hasHead'>): StatusChip {
  const r = u.report;
  if (r) {
    const href = `/api/rollup/report/${r.id}`;
    if (r.origin === 'import') return { kind: 'sent', label: `적재 ${kst(r.submittedAt)}`, href };
    if (r.basis === 'unapproved') return { kind: 'unapproved', label: `부서장 승인 없이 ${kst(r.submittedAt)}`, by: r.submittedBy, href };
    if (r.basis === 'no_head') return { kind: 'nohead', label: `부서장 없음 · 자동 ${kst(r.submittedAt)}`, href };
    if (r.basis === 'approved') return { kind: 'sent', label: `올라옴 ${kst(r.submittedAt)}`, by: r.approvedBy ? `${r.approvedBy} 승인` : undefined, href };
    return { kind: 'sent', label: `제출 ${kst(r.submittedAt)}`, by: r.submittedBy, href }; // v1.7 전의 [제출]
  }
  if (u.final && u.hasHead) return { kind: 'pending', label: '부서장 승인 전' };
  return u.merged ? { kind: 'waiting', label: '미제출' } : { kind: 'waiting', label: '아직 병합 전' };
}

export function unitRow(u: UnitStatus): DeskRow {
  return { id: u.division.id, name: u.division.nameKo, chip: chipOf(u) };
}

export function runView(r: RunCell | null): RunView | null {
  if (!r) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { startedAt, finishedAt, ...rest } = r; // 화면 부품은 Date를 받지 않는다
  return { ...rest, finishedAtKst: kst(finishedAt) };
}

/** 주차 목록 — 이번 주 + 제출 기록이 있는 최근 주차 + 지금 보는 주차 */
export async function weekOptions(selected: WeekSlot, now = new Date()) {
  const current = currentWeek(now).isoKey;
  const list = await rollupWeeks();
  const all = [selected, ...list].filter((s, i, arr) => arr.findIndex((x) => x.isoKey === s.isoKey) === i);
  const opts = all.map((s) => ({ isoKey: s.isoKey, label: s.label, year: s.year, isCurrent: s.isoKey === current }));
  if (!opts.some((o) => o.isCurrent)) {
    const c = currentWeek(now);
    opts.unshift({ isoKey: c.isoKey, label: c.label, year: c.year, isCurrent: true });
  }
  return opts.sort((a, b) => (a.isoKey < b.isoKey ? 1 : -1));
}
