// `/login` — 사내망 로그인 (AU-20). 이미 로그인 상태면 자기 부서로.
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const ps = await getPageScope();
  if (ps.ok) redirect(ps.scope.user.mustChangePassword ? '/password?first=1' : '/');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {/* CP-104 — 사용 안내가 가리키는 자리 */}
      <div data-guide="login-form" className="card px-6 py-8 sm:px-8 sm:py-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/tincase-stacked.svg" alt="Tincase" className="mx-auto h-[84px] w-auto" />
        <h1 className="sr-only">Tincase 로그인</h1>
        <p className="mt-4 mb-7 text-center text-sm text-muted">한국환경연구원 · 부서 업무일지 수합</p>
        <LoginForm />
      </div>
    </main>
  );
}
