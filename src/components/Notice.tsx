// CP-06 — 전면 안내 화면 (미등록·미온보딩·인증 실패)
export function NoticeScreen({ title, description }: { title: string; description: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-body">{description}</p>
    </main>
  );
}

export function noticeFor(code: 'unauthenticated' | 'not_registered' | 'division_not_onboarded', message: string) {
  const titles = {
    unauthenticated: '로그인이 필요합니다',
    not_registered: '등록되지 않은 사용자입니다',
    division_not_onboarded: '준비 중입니다',
  } as const;
  return <NoticeScreen title={titles[code]} description={message} />;
}
