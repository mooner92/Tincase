// `/setup/[token]` — 비밀번호 **본인 설정** (AU-30).
//
// **로그인 없이 열리는 유일한 페이지다.** 그래서 여기서 할 수 있는 일은 딱 하나여야 한다:
// 그 토큰이 가리키는 사람의 비밀번호를 정하는 것. 그 외에는 아무것도 보여주지 않는다 —
// 부서도, 다른 사람도, 심지어 이메일 전체도.
//
// 이름은 **크게 보여준다.** 링크가 잘못 전달됐으면 「어? 내가 아닌데」 하고 멈추게 하려는
// 것이다. 서버가 막을 수 없는 유일한 오배송을 사람이 막는 자리다.
import { readSetupToken, SETUP_TOKEN_DAYS, type TokenState } from '@/server/setup-token';
import { SetupForm } from './SetupForm';

export const dynamic = 'force-dynamic';

/**
 * AU-30a — 못 쓰는 링크는 **할 일이 다르므로** 상태마다 다른 말을 한다. 밀린 링크(더 새 링크가 나감)를 「이미 사용한 링크 —
 * 비밀번호가 이미 설정되었습니다」로 보이면, 받은 사람은 로그인하러 갔다가 막힌다(2026-10-10 점검 — 누가 그 사람 메일로 비밀번호 찾기를
 * 한 번 누르기만 해도 운영자가 보낸 링크가 그렇게 보였다). 밀린 링크의 할 일은 「가장 최근 쪽지」다.
 */
const MESSAGE: Record<Exclude<TokenState, { ok: true }>['reason'], { title: string; body: string }> = {
  unknown: {
    title: '쓸 수 없는 주소입니다',
    body: '주소가 잘못되었거나 이미 처리된 링크입니다. 운영자에게 다시 요청해 주세요.',
  },
  superseded: {
    title: '새 링크가 다시 발급된 링크입니다',
    body: '이 링크를 보낸 뒤 새 링크를 다시 보냈습니다. 비밀번호는 아직 바뀌지 않았습니다. 메신저에서 가장 최근에 받은 Tincase 비밀번호 쪽지의 제목을 눌러 주세요.',
  },
  used: {
    title: '이미 사용한 링크입니다',
    body: '비밀번호가 이미 설정되었습니다. 로그인 화면에서 바로 들어가시면 됩니다.',
  },
  expired: {
    title: '기한이 지난 링크입니다',
    body: `링크는 ${SETUP_TOKEN_DAYS}일 동안만 쓸 수 있습니다. 로그인 화면의 「비밀번호를 잊으셨나요?」로 새 링크를 받을 수 있습니다.`,
  },
};

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await readSetupToken(token);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card px-6 py-8 sm:px-8 sm:py-9">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/tincase-stacked.svg" alt="Tincase" className="mx-auto h-[84px] w-auto" />

        {state.ok ? (
          <>
            <h1 className="mt-5 text-center text-xl font-semibold text-ink">
              {state.user.name} 님의 비밀번호를 설정합니다
            </h1>
            <p className="mt-1.5 text-center text-sm text-muted">
              본인이 아니면 이 창을 닫아 주세요.
            </p>
            <div className="mt-7">
              <SetupForm token={token} email={state.user.email} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-center text-xl font-semibold text-ink">{MESSAGE[state.reason].title}</h1>
            <p className="mt-3 text-center text-sm leading-6 text-body">{MESSAGE[state.reason].body}</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 밖 페이지 */}
            <a href="/login" className="btn-secondary mt-7 w-full">
              로그인 화면으로
            </a>
          </>
        )}
      </div>
    </main>
  );
}
