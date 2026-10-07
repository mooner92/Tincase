'use client';
// RU-31·32 — 취합 화면의 주차 고르기. 지난 자료를 재현할 때(RU-44) 지난 주차로 간다
import { useRouter } from 'next/navigation';

export function WeekPicker({
  weeks,
  selected,
  baseHref,
}: {
  weeks: { isoKey: string; label: string; year: number; isCurrent: boolean }[];
  selected: string;
  /** `?node=…` 같은 다른 조건을 이미 담은 주소 */
  baseHref: string;
}) {
  const router = useRouter();
  const join = baseHref.includes('?') ? '&' : '?';
  return (
    <select
      value={selected}
      aria-label="주차 선택"
      onChange={(e) => {
        const w = weeks.find((x) => x.isoKey === e.target.value);
        router.push(w?.isCurrent ? baseHref : `${baseHref}${join}isoKey=${e.target.value}`);
      }}
      className="select max-w-full"
    >
      {weeks.map((w) => (
        <option key={w.isoKey} value={w.isoKey}>
          {w.year}년 {w.label}
          {w.isCurrent ? ' (이번 주)' : ''}
        </option>
      ))}
    </select>
  );
}
