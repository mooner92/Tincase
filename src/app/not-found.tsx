// PG-30 — 평범한 404. 격리 은닉 겸용 (권한 문구 금지)
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl font-bold text-hairline">404</p>
      <h1 className="mt-3 text-lg font-bold text-ink">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-muted">주소를 확인해 주세요.</p>
      <Link href="/" className="mt-5 text-sm text-ink underline underline-offset-2 hover:text-ink-active">
        내 부서 페이지로
      </Link>
    </main>
  );
}
