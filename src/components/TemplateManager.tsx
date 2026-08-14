'use client';
// CP-82~84 — 부서 양식 관리. 교체 실패 시 기존 양식 유지 명시.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type St =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; version: number; summary: { rows: number; cols: number }[]; warnings: string[] }
  | { kind: 'error'; message: string };

export function TemplateManager({ current }: { current: { version: number; uploadedAtKst: string } | null }) {
  const [st, setSt] = useState<St>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const send = (file: File) => {
    setSt({ kind: 'uploading' });
    const fd = new FormData();
    fd.set('file', file);
    fetch('/api/division/template', { method: 'POST', body: fd })
      .then(async (r) => {
        const body = await r.json();
        if (r.status === 201) {
          setSt({ kind: 'done', version: body.template.version, summary: body.parsedSummary, warnings: body.warnings });
          router.refresh();
        } else {
          setSt({ kind: 'error', message: body.message ?? '등록에 실패했습니다.' });
        }
      })
      .catch(() => setSt({ kind: 'error', message: '네트워크 오류입니다. 기존 양식은 그대로 유지됩니다.' }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {current ? (
          <p className="text-sm text-slate-700">
            현재 양식 <span className="font-semibold">v{current.version}</span>
            <span className="ml-2 text-slate-400">{current.uploadedAtKst} 등록</span>
          </p>
        ) : (
          <p className="text-sm text-red-700">등록된 양식이 없습니다 — 등록 전까지 부서원 업로드가 막힙니다.</p>
        )}
        <div className="flex gap-2">
          {current && (
            /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 내비게이션 아님 */
            <a
              href="/api/template"
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              현재 양식 받기
            </a>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={st.kind === 'uploading'}
            className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {st.kind === 'uploading' ? '등록 중…' : current ? '양식 교체' : '양식 등록'}
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".hwp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
          e.target.value = '';
        }}
      />
      <div aria-live="polite">
        {st.kind === 'done' && (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            ✓ v{st.version} 등록 완료 · 표 {st.summary.length}개 (
            {st.summary.map((t) => `${t.rows}행`).join(' · ')}) 파싱 확인 {/* CP-83 */}
            {st.warnings.length > 0 && <p className="mt-1 text-xs text-amber-700">{st.warnings.join(' · ')}</p>}
          </div>
        )}
        {st.kind === 'error' && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {st.message} {/* CP-84 — 기존 양식 유지는 서버 메시지에 포함 */}
          </p>
        )}
      </div>
    </div>
  );
}
