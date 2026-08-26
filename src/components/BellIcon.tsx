// NT-31 — 「알림을 보냈다」 표식.
//
// 글꼴에 없는 글자(✓·▾처럼)는 시스템 글꼴로 떨어져 크기·굵기가 어긋난다.
// 이모지도 OS마다 모양이 달라진다. 그래서 **인라인 SVG**로 그린다 —
// 어디서나 같고, `currentColor`를 따르니 색은 쓰는 쪽이 정한다.
export function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
    >
      <path d="M8 1.4a.95.95 0 0 1 .95.95v.42a4.15 4.15 0 0 1 3.2 4.04v2.28l.84 1.42a.55.55 0 0 1-.47.83H3.48a.55.55 0 0 1-.47-.83l.84-1.42V6.81a4.15 4.15 0 0 1 3.2-4.04v-.42A.95.95 0 0 1 8 1.4Z" />
      <path d="M6.35 12.2a1.7 1.7 0 0 0 3.3 0h-3.3Z" />
    </svg>
  );
}
