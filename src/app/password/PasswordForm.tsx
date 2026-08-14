'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PasswordForm({ first, hasPassword }: { first: boolean; hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('새 비밀번호가 서로 다릅니다.');
      return;
    }
    setBusy(true);
    setError(null);
    fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
      .then(async (r) => {
        const b = await r.json();
        if (r.ok) {
          router.replace('/');
          router.refresh();
        } else {
          setError(b.message ?? '변경에 실패했습니다.');
        }
      })
      .catch(() => setError('네트워크 오류입니다.'))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {hasPassword && (
        <div>
          <label htmlFor="cur" className="mb-1 block text-xs font-medium text-body">
            {first ? '발급받은 임시 비밀번호' : '현재 비밀번호'}
          </label>
          <input
            id="cur"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-xl border border-hairline px-3 py-2 text-sm"
          />
        </div>
      )}
      <div>
        <label htmlFor="new" className="mb-1 block text-xs font-medium text-body">
          새 비밀번호 <span className="font-normal text-muted-soft">(10자 이상)</span>
        </label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="w-full rounded-xl border border-hairline px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-xs font-medium text-body">
          새 비밀번호 확인
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl border border-hairline px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <p aria-live="polite" className="rounded-xl bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-active disabled:opacity-50"
      >
        {busy ? '변경 중…' : '비밀번호 변경'}
      </button>
      <p className="text-center text-xs text-muted-soft">변경하면 다른 기기의 로그인은 모두 해제됩니다.</p>
    </form>
  );
}
