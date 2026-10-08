'use client';
// RU-60~64 · RU-83 — 전사본과 결과. **전사본은 늘 준비돼 있다** (2026-10-08 · ADR-0015) — 섹션 출처가 바뀌면 Tincase가 다시 만든다.
// 그래서 [전사 취합본 만들기]·[다시 만들기]가 없다. 총괄은 보고 받는다: 상태 한 줄(「자동 16:02 · 13개 중 11」) · [전사본 받기] ·
// 이 총괄이 받은 뒤 바뀌었으면 주황 「16:20에 받은 뒤 바뀜」(RU-57a) · 만들기가 **실패했을 때만** [다시 시도](RU-76).
// 섹션마다 「들어감 / 미제출 / 실패」와 **자동으로 고친 것·확인할 것**을 보인다 — 총괄이 한글을 열기 전에 「어디를 봐야 하나」를 먼저 안다.
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
  /** RU-68 — 쓴 양식. 옛 기록에는 없다 */
  template?: string | null;
  /** 문서 전체의 확인할 것 — 만들 때 어느 섹션에도 없던 사본(RU-64)·서식 옮기기 메모 */
  warnings: string[];
  errorText: string | null;
  stale: boolean;
  /** RU-78 — 무엇 때문에 다시 만들어졌나 */
  causeLabel?: string;
}

export function OrgRunCard({
  run,
  failed = null,
  changedSinceDownload = null,
  isoKey,
  ready,
  coverage = [],
}: {
  /** 가장 최근 **성공한** 전사본 — 받을 판 */
  run: OrgRunCardView | null;
  /** 그 뒤의 시도가 실패했으면 — 그때만 [다시 시도] */
  failed?: { errorText: string | null; atKst: string | null } | null;
  /** RU-57a — 이 사람이 받은 뒤 바뀌었으면 받은 시각 */
  changedSinceDownload?: string | null;
  isoKey: string;
  /** 최종본에 들어올 것이 있는 섹션 수 */
  ready: number;
  /** RU-64 「누락」 — **지금** 도착해 있는데 어느 섹션에도 안 들어가는 사본. 만들어지기 전에도 보여야 한다 */
  coverage?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ok = run?.status === 'succeeded';
  const retry = async () => {
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
  // 만들 때의 경고 중 지금도 위 「빠지는 사본」에 있는 것은 두 번 쓰지 않는다
  const docWarnings = run?.warnings.filter((w) => !coverage.includes(w)) ?? [];

  // 2026-10-07 — 초록 칠한 카드 안에 흰 칩 상자가 들어 있던 것을 흰 카드 한 장으로 (CP-97)
  return (
    <section data-guide="org-run" className="card" aria-labelledby="org-run">
      <div className="card-head">
        <div className="min-w-0">
          <h2 id="org-run" className="card-title">
            전사본
          </h2>
          {/* RU-83 — 상태 한 줄. 만드는 것은 Tincase다 — 언제·무엇 때문에·몇 섹션인지만 */}
          <p data-guide="org-run-button" className="card-desc">
            {ok ? (
              <>
                자동 {run!.finishedAtKst}
                {run!.causeLabel && ` · ${run!.causeLabel}`} · {run!.sections.length}개 섹션 중 {copied}개 들어감 · 자동 수정 {fixedCount}건 · 확인할 곳{' '}
                {toCheck.length + docWarnings.length}
              </>
            ) : failed ? (
              <span className="text-error">전사본을 만들지 못했어요 — {failed.errorText}</span>
            ) : ready > 0 ? (
              '들어온 섹션으로 전사본을 만드는 중입니다 — 새로 고치면 보입니다.'
            ) : (
              '아직 들어온 섹션이 없어요 — 들어오는 대로 저절로 만들어집니다.'
            )}
          </p>
        </div>
        {failed ? (
          <span className="chip chip-error">만들지 못함</span>
        ) : ok ? (
          <span className="chip chip-ok">
            <span aria-hidden className="dot" />
            준비됨
          </span>
        ) : (
          <span className="chip chip-muted">아직 없음</span>
        )}
      </div>

      {/* RU-57a — 받은 사람에게만. NAMS에 이미 올렸을 수 있다 */}
      {ok && changedSinceDownload && (
        <p className="callout callout-warn mt-4">
          {changedSinceDownload}에 받은 뒤 전사본이 바뀌었습니다{run!.causeLabel && `(${run!.causeLabel})`} — 이미 올렸다면 다시 받아 바꿔 주세요.
        </p>
      )}
      {failed && ok && (
        <p className="callout callout-error mt-4">
          새로 들어온 것으로 다시 만들지 못했어요 — {failed.errorText}. 아래는 그 전({run!.finishedAtKst})의 전사본입니다.
        </p>
      )}
      {/* RU-64 — 섹션 구성에 그 부서가 없으면 본부장이 승인한 사본이 최종본에서 조용히 빠진다. 만들어지기 전에 알린다 */}
      {coverage.length > 0 && (
        <div className="callout callout-warn mt-4">
          <p className="font-semibold">최종본에서 빠지는 사본</p>
          <ul className="mt-1.5 space-y-1 text-body">
            {coverage.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {(ok || failed) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {ok && (
            <a data-guide="org-download" href={`/api/rollup/run/${run!.id}`} className="btn-primary">
              전사본 받기
            </a>
          )}
          {failed && (
            <button onClick={retry} disabled={busy} className="btn-secondary">
              {busy ? '만드는 중…' : '다시 시도'}
            </button>
          )}
        </div>
      )}

      {ok && toCheck.length + docWarnings.length > 0 && (
        <div className="callout callout-warn mt-4">
          <p className="font-semibold">한글에서 확인할 곳</p>
          <ul className="mt-1.5 space-y-1 text-body">
            {toCheck.map((s) => (
              <li key={s.title}>
                <span className="font-medium text-ink">{s.title}</span> — {s.status === 'failed' ? `옮기지 못함: ${s.error}` : s.warnings.join(' · ')}
              </li>
            ))}
            {docWarnings.map((w) => (
              <li key={w}>{w}</li>
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
          {open && run!.template && <p className="mt-3 text-xs text-muted">양식: {run!.template}</p>}
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
