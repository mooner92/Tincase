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
        <label htmlFor="email" className="mb-1 block text-xs font-medium text-body">
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
          className="w-full rounded-xl border border-hairline px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-body">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {busy ? '로그인 중…' : '로그인'}
      </button>
      {/*
        AU-32 — 예전에는 「운영자에게 요청하세요」였다. 그러면 운영자가 매번 불려 다니고,
        급할 때 자리에 없으면 그날은 못 들어온다. 본인이 바로 받게 한다.
      */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 밖 페이지 */}
      <a
        href="/forgot"
        className="block text-center text-xs text-muted underline underline-offset-2 hover:text-ink"
      >
        비밀번호를 잊으셨나요? 메신저로 재설정 링크 받기
      </a>
    </form>
  );
}
