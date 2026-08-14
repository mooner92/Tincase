'use client';
// 인원 관리 드로어 — 부서 목록이 길어 아래에 펼치면 스크롤해야 했다.
// 오버레이로 띄워 스크롤 없이 바로 보이게 한다 (FileDrawer와 같은 패턴).
import { useEffect, useRef } from 'react';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  divisionRole: 'member' | 'lead';
  isOperator: boolean;
  isCoordinator: boolean;
  isActive: boolean;
  onRoster: boolean;
  sortOrder: number;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  locked: boolean;
}

export function RosterDrawer({
  divisionName,
  users,
  busy,
  onClose,
  onPatch,
  onResetPassword,
}: {
  divisionName: string | null;
  users: UserRow[];
  busy: boolean;
  onClose: () => void;
  onPatch: (userId: string, patch: Record<string, unknown>) => void;
  onResetPassword: (u: UserRow) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!divisionName) return;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 배경 스크롤 잠금 — 드로어 안에서만 스크롤되게
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [divisionName, onClose]);

  if (!divisionName) return null;

  const issued = users.filter((u) => u.hasPassword).length;
  const roster = users.filter((u) => u.onRoster && u.isActive).length;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${divisionName} 인원 관리`}
        className="absolute inset-y-0 right-0 flex w-full max-w-4xl flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold text-slate-900 outline-none">
              {divisionName} <span className="font-normal text-slate-500">· 인원 관리</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              전체 {users.length}명 · 제출 대상 {roster}명 · 비밀번호 발급 {issued}/{users.length}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-lg leading-none text-slate-400 hover:text-slate-700"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e2e8f0]">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">이름</th>
                <th className="px-4 py-2 font-medium">이메일</th>
                <th className="px-4 py-2 font-medium">역할</th>
                <th className="px-4 py-2 font-medium">제출 대상</th>
                <th className="px-4 py-2 font-medium">정렬</th>
                <th className="px-4 py-2 font-medium">비밀번호</th>
                <th className="px-4 py-2 font-medium">계정</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-slate-100 last:border-0 ${u.isActive ? '' : 'text-slate-300'}`}
                >
                  <td className="whitespace-nowrap px-4 py-2 font-medium">
                    {u.name}
                    {u.isOperator && <span className="ml-1 rounded bg-purple-50 px-1 text-[11px] text-purple-700">운영</span>}
                    {u.isCoordinator && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] text-amber-700">총괄</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`${u.name} 역할`}
                      value={u.divisionRole}
                      disabled={busy}
                      onChange={(e) => onPatch(u.id, { divisionRole: e.target.value })}
                      className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="lead">lead (담당)</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      aria-label={`${u.name} 제출 대상`}
                      type="checkbox"
                      checked={u.onRoster}
                      disabled={busy}
                      onChange={(e) => onPatch(u.id, { onRoster: e.target.checked })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      aria-label={`${u.name} 정렬 순서`}
                      type="number"
                      defaultValue={u.sortOrder}
                      disabled={busy}
                      min={0}
                      onBlur={(e) =>
                        Number(e.target.value) !== u.sortOrder && onPatch(u.id, { sortOrder: Number(e.target.value) })
                      }
                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs tabular-nums"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {!u.hasPassword ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">미발급</span>
                      ) : u.locked ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">잠김</span>
                      ) : u.mustChangePassword ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">변경 대기</span>
                      ) : (
                        <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700">사용 중</span>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => onResetPassword(u)}
                        className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {u.hasPassword ? '초기화' : '발급'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={busy}
                      onClick={() => onPatch(u.id, { isActive: !u.isActive })}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {u.isActive ? '비활성화' : '활성화'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
