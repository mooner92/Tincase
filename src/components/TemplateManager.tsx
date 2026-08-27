'use client';
// CP-82~84 — 부서 양식 관리. 교체 실패 시 기존 양식 유지 명시.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type St =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; version: number; summary: { rows: number; cols: number }[]; warnings: string[] }
  | { kind: 'error'; message: string };

export function TemplateManager({
  current,
  hasStandard,
}: {
  current: { version: number; uploadedAtKst: string } | null;
  hasStandard: boolean;
}) {
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
          <p className="text-sm text-body">
            현재 양식 <span className="font-semibold">v{current.version}</span>
            <span className="ml-2 text-muted-soft">{current.uploadedAtKst} 등록</span>
          </p>
        ) : (
          <p className="text-sm text-error">등록된 양식이 없습니다 — 등록 전까지 부서원 업로드가 막힙니다.</p>
        )}
        <div className="flex gap-2">
          {current && (
            /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 내비게이션 아님 */
            <a
              href="/api/template"
              className="rounded border border-hairline px-3 py-1.5 text-xs font-medium text-body hover:bg-surface-soft"
            >
              현재 양식 받기
            </a>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={st.kind === 'uploading'}
            className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-active disabled:opacity-50"
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

      {/* ST-20 — 전사 표준 양식을 시작점으로 제공 */}
      {/*
        ST-20 — 전사 표준 양식을 시작점으로. 설명은 **한 줄**로 줄였다 (v1.24.0) —
        세 줄짜리 안내는 처음 한 번만 필요한데 매번 자리를 차지한다.
      */}
      <p className="text-xs leading-5 text-muted">
        전사 표준 양식에서 <strong className="font-medium text-body">우리 부서 부분만 남겨</strong> 등록하세요.
        {hasStandard ? (
          /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드 */
          <a href="/api/template/standard" className="ml-1.5 font-medium text-ink underline underline-offset-2 hover:text-ink-active">
            표준 양식 받기 →
          </a>
        ) : (
          <span className="ml-1.5 text-muted-soft">표준 양식 미등록 — 운영자에게 요청하세요.</span>
        )}
      </p>
      <div aria-live="polite">
        {st.kind === 'done' && (
          <div className="rounded-xl bg-brand-soft px-4 py-3 text-sm text-ink">
            ✓ v{st.version} 등록 완료 · 표 {st.summary.length}개 (
            {st.summary.map((t) => `${t.rows}행`).join(' · ')}) 파싱 확인 {/* CP-83 */}
            {st.warnings.length > 0 && <p className="mt-1 text-xs text-body-strong">{st.warnings.join(' · ')}</p>}
          </div>
        )}
        {st.kind === 'error' && (
          <p className="rounded-xl bg-error/10 px-4 py-3 text-sm text-error">
            {st.message} {/* CP-84 — 기존 양식 유지는 서버 메시지에 포함 */}
          </p>
        )}
      </div>
    </div>
  );
}
