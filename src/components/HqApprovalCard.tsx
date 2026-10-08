'use client';
// RU-55 · RU-82 — 본부장 승인 = **총괄로 제출**. 본부본 카드(RunCard)의 아래 구역 둘로 그린다 — 혼자 카드가 아니다(CP-97):
//   본부장 승인   상태 · 누가 · 언제, 본부장에게 [검토 완료 · 승인](주 버튼 — 화면이 그린 판의 runId·sha를 싣는다)
//   총괄          지금 총괄에 가 있는 것 — 승인 · 총괄로 감 / 주황 「승인 뒤 바뀜」 / 주황 「본부장 승인 없이」
// 2026-10-08(ADR-0015) 전에는 승인 뒤에 본부 담당자가 [총괄에 제출]을 눌렀다. 이제 승인이 곧 제출이라 그 버튼과 알림이 없다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type HqStateView = 'Q0' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Qf';

export function HqApprovalCard({
  isoKey,
  state,
  approval,
  viewed,
  canApprove,
  hasHead,
  missing,
  hqReport,
  escape,
}: {
  isoKey: string;
  state: HqStateView;
  approval: { by: string; atKst: string; changedAfter: boolean } | null;
  /** RU-55 — 화면이 그린 본부본의 판. 승인은 이 판에만 붙는다(다르면 409) */
  viewed: { runId: string; sha256: string } | null;
  /** 본부의 head에게만 (requireHqReviewer와 같은 판정) */
  canApprove: boolean;
  hasHead: boolean;
  /** 아직 안 올라온 산하 — 일부만 모인 본부본을 승인하면 뒤에 다시 승인해야 한다(§12 Q11) */
  missing: string[];
  /** 지금 총괄에 가 있는 본부본 */
  hqReport: { atKst: string; basis: string; by: string } | null;
  /** RU-77 — 본부 lead의 비상구 「본부장 승인 없이 총괄로」. 창이 열렸을 때만 그린다 */
  escape: { open: boolean; opensAtKst: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmEscape, setConfirmEscape] = useState(false);

  const post = async (url: string, body: unknown, done: (b: Record<string, unknown>) => string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const b = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) setErr((b.message as string) ?? '처리하지 못했습니다.');
      else {
        setNote(done(b));
        router.refresh();
      }
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
    } finally {
      setBusy(false);
      setConfirmEscape(false);
    }
  };
  const approve = () =>
    post('/api/rollup/hq/approve', { isoKey, ...viewed }, (b) => (b.unchanged ? '이미 승인한 판입니다' : '승인했어요 — 총괄로 갔어요'));
  const escapeNow = () =>
    post('/api/rollup/report', { level: 'hq', isoKey, withoutApproval: true }, () => '본부장 승인 없이 총괄로 올렸어요 — 총괄에는 주황으로 보입니다');

  const awaiting = state === 'Q1' || state === 'Q3' || state === 'Q4';
  const showApprove = canApprove && hasHead && awaiting && !!viewed;

  return (
    <>
      <div data-guide="hq-approval" className="card-section flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="font-semibold text-ink">본부장 승인</span>
        {!hasHead ? (
          <span className="text-muted">본부장 승인 단계가 없는 본부입니다 — 본부본이 저절로 총괄에 올라갑니다</span>
        ) : approval ? (
          <>
            <span className={`chip ${approval.changedAfter ? 'chip-warn' : 'chip-ok'}`}>{approval.changedAfter ? '승인 뒤 바뀜' : '승인 완료'}</span>
            <span className="text-ink">{approval.by}</span>
            <span className="text-muted">{approval.atKst}</span>
          </>
        ) : (
          <span className="text-muted">아직 — 검토하고 승인하면 바로 총괄로 갑니다</span>
        )}
        {showApprove && (
          <button data-guide="hq-approve" onClick={approve} disabled={busy} className="btn-primary btn-sm sm:ml-auto">
            {busy ? '승인 중…' : '검토 완료 · 승인'}
          </button>
        )}
        {/* §12 Q11 — 일부만 모인 본부본도 승인할 수 있다. 늦게 온 단위가 붙으면 승인이 풀린다는 것을 누르기 전에 */}
        {showApprove && missing.length > 0 && (
          <p className="w-full text-xs text-muted">
            아직 {missing.join('·')} 미제출 — 승인 뒤에 올라오면 본부본이 다시 이어 붙어 다시 승인해야 합니다
          </p>
        )}
      </div>

      {/* RU-82 — 총괄에 지금 무엇이 가 있나. 승인이 곧 제출이라 버튼이 없다 */}
      {(hqReport || awaiting) && (
        <div data-guide="report-hq" className="card-section text-sm">
          <p data-guide="report-hq-submit" className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-ink">총괄</span>
            {state === 'Q2' && hqReport ? (
              <>
                <span className="chip chip-ok">
                  <span aria-hidden className="dot" />
                  {hqReport.basis === 'no_head' ? '자동으로 감' : '승인 · 총괄로 감'}
                </span>
                <span className="text-muted">{hqReport.atKst}</span>
              </>
            ) : state === 'Q3' && hqReport ? (
              <span className="text-warning">
                승인 뒤 본부본이 바뀌었어요 — 총괄에는 {hqReport.atKst}에 {hqReport.basis === 'unapproved' ? '승인 없이 올린' : '승인한'} 판이 있어요
              </span>
            ) : state === 'Q4' && hqReport ? (
              <span className="text-warning">
                본부장 승인 없이 총괄로 감 · {hqReport.atKst} · {hqReport.by}
              </span>
            ) : (
              <span className="text-muted">본부장 승인을 기다려요 — 승인하면 바로 총괄로 갑니다</span>
            )}
          </p>
          {/* RU-77 — 비상구. 기한 15분 전부터 본부 lead에게만, 글자 링크로. 누르면 그 자리에서 한 번 더 묻는다 */}
          {escape?.open && (state === 'Q1' || state === 'Q3') && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {confirmEscape ? (
                <>
                  <span className="text-body">본부장 승인 없이 총괄에 올립니다 — 총괄에는 주황으로 보입니다.</span>
                  <button onClick={escapeNow} disabled={busy} className="btn-secondary btn-sm">
                    승인 없이 올리기
                  </button>
                  <button onClick={() => setConfirmEscape(false)} className="btn-ghost">
                    아니오
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirmEscape(true)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                  본부장 승인 없이 총괄로
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {(err || note) && (
        <div className="card-section">
          {err ? <p className="callout callout-error">{err}</p> : <p className="text-sm font-medium text-success">{note}</p>}
        </div>
      )}
    </>
  );
}
