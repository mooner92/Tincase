// `/login` — 사내망 로그인 (AU-20). 이미 로그인 상태면 자기 부서로.
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const ps = await getPageScope();
  if (ps.ok) redirect(ps.scope.user.mustChangePassword ? '/password?first=1' : '/');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-bold text-slate-900">주간 업무일지</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">한국환경연구원 · 부서 업무일지 수합</p>
      <LoginForm />
    </main>
  );
}
