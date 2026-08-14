// `/password` — 비밀번호 변경. 초기 발급 계정은 여기로 강제된다 (AU-22).
import { redirect } from 'next/navigation';
import { getPageScope } from '@/server/page-scope';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const ps = await getPageScope();
  if (!ps.ok) redirect('/login');
  const { first } = await searchParams;
  const isFirst = first === '1' || ps.scope.user.mustChangePassword;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card px-8 py-9">
      <h1 className="display text-[24px] leading-tight">
        {isFirst ? '비밀번호를 변경해 주세요' : '비밀번호 변경'}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {isFirst
          ? '처음 발급받은 임시 비밀번호는 사용을 계속할 수 없습니다. 본인만 아는 값으로 바꿔 주세요.'
          : `${ps.scope.user.name} 님`}
      </p>
      <PasswordForm first={isFirst} hasPassword={!!ps.scope.user.passwordHash} />
      </div>
    </main>
  );
}
