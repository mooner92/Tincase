'use client';
// CP-48~53 + 드로어 연동 (PG-19/20). 서버(ManageView)가 데이터를 내려주고 여기서 상호작용만.
//
// 2026-10-07 (PG-52) — 줄마다 테두리 버튼 「열기」와 ↓ 상자가 있어 표가 버튼 밭이었고, 「크기」 열은 모든 줄이
// 38.5 KB였다(양식이 같으니 크기도 같다 — 읽을 것이 없는 열). 크기를 빼고, 줄 행동은 테두리 없는 버튼(btn-ghost)으로,
// 버전은 「v2」만 둔다(「v2 (2)」의 괄호를 읽을 수 있는 사람이 없었다). 640px 미만은 표 대신 줄 목록이다(UX-02).
//
// 2026-10-08 (PG-73 — 기능 정리) — 줄마다 [받기](R8)와 머리의 [전체 zip 받기](R1)를 지웠다. 제출물 다운로드는 운영자 3건,
// zip은 0건이었다 — 받을 일이 있으면 [열기] 드로어의 [원본 다운로드] 하나다. 표 밑 「집계 제외: …」 각주(R7)도 지웠다 —
// 명단 밖인데 낸 사람은 「추가 제출」 표가 따로 보이고, 안 낸 사람은 셀 것이 없다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDrawer, type DrawerMember } from './FileDrawer';
import { BellIcon } from './BellIcon';

export interface MemberRow {
  user: { id: string; name: string };
  status: 'submitted' | 'missing';
  latest: { id: string; version: number; uploadedAtKst: string } | null;
  versionCount: number;
  /** NT-31 — 이 주차에 마감 알림을 받은 시각 (KST "13:00") */
  notifiedAtKst?: string | null;
}

export function SubmissionTableClient({
  members,
  caption,
  title,
  canDelete = false,
}: {
  members: MemberRow[];
  caption: string;
  /** 카드 제목 — 「부서원 11명」 */
  title: string;
  /** TACP-14 — operator만. 담당자에게는 렌더하지 않는다 (TACP-9) */
  canDelete?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const remove = async (row: MemberRow) => {
    if (!row.latest) return;
    const n = row.versionCount;
    if (
      !confirm(
        `${row.user.name} 님의 이번 주 제출을 삭제합니다.\n` +
          `${n > 1 ? `올린 파일 ${n}개가 ` : '올린 파일이 '}모두 지워지고 미제출 상태가 됩니다.\n` +
          `되돌릴 수 없습니다.`,
      )
    )
      return;
    setBusyId(row.latest.id);
    setErr(null);
    const res = await fetch(`/api/submissions/${row.latest.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(`${row.user.name}: ${body.message ?? '삭제하지 못했습니다.'}`);
      setBusyId(null);
      return;
    }
    router.refresh();
  };

  const drawerMembers: DrawerMember[] = members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    latestId: m.latest?.id ?? null,
  }));

  /** 상태 — 점 + 낱말. 안 낸 사람에게 알림이 갔으면 벨 (NT-31) */
  const status = (m: MemberRow) =>
    m.status === 'submitted' ? (
      <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap text-success">
        <span aria-hidden className="dot" />
        제출
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
        <span aria-hidden className="dot dot-hollow text-border-strong" />
        미제출
        {m.notifiedAtKst && (
          <span title={`마감 알림을 보냈습니다 (${m.notifiedAtKst})`} className="ml-1 text-muted-soft">
            <BellIcon />
            <span className="sr-only">알림 보냄 {m.notifiedAtKst}</span>
          </span>
        )}
      </span>
    );

  /** 열기·삭제 — 표와 줄 목록이 같은 것을 쓴다 (두 벌이면 갈라진다) */
  const actions = (m: MemberRow) =>
    m.latest && (
      <span className="inline-flex items-center gap-0.5">
        <button onClick={() => setOpenId(m.latest!.id)} className="btn-ghost" aria-label={`${m.user.name} 제출물 열기`}>
          열기
        </button>
        {/* 운영자 전용 (TACP-14). 파괴적이라 다른 버튼과 같은 무게로 두지 않는다 */}
        {canDelete && (
          <button
            onClick={() => remove(m)}
            disabled={busyId === m.latest.id}
            aria-label={`${m.user.name} 제출물 삭제`}
            className="btn-link-danger ml-1.5"
          >
            {busyId === m.latest.id ? '…' : '삭제'}
          </button>
        )}
      </span>
    );

  return (
    <>
      <section className="card card-flush">
        <div className="card-head items-center px-5 pt-4 pb-3 sm:px-6">
          <h2 className="card-title">{title}</h2>
        </div>

        {/* 좁은 화면 — 줄 목록. 표를 누르면 열 머리가 세로로 쪼개지고 버튼이 화면 밖으로 나갔다 (UX-02) */}
        <ul className="border-t border-hairline-soft sm:hidden">
          {members.map((m) => (
            <li key={m.user.id} className="flex items-center justify-between gap-3 border-t border-hairline-soft px-5 py-2.5 first:border-t-0">
              <div className="min-w-0">
                <p className="font-medium text-ink">{m.user.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  {status(m)}
                  {m.latest && (
                    <span className="text-muted tabular-nums">
                      v{m.latest.version} · {m.latest.uploadedAtKst}
                    </span>
                  )}
                </p>
              </div>
              <div className="shrink-0">{actions(m)}</div>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">상태</th>
                <th scope="col">버전</th>
                <th scope="col">제출시각</th>
                <th scope="col" className="text-right">
                  {canDelete ? '열람 · 삭제' : '열람'}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user.id}>
                  <td className="font-medium whitespace-nowrap text-ink">{m.user.name}</td>
                  <td>{status(m)}</td>
                  <td className="text-body">{m.latest ? `v${m.latest.version}` : '—'}</td>
                  <td className="whitespace-nowrap text-body">{m.latest?.uploadedAtKst ?? '—'}</td>
                  <td className="py-0 text-right">{actions(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <p className="border-t border-hairline-soft px-5 py-3 text-sm text-error sm:px-6">{err}</p>}
      </section>

      <FileDrawer openId={openId} members={drawerMembers} onClose={() => setOpenId(null)} onNavigate={setOpenId} />
    </>
  );
}
