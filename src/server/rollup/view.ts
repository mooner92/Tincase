// 취합 화면 공통 — 서버 값(날짜)을 화면용 글자로. 화면 부품은 Date를 받지 않는다
import type { WeekSlot } from '@prisma/client';
import { toKstIso, currentWeek } from '@/lib/week';
import type { DeskRow, RunView, StatusChip } from '@/components/RollupDesk';
import type { RunCell, UnitStatus } from './run';
import { rollupWeeks } from './run';

export const kst = (d: Date | null | undefined) => (d ? toKstIso(d).slice(5, 16).replace('T', ' ') : null);

export function chipOf(u: Pick<UnitStatus, 'report' | 'merged'>): StatusChip {
  if (u.report) {
    return {
      kind: 'sent',
      // 칩에는 「제출 시각」만, 낸 사람은 칩 옆에 흐리게 — 칩 하나에 낱말 셋이면 칩이 문장이 된다 (CP-100)
      label: `제출 ${kst(u.report.submittedAt)}`,
      by: `${u.report.submittedBy}${u.report.origin === 'import' ? ' (적재)' : ''}`,
      href: `/api/rollup/report/${u.report.id}`,
    };
  }
  return u.merged ? { kind: 'merged', label: '병합됨 · 미제출' } : { kind: 'waiting', label: '아직 병합 전' };
}

export function unitRow(u: UnitStatus): DeskRow {
  return { id: u.division.id, name: u.division.nameKo, chip: chipOf(u) };
}

export function runView(r: RunCell | null): RunView | null {
  return r ? { ...r, finishedAtKst: kst(r.finishedAt) } : null;
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
