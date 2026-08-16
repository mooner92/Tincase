'use client';
// CP-48~53 + 드로어 연동 (PG-19/20). 서버(ManageView)가 데이터를 내려주고 여기서 상호작용만.
import { useState } from 'react';
import { FileDrawer, type DrawerMember } from './FileDrawer';

export interface MemberRow {
  user: { id: string; name: string };
  status: 'submitted' | 'missing';
  latest: { id: string; version: number; byteSize: number; uploadedAtKst: string } | null;
  versionCount: number;
}

export function SubmissionTableClient({ members, caption }: { members: MemberRow[]; caption: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

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
              <th scope="col" className="px-5 py-3 text-right font-medium">열람 · 받기</th>
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
                    <span className="text-muted-soft">○ 미제출</span>
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
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <FileDrawer openId={openId} members={drawerMembers} onClose={() => setOpenId(null)} onNavigate={setOpenId} />
    </>
  );
}
