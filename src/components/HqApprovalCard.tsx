'use client';
// RU-55 — 본부장 승인. 누르는 순간 본부 담당자에게 「승인 완료」가 간다
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
  return (
    <section className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4 text-sm">
      {approval ? (
        <>
          <span className={approval.changedAfter ? 'font-semibold text-warning' : 'font-semibold text-success'}>
            {approval.changedAfter ? '승인 뒤 다시 이어 붙임' : '✓ 본부장 승인 완료'}
          </span>
          <span className="text-ink">{approval.by}</span>
          <span className="text-muted">{approval.atKst}</span>
        </>
      ) : (
        <span className="text-muted">본부장 승인 전 — 본부본을 받아 검토한 뒤 본부장이 [승인]을 누르면 담당자에게 알림이 갑니다</span>
      )}
      {canApprove && !done && (
        <button onClick={approve} disabled={busy} className="btn-primary btn-sm ml-auto">
          {busy ? '승인 중…' : '검토 완료 · 승인'}
        </button>
      )}
      {err && <p className="w-full rounded-lg bg-error-soft px-3 py-2 text-error">{err}</p>}
    </section>
  );
}
