// PG-66 — 스켈레톤. 홈과 같은 격자: 카드 하나(5칸) + 지난 주차 줄 여섯(7칸)
export default function Loading() {
  return (
    <main className="grid animate-pulse grid-cols-1 items-start gap-4 pt-8 lg:grid-cols-12 lg:gap-6">
      <div className="h-40 rounded-xl border border-hairline bg-canvas lg:col-span-5" />
      <div className="space-y-2 rounded-xl border border-hairline bg-canvas p-5 lg:col-span-7">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-surface-soft" />
        ))}
      </div>
    </main>
  );
}
