// PG-90 · HM-59f · HM-52c — `/ops` 「병합 줄」 카드 (운영자, TACP-30). 서버가 그린다 — 새 API가 없다(문은 페이지의 운영자 문).
//
// 마감 병합이 줄 하나에 서면서(HM-59) 「지금 어디까지 왔나 · 무엇이 막혔나」를 볼 곳이 필요해졌다 — 예전에는 서버 로그뿐이었다.
// 이번 주 부서마다 한 줄(가장 최근 작업), 줄 순서로. 위에는 이번 주 몇 곳 끝났나 · 예상 끝 · 모델 문(쥔 호출 · 대기 수 · 마지막 데우기).
// 조작([줄에서 빼기] · [멈추기])은 아직 없다(3단계). 문구는 값과 상태뿐이다(PG-65).
import type { WeekSlot } from '@prisma/client';
import { mergeQueueView, type QueueRow } from '@/server/merge/queue';
import { modelGateState } from '@/server/merge/gate';
import { toKstIso } from '@/lib/week';
import { AutoRefresh } from './AutoRefresh';

const hhmm = (d: Date | null) => (d ? toKstIso(d).slice(11, 16) : '—');
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

const TRIGGER_KO: Record<string, string> = { auto: '자동', reopen: '열림 뒤', manual: '수동', model_retry: '2차' };

function statusCell(r: QueueRow, now: Date) {
  switch (r.status) {
    case 'queued':
      return <span className="chip chip-muted">줄 {r.position ?? '?'}번째</span>;
    case 'running':
      return <span className="chip chip-info">병합 중 {r.startedAt ? mmss(now.getTime() - r.startedAt.getTime()) : ''}</span>;
    case 'done':
      return <span className="chip chip-ok">끝</span>;
    case 'cancelled':
      return <span className="chip chip-muted">빠짐</span>;
    default:
      return (
        <span className="chip chip-error" title={r.errorText ?? undefined}>
          실패
        </span>
      );
  }
}

function modelCell(r: QueueRow) {
  if (!r.model) return <span className="text-muted">—</span>;
  const { used, asked, misses } = r.model;
  if (asked === 0) return <span className="text-muted">부르지 않음</span>;
  return (
    <span className={misses.length ? 'text-warning' : 'text-ink'}>
      {used}/{asked}
      {misses.length > 0 && <span className="ml-1.5 text-xs">{misses.map((m) => `${m.table}: ${m.reason}`).join(' · ')}</span>}
    </span>
  );
}

export async function MergeQueueCard({ slot, now = new Date() }: { slot: WeekSlot; now?: Date }) {
  const view = await mergeQueueView(slot.id, now);
  const gate = modelGateState(undefined, now.getTime());
  const active = view.waiting + view.running > 0;

  return (
    <section className="card card-flush" aria-labelledby="merge-queue">
      {/* 대기 · 병합 중인 작업이 있는 동안만 새로 그린다 — 줄이 비면 멈춘다 */}
      {active && <AutoRefresh ms={5000} />}
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="merge-queue" className="card-title">
            병합 줄
          </h2>
          {view.total > 0 && (
            <span className="text-sm text-muted tabular-nums">
              {slot.label} · {view.done}/{view.total} 끝{view.waiting > 0 && ` · 대기 ${view.waiting}`}
              {view.etaAt && ` · 예상 끝 ${hhmm(view.etaAt)}`}
            </span>
          )}
        </div>
        {/* HM-52c — 모델 문. 쥔 호출과 쥔 시간, 줄 선 호출 수, 마지막 데우기 */}
        <p className="mt-1.5 text-sm text-muted">
          {gate.holder ? `모델 사용 중 ${mmss(gate.holder.heldMs)} (${gate.holder.label})` : '모델 쉼'}
          {gate.waiting > 0 && ` · 대기 ${gate.waiting}`}
          {gate.lastWarmup && ` · 데우기 ${hhmm(gate.lastWarmup.at)} ${gate.lastWarmup.ok ? '✓' : '실패'}`}
        </p>
        <div className="h-3" aria-hidden />
      </div>
      {view.rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted sm:px-6">이번 주 병합 없음</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-max min-w-full">
            <thead>
              <tr>
                <th>순번</th>
                <th>부서</th>
                <th>상태</th>
                <th>줄 선 시각</th>
                <th>시작</th>
                <th>끝</th>
                <th>모델</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.jobId}>
                  <td className="tabular-nums text-muted">{r.position ?? ''}</td>
                  <td>
                    <span className="font-medium text-ink">{r.divisionName}</span>
                    <span className="ml-1.5 text-xs text-muted">{TRIGGER_KO[r.trigger] ?? r.trigger}</span>
                  </td>
                  <td>
                    {statusCell(r, now)}
                    {r.status === 'failed' && r.errorText && <span className="ml-1.5 text-xs text-muted">{r.errorText}</span>}
                  </td>
                  <td className="tabular-nums">{hhmm(r.enqueuedAt)}</td>
                  <td className="tabular-nums">{hhmm(r.startedAt)}</td>
                  <td className="tabular-nums">{hhmm(r.finishedAt)}</td>
                  <td>{modelCell(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
