'use client';
// CP-40~43 — 주차 셀렉터 (담당자 화면)
import { useRouter } from 'next/navigation';

export interface SlotOption {
  isoKey: string;
  label: string;
  year: number;
  submitted: number;
  isCurrent: boolean;
  /** WS-14 — 그 달 마지막 주(월간 업무일지) */
  monthly?: boolean;
}

export function SlotSelector({
  slots,
  selected,
  roster,
  baseHref,
}: {
  slots: SlotOption[];
  selected: string;
  roster: number;
  baseHref: string; // `/{slug}/manage`
}) {
  const router = useRouter();
  return (
    <select
      value={selected}
      aria-label="주차 선택"
      onChange={(e) => {
        const key = e.target.value;
        const s = slots.find((x) => x.isoKey === key);
        router.push(s?.isCurrent ? baseHref : `${baseHref}/${key}`);
      }}
      className="rounded-xl border border-hairline bg-canvas px-3 py-1.5 text-sm"
    >
      {slots.map((s) => (
        <option key={s.isoKey} value={s.isoKey}>
          {s.year}년 {s.label}
          {s.monthly ? ' · 월간' : ''} ({s.submitted}/{roster}){s.isCurrent ? ' · 이번 주' : ''}
        </option>
      ))}
    </select>
  );
}
