'use client';
// WA-02 — 제출 방법 두 갈래. **파일 업로드를 없애지 않는다.**
// 한글에서 표·서식을 쓰는 사람이 있고, 웹 작성이 막혔을 때의 폴백도 필요하다.
import { useState } from 'react';
import { UploadDropzone } from './UploadDropzone';
import { WebComposer } from './WebComposer';

export function SubmitChoice({
  hasPrevious,
  isoKey,
  guideLines,
}: {
  hasPrevious: boolean;
  isoKey: string;
  guideLines: string[];
}) {
  const [mode, setMode] = useState<'upload' | 'web'>('upload');
  const [composing, setComposing] = useState(false);

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
          <button onClick={() => setComposing(true)} className="btn-primary mt-4">
            {hasPrevious ? '웹에서 다시 작성' : '웹에서 작성 시작'}
          </button>
        </div>
      )}

      {composing && <WebComposer isoKey={isoKey} guideLines={guideLines} onClose={() => setComposing(false)} />}
    </div>
  );
}
