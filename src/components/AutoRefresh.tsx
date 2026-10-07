'use client';
// RU-33 — 큰 화면은 아무도 만지지 않는다. 스스로 새로 그린다
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      router.refresh();
      setAt(new Date());
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return (
    <span className="tabular-nums" title={`${seconds}초마다 새로 고칩니다`}>
      {hh}:{mm} 기준 · {seconds}초마다 갱신
    </span>
  );
}
