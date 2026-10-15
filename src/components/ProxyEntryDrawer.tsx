'use client';
// CP-132 · LE-40·41 — 담당자가 **낸 적 없는** 부서원의 표를 대신 채우는 오른쪽 서랍.
//
// 본문은 낸 사람의 [고치기]와 같은 부품(`SubmissionEditor`)이고 시작점만 빈 표다 — 칸 규칙(HM-39·42)이 두 곳에서 갈라지지 않게.
// 저장하면 서랍을 닫는다. 표가 다시 그려지면 그 사람의 행이 「제출」로 바뀐다(부모가 `router.refresh()`).
import { useCallback, useEffect, useRef, useState } from 'react';
import { SubmissionEditor } from './SubmissionEditor';

export interface ProxyTarget {
  userId: string;
  name: string;
}

const EMPTY = { achievements: [], plans: [], notes: [] };

export function ProxyEntryDrawer({
  target,
  isoKey,
  weekLabel,
  onClose,
  onSaved,
}: {
  target: ProxyTarget | null;
  isoKey: string;
  /** 「10월 3주차」 — 머리에 붙는다 */
  weekLabel: string;
  onClose: () => void;
  onSaved: (target: ProxyTarget) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const open = !!target;

  const requestClose = useCallback(() => {
    if (dirty && !confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) return;
    setDirty(false);
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // 포커스 트랩 — 편집 칸을 Tab으로 돌다 서랍 밖(뒤 화면)으로 새면 안 된다 (CP-75와 같다)
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-40 h-screen">
      <div className="absolute inset-0 bg-ink/30" onClick={requestClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${target.name}님 대신 입력`}
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-2xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
          <h2 ref={titleRef} tabIndex={-1} className="min-w-0 text-base font-semibold text-ink outline-none">
            {target.name}님 대신 입력 <span className="font-normal text-muted">· {weekLabel}</span>
          </h2>
          <button onClick={requestClose} className="btn-ghost w-9 px-0 text-xl leading-none text-muted" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="mb-4 text-[13px] leading-5 text-muted">
            저장하면 {target.name}님이 낸 것으로 기록돼요. 본인 화면에는 「담당자 대신 입력」으로 보이고, 마감은 보지 않아요.
          </p>
          <SubmissionEditor
            key={target.userId}
            proxy={{ userId: target.userId, isoKey }}
            initial={EMPTY}
            onDirtyChange={setDirty}
            onCancel={requestClose}
            onSaved={() => {
              setDirty(false);
              onSaved(target);
            }}
          />
        </div>
      </div>
    </div>
  );
}
