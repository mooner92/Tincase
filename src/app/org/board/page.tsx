// `/org/board` — 큰 화면 (RU-33·65 · TACP-21). 운영회의 화면에 띄워 둔다.
//
// 한 칸 = 최종본의 한 섹션(13개, 최종본 순서). 멀리서 읽혀야 한다: 글자는 크게, 낱말은 적게, 색은 셋.
// 파랑 = 총괄에 도착(Tincase 제출·올린 파일) · 주황 = 진행 중(사람들이 내는 중·본부 취합 중) · 회색 = 대기.
// 바탕은 밝게 — 브랜드색으로 꽉 채우면 상태 색이 묻힌다 (2026-10-07 피드백).
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePageScope } from '@/server/page-scope';
import { canOpenOrgDesk } from '@/server/authz';
import { noticeFor } from '@/components/Notice';
import { AutoRefresh } from '@/components/AutoRefresh';
import { rollupSlot } from '@/server/rollup/slot';
import { divisionStatus } from '@/server/worklog';
import { kst } from '@/server/rollup/view';
import { loadTree } from '@/server/rollup/tree';
import { resolveSections } from '@/server/rollup/sections';
import { lastOrgRun } from '@/server/rollup/orgrun';
import { latestReview } from '@/server/merge/review';

export const dynamic = 'force-dynamic';

type Tone = 'done' | 'doing' | 'idle';
const tile: Record<Tone, string> = {
  done: 'border-[#9db8f5] bg-[#e9f0ff]',
  doing: 'border-[#efc98a] bg-[#fff4e0]',
  idle: 'border-hairline-soft bg-white',
};
const pill: Record<Tone, string> = {
  done: 'bg-[#1e3a8a] text-white',
  doing: 'bg-[#b26a00] text-white',
  idle: 'bg-surface-strong text-muted',
};

export default async function OrgBoardPage({ searchParams }: { searchParams: Promise<{ isoKey?: string }> }) {
  const ps = await requirePageScope();
  if (!ps.ok) return noticeFor(ps.code, ps.message);
  if (!(await canOpenOrgDesk(ps.scope))) notFound(); // TACP-5 · RU-52 — /org와 같은 게이트
  const sp = await searchParams;
  const slot = await rollupSlot(sp.isoKey ?? null);
  const tree = await loadTree();
  const sources = await resolveSections(slot, tree);
  const run = await lastOrgRun(slot, sources);

  // 섹션마다: 그 섹션을 쓰는 Tincase 부서(본부 섹션이면 실제로 쓰는 실)의 사람 진행·승인
  const rows: { id: string; title: string; tone: Tone; status: string; sub: string }[] = [];
  let roster = 0;
  let sent = 0;
  for (const s of sources) {
    const node = s.section.divisionId
      ? tree.nodes.find((n) => n.node.id === s.section.divisionId || n.contributors.some((c) => c.id === s.section.divisionId))
      : undefined;
    const writer = node
      ? (node.contributors.find((c) => c.id === s.section.divisionId) ?? (node.contributors.length === 1 ? node.contributors[0] : undefined))
      : undefined;
    let people: { roster: number; submitted: number } | null = null;
    let approved = false;
    if (writer) {
      const st = await divisionStatus(writer.id, slot.id);
      people = { roster: st.summary.roster, submitted: Math.min(st.summary.submitted, st.summary.roster) };
      roster += people.roster;
      sent += people.submitted;
      const rv = await latestReview(writer.id, slot.id);
      approved = !!rv && !rv.changedAfter;
    }
    const arrived = s.kind === 'tincase' || s.kind === 'upload';
    const tone: Tone = arrived ? 'done' : s.kind === 'waiting_hq' || (people && people.submitted > 0) ? 'doing' : 'idle';
    const status = arrived ? '도착' : s.kind === 'waiting_hq' ? '본부 취합 중' : people && people.submitted > 0 ? '작성 중' : '대기';
    const sub = [
      s.kind === 'upload' ? '게시판 파일' : s.kind === 'tincase' ? 'Tincase' : node ? null : 'Tincase 밖',
      people ? `${people.submitted}/${people.roster}명` : null,
      approved ? '부서장 승인' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    rows.push({ id: s.section.id, title: s.section.title, tone, status, sub });
  }
  const arrivedCount = sources.filter((s) => s.kind === 'tincase' || s.kind === 'upload').length;
  const final = run?.status === 'succeeded' ? run : null;
  const half = Math.ceil(rows.length / 2);

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

      <section className="mt-5 grid grid-cols-3 gap-4">
        {[
          { k: '개인 제출 (Tincase)', v: `${sent}/${roster}`, s: '명', hi: false },
          { k: '섹션 도착', v: `${arrivedCount}/${sources.length}`, s: '곳', hi: false },
          {
            k: '전사 취합본',
            v: final ? (final.stale ? '다시 만들기' : '준비됨') : '대기',
            s: final ? (kst(final.finishedAt) ?? '') : '',
            hi: !!final && !final.stale,
          },
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

      <div className="mt-4 flex items-center gap-5 px-1 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#1e3a8a]" />
          도착
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#b26a00]" />
          진행 중
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-[#c8c8c8]" />
          대기
        </span>
        <span className="ml-auto">위에서 아래로 최종본 순서</span>
      </div>

      {/* 13섹션 — 두 단, 왼쪽 단 위에서 아래로 이어 오른쪽 단 */}
      <section className="mt-2 grid grid-cols-2 gap-x-4">
        {[rows.slice(0, half), rows.slice(half)].map((col, c) => (
          <div key={c} className="space-y-2">
            {col.map((r, i) => (
              <div key={r.id} className={`flex items-center gap-4 rounded-2xl border px-5 py-2.5 ${tile[r.tone]}`}>
                <span className="w-7 text-right text-xl font-semibold tabular-nums text-muted">{c * half + i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[1.45rem] font-bold leading-tight">{r.title}</p>
                  {r.sub && <p className="mt-0.5 truncate text-base text-muted">{r.sub}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-4 py-1.5 text-lg font-semibold ${pill[r.tone]}`}>{r.status}</span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}
