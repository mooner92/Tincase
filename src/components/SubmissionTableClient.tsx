'use client';
// CP-48~53 + 드로어 연동 (PG-19/20). 서버(ManageView)가 데이터를 내려주고 여기서 상호작용만.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDrawer, type DrawerMember } from './FileDrawer';

export interface MemberRow {
  user: { id: string; name: string };
  status: 'submitted' | 'missing';
  latest: { id: string; version: number; byteSize: number; uploadedAtKst: string } | null;
  versionCount: number;
  /** NT-31 — 이 주차에 마감 알림을 받은 시각 (KST "13:00") */
  notifiedAtKst?: string | null;
}

export function SubmissionTableClient({
  members,
  caption,
  canDelete = false,
}: {
  members: MemberRow[];
  caption: string;
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
          `되돌릴 수 없으며 감사 로그에 남습니다.`,
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

  return (
    <>
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="table-head border-b border-hairline">
              <th scope="col" className="px-5 py-3 font-medium">이름</th>
              <th scope="col" className="px-5 py-3 font-medium">상태</th>
              <th scope="col" className="px-5 py-3 font-medium">버전</th>
              <th scope="col" className="px-5 py-3 font-medium">제출시각</th>
              <th scope="col" className="px-5 py-3 font-medium">크기</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">{canDelete ? '열람 · 받기 · 삭제' : '열람 · 받기'}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.user.id}
                className={`border-b border-hairline-soft last:border-0 ${m.status === 'missing' ? 'bg-surface-soft/60' : ''}`}
              >
                <td className="px-5 py-3 font-medium text-ink">{m.user.name}</td>
                <td className="px-5 py-3">
                  {m.status === 'submitted' ? (
                    <span className="font-medium text-success">● 제출</span>
                  ) : (
                    <span className="text-muted-soft">
                      ○ 미제출
                      {m.notifiedAtKst && (
                        <span
                          className="ml-2 rounded-full border border-hairline px-1.5 py-px text-[10px] text-muted-soft"
                          title={`마감 알림을 보냈습니다 (${m.notifiedAtKst})`}
                        >
                          알림
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums text-body">
                  {m.latest ? `v${m.latest.version}${m.versionCount > 1 ? ` (${m.versionCount})` : ''}` : '—'}
                </td>
                <td className="px-5 py-3 tabular-nums text-body">{m.latest?.uploadedAtKst ?? '—'}</td>
                <td className="px-5 py-3 tabular-nums text-body">
                  {m.latest ? `${(m.latest.byteSize / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  {m.latest && (
                    <span className="inline-flex gap-1.5">
                      <button onClick={() => setOpenId(m.latest!.id)} className="btn-secondary btn-sm">
                        열기
                      </button>
                      <a href={`/api/submissions/${m.latest.id}/download`} className="inline-flex h-9 items-center justify-center rounded-lg border border-hairline px-3 text-sm text-body transition-colors hover:bg-surface-soft" aria-label={`${m.user.name} 파일 받기`}>
                        ↓
                      </a>
                      {/* 운영자 전용 (TACP-14). 파괴적이라 다른 버튼과 같은 무게로 두지 않는다 */}
                      {canDelete && (
                        <button
                          onClick={() => remove(m)}
                          disabled={busyId === m.latest.id}
                          aria-label={`${m.user.name} 제출물 삭제`}
                          className="inline-flex h-9 items-center justify-center rounded-lg px-2 text-sm text-muted-soft transition-colors hover:bg-error-soft hover:text-error disabled:cursor-not-allowed"
                        >
                          {busyId === m.latest.id ? '…' : '삭제'}
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {err && <p className="mt-2 px-1 text-sm text-error">{err}</p>}

      <FileDrawer openId={openId} members={drawerMembers} onClose={() => setOpenId(null)} onNavigate={setOpenId} />
    </>
  );
}
