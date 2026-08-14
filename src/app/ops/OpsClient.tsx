'use client';
// PG-33~35 — 운영 화면 (operator). 테넌시 + 인원 배치 + 비밀번호.
// 부서를 취합게시판 제출 이력으로 탭 분리한다 — 온보딩 우선순위가 곧 그 순서다 (DM-15).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RosterDrawer, type UserRow } from './RosterDrawer';

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
  boardStatus: 'confirmed' | 'unclear' | 'none';
  boardNote: string;
}

/** 초기화 결과 — 평문은 화면에만, 한 번만 보인다 (AU-27) */
interface IssuedPassword {
  userId: string;
  name: string;
  email: string;
  password: string;
}

const DOW = ['', '월', '화', '수', '목', '금', '토', '일'];

const TABS = [
  { key: 'confirmed', label: '제출 확인', hint: '취합게시판에 제출일이 확인된 부서 — 온보딩 1순위' },
  { key: 'unclear', label: '확인 필요', hint: '담당자는 있으나 제출이 확인되지 않음 — 보고 단위 확인 후 판단' },
  { key: 'none', label: '이력 없음', hint: '취합게시판에 나타나지 않음 — 상위 조직이 대표로 낼 가능성' },
] as const;

export function OpsClient() {
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [tab, setTab] = useState<'confirmed' | 'unclear' | 'none'>('confirmed');
  const [selected, setSelected] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedPassword[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const loadDivisions = useCallback(() => {
    fetch('/api/ops/divisions')
      .then((r) => r.json())
      .then((b) => setDivisions(b.divisions ?? []));
  }, []);
  useEffect(loadDivisions, [loadDivisions]);

  const loadUsers = useCallback((divisionId: string) => {
    fetch(`/api/ops/roster?division=${divisionId}`)
      .then((r) => r.json())
      .then((b) => setUsers(b.users ?? []));
  }, []);

  const openRoster = (divisionId: string) => {
    setSelected(divisionId);
    setUsers([]);
    loadUsers(divisionId);
  };

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
        flash(r.ok ? '저장됨' : (b.message ?? '실패'));
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
        flash(r.ok ? '저장됨' : (b.message ?? '실패'));
        if (selected) loadUsers(selected);
        loadDivisions();
      })
      .finally(() => setBusy(false));
  };

  const resetPassword = (u: UserRow) => {
    if (!confirm(`${u.name} 님의 비밀번호를 초기화합니다.\n기존 로그인은 모두 해제되고, 새 임시 비밀번호를 전달해야 합니다.`))
      return;
    setBusy(true);
    fetch('/api/ops/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id }),
    })
      .then(async (r) => {
        const b = await r.json();
        if (r.ok) {
          setIssued((prev) => [
            { userId: u.id, name: b.name, email: b.email, password: b.password },
            ...prev.filter((x) => x.userId !== u.id),
          ]);
          flash(`${b.name} 비밀번호 초기화 완료`);
          if (selected) loadUsers(selected);
        } else {
          flash(b.message ?? '초기화 실패');
        }
      })
      .finally(() => setBusy(false));
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const counts = useMemo(
    () => ({
      confirmed: divisions.filter((d) => d.boardStatus === 'confirmed').length,
      unclear: divisions.filter((d) => d.boardStatus === 'unclear').length,
      none: divisions.filter((d) => d.boardStatus === 'none').length,
    }),
    [divisions],
  );
  const shown = divisions.filter((d) => d.boardStatus === tab);
  const selectedName = divisions.find((d) => d.id === selected)?.nameKo ?? null;

  return (
    <div className="space-y-5">
      <div aria-live="polite" className="h-5 text-sm text-ink">
        {msg}
      </div>

      {/* AU-27 — 발급된 임시 비밀번호. 화면을 벗어나면 다시 볼 수 없다 */}
      {issued.length > 0 && (
        <section className="rounded-xl border-2 border-brand-ochre/60 bg-brand-ochre/15 px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">발급된 임시 비밀번호 — 지금 전달하세요</h2>
            <button onClick={() => setIssued([])} className="text-xs text-body-strong hover:underline">
              목록 지우기
            </button>
          </div>
          <p className="mt-1 text-xs text-body-strong">
            서버에는 해시만 저장되어 <strong>이 화면을 닫으면 다시 볼 수 없습니다.</strong> 개인별로 전달하세요
            (단체 메시지 금지).
          </p>
          <ul className="mt-3 space-y-1.5">
            {issued.map((x) => (
              <li key={x.userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 font-medium text-ink">{x.name}</span>
                <span className="w-52 font-mono text-xs text-muted">{x.email}</span>
                <code className="rounded bg-canvas px-2 py-1 font-mono text-sm font-bold tracking-wider text-ink">
                  {x.password}
                </code>
                <button
                  onClick={() => copy(x.password, x.userId)}
                  className="rounded border border-brand-ochre bg-canvas px-2 py-1 text-xs font-medium text-body-strong hover:bg-amber-100"
                >
                  {copied === x.userId ? '복사됨 ✓' : '복사'}
                </button>
                <button
                  onClick={() =>
                    copy(
                      `[주간업무 시스템 계정]\n주소: http://192.168.1.104:11111\n아이디: ${x.email}\n임시 비밀번호: ${x.password}\n첫 로그인 후 비밀번호를 변경해 주세요.`,
                      `msg-${x.userId}`,
                    )
                  }
                  className="rounded border border-hairline bg-canvas px-2 py-1 text-xs text-body hover:bg-surface-soft"
                >
                  {copied === `msg-${x.userId}` ? '복사됨 ✓' : '안내문 복사'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 탭 — 취합게시판 제출 이력 기준 */}
      <div>
        <div className="flex gap-1 border-b border-hairline" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-ink'
                  : 'border-transparent text-muted hover:text-body'
              }`}
            >
              {t.label}{' '}
              <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${tab === t.key ? 'bg-surface-card' : 'bg-surface-card'}`}>
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{TABS.find((t) => t.key === tab)?.hint}</p>
      </div>

      <section className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-muted">
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
            {shown.map((d) => (
              <tr key={d.id} className={`border-b border-hairline-soft last:border-0 ${d.isActive ? '' : 'text-muted-soft'}`}>
                <td className="px-4 py-2">
                  <span className="font-medium">{d.nameKo}</span>
                  {d.boardNote && (
                    <p className="mt-0.5 max-w-md text-[11px] leading-4 text-muted-soft">{d.boardNote}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">/{d.shortSlug ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{d.memberCount}</td>
                <td className="px-4 py-2">
                  {d.hasTemplate ? <span className="text-success">✓</span> : <span className="text-error">없음</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <select
                    aria-label={`${d.nameKo} 마감 요일`}
                    value={d.deadlineDow}
                    disabled={busy}
                    onChange={(e) => patchDivision(d.id, { deadlineDow: Number(e.target.value) })}
                    className="rounded border border-hairline px-1 py-0.5 text-xs"
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
                    onBlur={(e) =>
                      e.target.value !== d.deadlineTime && patchDivision(d.id, { deadlineTime: e.target.value })
                    }
                    className="rounded border border-hairline px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    disabled={busy}
                    onClick={() => patchDivision(d.id, { isActive: !d.isActive })}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      d.isActive ? 'bg-green-100 text-ink' : 'bg-surface-card text-muted hover:bg-surface-strong'
                    }`}
                  >
                    {d.isActive ? '활성' : '비활성'}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => openRoster(d.id)}
                    className="rounded border border-hairline px-2 py-0.5 text-xs text-body hover:bg-surface-soft"
                  >
                    열기
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-soft">
                  이 분류에 해당하는 부서가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* 스크롤 없이 바로 보이도록 드로어로 (기존엔 표 아래에 펼쳐져 스크롤이 필요했다) */}
      <RosterDrawer
        divisionName={selectedName}
        users={users}
        busy={busy}
        onClose={() => setSelected(null)}
        onPatch={patchUser}
        onResetPassword={resetPassword}
      />
    </div>
  );
}
