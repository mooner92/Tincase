'use client';
// PG-29 — 오류 경계. 스택 노출 금지, 상관 ID만.
import { useMemo } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const code = useMemo(() => error.digest?.slice(0, 6) ?? 'unknown', [error.digest]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-bold text-ink">문제가 발생했습니다</h1>
      <p className="mt-2 text-sm text-body">잠시 후 다시 시도해 주세요. 계속되면 운영자에게 알려주세요.</p>
      <button
        onClick={reset}
        className="mt-5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-active"
      >
        다시 시도
      </button>
      <p className="mt-3 text-xs text-muted-soft">(오류 코드: {code})</p>
    </main>
  );
}
