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
  /** TACP-22 — 담당자가 고친 판이면 고친 사람. 내 글이 바뀐 것을 본인이 안다 */
  editedBy?: string | null;
  /** TACP-22 — 고친 시각 (KST "HH:MM"). 제출시각(`uploadedAtKst`)은 내가 낸 시각 그대로다 */
  editedAtKst?: string | null;
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
      <span className="inline-flex gap-0.5">
        <button onClick={() => setOpenId(r.submissionId)} className="btn-ghost">
          열기
        </button>
        <a href={`/api/submissions/${r.submissionId}/download`} className="btn-ghost">
          받기
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
      <ul className="card card-flush mt-6 divide-y divide-hairline-soft sm:hidden">
        {rows.map((r) => (
          <li key={r.slotId} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {r.label}
                {r.monthly && <span className="chip chip-ok ml-2 px-2 text-xs">월간</span>}
              </p>
              <p className="mt-0.5 text-xs">
                {r.submissionId ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <span aria-hidden className="dot" />
                      제출
                    </span>
                    <span className="ml-1.5 tabular-nums text-muted">
                      {r.uploadedAtKst}
                      {r.version ? ` · v${r.version}` : ''}
                    </span>
                    {r.editedBy && (
                      <span className="ml-1.5 text-warning">
                        · {r.editedBy} 고침{r.editedAtKst ? ` · ${r.editedAtKst}` : ''}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">미제출</span>
                )}
              </p>
            </div>
            <div className="shrink-0">{actions(r)}</div>
          </li>
        ))}
      </ul>

      <div className="card card-flush mt-6 hidden overflow-x-auto sm:block">
        <table className="table whitespace-nowrap">
          <thead>
            <tr>
              <th>주차</th>
              <th>상태</th>
              <th>버전</th>
              <th>제출시각</th>
              <th className="text-right">열람 · 받기</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slotId}>
                <td className="font-medium text-ink">
                  {r.label}
                  {r.monthly && <span className="chip chip-ok ml-2 px-2 text-xs">월간</span>}
                </td>
                <td>
                  {r.submissionId ? (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <span aria-hidden className="dot" />
                      제출
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <span aria-hidden className="dot dot-hollow text-border-strong" />
                      미제출
                    </span>
                  )}
                </td>
                <td className="text-body">
                  {r.version ? `v${r.version}` : '—'}
                  {r.editedBy && (
                    <span className="ml-1.5 text-xs text-warning">
                      {r.editedBy} 고침{r.editedAtKst ? ` · ${r.editedAtKst}` : ''}
                    </span>
                  )}
                </td>
                <td className="text-body">{r.uploadedAtKst ?? '—'}</td>
                <td className="py-0 text-right">{actions(r)}</td>
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
