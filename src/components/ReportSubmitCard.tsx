'use client';
// RU-30 — 실·팀(또는 본부)의 결과를 위로 **보낸다** (TACP-21).
//
// 보내는 것은 그 순간의 사본이다(RU-02). 그래서 「보낸 뒤 병합본이 바뀌었다」를 반드시 보여 준다 —
// 고쳤는데 위에는 옛 판이 가 있는 상태가 가장 조용하고 가장 나쁜 실수다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ReportStateView {
  level: 'unit' | 'hq';
  targetLabel: string;
  current: { id: string; submittedAtKst: string; submittedBy: string; origin: string } | null;
  hasOutput: boolean;
  changedSinceSubmit: boolean;
}

export function ReportSubmitCard({ state, isoKey }: { state: ReportStateView; isoKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const target = state.targetLabel === '총괄' ? '총괄(기획조정실)' : state.targetLabel;
  const what = state.level === 'hq' ? '본부본' : '병합본';

  const call = async (init: RequestInit, url = '/api/rollup/report') => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(url, init);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '처리하지 못했습니다.');
      else router.refresh();
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
    } finally {
      setBusy(false);
      setConfirmWithdraw(false);
    }
  };
  const submit = () =>
    call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: state.level, isoKey }) });
  const withdraw = () => state.current && call({ method: 'DELETE' }, `/api/rollup/report?id=${state.current.id}`);

  const sent = state.current;
  return (
    <section className={`card mt-6 px-6 py-5 ${sent && !state.changedSinceSubmit ? 'border-success/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {sent ? (
              <>
                <span aria-hidden className="mr-1.5 text-success">
                  ✓
                </span>
                {target}에 제출했습니다
              </>
            ) : (
              `${target}에 제출`
            )}
          </h2>
          <p className="mt-1 text-sm text-body">
            {sent
              ? `${sent.submittedAtKst} · ${sent.submittedBy}${sent.origin === 'import' ? ' · 지난 자료 적재' : ''}`
              : state.hasOutput
                ? `검토가 끝나면 제출하세요. 그 순간의 ${what}이 ${target}에 갑니다.`
                : `${what}이 생기면 제출할 수 있습니다.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sent && <a href={`/api/rollup/report/${sent.id}`} className="btn-secondary btn-sm">보낸 것 받기</a>}
          {(!sent || state.changedSinceSubmit) && (
            <button onClick={submit} disabled={busy || !state.hasOutput} className="btn-primary btn-sm">
              {busy ? '제출 중…' : sent ? '다시 제출' : `${target}에 제출`}
            </button>
          )}
        </div>
      </div>

      {sent && state.changedSinceSubmit && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
          제출한 뒤 {what}이 바뀌었습니다 — <strong>다시 제출해야</strong> 바뀐 내용이 {target}에 갑니다. 지금은 앞서 낸 판이 가 있습니다.
        </p>
      )}
      {sent && (
        <div className="mt-3 text-xs text-muted">
          {confirmWithdraw ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-body">제출을 취소할까요? {target}에서 「미제출」로 보입니다.</span>
              <button onClick={withdraw} disabled={busy} className="btn-secondary btn-sm">
                제출 취소
              </button>
              <button onClick={() => setConfirmWithdraw(false)} className="underline">
                아니오
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmWithdraw(true)} className="underline">
              제출 취소
            </button>
          )}
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
    </section>
  );
}
