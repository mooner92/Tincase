'use client';
// 내 제출물 — 받기 + **화면에서 바로 열어보기**.
//
// 미리보기 드로어는 담당자 화면에만 붙어 있었다. 그런데 "내가 뭘 냈더라"를
// 확인하려면 파일을 내려받아 한글을 열어야 했다 — 자기 것인데도.
// 미리보기 API는 처음부터 본인에게 열려 있었으므로(AU-13) 화면만 없던 것이다.
import { useState } from 'react';
import { FileDrawer } from './FileDrawer';

export function MySubmissionCard({
  submissionId,
  userId,
  userName,
  version,
  uploadedAtKst,
  sizeKb,
  originalName,
}: {
  submissionId: string;
  userId: string;
  userName: string;
  version: number;
  uploadedAtKst: string;
  sizeKb: string;
  originalName: string;
}) {
  // 버전 전환도 이 상태를 바꾼다 — 빈 함수를 넘기면 v2를 골라도 아무 일이 없다
  const [viewId, setViewId] = useState<string | null>(null);

  return (
    <>
      <section className="card-feature bg-brand-mint/35 px-7 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="display text-xl">
              <span aria-hidden className="mr-1.5 text-success">
                ✓
              </span>
              제출 완료 <span className="text-muted">v{version}</span>
            </p>
            <p className="mt-1 truncate text-sm text-body">
              {uploadedAtKst} · {sizeKb} KB · {originalName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setViewId(submissionId)} className="btn-oncolor">
              열어보기
            </button>
            <a href={`/api/submissions/${submissionId}/download`} className="btn-secondary btn-sm">
              내 파일 받기
            </a>
          </div>
        </div>
      </section>

      {/* 드로어는 여러 사람을 오가도록 만들어졌지만 여기서는 나 하나다.
          ←→ 는 드로어가 알아서 숨기고, 버전 전환은 onNavigate로 들어온다 */}
      <FileDrawer
        openId={viewId}
        members={[{ userId, name: userName, latestId: submissionId }]}
        onClose={() => setViewId(null)}
        onNavigate={setViewId}
      />
    </>
  );
}
