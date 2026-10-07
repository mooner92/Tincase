'use client';
// PG-33~35 — 운영 화면 (operator). 부서 + 인원 배치 + 비밀번호.
//
// PG-55 (2026-10-07) — 부서 표는 **읽기가 기본**이다. 줄마다 요일·시각·업무일지 고르기와 활성 단추가 늘 열려 있어
// 열네 줄이 입력칸 밭이었고, 지나가다 잘못 건드리면 그대로 저장됐다(바꾸는 즉시 저장한다). 이제 [편집]을 누른 줄만 열린다.
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
  /** OPS-41 — `missing`은 「등록 기록만 있고 파일이 없다」 — 「없음」과 할 일이 다르다 */
  templateState?: 'ok' | 'missing' | 'none';
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
  /** PG-55 — 지금 고치고 있는 부서 한 줄. 나머지 줄은 읽기만 */
  const [editingId, setEditingId] = useState<string | null>(null);

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

  /**
   * AU-30 — 설정 링크 보내기.
   *
   * 확인 문구에 **「바뀌지 않습니다」를 먼저** 쓴다. 운영자가 제일 무서워하는 건
   * 「이미 쓰고 있는 사람 비밀번호를 날리는 것」이고, 그 걱정이 남아 있으면
   * 한 명씩 골라 보내게 된다 — 그러면 이 기능을 만든 뜻이 없다.
   */
  const sendSetupLink = (userIds: string[]) => {
    const n = userIds.length;
    if (!confirm(`${n}명에게 비밀번호 설정 링크를 메신저로 보냅니다.\n\n· 지금 쓰고 있는 비밀번호는 바뀌지 않습니다\n· 본인이 링크를 눌러 새로 정할 때만 바뀝니다\n· 링크는 1회용이고 3일 뒤 사라집니다`))
      return;
    setBusy(true);
    fetch('/api/ops/setup-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) return flash(b.message ?? '보내지 못했습니다.');
        const 실패 = (b.failed as { name: string; reason: string }[]) ?? [];
        flash(
          `링크 ${b.sent.length}명 발송` +
            (실패.length ? ` · 실패 ${실패.length}명 (${실패.map((f) => `${f.name}:${f.reason}`).join(', ')})` : ''),
        );
        if (selected) loadUsers(selected);
      })
      .catch(() => flash('네트워크 오류로 보내지 못했습니다.'))
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
    <div className="space-y-4 lg:space-y-6">
      <div aria-live="polite" className="min-h-5 text-sm text-ink empty:hidden">
        {msg}
      </div>

      {/* RS-15 — 주 1회 하는 일이라 부서 목록보다 위에 둔다. 아래에 있으면 스크롤해야 보인다 */}
      <RosterSync />

      {/* AU-27 — 발급된 임시 비밀번호. 화면을 벗어나면 다시 볼 수 없다 */}
      {issued.length > 0 && (
        <section className="card border-warning/50" aria-labelledby="issued">
          <div className="card-head items-center">
            <h2 id="issued" className="card-title">
              발급된 임시 비밀번호 — 지금 전달하세요
            </h2>
            <button onClick={() => setIssued([])} className="btn-ghost">
              목록 지우기
            </button>
          </div>
          <p className="callout callout-warn mt-3">
            서버에는 해시만 저장되어 <strong>이 화면을 닫으면 다시 볼 수 없습니다.</strong> 개인별로 전달하세요
            (단체 메시지 금지).
          </p>
          <ul className="mt-4 space-y-2">
            {issued.map((x) => (
              <li key={x.userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 font-medium text-ink">{x.name}</span>
                <span className="w-52 font-mono text-xs text-muted">{x.email}</span>
                <code className="rounded bg-surface-soft px-2 py-1 font-mono text-sm font-bold tracking-wider text-ink">
                  {x.password}
                </code>
                <button onClick={() => copy(x.password, x.userId)} className="btn-secondary btn-sm">
                  {copied === x.userId ? '복사됨' : '복사'}
                </button>
                <button
                  onClick={() =>
                    copy(
                      `[Tincase — 주간 업무일지 계정]\n주소: ${window.location.origin}\n아이디: ${x.email}\n임시 비밀번호: ${x.password}\n첫 로그인 후 비밀번호를 변경해 주세요.`,
                      `msg-${x.userId}`,
                    )
                  }
                  className="btn-ghost"
                >
                  {copied === `msg-${x.userId}` ? '복사됨' : '안내문 복사'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card-flush" aria-labelledby="divisions">
        <div className="px-5 pt-5 sm:px-6">
          <h2 id="divisions" className="card-title">
            부서
          </h2>
          {/* 탭 — 취합게시판 제출 이력 기준. 페이지 탭은 잉크 밑줄 (CP-100) */}
          <div className="mt-3 flex gap-5 border-b border-hairline-soft" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`tab-line ${tab === t.key ? 'tab-line-active' : ''}`}
              >
                {t.label}
                <span className="chip chip-muted px-2 py-0 text-xs">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <p className="py-3 text-sm text-muted">{TABS.find((t) => t.key === tab)?.hint}</p>
        </div>

        <div className="overflow-x-auto">
          {/* OPS-40 — 칸을 짜부라뜨리지 않는다. `w-full`만 두면 「비활성」이 세로로 쪼개진다 */}
          <table className="table w-max min-w-full">
            <thead>
              <tr>
                <th>부서</th>
                <th>별칭</th>
                <th>인원</th>
                <th>양식</th>
                <th>마감</th>
                <th>업무일지</th>
                <th>상태</th>
                <th className="text-right">편집 · 인원</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const editing = editingId === d.id;
                return (
                  <tr key={d.id} className={editing ? 'bg-surface-soft' : ''}>
                    <td className="py-2">
                      <span className={`font-medium ${d.isActive ? 'text-ink' : 'text-muted'}`}>{d.nameKo}</span>
                      {d.boardNote && <p className="mt-0.5 max-w-md text-xs leading-4 text-muted">{d.boardNote}</p>}
                    </td>
                    <td className="font-mono text-xs whitespace-nowrap text-muted">/{d.shortSlug ?? '—'}</td>
                    <td className="tabular-nums">{d.memberCount}</td>
                    <td>
                      {/*
                        OPS-41 — 세 상태를 구분한다. 예전에는 등록 기록만 보고 「✓」를 찍어서,
                        파일이 없는 부서도 켤 수 있어 보였다 — 켠 뒤에야 알게 된다.
                      */}
                      {d.templateState === 'missing' ? (
                        <span
                          title="등록 기록은 있는데 파일이 저장소에 없습니다 — 부서 설정에서 다시 올려주세요"
                          className="chip chip-warn text-xs"
                        >
                          파일 없음
                        </span>
                      ) : d.hasTemplate ? (
                        <span className="chip chip-ok text-xs">있음</span>
                      ) : (
                        <span className="chip chip-error text-xs">없음</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {editing ? (
                        <>
                          <select
                            aria-label={`${d.nameKo} 마감 요일`}
                            value={d.deadlineDow}
                            disabled={busy}
                            onChange={(e) => patchDivision(d.id, { deadlineDow: Number(e.target.value) })}
                            className="select h-8 px-2"
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
                            className="select h-8 px-2"
                          />
                        </>
                      ) : (
                        <span className="text-body">
                          {DOW[d.deadlineDow]} {d.deadlineTime}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {/* 집계 대상 — 조사(R-002)가 초기값이지만 현실이 바뀌면 운영자가 고친다.
                          코드에만 있으면 부서가 새로 시작해도 손댈 방법이 없다 */}
                      {editing ? (
                        <select
                          aria-label={`${d.nameKo} 업무일지 제출 여부`}
                          value={d.boardStatus}
                          disabled={busy}
                          onChange={(e) => patchDivision(d.id, { boardStatus: e.target.value })}
                          className="select h-8 px-2"
                        >
                          <option value="confirmed">제출함 (집계)</option>
                          <option value="none">안 냄</option>
                        </select>
                      ) : (
                        <span className="text-body">{d.boardStatus === 'confirmed' ? '제출함 (집계)' : '안 냄'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {editing ? (
                        <button
                          disabled={busy}
                          onClick={() => patchDivision(d.id, { isActive: !d.isActive })}
                          aria-pressed={d.isActive}
                          className="btn-secondary h-8 px-3 text-sm"
                        >
                          {d.isActive ? '활성 · 끄기' : '비활성 · 켜기'}
                        </button>
                      ) : (
                        <span className={`chip text-xs ${d.isActive ? 'chip-ok' : 'chip-muted'}`}>
                          {d.isActive ? '활성' : '비활성'}
                        </span>
                      )}
                    </td>
                    <td className="py-0 text-right whitespace-nowrap">
                      <button onClick={() => setEditingId(editing ? null : d.id)} className="btn-ghost">
                        {editing ? '완료' : '편집'}
                      </button>
                      <button onClick={() => openRoster(d.id)} className="btn-ghost">
                        열기
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-muted">
                    이 분류에 해당하는 부서가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 스크롤 없이 바로 보이도록 드로어로 (기존엔 표 아래에 펼쳐져 스크롤이 필요했다) */}
      <RosterDrawer
        divisionName={selectedName}
        users={users}
        busy={busy}
        onClose={() => setSelected(null)}
        onPatch={patchUser}
        onResetPassword={resetPassword}
        onSendSetupLink={sendSetupLink}
      />
    </div>
  );
}
