'use client';
// AU-32 — 재설정 요청. **성공·실패를 구분해 보여주지 않는다** (서버도 같은 응답을 준다).
import { useState } from 'react';

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    fetch('/api/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then(async (r) => {
        if (r.ok) setSent(true);
        else setErr(((await r.json()) as { message?: string }).message ?? '요청하지 못했습니다.');
      })
      .catch(() => setErr('네트워크 오류로 요청하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  if (sent) {
    return (
      <div className="text-center">
        {/*
          「보냈습니다」가 아니라 「보냈습니다 — 안 오면 운영자에게」다.
          없는 메일이어도 같은 화면이 뜨므로(명단이 새지 않게), 안 오는 경우를 여기서 안내한다.
        */}
        <p className="text-sm leading-6 text-body">
          <strong className="font-semibold text-ink">메신저를 확인해 주세요.</strong>
          <br />
          쪽지가 오지 않으면 등록되지 않은 주소이거나 사번이 없는 경우입니다 — 운영자에게 문의해 주세요.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 밖 페이지 */}
        <a href="/login" className="btn-secondary mt-6 w-full">
          로그인 화면으로
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        required
        placeholder="name@kei.re.kr"
        className="w-full rounded-lg border border-border-strong px-3.5 py-2.5 text-sm focus:border-ink focus:outline-none"
      />
      {err && <p className="text-sm text-error">{err}</p>}
      <button type="submit" disabled={busy || !email} className="btn-primary w-full">
        {busy ? '보내는 중…' : '재설정 링크 받기'}
      </button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 밖 페이지 */}
      <a href="/login" className="block text-center text-sm text-muted underline underline-offset-2 hover:text-ink">
        로그인으로 돌아가기
      </a>
    </form>
  );
}
