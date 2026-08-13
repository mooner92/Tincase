'use client';
// CP-23~33 — 업로드 드롭존. XHR(진행률) · 자동 재시도 없음(CP-33) · 오류 한국어 매핑(CP-28)
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type UploadState =
  | { kind: 'idle' }
  | { kind: 'dragover' }
  | { kind: 'uploading'; fileName: string; percent: number }
  | { kind: 'success'; version: number; sameAsPrevious: boolean }
  | { kind: 'error'; message: string; canRetry: boolean };

const MAX_BYTES = 20 * 1024 * 1024;

export function UploadDropzone({ hasPrevious }: { hasPrevious: boolean }) {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const router = useRouter();
  const busy = state.kind === 'uploading';

  const send = useCallback(
    (file: File) => {
      // CP-25 — 전송 전 1차 검증 (즉시 피드백)
      if (!/\.hwp$/i.test(file.name)) {
        const isHwpx = /\.hwpx$/i.test(file.name);
        setState({
          kind: 'error',
          canRetry: false,
          message: isHwpx
            ? '.hwpx는 받지 않습니다. 한글에서 [다른 이름으로 저장] → [한글 문서(*.hwp)]로 저장 후 올려주세요.'
            : '한글(.hwp) 파일만 올릴 수 있습니다.',
        });
        return;
      }
      if (file.size > MAX_BYTES) {
        setState({ kind: 'error', canRetry: false, message: '파일이 너무 큽니다 (최대 20MB).' });
        return;
      }
      if (file.size === 0) {
        // CP-32 — 폴더 드롭 등
        setState({ kind: 'error', canRetry: false, message: '빈 파일이거나 폴더입니다. hwp 파일을 선택해 주세요.' });
        return;
      }

      lastFileRef.current = file;
      setState({ kind: 'uploading', fileName: file.name, percent: 0 });

      const xhr = new XMLHttpRequest(); // CP-26: fetch는 업로드 진행률이 없다
      xhr.open('POST', '/api/submissions');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setState({ kind: 'uploading', fileName: file.name, percent: Math.round((e.loaded / e.total) * 100) });
        }
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || '{}');
          if (xhr.status === 201) {
            setState({ kind: 'success', version: body.submission.version, sameAsPrevious: body.sameAsPrevious });
            router.refresh(); // CP-30
          } else if (body.error === 'slot_locked') {
            setState({ kind: 'error', canRetry: false, message: body.message }); // CP-29
            router.refresh(); // 잠김 화면으로
          } else {
            setState({ kind: 'error', canRetry: false, message: body.message ?? '업로드에 실패했습니다.' });
          }
        } catch {
          setState({ kind: 'error', canRetry: true, message: '응답을 해석할 수 없습니다. 다시 시도해 주세요.' });
        }
      };
      xhr.onerror = () => {
        // CP-33 — 자동 재시도 금지 (중복 버전 방지). 사용자가 결정
        setState({ kind: 'error', canRetry: true, message: '네트워크 오류로 전송하지 못했습니다.' });
      };
      const fd = new FormData();
      fd.set('file', file);
      xhr.send(fd);
    },
    [router],
  );

  const onFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (busy || !files || files.length === 0) return; // CP-27
      const list = Array.from(files);
      if (list.length > 1) {
        setState({ kind: 'error', canRetry: false, message: '한 개만 올릴 수 있습니다. 첫 번째 파일로 진행하려면 다시 선택해 주세요.' }); // CP-31
        return;
      }
      send(list[0]);
    },
    [busy, send],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="hwp 파일 업로드"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setState((s) => (s.kind === 'idle' || s.kind === 'error' || s.kind === 'success' ? { kind: 'dragover' } : s));
        }}
        onDragLeave={() => setState((s) => (s.kind === 'dragover' ? { kind: 'idle' } : s))}
        onDrop={(e) => {
          e.preventDefault();
          if (state.kind === 'dragover') setState({ kind: 'idle' });
          onFiles(e.dataTransfer.files);
        }}
        className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          state.kind === 'dragover'
            ? 'border-blue-500 bg-blue-50'
            : busy
              ? 'cursor-wait border-slate-300 bg-slate-50'
              : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".hwp"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = ''; // 같은 파일 재선택 허용
          }}
        />
        {state.kind === 'uploading' ? (
          <div className="w-full max-w-xs">
            <p className="mb-2 truncate text-sm text-slate-600">{state.fileName} 올리는 중…</p>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${state.percent}%` }} />
            </div>
            <p className="mt-1 text-right text-xs tabular-nums text-slate-500">{state.percent}%</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">
              여기에 hwp 파일을 끌어다 놓거나 <span className="text-blue-700 underline">클릭해서 선택</span>하세요
            </p>
            <p className="mt-1 text-xs text-slate-400">.hwp · 최대 20MB{hasPrevious && ' · 다시 올리면 새 버전으로 저장됩니다'}</p>
          </>
        )}
      </div>

      <div aria-live="polite">
        {state.kind === 'success' && (
          <p className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            ✓ 제출 완료 (v{state.version})
            {state.sameAsPrevious && ' — 이전 버전과 내용이 동일합니다'}
          </p>
        )}
        {state.kind === 'error' && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{state.message}</p>
            {state.canRetry && (
              <button
                onClick={() => lastFileRef.current && send(lastFileRef.current)}
                className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100"
              >
                다시 시도
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
