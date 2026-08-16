'use client';
// 내 제출물 — 받기 + **화면에서 바로 열어보기**.
//
// 미리보기 드로어는 담당자 화면에만 붙어 있었다. 그런데 "내가 뭘 냈더라"를
// 확인하려면 파일을 내려받아 한글을 열어야 했다 — 자기 것인데도.
// 미리보기 API는 처음부터 본인에게 열려 있었으므로(AU-13) 화면만 없던 것이다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDrawer } from './FileDrawer';

export function MySubmissionCard({
  submissionId,
  userId,
  userName,
  version,
  uploadedAtKst,
  sizeKb,
  originalName,
  canCancel,
}: {
  submissionId: string;
  userId: string;
  userName: string;
  version: number;
  uploadedAtKst: string;
  sizeKb: string;
  originalName: string;
  /** TACP-14 — 마감 전에만. 못 하는 행동의 버튼은 렌더하지 않는다 (TACP-9) */
  canCancel: boolean;
}) {
  // 버전 전환도 이 상태를 바꾼다 — 빈 함수를 넘기면 v2를 골라도 아무 일이 없다
  const [viewId, setViewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  // 되돌릴 수 없는 행동이다 (ADR-0007). 버전이 여럿이면 몇 개가 사라지는지 먼저 말한다
  const cancel = async () => {
    const warn =
      version > 1
        ? `이번 주 제출을 취소합니다.\n올린 파일 ${version}개(v1~v${version})가 모두 삭제되고 미제출 상태가 됩니다.\n되돌릴 수 없습니다.`
        : '이번 주 제출을 취소합니다.\n올린 파일이 삭제되고 미제출 상태가 됩니다.\n되돌릴 수 없습니다.';
    if (!confirm(warn)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/submissions/${submissionId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body.message ?? '취소하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
      return;
    }
    router.refresh();
  };

  return (
    <>
      <section className="card-feature bg-brand-soft px-7 py-6">
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
            {/* 파괴적 행동이라 남은 두 버튼과 같은 무게로 두지 않는다 — 텍스트 링크 */}
            {canCancel && (
              <button
                onClick={cancel}
                disabled={busy}
                className="ml-1 rounded-lg px-2 py-1.5 text-sm text-muted underline-offset-2 transition-colors hover:text-error hover:underline disabled:cursor-not-allowed disabled:text-muted-soft disabled:no-underline"
              >
                {busy ? '취소하는 중…' : '제출 취소'}
              </button>
            )}
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-error">{err}</p>}
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
