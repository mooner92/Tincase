// `/org/board` — 큰 화면 (RU-33 · TACP-21). 운영회의 화면에 띄워 둔다.
//
// 멀리서 읽혀야 한다: 글자는 크게, 낱말은 적게, 색은 셋(도착·진행·대기)뿐.
// 한 줄 = 한 본부(또는 본부 밖 단위). 왼쪽에서 오른쪽으로 실·팀 → 본부 → 전사가 흐른다.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { canRunOrgRollup } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AutoRefresh } from '@/components/AutoRefresh';
import { orgBoard } from '@/server/rollup/run';
import { rollupSlot } from '@/server/rollup/slot';
import { divisionStatus } from '@/server/worklog';
import { kst } from '@/server/rollup/view';

export const dynamic = 'force-dynamic';

type Tone = 'done' | 'doing' | 'idle';
// 밝은 바탕에 상태 색 셋만. 바탕을 브랜드색으로 꽉 채우면 상태 색이 묻힌다 (2026-10-07 피드백)
const tile: Record<Tone, string> = {
  done: 'border-[#9db8f5] bg-[#e9f0ff] text-[#1e3a8a]',
  doing: 'border-[#efc98a] bg-[#fff4e0] text-[#7a4a00]',
  idle: 'border-hairline-soft bg-surface-strong text-muted',
};

function Stage({ tone, title, sub }: { tone: Tone; title: string; sub?: string | null }) {
  return (
    <div className={`flex min-h-[4.25rem] flex-col justify-center rounded-2xl border px-4 py-2 ${tile[tone]}`}>
      <span className="text-[1.25rem] font-bold leading-tight">{title}</span>
      {sub && <span className="mt-0.5 text-sm font-medium opacity-80">{sub}</span>}
    </div>
  );
}

export default async function OrgBoardPage({ searchParams }: { searchParams: Promise<{ isoKey?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!canRunOrgRollup(ps.scope.user)) notFound();
  const sp = await searchParams;
  const slot = await rollupSlot(sp.isoKey ?? null);
  const board = await orgBoard(slot);

  // 사람 단위 진행 — 실·팀마다 몇 명 중 몇 명이 냈나
  const people = new Map<string, { roster: number; submitted: number }>();
  for (const n of board.nodes) {
    for (const u of n.units) {
      const s = await divisionStatus(u.division.id, slot.id);
      people.set(u.division.id, { roster: s.summary.roster, submitted: Math.min(s.summary.submitted, s.summary.roster) });
    }
  }
  const allUnits = board.nodes.flatMap((n) => n.units);
  const sumRoster = [...people.values()].reduce((a, p) => a + p.roster, 0);
  const sumSent = [...people.values()].reduce((a, p) => a + p.submitted, 0);
  const unitsSent = allUnits.filter((u) => u.report).length;
  const arrived = board.nodes.filter((n) => n.ready).length;
  const final = board.lastRun?.status === 'succeeded' ? board.lastRun : null;

  return (
    <main className="min-h-screen bg-surface-soft px-10 py-6 text-ink">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-lg font-medium text-muted">Tincase · 전사 주간업무 취합</p>
          <h1 className="mt-1 text-5xl font-bold tracking-tight">
            {slot.year}년 {slot.label}
          </h1>
        </div>
        <div className="text-right text-base text-muted">
          <AutoRefresh seconds={30} />
          <div className="mt-1">
            <Link href={`/org${sp.isoKey ? `?isoKey=${sp.isoKey}` : ''}`} className="underline decoration-hairline">
              작업 화면으로
            </Link>
          </div>
        </div>
      </header>

      {/* 한 줄 요약 — 회의실 뒷줄에서도 읽히는 숫자 넷 */}
      <section className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { k: '개인 제출', v: `${sumSent}/${sumRoster}`, s: '명', hi: false },
          { k: '실·팀 제출', v: `${unitsSent}/${allUnits.length}`, s: '곳', hi: false },
          { k: '총괄 도착', v: `${arrived}/${board.nodes.length}`, s: '곳', hi: false },
          { k: '전사본', v: final ? '준비됨' : '대기', s: final ? kst(final.finishedAt) ?? '' : '', hi: !!final },
        ].map((m) => (
          <div key={m.k} className={`rounded-2xl border bg-white px-6 py-4 ${m.hi ? 'border-[#9db8f5] ring-2 ring-[#e9f0ff]' : 'border-hairline-soft'}`}>
            <p className="text-base text-muted">{m.k}</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">
              {m.v}
              <span className="ml-2 text-lg font-medium text-muted">{m.s}</span>
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6 space-y-2">
        <div className="grid grid-cols-[17rem_1fr_13rem] gap-4 px-2 text-sm font-medium tracking-wide text-muted">
          <span>본부</span>
          <span className="flex flex-wrap items-center gap-x-4">
            실·팀
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#5b82e0]" />제출·도착</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#e3a640]" />진행 중</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#c8c8c8]" />대기</span>
          </span>
          <span>총괄</span>
        </div>
        {board.nodes.map((n) => {
          const sentUnits = n.units.filter((u) => u.report).length;
          const nodeTone: Tone = n.ready ? 'done' : sentUnits > 0 || n.units.some((u) => u.merged) ? 'doing' : 'idle';
          return (
            <div key={n.node.id} className="grid grid-cols-[17rem_1fr_13rem] items-stretch gap-4 rounded-3xl border border-hairline-soft bg-white p-2">
              <div className="flex items-center px-3 text-[1.6rem] font-bold leading-snug break-keep">{n.node.nameKo}</div>
              <div className="flex flex-wrap items-stretch gap-3">
                {n.units.map((u) => {
                  const p = people.get(u.division.id);
                  const tone: Tone = u.report ? 'done' : u.merged || (p && p.submitted > 0) ? 'doing' : 'idle';
                  const label = u.report ? `제출 ${kst(u.report.submittedAt)?.slice(6)}` : u.merged ? '병합됨' : p ? `${p.submitted}/${p.roster}명` : '';
                  return <Stage key={u.division.id} tone={tone} title={u.division.nameKo} sub={label} />;
                })}
              </div>
              <Stage
                tone={nodeTone}
                title={n.ready ? '도착' : n.hasHqStep ? '본부 취합 중' : '대기'}
                sub={
                  n.hasHqStep
                    ? n.hqReport
                      ? `본부 제출 ${kst(n.hqReport.submittedAt)?.slice(6)}`
                      : `실·팀 ${sentUnits}/${n.units.length}`
                    : n.units[0]?.report
                      ? '바로 제출'
                      : null
                }
              />
            </div>
          );
        })}
      </section>

      {board.offline.length > 0 && (
        <p className="mt-5 text-lg text-muted">Tincase 밖(취합게시판): {board.offline.map((d) => d.nameKo).join(' · ')}</p>
      )}
    </main>
  );
}
