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
          <p className="text-sm text-error">양식 없음 — 부서원 제출 불가</p>
        )}
        <div className="flex items-center gap-2">
          {/* ST-20 — 전사 표준 양식을 시작점으로. 2026-10-08 — 설명 줄을 걷고 링크만 버튼 줄에 */}
          {hasStandard && (
            /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드 */
            <a href="/api/template/standard" className="btn-ghost">
              표준 양식 받기
            </a>
          )}
          {current && (
            /* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 다운로드, 내비게이션 아님 */
            <a href="/api/template" className="btn-ghost">
              현재 양식 받기
            </a>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={st.kind === 'uploading'}
            // 양식이 없으면 등록이 이 카드의 할 일이다 — 주 버튼. 있으면 교체는 가끔 하는 일이라 보조 버튼 (CP-99)
            className={current ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}
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
          <div className="callout mt-1 bg-success-soft text-ink">
            v{st.version} 등록됨 {/* CP-83 — 표 파싱 요약(표 N개·행 수)은 2026-10-08에 걷었다. 경고는 남긴다 */}
            {st.warnings.length > 0 && <p className="mt-1 text-xs text-body-strong">{st.warnings.join(' · ')}</p>}
          </div>
        )}
        {st.kind === 'error' && (
          <p className="callout callout-error">
            {st.message} {/* CP-84 — 기존 양식 유지는 서버 메시지에 포함 */}
          </p>
        )}
      </div>
    </div>
  );
}
