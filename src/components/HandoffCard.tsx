'use client';
// RU-80 — 실·팀 수합 관리의 **「위로」 상태 카드** (2026-10-08 · ADR-0015 — 예전 [본부에 제출] 카드를 대신한다).
//
// 버튼이 아니라 **상태**다. 부서장의 승인이 곧 위로 가는 제출이므로 담당자가 누를 것은 없다 — 알아야 할 것은
// 「지금 어디까지 갔나」: 칩 하나 + 한 줄(상태 · 받는 곳 · 기한 · 올라간 시각과 승인한 사람) + 행방 한 줄.
// 버튼은 하나도 없고, 담당자에게만 기한 15분 전부터 승인 전·승인 뒤 바뀜일 때 글자 링크 「부서장 승인 없이 올리기」(RU-77).
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface HandoffCardView {
  target: string;
  toHq: boolean;
  dueKo: string;
  hasHead: boolean;
  state: 'U0' | 'U1' | 'U2' | 'U3' | 'U4' | 'Uf' | 'H0' | 'H1' | 'H2' | 'Hf';
  sent: { id: string; atKst: string; basis: string; by: string } | null;
  trail: { hqArrivedKst: string | null; hqApprovedKst: string | null; orgArrivedKst: string | null } | null;
  escape: { open: boolean; opensAtKst: string } | null;
}

const CHIP: Record<HandoffCardView['state'], { cls: string; word: string; dot?: boolean }> = {
  U0: { cls: 'chip-muted', word: '받는 중' },
  U1: { cls: 'chip-muted', word: '부서장 승인 전' },
  U2: { cls: 'chip-ok', word: '올라감', dot: true },
  U3: { cls: 'chip-warn', word: '승인 뒤 바뀜' },
  U4: { cls: 'chip-warn', word: '승인 없이 올라감', dot: true },
  Uf: { cls: 'chip-muted', word: '병합본 없음' },
  H0: { cls: 'chip-muted', word: '받는 중' },
  H1: { cls: 'chip-ok', word: '올라감', dot: true },
  H2: { cls: 'chip-warn', word: '운영자 수정 · 안 올라감' },
  Hf: { cls: 'chip-muted', word: '병합본 없음' },
};

/** 상태 한 줄 (12 §2a 실·팀 상태 기계의 화면 문구) */
function line(v: HandoffCardView): ReactNode {
  const due = <strong className="font-semibold text-ink">{v.dueKo}까지</strong>;
  switch (v.state) {
    case 'U0':
      return <>마감 뒤 병합본을 부서장이 승인하면 바로 {v.target}에 올라갑니다 · {due}</>;
    case 'U1':
      return <>부서장이 승인하면 바로 {v.target}에 올라갑니다 · {due}</>;
    case 'U2':
      return <>{v.target}에 올라감 {v.sent?.atKst} · {v.sent?.by}</>;
    case 'U3':
      return (
        <span className="text-warning">
          승인 뒤 바뀜 — 부서장이 다시 승인하면 올라갑니다. 지금 {v.target}에는 {v.sent?.atKst}에{' '}
          {v.sent?.basis === 'unapproved' ? '승인 없이 올린' : '승인한'} 판이 있습니다 · {due}
        </span>
      );
    case 'U4':
      return (
        <span className="text-warning">
          부서장 승인 없이 올라감 {v.sent?.atKst} · {v.sent?.by} — 부서장이 승인하면 승인한 판이 대신합니다
        </span>
      );
    case 'H0':
      return <>마감 뒤 병합본이 저절로 {v.target}에 올라갑니다 — 이 부서는 부서장 승인 단계가 없습니다</>;
    case 'H1':
      return <>{v.target}에 올라감 {v.sent?.atKst} · 자동(부서장 없음) — 고쳐 저장하면 다시 올라갑니다</>;
    case 'H2':
      // 결정 b — 운영자의 저장은 이 부서의 결론이 아니라 올라가지 않는다. 담당자가 할 일(확인해 저장 · 다시 병합)을 그대로 말한다
      return (
        <span className="text-warning">
          운영자가 고친 판은 아직 올라가지 않았어요 — 담당자가 확인해 저장하거나 다시 병합하면 올라갑니다
          {v.sent ? ` · 지금 ${v.target}에는 ${v.sent.atKst} 판` : ''}
        </span>
      );
    default:
      return <>아직 마감 뒤 병합본이 없습니다 — 위 병합본 카드에서 [지금 병합]을 눌러 주세요 · {due}</>;
  }
}

/** RU-80 — 행방 한 줄, 시각만 (TACP-21 v1.7) */
function trailLine(v: HandoffCardView): string | null {
  const t = v.trail;
  if (!t) return null;
  if (!v.toHq) return t.orgArrivedKst ? `총괄 도착 ${t.orgArrivedKst}` : null;
  return [
    t.hqArrivedKst && `${v.target} 도착 ${t.hqArrivedKst}`,
    t.hqApprovedKst ? `본부장 승인 ${t.hqApprovedKst}` : t.hqArrivedKst ? '본부장 승인 전' : null,
    t.orgArrivedKst && `총괄 도착 ${t.orgArrivedKst}`,
  ]
    .filter(Boolean)
    .join(' → ');
}

export function HandoffCard({ view, isoKey }: { view: HandoffCardView; isoKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const chip = CHIP[view.state];
  const trail = trailLine(view);

  const escapeNow = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'unit', isoKey, withoutApproval: true }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '올리지 못했습니다.');
      else router.refresh();
    } catch {
      setErr('네트워크 오류로 올리지 못했습니다.');
    } finally {
      setBusy(false);
      setAsk(false);
    }
  };

  return (
    <section data-guide="report-unit" className="card" aria-labelledby="handoff-card">
      <div className="card-head">
        <div className="min-w-0">
          <h2 id="handoff-card" className="card-title">
            {view.target}에 올라가는 병합본
          </h2>
          <p data-guide="report-unit-submit" className="card-desc">
            {line(view)}
          </p>
          {trail && <p className="mt-1 text-xs text-muted">{trail}</p>}
        </div>
        <span className={`chip ${chip.cls}`}>
          {chip.dot && <span aria-hidden className="dot" />}
          {chip.word}
        </span>
      </div>

      {/* RU-77 — 비상구. 승인할 사람이 자리에 없는 날의 길이다 — 기한 15분 전부터, 글자 링크로, 누르면 한 번 더 묻는다 */}
      {view.escape?.open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {ask ? (
            <>
              <span className="text-body">부서장 승인 없이 {view.target}에 올립니다 — 위에서는 주황으로 보입니다.</span>
              <button onClick={escapeNow} disabled={busy} className="btn-secondary btn-sm">
                {busy ? '올리는 중…' : '승인 없이 올리기'}
              </button>
              <button onClick={() => setAsk(false)} className="btn-ghost">
                아니오
              </button>
            </>
          ) : (
            <button onClick={() => setAsk(true)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              부서장 승인 없이 올리기
            </button>
          )}
        </div>
      )}
      {err && <p className="callout callout-error mt-4">{err}</p>}
    </section>
  );
}
