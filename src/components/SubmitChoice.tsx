'use client';
// WA-02 — 제출 방법 두 갈래. **파일 업로드를 없애지 않는다.**
// 한글에서 표·서식을 쓰는 사람이 있고, 웹 작성이 막혔을 때의 폴백도 필요하다.
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
}) {
  const [mode, setMode] = useState<'upload' | 'web'>('upload');
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

  return (
    <div>
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

      {mode === 'upload' ? (
        <UploadDropzone hasPrevious={hasPrevious} />
      ) : (
        <div className="card-cream px-7 py-6">
          <p className="text-sm leading-6 text-body">
            한글을 열지 않고 화면에서 바로 적어 제출합니다.
            <br />
            제출하면 <span className="font-medium text-ink">부서 양식으로 만들어져</span> 파일로 올린 것과 똑같이 처리됩니다.
          </p>
          <button onClick={start} disabled={loading} className="btn-primary mt-4">
            {loading ? '불러오는 중…' : hasPrevious ? '웹에서 다시 작성' : '웹에서 작성 시작'}
          </button>
        </div>
      )}

      {composing && <WebComposer
          isoKey={isoKey}
          guideLines={guideLines}
          emptyWordsRaw={emptyWordsRaw}
          initial={composing.initial}
          initialVersion={current?.version}
          initialFailed={composing.failed}
          weekStartMs={weekStartMs}
          onClose={() => setComposing(null)}
        />}
    </div>
  );
}
