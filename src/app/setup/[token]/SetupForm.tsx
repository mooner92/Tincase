'use client';
// AU-30 — 설정 폼. 정책 위반은 **보내기 전에** 알려 준다 (서버도 다시 본다).
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

export function SetupForm({ token, email }: { token: string; email: string }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) {
      setErr('두 번 입력한 비밀번호가 다릅니다.');
      return;
    }
    setBusy(true);
    setErr(null);
    fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pw }),
    })
      .then(async (r) => {
        if (r.ok) setDone(true);
        else setErr(((await r.json()) as { message?: string }).message ?? '설정하지 못했습니다.');
      })
      .catch(() => setErr('네트워크 오류로 설정하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  if (done) {
    return (
      <div className="text-center">
        <p className="text-sm text-body">
          <strong className="font-semibold text-ink">비밀번호가 설정되었습니다.</strong>
          <br />
          아이디는 <span className="font-medium text-ink">{email}</span> 입니다.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 밖 페이지 */}
        <a href="/login" className="btn-primary mt-6 w-full">
          로그인하기
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* 아이디는 **보여만 준다.** 물어볼 이유가 없다 — 링크가 이미 누구인지 알고 있다 */}
      <p className="text-center text-sm text-muted">
        아이디 <span className="font-medium text-ink">{email}</span>
      </p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoComplete="new-password"
        required
        placeholder={`새 비밀번호 (${PASSWORD_MIN_LENGTH}자 이상)`}
        className="w-full rounded-lg border border-border-strong px-3.5 py-2.5 text-sm focus:border-ink focus:outline-none"
      />
      <input
        type="password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        autoComplete="new-password"
        required
        placeholder="한 번 더"
        className="w-full rounded-lg border border-border-strong px-3.5 py-2.5 text-sm focus:border-ink focus:outline-none"
      />
      {err && <p className="text-sm text-error">{err}</p>}
      <button type="submit" disabled={busy || !pw || !pw2} className="btn-primary w-full">
        {busy ? '설정 중…' : '비밀번호 설정'}
      </button>
    </form>
  );
}
