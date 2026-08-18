'use client';
// 내 이력 — 주차별 제출 현황 + 화면에서 바로 열어보기.
// 지난주에 뭘 냈는지 확인하려고 파일을 내려받아 한글을 열 이유가 없다
// (미리보기는 처음부터 본인에게 열려 있었다 — AU-13).
import { useState } from 'react';
import { FileDrawer } from './FileDrawer';

export interface HistoryRow {
  slotId: string;
  label: string;
  submissionId: string | null;
  version: number | null;
  uploadedAtKst: string | null;
  /** WS-14 — 그 달 마지막 주. 이력에서도 월간이 어느 주였는지 보여야 한다 */
  monthly?: boolean;
}

export function HistoryTable({
  rows,
  userId,
  userName,
}: {
  rows: HistoryRow[];
  userId: string;
  userName: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">주차</th>
              <th className="px-4 py-2.5 font-medium">상태</th>
              <th className="px-4 py-2.5 font-medium">버전</th>
              <th className="px-4 py-2.5 font-medium">제출시각</th>
              <th className="px-4 py-2.5 text-right font-medium">열람 · 받기</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.slotId}
                className={`border-b border-hairline-soft last:border-0 ${!r.submissionId ? 'bg-surface-soft/60' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium text-ink">
                  {r.label}
                  {r.monthly && (
                    <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">
                      월간
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.submissionId ? (
                    <span className="text-success">● 제출</span>
                  ) : (
                    <span className="text-muted-soft">미제출</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-body">{r.version ? `v${r.version}` : '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-body">{r.uploadedAtKst ?? '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.submissionId && (
                    <span className="inline-flex gap-1.5">
                      <button
                        onClick={() => setOpenId(r.submissionId)}
                        className="rounded border border-hairline px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-soft"
                      >
                        열기
                      </button>
                      <a
                        href={`/api/submissions/${r.submissionId}/download`}
                        className="rounded border border-hairline px-2.5 py-1 text-xs font-medium text-body hover:bg-surface-soft"
                      >
                        ↓ 받기
                      </a>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FileDrawer
        openId={openId}
        members={[{ userId, name: userName, latestId: openId }]}
        onClose={() => setOpenId(null)}
        onNavigate={setOpenId}
      />
    </>
  );
}
