'use client';
// RU-55 — 본부장 승인. 누르는 순간 본부 담당자에게 「승인 완료」가 간다.
// 본부본 카드(RunCard)의 아래 구역으로 그린다 — 혼자 카드가 아니다
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function HqApprovalCard({
  isoKey,
  approval,
  canApprove,
}: {
  isoKey: string;
  approval: { by: string; atKst: string; changedAfter: boolean } | null;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/hq/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isoKey }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '승인하지 못했습니다.');
      else router.refresh();
    } catch {
      setErr('네트워크 오류로 승인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const done = approval && !approval.changedAfter;
  // 본부본 카드(RunCard)의 한 구역이다 — 승인은 따로 카드를 세울 만큼 긴 일이 아니다 (CP-97)
  return (
    <div data-guide="hq-approval" className="card-section flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="font-semibold text-ink">본부장 승인</span>
      {approval ? (
        <>
          <span className={`chip ${approval.changedAfter ? 'chip-warn' : 'chip-ok'}`}>
            {approval.changedAfter ? '승인 뒤 다시 이어 붙임' : '승인 완료'}
          </span>
          <span className="text-ink">{approval.by}</span>
          <span className="text-muted">{approval.atKst}</span>
        </>
      ) : (
        <span className="text-muted">아직 — 본부본을 받아 검토한 뒤 본부장이 [승인]을 누르면 담당자에게 알림이 갑니다</span>
      )}
      {canApprove && !done && (
        <button data-guide="hq-approve" onClick={approve} disabled={busy} className="btn-primary btn-sm sm:ml-auto">
          {busy ? '승인 중…' : '검토 완료 · 승인'}
        </button>
      )}
      {err && <p className="callout callout-error w-full">{err}</p>}
    </div>
  );
}
