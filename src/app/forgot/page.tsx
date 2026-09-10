// `/forgot` — 비밀번호를 잊었을 때 (AU-32). 로그인 없이 열린다.
import { ForgotForm } from './ForgotForm';

export const dynamic = 'force-dynamic';

export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card px-8 py-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/tincase-stacked.svg" alt="Tincase" className="mx-auto h-[84px] w-auto" />
        <h1 className="display mt-5 text-center text-xl">비밀번호를 잊으셨나요</h1>
        <p className="mt-2 text-center text-sm leading-6 text-muted">
          메일 주소를 넣으시면 <strong className="font-medium text-body">사내 메신저로</strong> 재설정 링크를
          보내 드립니다.
        </p>
        <div className="mt-7">
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
