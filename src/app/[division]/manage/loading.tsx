// 수합 관리 스켈레톤 — 카드가 위아래로 쌓이는 화면이다.
// 부모(`[division]/loading.tsx`)는 부서원 홈 모양(5칸 카드 + 7칸 목록)이라, 이것이 없으면 수합 관리로 갈 때
// 두 칸 뼈대가 잠깐 비쳤다가 한 줄 화면으로 바뀐다(2026-10-08 PG-66 뒤).
export default function Loading() {
  return (
    <main className="animate-pulse space-y-4 pt-8 lg:space-y-6">
      <div className="h-20 rounded-xl border border-hairline bg-canvas" />
      <div className="h-24 rounded-xl border border-hairline bg-canvas" />
      <div className="h-40 rounded-xl border border-hairline bg-canvas" />
    </main>
  );
}
