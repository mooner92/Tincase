// `/password` — 비밀번호 변경. 초기 발급 계정은 여기로 강제된다 (AU-22).
import { redirect } from 'next/navigation';
import { getPageScope, loginPath } from '@/server/page-scope';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const ps = await getPageScope();
  if (!ps.ok) redirect(await loginPath());
  const { first } = await searchParams;
  const isFirst = first === '1' || ps.scope.user.mustChangePassword;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card px-6 py-8 sm:px-8 sm:py-9">
      <h1 className="page-title">
        {isFirst ? '비밀번호를 변경해 주세요' : '비밀번호 변경'}
      </h1>
      {/* 2026-10-08 — 첫 변경의 「임시 비밀번호는 계속 쓸 수 없습니다…」 설명은 걷었다. 제목이 말한다 */}
      <p className="mt-1 mb-6 text-sm text-muted">{ps.scope.user.name} 님</p>
      <PasswordForm first={isFirst} hasPassword={!!ps.scope.user.passwordHash} />
      </div>
    </main>
  );
}
