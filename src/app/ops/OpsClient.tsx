'use client';
import Link from 'next/link';
// PG-33~35 — 운영 화면 (operator). 테넌시 + 인원 배치 + 비밀번호.
// 부서를 취합게시판 제출 이력으로 탭 분리한다 — 온보딩 우선순위가 곧 그 순서다 (DM-15).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RosterDrawer, type UserRow } from './RosterDrawer';
import { RosterSync } from './RosterSync';

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
  boardStatus: 'confirmed' | 'none';
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

/*
 * 「확인 필요」 탭은 없앴다 (v1.23.0).
 *
 * 조사 단계(R-002)에서는 게시판만 보고 판단해야 해서 «담당자는 있는데 제출은 못 봤다»는
 * 중간 상태가 필요했다. 2026-08-26에 운영자가 게시판 답변일자로 **실제 담당자 11명**을
 * 확정하면서 그 모호함이 사라졌다 — 나머지는 연구부서라 업무일지를 아예 쓰지 않는다.
 *
 * 답이 나온 뒤에도 «확인 필요»를 남겨두면, 볼 때마다 이미 끝난 확인을 다시 하게 된다.
 */
const TABS = [
  { key: 'confirmed', label: '제출 확인', hint: '취합게시판에 제출일이 확인된 부서 — 온보딩 1순위' },
  { key: 'none', label: '이력 없음', hint: '업무일지를 쓰지 않는 부서 (대부분 연구부서) · 상위 조직이 대표로 내는 경우' },
] as const;

export function OpsClient() {
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [tab, setTab] = useState<'confirmed' | 'none'>('confirmed');
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
      none: divisions.filter((d) => d.boardStatus !== 'confirmed').length,
    }),
    [divisions],
  );
  // 「이력 없음」은 «confirmed가 아닌 전부»다 — 옛 `unclear` 값이 남아 있어도
  // 어느 탭에도 안 보이는 부서가 생기지 않는다
  const shown = divisions.filter((d) =>
    tab === 'confirmed' ? d.boardStatus === 'confirmed' : d.boardStatus !== 'confirmed',
  );
  const selectedName = divisions.find((d) => d.id === selected)?.nameKo ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div aria-live="polite" className="h-5 text-sm text-ink">
          {msg}
        </div>
        {/* 모니터로 가는 길 — 없으면 만들어도 아무도 못 간다 */}
        <div className="flex shrink-0 gap-2">
          <Link href="/ops/monitor" className="btn-secondary btn-sm">
            전사 제출 현황 조직도
          </Link>
          <Link href="/ops/audit" className="btn-secondary btn-sm">
            감사 로그
          </Link>
        </div>
      </div>

      {/* RS-15 — 주 1회 하는 일이라 부서 목록보다 위에 둔다. 아래에 있으면 스크롤해야 보인다 */}
      <RosterSync />

      {/* AU-27 — 발급된 임시 비밀번호. 화면을 벗어나면 다시 볼 수 없다 */}
      {issued.length > 0 && (
        <section className="rounded-xl border-2 border-warning/40 bg-warning-soft px-5 py-4">
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
                  className="rounded border border-warning/40 bg-canvas px-2 py-1 text-xs font-medium text-body-strong hover:bg-amber-100"
                >
                  {copied === x.userId ? '복사됨 ✓' : '복사'}
                </button>
                <button
                  onClick={() =>
                    copy(
                      `[Tincase — 주간 업무일지 계정]\n주소: ${window.location.origin}\n아이디: ${x.email}\n임시 비밀번호: ${x.password}\n첫 로그인 후 비밀번호를 변경해 주세요.`,
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
              <th className="px-4 py-2 font-medium">업무일지</th>
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
                  {/* 집계 대상 — 조사(R-002)가 초기값이지만 현실이 바뀌면 운영자가 고친다.
                      코드에만 있으면 부서가 새로 시작해도 손댈 방법이 없다 */}
                  <select
                    aria-label={`${d.nameKo} 업무일지 제출 여부`}
                    value={d.boardStatus}
                    disabled={busy}
                    onChange={(e) => patchDivision(d.id, { boardStatus: e.target.value })}
                    className="rounded border border-hairline px-1 py-0.5 text-xs"
                  >
                    <option value="confirmed">제출함 (집계)</option>
                    <option value="none">안 냄</option>
                  </select>
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
