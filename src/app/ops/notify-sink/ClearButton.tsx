'use client';
// NT-56 — 「비우기」. 두 번 눌러야 지운다 — 리허설 도중 한 번 잘못 누르면 판정할 기록이 통째로 사라진다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ClearButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onClick = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/ops/notify-sink', { method: 'DELETE' });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`);
      setArmed(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-error">{error}</span>}
      <button onClick={onClick} disabled={disabled || busy} className={`btn-secondary btn-sm ${armed ? 'border-error text-error' : ''}`}>
        {busy ? '비우는 중…' : armed ? '한 번 더' : '비우기'}
      </button>
    </span>
  );
}
