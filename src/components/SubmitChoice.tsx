'use client';
// 제출 방법. WA-02 — 업로드와 웹 작성 두 갈래였다.
//
// WA-30~32 · ADR-0014 — 업로드는 서버 스위치로 단계적으로 닫는다. 닫힌 서버에서는
// 탭도 드롭존도 그리지 않고 웹 작성 하나만 남긴다 — 못 쓰는 길을 그리지 않는다(TACP-9).
// 스위치는 서버만 안다. 이 컴포넌트는 페이지가 넘긴 `uploadOpen`만 본다.
import { useState } from 'react';
import { UploadDropzone } from './UploadDropzone';
import { WebComposer, type ComposerRow } from './WebComposer';

type Rows = Record<'achievements' | 'plans' | 'notes', ComposerRow[]>;

export function SubmitChoice({
  hasPrevious,
  current,
  isoKey,
  weekStartMs,
  guideLines,
  emptyWordsRaw,
  uploadOpen,
}: {
  hasPrevious: boolean;
  /** WA-35 — 이번 주에 낸 판. 「다시 작성」이 여기서 시작한다 */
  current?: { id: string; version: number } | null;
  isoKey: string;
  /** WA-36a — 이번 주 월요일 00:00 KST (일자 예시) */
  weekStartMs: number;
  guideLines: string[];
  /** HM-33 — 부서가 정한 「내용 없음」 낱말. 비면 검사하지 않는다 */
  emptyWordsRaw?: string;
  /** PG-11 — `hwpUploadOpen()`의 값. false면 웹 작성만 */
  uploadOpen: boolean;
}) {
  const [mode, setMode] = useState<'upload' | 'web'>(uploadOpen ? 'upload' : 'web');
  const [composing, setComposing] = useState<{ initial: Rows | null; failed: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  /*
   * WA-35 — 이번 주에 낸 판이 있으면 그 표로 연다. 날짜 하나 고치려고 일곱 줄을 다시 적게 하면
   * 그냥 두거나 담당자에게 부탁한다. 표는 열람과 같은 응답(`rowsByTable`, 「공유」 포함)에서 온다 —
   * 본인 것은 원래 열람할 수 있으므로 새 권한이 생기지 않는다.
   * 임시본이 있으면 그쪽이 먼저인데(WA-35a), 그래도 받아 둔다 — [지금 낸 판으로 다시 시작]에 쓴다.
   */
  const start = async () => {
    if (!current) {
      setComposing({ initial: null, failed: false });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/submissions/${current.id}/preview`);
      const b = r.ok ? ((await r.json()) as { rowsByTable?: Rows }) : null;
      setComposing({ initial: b?.rowsByTable ?? null, failed: !b?.rowsByTable });
    } catch {
      setComposing({ initial: null, failed: true });
    } finally {
      setLoading(false);
    }
  };

  // PG-12 — 할 일 하나. 아직 안 냈으면 이것이 이 카드의 주 버튼이고, 냈으면 「다시 작성」은 보조 버튼이다(CP-99)
  const composeButton = (
    <button onClick={start} disabled={loading} className={hasPrevious ? 'btn-secondary btn-sm' : 'btn-primary'}>
      {loading ? '불러오는 중…' : hasPrevious ? '다시 작성 (새 버전)' : '작성하기'}
    </button>
  );
  const composer = composing && (
    <WebComposer
      isoKey={isoKey}
      guideLines={guideLines}
      emptyWordsRaw={emptyWordsRaw}
      initial={composing.initial}
      initialVersion={current?.version}
      initialFailed={composing.failed}
      weekStartMs={weekStartMs}
      onClose={() => setComposing(null)}
    />
  );

  // 업로드가 닫힌 서버 — 카드의 행동 줄에 버튼 하나로 들어간다 (내 제출물 버튼들과 한 줄)
  if (!uploadOpen) {
    return (
      <>
        {composeButton}
        {composer}
      </>
    );
  }

  // 업로드가 열린 서버 — 두 갈래를 고르는 묶음은 행동 줄 **아래** 제 줄을 차지한다(order-last · w-full)
  return (
    <div className="order-last mt-3 w-full">
      {uploadOpen && (
        <div className="mb-3 flex gap-1.5">
          <button
            onClick={() => setMode('upload')}
            className={`tab-pill ${mode === 'upload' ? 'tab-pill-active' : ''}`}
          >
            파일 올리기
          </button>
          <button onClick={() => setMode('web')} className={`tab-pill ${mode === 'web' ? 'tab-pill-active' : ''}`}>
            웹에서 작성
          </button>
        </div>
      )}

      {uploadOpen && mode === 'upload' ? (
        <UploadDropzone hasPrevious={hasPrevious} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {composeButton}
          {/* 두 길이 있을 때만 「둘이 같다」고 안심시킨다. 하나뿐이면 비교할 대상이 없다 */}
          <p className="text-sm text-muted">한글 없이 화면에서 적습니다 — 파일로 올린 것과 똑같이 처리됩니다.</p>
        </div>
      )}

      {composer}
    </div>
  );
}
