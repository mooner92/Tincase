'use client';
// CP-115 — 수합 관리의 주차 고르기 (PG-72). 네이티브 `<select>`를 달마다 `<optgroup>`으로 묶고, 옆에 ‹ › 링크.
//
// 상한 없이 근거 있는 주를 다 담으면(`divisionWeeks`) 목록이 길어진다 — 달로 묶어 눈이 달 이름으로 먼저 간다.
// 가장 흔한 「지난주 보기」는 ‹ 한 번이다. 새 위젯은 만들지 않는다: 휴대폰에서는 기본 선택기가 뜬다.
// 팝오버(WeekJump)는 /hq·/org의 WeekPicker와 합칠 때 한다(S14).
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface SlotOption {
  isoKey: string;
  label: string;
  year: number;
  /** 월요일의 달(WS-04). 없으면 `label`(「9월 4주차」 — WS-02)에서 읽는다 */
  month?: number;
  submitted: number;
  isCurrent: boolean;
  /** WS-14 — 그 달 마지막 주(월간 업무일지) */
  monthly?: boolean;
}

const monthOf = (s: SlotOption) => s.month ?? Number(/^(\d{1,2})월/.exec(s.label)?.[1] ?? 0);

/** 목록(최신이 위)을 달 묶음으로 — 순서를 그대로 둔다 */
export function groupByMonth(slots: SlotOption[]): { label: string; slots: SlotOption[] }[] {
  const out: { label: string; slots: SlotOption[] }[] = [];
  for (const s of slots) {
    const label = `${s.year}년 ${monthOf(s)}월`;
    const last = out.at(-1);
    if (last?.label === label) last.slots.push(s);
    else out.push({ label, slots: [s] });
  }
  return out;
}

/** 선 화살표 — ‹ ›는 페이퍼로지에 없어 다른 글꼴로 샌다(UI-T90과 같은 이유) */
function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rotate-45 border-current ${
        dir === 'prev' ? 'ml-0.5 border-b-[1.5px] border-l-[1.5px]' : 'mr-0.5 border-t-[1.5px] border-r-[1.5px]'
      }`}
    />
  );
}

export function SlotSelector({
  slots,
  selected,
  roster,
  baseHref,
}: {
  /** 최신이 위 */
  slots: SlotOption[];
  selected: string;
  roster: number;
  baseHref: string; // `/{slug}/manage`
}) {
  const router = useRouter();
  const hrefOf = (s: SlotOption) => (s.isCurrent ? baseHref : `${baseHref}/${s.isoKey}`);
  const at = slots.findIndex((s) => s.isoKey === selected);
  // 이웃 주 — 목록 순서 그대로. 양 끝에서는 그리지 않는다(갈 곳이 없는 버튼은 고장으로 읽힌다 — TACP-9)
  const older = at >= 0 ? slots[at + 1] : undefined;
  const newer = at > 0 ? slots[at - 1] : undefined;
  const nav = 'btn-ghost h-9 w-9 shrink-0 px-0 text-muted';

  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      {older ? (
        <Link href={hrefOf(older)} aria-label={`이전 주차 ${older.label}`} className={nav}>
          <Chevron dir="prev" />
        </Link>
      ) : (
        <span className="w-9 shrink-0" />
      )}
      <select
        value={selected}
        aria-label="주차 선택"
        onChange={(e) => {
          const s = slots.find((x) => x.isoKey === e.target.value);
          if (s) router.push(hrefOf(s));
        }}
        className="select min-w-0 flex-1 sm:flex-none"
      >
        {groupByMonth(slots).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.slots.map((s) => (
              <option key={s.isoKey} value={s.isoKey}>
                {s.label}
                {s.monthly ? ' · 월간' : ''} ({s.submitted}/{roster}){s.isCurrent ? ' · 이번 주' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {newer ? (
        <Link href={hrefOf(newer)} aria-label={`다음 주차 ${newer.label}`} className={nav}>
          <Chevron dir="next" />
        </Link>
      ) : (
        <span className="w-9 shrink-0" />
      )}
    </div>
  );
}
