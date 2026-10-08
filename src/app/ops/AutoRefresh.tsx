'use client';
// PG-90 — 서버가 그린 카드를 주기적으로 새로 그린다(`router.refresh`). 새 API를 두지 않으려는 것이다 —
// 「병합 줄」 카드는 운영자 문 안에서 서버가 읽는다(TACP-30). 이 부품은 그려진 동안만 돈다 — 카드는 줄이 빌 때 이것을 그리지 않는다.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ ms }: { ms: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [ms, router]);
  return null;
}
