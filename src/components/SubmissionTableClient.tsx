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
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th scope="col" className="px-4 py-2.5 font-medium">이름</th>
              <th scope="col" className="px-4 py-2.5 font-medium">상태</th>
              <th scope="col" className="px-4 py-2.5 font-medium">버전</th>
              <th scope="col" className="px-4 py-2.5 font-medium">제출시각</th>
              <th scope="col" className="px-4 py-2.5 font-medium">크기</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">열람 · 받기</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.user.id}
                className={`border-b border-slate-100 last:border-0 ${m.status === 'missing' ? 'bg-slate-50/60' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium text-slate-800">{m.user.name}</td>
                <td className="px-4 py-2.5">
                  {m.status === 'submitted' ? (
                    <span className="text-green-700">● 제출</span>
                  ) : (
                    <span className="text-slate-400">○ 미제출</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {m.latest ? `v${m.latest.version}${m.versionCount > 1 ? ` (${m.versionCount})` : ''}` : '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">{m.latest?.uploadedAtKst ?? '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {m.latest ? `${(m.latest.byteSize / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {m.latest && (
                    <span className="inline-flex gap-1.5">
                      <button
                        onClick={() => setOpenId(m.latest!.id)}
                        className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        열기
                      </button>
                      <a
                        href={`/api/submissions/${m.latest.id}/download`}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
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
