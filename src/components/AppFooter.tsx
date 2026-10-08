// 하단 한 줄 — 장식이 아니라 **바닥**이다.
// 내용이 짧은 화면(제출 화면)은 아래가 그냥 비어서 페이지가 끝난 줄 모른다.
// 2026-10-08 (R16) — 「문의 ○○ 운영자」 줄은 걷었다. 누구에게 물을지는 막힌 화면(미등록·준비 중·마감)이 그 자리에서 말한다.
export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-hairline-soft">
      <div className="mx-auto max-w-[1120px] px-5 py-6 text-[13px] text-muted">Tincase</div>
    </footer>
  );
}
