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

  /** 열기·받기 — 표와 카드가 같은 것을 쓴다 (두 벌이면 갈라진다) */
  const actions = (r: HistoryRow) =>
    r.submissionId && (
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
    );

  return (
    <>
      {/*
        UX-02 — 휴대폰에서는 **표를 쓰지 않는다** (v1.23.2).
        `overflow-x-auto` 안에 `w-full` 표를 두면 스크롤되는 게 아니라 **눌린다** —
        390px에서 머리글이 「버\n전」「제출\n시각」처럼 세로로 쪼개져 읽을 수 없었다 (실측).
        가로 스크롤로 바꿔도 버튼이 화면 밖에 있어 불편하다. 그래서 좁은 화면은 카드로 쌓는다.
      */}
      <ul className="mt-4 space-y-2 sm:hidden">
        {rows.map((r) => (
          <li
            key={r.slotId}
            className={`card flex items-center justify-between gap-3 px-4 py-3 ${!r.submissionId ? 'bg-surface-soft/60' : ''}`}
          >
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {r.label}
                {r.monthly && (
                  <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">
                    월간
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs">
                {r.submissionId ? (
                  <>
                    <span className="text-success">● 제출</span>
                    <span className="ml-1.5 tabular-nums text-muted">
                      {r.uploadedAtKst}
                      {r.version ? ` · v${r.version}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-soft">미제출</span>
                )}
              </p>
            </div>
            <div className="shrink-0">{actions(r)}</div>
          </li>
        ))}
      </ul>

      <div className="card mt-4 hidden overflow-x-auto sm:block">
        <table className="w-full text-sm whitespace-nowrap">
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
                <td className="px-4 py-2.5 text-right">{actions(r)}</td>
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
