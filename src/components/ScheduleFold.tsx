'use client';
// WS-19l · PG-51a — 「전사」 머리글의 마감 한 줄과 [일정 바꾸기]. 누르면 그 아래에 「주차 일정」 카드가 펼쳐진다.
//
// 일정은 연휴 때나 바꾼다 — 매주 보는 것은 마감 시각 한 줄이다. 그래서 카드는 접어 두고 줄만 늘 보인다.
// 바꿀 수 있는 것이 없는 사람에게는 페이지가 이 부품 대신 줄만 그린다(TACP-9).
import { useState, type ReactNode } from 'react';

export function ScheduleFold({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted">
        {summary}
        <button
          type="button"
          data-guide="schedule-open"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="schedule"
          className="btn-secondary btn-sm"
        >
          {open ? '일정 접기' : '일정 바꾸기'}
        </button>
      </div>
      {open && (
        <div id="schedule" className="mt-4">
          {children}
        </div>
      )}
    </>
  );
}
