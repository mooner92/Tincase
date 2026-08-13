'use client';
// CP-11~17 — 마감 카운트다운. 서버가 준 deadline만 신뢰, 서버 시각으로 스큐 보정 (CP-15).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeadlineCountdown({
  deadlineAtMs,
  serverNowMs,
}: {
  deadlineAtMs: number;
  serverNowMs: number; // 렌더 시점 서버 시각 — 로컬 시계 오차 보정 기준
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(deadlineAtMs - serverNowMs);
  const expiredRef = useRef(false);
  const skewRef = useRef<number | null>(null);

  useEffect(() => {
    // CP-15 — 스큐는 effect에서 1회 계산 (render는 순수하게 유지)
    if (skewRef.current === null) skewRef.current = serverNowMs - Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const left = deadlineAtMs - (Date.now() + (skewRef.current ?? 0));
      setRemaining(left);
      if (left <= 0) {
        if (!expiredRef.current) {
          expiredRef.current = true; // CP-13: 정확히 1회
          router.refresh(); // PG-14: 잠김 화면으로 전환
        }
        return;
      }
      // CP-12 — 1시간 넘게 남으면 60초, 이하 1초 주기 (setTimeout 체인)
      timer = setTimeout(tick, left > 3661_000 ? 60_000 : 1_000);
    };
    tick();

    // CP-17 — 백그라운드 복귀 시 즉시 재계산 (브라우저 타이머 스로틀 대응)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer); // CP-16
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [deadlineAtMs, serverNowMs, router]);

  if (remaining <= 0) return <span className="font-semibold text-slate-500">마감됨</span>;

  const h = Math.floor(remaining / 3600_000);
  const m = Math.floor((remaining % 3600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const urgent = remaining <= 3 * 3600_000; // CP-14

  return (
    <span
      className={`tabular-nums font-semibold ${urgent ? 'text-orange-600' : 'text-blue-700'}`}
      aria-live="polite"
    >
      {h >= 1 ? `${h}시간 ${m}분 남음` : `${m}분 ${s}초 남음`}
    </span>
  );
}
