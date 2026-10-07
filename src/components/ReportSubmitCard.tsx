'use client';
// RU-30 — 실·팀(또는 본부)의 결과를 위로 **보낸다** (TACP-21).
//
// 보내는 것은 그 순간의 사본이다(RU-02). 그래서 「보낸 뒤 병합본이 바뀌었다」를 반드시 보여 준다 —
// 고쳤는데 위에는 옛 판이 가 있는 상태가 가장 조용하고 가장 나쁜 실수다.
import { Fragment, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface ReportStateView {
  level: 'unit' | 'hq';
  targetLabel: string;
  current: { id: string; submittedAtKst: string; submittedBy: string; origin: string } | null;
  hasOutput: boolean;
  changedSinceSubmit: boolean;
  /** RU-30 — 이 단위가 지킬 기한 (「15:00」). 실·팀 담당자에게는 이 카드가 기한을 보는 유일한 곳이다 */
  dueKo?: string;
}

export function ReportSubmitCard({
  state,
  isoKey,
  primary = true,
  bare = false,
  headApproval = null,
}: {
  state: ReportStateView;
  isoKey: string;
  /**
   * RU-30 — 부서장이 있는 부서에서 지금 병합본이 아직 승인 전(`pending`)이거나 승인 뒤 바뀌었나(`changed`).
   * 그러면 같은 줄에 그렇게 쓰고 [제출]은 보조로 물러난다(CP-99) — 급한 담당자가 승인 전에 보내고,
   * 실장이 고치면 「제출 뒤 바뀜」으로 다시 내야 했다. 부서장이 없는 부서·이미 승인한 판이면 null
   */
  headApproval?: 'pending' | 'changed' | null;
  /**
   * CP-99 — 이 화면의 주 버튼인가. 부서장이 승인할 판이 남아 있으면 그 화면의 주 버튼은 [승인]이라
   * 여기는 보조로 물러난다 — 한 화면에 초록 버튼이 둘이면 어느 것을 먼저 누를지 모른다
   */
  primary?: boolean;
  /** 다른 카드(본부본)의 아래 구역으로 그린다 — 카드 안에 카드를 넣지 않는다 (CP-97) */
  bare?: boolean;
}) {
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
  const needsSubmit = !sent || state.changedSinceSubmit;
  const approvalWord = headApproval === 'pending' ? '부서장 승인 전' : headApproval === 'changed' ? '부서장 승인 뒤 바뀜' : null;
  // 설명 한 줄 — 낸 것(시각·누가) · 아직 할 일이 있으면 기한과 부서장 승인 상태 · 안 냈으면 무엇이 가는지
  const desc: ReactNode[] = [
    ...(sent ? [`${sent.submittedAtKst} · ${sent.submittedBy}${sent.origin === 'import' ? ' · 지난 자료 적재' : ''}`] : []),
    ...(needsSubmit && state.dueKo
      ? [
          <strong key="due" className="font-semibold text-ink">
            {state.dueKo}까지{sent ? ' 다시 제출' : ''}
          </strong>,
        ]
      : []),
    ...(needsSubmit && approvalWord
      ? [
          <span key="approval" className="font-semibold text-warning">
            {approvalWord}
          </span>,
        ]
      : []),
    ...(!sent ? [state.hasOutput ? `검토가 끝나면 제출하세요. 그 순간의 ${what}이 ${target}에 갑니다.` : `${what}이 생기면 제출할 수 있습니다.`] : []),
  ];
  return (
    <section className={bare ? 'card-section' : 'card'} aria-labelledby={`report-${state.level}`}>
      <div className="card-head">
        <div className="min-w-0">
          <h2 id={`report-${state.level}`} className={bare ? 'text-[15px] font-semibold text-ink' : 'card-title'}>
            {target}에 제출
          </h2>
          <p className="card-desc">
            {desc.map((d, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                {d}
              </Fragment>
            ))}
          </p>
        </div>
        {sent ? (
          state.changedSinceSubmit ? (
            <span className="chip chip-warn">제출 뒤 바뀜</span>
          ) : (
            <span className="chip chip-ok">
              <span aria-hidden className="dot" />
              제출함
            </span>
          )
        ) : (
          <span className="chip chip-muted">아직 안 냄</span>
        )}
      </div>

      {sent && state.changedSinceSubmit && (
        <p className="callout callout-warn mt-4">
          제출한 뒤 {what}이 바뀌었습니다 — <strong>다시 제출해야</strong> 바뀐 내용이 {target}에 갑니다. 지금은 앞서 낸 판이 가 있습니다.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {needsSubmit && (
          <button
            onClick={submit}
            disabled={busy || !state.hasOutput}
            className={primary && !approvalWord ? 'btn-primary' : 'btn-secondary'}
          >
            {busy ? '제출 중…' : sent ? '다시 제출' : `${target}에 제출`}
          </button>
        )}
        {sent && (
          <a href={`/api/rollup/report/${sent.id}`} className="btn-ghost">
            보낸 것 받기
          </a>
        )}
        {/* 되돌리는 행동은 글자 링크로, 줄 끝에. 누르면 그 자리에서 한 번 더 묻는다 */}
        {sent &&
          (confirmWithdraw ? (
            <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              <span className="text-body">제출을 취소할까요? {target}에서 「미제출」로 보입니다.</span>
              <button onClick={withdraw} disabled={busy} className="btn-secondary btn-sm">
                제출 취소
              </button>
              <button onClick={() => setConfirmWithdraw(false)} className="btn-ghost">
                아니오
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmWithdraw(true)} className="btn-link-danger ml-auto">
              제출 취소
            </button>
          ))}
      </div>
      {err && <p className="callout callout-error mt-4">{err}</p>}
    </section>
  );
}
