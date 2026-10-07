'use client';
// RU-60~64 — 전사 취합본 만들기와 결과. 섹션마다 「들어감 / 미제출 / 실패」와 **자동으로 고친 것·확인할 것**을 보인다.
// 총괄이 한글을 열기 전에 「어디를 봐야 하나」를 먼저 안다 — 번호를 다시 매긴 곳, 양식 잔재가 남은 곳.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface OrgRunCardView {
  id: string;
  status: string;
  finishedAtKst: string | null;
  sections: {
    title: string;
    status: 'copied' | 'missing' | 'failed';
    label: string;
    fixed: string[];
    warnings: string[];
    dropped: string[];
    error?: string;
  }[];
  warnings: string[];
  errorText: string | null;
  stale: boolean;
}

export function OrgRunCard({ run, isoKey, ready }: { run: OrgRunCardView | null; isoKey: string; ready: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ok = run?.status === 'succeeded';
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isoKey }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '만들지 못했습니다.');
      router.refresh();
    } catch {
      setErr('네트워크 오류로 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };
  const copied = run?.sections.filter((s) => s.status === 'copied').length ?? 0;
  const toCheck = run?.sections.filter((s) => s.warnings.length || s.status === 'failed') ?? [];
  const fixedCount = run?.sections.reduce((n, s) => n + s.fixed.length, 0) ?? 0;

  // 다음 할 일이 「만들기」일 때만 그 버튼이 주 버튼이다 (CP-99)
  const runIsNext = !ok || !!run?.stale;

  // 2026-10-07 — 초록 칠한 카드 안에 흰 칩 상자가 들어 있던 것을 흰 카드 한 장으로 (CP-97)
  return (
    <section className="card" aria-labelledby="org-run">
      <div className="card-head">
        <div className="min-w-0">
          <h2 id="org-run" className="card-title">
            전사 취합본
          </h2>
          <p className="card-desc">
            {ok ? (
              <>
                {run!.sections.length}개 섹션 중 {copied}개 들어감 · 자동 수정 {fixedCount}건 · 확인할 곳 {toCheck.length}
              </>
            ) : run?.status === 'failed' ? (
              <span className="text-error">{run.errorText}</span>
            ) : ready > 0 ? (
              `들어온 ${ready}개 섹션으로 최종본 꼴을 만듭니다. 빠진 섹션은 「미제출」로 자리를 둡니다.`
            ) : (
              '아직 들어온 섹션이 없습니다.'
            )}
          </p>
        </div>
        {ok ? (
          run!.stale ? (
            <span className="chip chip-warn">섹션이 바뀜</span>
          ) : (
            <span className="chip chip-ok">
              <span aria-hidden className="dot" />
              준비됨{run!.finishedAtKst && ` ${run!.finishedAtKst}`}
            </span>
          )
        ) : run?.status === 'failed' ? (
          <span className="chip chip-error">만들지 못함</span>
        ) : (
          <span className="chip chip-muted">아직 안 만듦</span>
        )}
      </div>

      {ok && run!.stale && (
        <p className="callout callout-warn mt-4">
          만든 뒤 섹션이 바뀌었습니다(새로 냄·올림·취소·순서) — <strong>다시 만들기</strong>를 누르세요.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={go} disabled={busy || ready === 0} className={runIsNext ? 'btn-primary' : 'btn-ghost'}>
          {busy ? '만드는 중…' : ok ? '다시 만들기' : '전사 취합본 만들기'}
        </button>
        {ok && (
          <a href={`/api/rollup/run/${run!.id}`} className="btn-secondary">
            전사본 받기
          </a>
        )}
      </div>

      {ok && toCheck.length > 0 && (
        <div className="callout callout-warn mt-4">
          <p className="font-semibold">한글에서 확인할 곳</p>
          <ul className="mt-1.5 space-y-1 text-body">
            {toCheck.map((s) => (
              <li key={s.title}>
                <span className="font-medium text-ink">{s.title}</span> — {s.status === 'failed' ? `옮기지 못함: ${s.error}` : s.warnings.join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ok && (
        <div className="card-section">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-2 text-sm font-medium text-ink hover:underline"
          >
            <span
              aria-hidden
              className={`relative -top-px inline-block h-1.5 w-1.5 border-r-[1.5px] border-b-[1.5px] border-current transition-transform ${
                open ? 'rotate-45' : '-rotate-45'
              }`}
            />
            섹션별 처리
          </button>
          {open && (
            <ol className="mt-3 text-sm">
              {run!.sections.map((s, i) => (
                <li key={s.title} className="flex flex-wrap items-baseline gap-x-2 border-t border-hairline-soft py-2 first:border-t-0">
                  <span className="w-5 text-right tabular-nums text-muted">{i + 1}</span>
                  <span className="font-medium text-ink">{s.title}</span>
                  <span className="text-xs text-muted">
                    {s.status === 'missing' ? '미제출 자리' : s.status === 'failed' ? '실패' : s.label}
                    {s.fixed.length > 0 && ` · ${s.fixed.join(' · ')}`}
                    {s.dropped.length > 0 && ` · 뺀 것: ${s.dropped.join(', ')}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {err && <p className="callout callout-error mt-4">{err}</p>}
    </section>
  );
}
