'use client';
// NT-21 — 사용자 드롭다운의 «알림 받기» 토글.
//
// 알림을 싫어하는 사람은 반드시 있다. 끌 수 없으면 그 사람은 알림을 **차단**하거나
// 무시하게 되고, 그러면 정작 필요한 순간에도 안 읽는다.
// 끄는 길을 열어두는 편이 알림 자체를 살린다.
//
// **끄는 것은 알림뿐이고 제출 의무는 그대로**라는 걸 화면에서 분명히 한다 —
// "알림 끔"을 "안 내도 됨"으로 읽으면 곤란하다.
import { useState } from 'react';

export function NotifyToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setOn(next); // 먼저 바꾸고, 실패하면 되돌린다 — 토글은 즉시 반응해야 한다
    const res = await fetch('/api/me/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (!res?.ok) setOn(!next);
    setBusy(false);
  };

  return (
    <button
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={toggle}
      disabled={busy}
      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-body hover:bg-surface-soft disabled:opacity-60"
    >
      <span>
        알림 받기
        <span className="mt-0.5 block text-[11px] text-muted-soft">마감 1시간 전 안내</span>
      </span>
      {/* 스위치 — 켜짐/꺼짐이 색과 위치 둘 다로 보여야 한다 */}
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-border-strong'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
