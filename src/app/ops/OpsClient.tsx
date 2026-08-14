'use client';
// PG-33~35 — 운영 화면 (operator). 부서 활성화·마감·별칭 + 인원 배치(onRoster·역할·정렬).
import { useCallback, useEffect, useState } from 'react';

interface DivisionRow {
  id: string;
  slug: string;
  shortSlug: string | null;
  nameKo: string;
  isActive: boolean;
  deadlineDow: number;
  deadlineTime: string;
  memberCount: number;
  hasTemplate: boolean;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  divisionRole: 'member' | 'lead';
  isOperator: boolean;
  isCoordinator: boolean;
  isActive: boolean;
  onRoster: boolean;
  sortOrder: number;
}

const DOW = ['', '월', '화', '수', '목', '금', '토', '일'];

export function OpsClient() {
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDivisions = useCallback(() => {
    fetch('/api/ops/divisions')
      .then((r) => r.json())
      .then((b) => setDivisions(b.divisions ?? []));
  }, []);
  useEffect(loadDivisions, [loadDivisions]);

  const loadUsers = useCallback((divisionId: string) => {
    setSelected(divisionId);
    fetch(`/api/ops/roster?division=${divisionId}`)
      .then((r) => r.json())
      .then((b) => setUsers(b.users ?? []));
  }, []);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  };

  const patchDivision = (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    fetch('/api/ops/divisions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
      .then(async (r) => {
        const b = await r.json();
        flash(r.ok ? '저장됨' : b.message ?? '실패');
        loadDivisions();
      })
      .finally(() => setBusy(false));
  };

  const patchUser = (userId: string, patch: Record<string, unknown>) => {
    setBusy(true);
    fetch('/api/ops/roster', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ userId, ...patch }] }),
    })
      .then(async (r) => {
        const b = await r.json();
        flash(r.ok ? '저장됨' : b.message ?? '실패');
        if (selected) loadUsers(selected);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="h-5 text-sm text-blue-700">
        {msg}
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <caption className="px-4 pt-3 text-left text-sm font-semibold text-slate-500">부서 (테넌트)</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">부서</th>
              <th className="px-4 py-2 font-medium">별칭</th>
              <th className="px-4 py-2 font-medium">인원</th>
              <th className="px-4 py-2 font-medium">양식</th>
              <th className="px-4 py-2 font-medium">마감</th>
              <th className="px-4 py-2 font-medium">활성</th>
              <th className="px-4 py-2 font-medium">인원 관리</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((d) => (
              <tr key={d.id} className={`border-b border-slate-100 last:border-0 ${d.isActive ? '' : 'text-slate-400'}`}>
                <td className="px-4 py-2 font-medium">{d.nameKo}</td>
                <td className="px-4 py-2 font-mono text-xs">/{d.shortSlug ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{d.memberCount}</td>
                <td className="px-4 py-2">{d.hasTemplate ? '✓' : <span className="text-red-500">없음</span>}</td>
                <td className="px-4 py-2">
                  <select
                    aria-label={`${d.nameKo} 마감 요일`}
                    value={d.deadlineDow}
                    disabled={busy}
                    onChange={(e) => patchDivision(d.id, { deadlineDow: Number(e.target.value) })}
                    className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>
                        {DOW[n]}
                      </option>
                    ))}
                  </select>{' '}
                  <input
                    aria-label={`${d.nameKo} 마감 시각`}
                    type="time"
                    defaultValue={d.deadlineTime}
                    disabled={busy}
                    onBlur={(e) => e.target.value !== d.deadlineTime && patchDivision(d.id, { deadlineTime: e.target.value })}
                    className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    disabled={busy}
                    onClick={() => patchDivision(d.id, { isActive: !d.isActive })}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      d.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {d.isActive ? '활성' : '비활성'}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => loadUsers(d.id)}
                    className={`rounded border px-2 py-0.5 text-xs ${
                      selected === d.id ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    열기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <caption className="px-4 pt-3 text-left text-sm font-semibold text-slate-500">
              인원 배치 — {divisions.find((d) => d.id === selected)?.nameKo}
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">이름</th>
                <th className="px-4 py-2 font-medium">이메일</th>
                <th className="px-4 py-2 font-medium">역할</th>
                <th className="px-4 py-2 font-medium">제출 대상</th>
                <th className="px-4 py-2 font-medium">정렬</th>
                <th className="px-4 py-2 font-medium">계정</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-b border-slate-100 last:border-0 ${u.isActive ? '' : 'text-slate-300'}`}>
                  <td className="px-4 py-2 font-medium">
                    {u.name}
                    {u.isOperator && <span className="ml-1 rounded bg-purple-50 px-1 text-[11px] text-purple-700">운영</span>}
                    {u.isCoordinator && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] text-amber-700">총괄</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`${u.name} 역할`}
                      value={u.divisionRole}
                      disabled={busy}
                      onChange={(e) => patchUser(u.id, { divisionRole: e.target.value })}
                      className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="lead">lead (담당)</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      aria-label={`${u.name} 제출 대상`}
                      type="checkbox"
                      checked={u.onRoster}
                      disabled={busy}
                      onChange={(e) => patchUser(u.id, { onRoster: e.target.checked })}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      aria-label={`${u.name} 정렬 순서`}
                      type="number"
                      defaultValue={u.sortOrder}
                      disabled={busy}
                      min={0}
                      onBlur={(e) => Number(e.target.value) !== u.sortOrder && patchUser(u.id, { sortOrder: Number(e.target.value) })}
                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={busy}
                      onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {u.isActive ? '비활성화' : '활성화'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
