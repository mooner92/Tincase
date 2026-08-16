// 하단 한 줄 — 장식이 아니라 **바닥**이다.
// 내용이 짧은 화면(제출 화면)은 아래가 그냥 비어서 페이지가 끝난 줄 모른다.
// 그리고 사용자가 막혔을 때 제일 먼저 찾는 것은 "누구한테 물어보나"다 — 그걸 여기 둔다.
export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-hairline-soft">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-2 px-5 py-6 text-[13px] text-muted">
        <span>Tincase · 한국환경연구원 부서 업무일지 수합</span>
        <span>
          문의{' '}
          <a href="mailto:mhchoi@kei.re.kr" className="text-body underline-offset-2 hover:underline">
            AI홍보전략실 최명헌
          </a>
        </span>
      </div>
    </footer>
  );
}
