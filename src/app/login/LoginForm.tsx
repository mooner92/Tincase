'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
      .then(async (r) => {
        const b = await r.json();
        if (r.ok) {
          // 초기 발급 비밀번호면 변경 화면으로 (AU-22)
          router.replace(b.mustChangePassword ? '/password?first=1' : '/');
          router.refresh();
        } else {
          setError(b.message ?? '로그인에 실패했습니다.');
        }
      })
      .catch(() => setError('네트워크 오류입니다. 다시 시도해 주세요.'))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-600">
          KEI 이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="hong@kei.re.kr"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-600">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <p aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? '로그인 중…' : '로그인'}
      </button>
      <p className="text-center text-xs text-slate-400">
        비밀번호를 모르거나 잊으셨다면 운영자(AI홍보전략실 최명헌)에게 재발급을 요청하세요.
      </p>
    </form>
  );
}
