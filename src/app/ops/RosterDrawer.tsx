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
  rosterNote?: string | null;
  employeeNo?: string | null;
  notifyEnabled?: boolean;
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
    <div className="fixed inset-0 z-40 h-screen">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${divisionName} 인원 관리`}
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-4xl flex-col border-l border-hairline bg-canvas"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <h2 ref={titleRef} tabIndex={-1} className="text-base font-bold text-ink outline-none">
              {divisionName} <span className="font-normal text-muted">· 인원 관리</span>
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              전체 {users.length}명 · 제출 대상 {roster}명 · 비밀번호 발급 {issued}/{users.length}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-lg leading-none text-muted-soft hover:text-body"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-canvas shadow-[0_1px_0_0_var(--color-hairline)]">
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">이름</th>
                <th className="px-4 py-2 font-medium">이메일</th>
                <th className="px-4 py-2 font-medium">역할</th>
                <th className="px-4 py-2 font-medium">제출 대상</th>
                <th className="px-4 py-2 font-medium">사번</th>
                <th className="px-4 py-2 font-medium">알림</th>
                <th className="px-4 py-2 font-medium">정렬</th>
                <th className="px-4 py-2 font-medium">비밀번호</th>
                <th className="px-4 py-2 font-medium">계정</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`border-b border-hairline-soft last:border-0 ${u.isActive ? '' : 'text-hairline'}`}
                >
                  <td className="whitespace-nowrap px-4 py-2 font-medium">
                    {u.name}
                    {u.isOperator && <span className="ml-1 rounded bg-surface-strong px-1 text-[11px] text-ink">운영</span>}
                    {u.isCoordinator && <span className="ml-1 rounded bg-warning-soft px-1 text-[11px] text-body-strong">총괄</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`${u.name} 역할`}
                      value={u.divisionRole}
                      disabled={busy}
                      onChange={(e) => onPatch(u.id, { divisionRole: e.target.value })}
                      className="rounded border border-hairline px-1 py-0.5 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="lead">lead (담당)</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      aria-label={`${u.name} 집계 대상`}
                      type="checkbox"
                      checked={u.onRoster}
                      disabled={busy}
                      onChange={(e) => onPatch(u.id, { onRoster: e.target.checked })}
                    />
                    {/* 빼는 것과 **이유**를 같이 적어야 몇 주 뒤에 되돌릴 수 있다 (DM-16).
                        복직하면 체크만 다시 켜면 되고, 과거 제출 이력은 그대로 남는다 */}
                    {!u.onRoster && (
                      <input
                        aria-label={`${u.name} 제외 사유`}
                        defaultValue={u.rosterNote ?? ''}
                        placeholder="사유 (휴직 등)"
                        disabled={busy}
                        onBlur={(e) =>
                          e.target.value.trim() !== (u.rosterNote ?? '') &&
                          onPatch(u.id, { rosterNote: e.target.value })
                        }
                        className="mt-1 w-24 rounded border border-hairline px-1 py-0.5 text-xs"
                      />
                    )}
                  </td>
                  {/* NT-22 — 사번과 알림. 사번이 없으면 알림은 켜 있어도 나가지 않는다 */}
                  <td className="px-4 py-2">
                    <input
                      aria-label={`${u.name} 사번`}
                      defaultValue={u.employeeNo ?? ''}
                      placeholder="사번"
                      disabled={busy}
                      onBlur={(e) =>
                        e.target.value.trim() !== (u.employeeNo ?? '') &&
                        onPatch(u.id, { employeeNo: e.target.value })
                      }
                      className="w-20 rounded border border-hairline px-1 py-0.5 text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      aria-label={`${u.name} 알림 받기`}
                      type="checkbox"
                      checked={u.notifyEnabled ?? true}
                      disabled={busy || !u.employeeNo}
                      title={u.employeeNo ? '알림 받기' : '사번을 먼저 넣어야 합니다'}
                      onChange={(e) => onPatch(u.id, { notifyEnabled: e.target.checked })}
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
                      className="w-16 rounded border border-hairline px-1 py-0.5 text-xs tabular-nums"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {!u.hasPassword ? (
                        <span className="rounded bg-surface-card px-1.5 py-0.5 text-[11px] text-muted">미발급</span>
                      ) : u.locked ? (
                        <span className="rounded bg-error/10 px-1.5 py-0.5 text-[11px] text-error">잠김</span>
                      ) : u.mustChangePassword ? (
                        <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[11px] text-body-strong">변경 대기</span>
                      ) : (
                        <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-success">사용 중</span>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => onResetPassword(u)}
                        className="rounded border border-hairline bg-surface-card px-2 py-0.5 text-xs font-medium text-ink hover:bg-surface-strong disabled:opacity-50"
                      >
                        {u.hasPassword ? '초기화' : '발급'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={busy}
                      onClick={() => onPatch(u.id, { isActive: !u.isActive })}
                      className="rounded border border-hairline px-2 py-0.5 text-xs text-body hover:bg-surface-soft"
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
