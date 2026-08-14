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
      <div className="card px-8 py-9">
        <h1 className="display text-[28px] leading-tight">주간업무</h1>
        <p className="mt-1.5 mb-7 text-sm text-muted">한국환경연구원 · 부서 업무일지 수합</p>
        <LoginForm />
      </div>
    </main>
  );
}
