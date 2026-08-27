'use client';
// HM-26 — 병합 결과 검토. **볼 곳만 보여준다.**
//
// "슥 보고 제출"이 되려면 전체를 다시 읽게 하면 안 된다. 나머지 행은 제출자가 쓴 원문
// 그대로이므로 확인할 필요가 없다. 확인이 필요한 건 **기계가 판단한 곳**뿐이다:
// 합쳐진 행, 안 합친 이유, 빠진 사람, 실패.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MergedDrawer } from './MergedDrawer';

export interface MergeGroupView {
  authors: string[];
  category: string;
  reason: string;
  sources: { who: string; content: string }[];
  kept: string;
}

export interface MergeStateView {
  status: 'none' | 'succeeded' | 'failed' | 'running';
  finishedAtKst: string | null;
  trigger: 'auto' | 'manual' | null;
  rowCounts: { achievements: number; plans: number; notes: number } | null;
  warnings: string[];
  errorText: string | null;
  groups: MergeGroupView[];
  modelUsed: boolean;
  modelReason: string | null;
  categoryOrder: string[];
  sourceCount: number;
  missing: string[];
  /** HM-33 — 확인이 필요한 행 (「없음」 등). 지우지 않고 보여준다 */
  flagged: { no: string; who: string; content: string; bucket: string }[];
}

export function MergePanel({
  state,
  isoKey,
  divisionSlug,
  canRun,
  canDownload,
  canEditMerged,
  submitted,
}: {
  state: MergeStateView;
  isoKey: string;
  divisionSlug: string;
  canRun: boolean;
  canDownload: boolean;
  /** 병합본 수정 — 담당자 + 내 부서 (TACP-15). «병합 실행»과 다른 판정이다 */
  canEditMerged: boolean;
  submitted: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState(false);
  const [openContent, setOpenContent] = useState(false);
  const router = useRouter();

  const run = () => {
    setBusy(true);
    setErr(null);
    fetch('/api/division/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isoKey }),
    })
      .then(async (r) => {
        if (!r.ok) setErr(((await r.json()) as { message?: string }).message ?? '병합에 실패했습니다.');
        else router.refresh();
      })
      .catch(() => setErr('네트워크 오류로 병합하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  const done = state.status === 'succeeded';
  const href = `/api/division/merged?division=${encodeURIComponent(divisionSlug)}&isoKey=${isoKey}`;

  return (
    <section className={`card-feature px-7 py-6 ${done ? 'bg-brand-soft' : 'bg-surface-strong'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="display text-xl">
            {done ? (
              <>
                <span aria-hidden className="mr-1.5 text-success">
                  ✓
                </span>
                병합본 준비됨
              </>
            ) : state.status === 'failed' ? (
              '병합 실패'
            ) : (
              '아직 병합하지 않았습니다'
            )}
          </h2>
          {done && state.rowCounts && (
            <p className="mt-1 text-sm text-body">
              제출 {state.sourceCount}건 → 실적 {state.rowCounts.achievements} · 계획 {state.rowCounts.plans}
              {state.rowCounts.notes > 0 && ` · 특이 ${state.rowCounts.notes}`}
              {state.finishedAtKst && ` · ${state.finishedAtKst}`}
              {state.trigger === 'auto' && ' · 마감 후 자동'}
            </p>
          )}
          {state.status === 'failed' && <p className="mt-1 text-sm text-error">{state.errorText}</p>}
          {state.status === 'none' && (
            <p className="mt-1 text-sm text-body">
              {submitted === 0 ? '제출된 파일이 없습니다.' : '마감이 지나면 자동으로 병합됩니다.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {done && canDownload && (
            <button onClick={() => setOpenContent(true)} className="btn-oncolor">
              내용 보기
            </button>
          )}
          {done && canDownload && (
            <a href={href} className="btn-oncolor">
              받기
            </a>
          )}
          {canRun && (
            <button onClick={run} disabled={busy || submitted === 0} className="btn-secondary btn-sm">
              {busy ? '병합 중…' : done ? '다시 병합' : '지금 병합'}
            </button>
          )}
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-error">{err}</p>}

      <MergedDrawer
        open={openContent}
        onClose={() => setOpenContent(false)}
        isoKey={isoKey}
        divisionSlug={divisionSlug}
        canEdit={canEditMerged}
      />

      {done && (
        <>
          {/*
            HM-33 — 「없음」처럼 내용이 비어 보이는 행.
            **지우지 않고 보여준다** — 지우려면 판정이 정확해야 하고, 정확하지 않으면
            남의 한 주가 조용히 사라진다. 기계는 «이거 보세요»까지만 한다.
            합쳐진 행보다 위에 둔다: 이건 **손대야 하는 것**이고 그건 확인만 하면 된다.
          */}
          {state.flagged.length > 0 && (
            <div className="mt-5 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
              <p className="text-sm font-semibold text-ink">
                확인이 필요한 내용 {state.flagged.length}건
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-body">
                {state.flagged.map((f, i) => (
                  <li key={i}>
                    <span className="tabular-nums text-muted">
                      {({ achievements: '실적', plans: '계획', notes: '특이사항' } as Record<string, string>)[f.bucket] ?? ''} {f.no}
                    </span>
                    {f.who && <span className="ml-1.5 font-medium text-ink">{f.who}</span>}
                    <span className="ml-1.5">「{f.content}」</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-soft">
                내용이 비어 있는 것처럼 보입니다. 빼야 할 것 같으면 [내용 보기]에서 그 행을 지우고 저장하세요 —
                <strong className="font-medium"> 제출자가 올린 원본은 그대로입니다.</strong>
              </p>
            </div>
          )}

          {/* 확인이 필요한 것만 */}
          {state.groups.length > 0 && (
            <div className="mt-5">
              <button
                onClick={() => setOpenGroups((v) => !v)}
                aria-expanded={openGroups}
                className="flex w-full items-center justify-between rounded-xl bg-canvas/70 px-4 py-2.5 text-left text-sm font-semibold text-ink hover:bg-canvas"
              >
                <span>
                  합쳐진 행 {state.groups.length}건
                  <span className="ml-2 font-normal text-muted">— 여기만 확인하면 됩니다</span>
                </span>
                <span aria-hidden className="text-xs text-muted">
                  {openGroups ? '접기 ▲' : '펼치기 ▼'}
                </span>
              </button>
              {openGroups && (
                <ul className="mt-2 space-y-2">
                  {state.groups.map((g, i) => (
                    <li key={i} className="rounded-xl bg-canvas/70 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{g.authors.join(' + ')}</span>
                        {g.category && <span className="badge-pill bg-surface-card py-0 text-[11px]">{g.category}</span>}
                        {g.reason && <span className="text-xs text-muted">{g.reason}</span>}
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-body">
                        {g.sources.map((s, k) => (
                          <li key={k} className={s.content === g.kept ? 'font-medium text-ink' : 'text-muted-soft'}>
                            <span className="mr-1.5 text-xs text-muted">{s.who}</span>
                            {s.content}
                            {s.content === g.kept && <span className="ml-1.5 text-xs text-success">← 남김</span>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 기계가 한 일을 숨기지 않는다 */}
          <p className="mt-4 text-[11px] leading-5 text-muted">
            {state.modelUsed ? '중복 묶기·분류에 모델을 사용했습니다.' : `모델 미사용 — ${state.modelReason ?? ''}`}
            {state.categoryOrder.length > 0 && ` · 분류 순서 ${state.categoryOrder.join(' → ')}`}
            {' · 문서 글자는 제출된 원문 그대로이며 무엇도 새로 쓰지 않았습니다.'}
          </p>

          {state.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-body">
              {state.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {/*
            UX-04 — 「지금 미제출」이 아니라 **「이 병합본을 만들 때 빠져 있던 사람」**이다.
            둘은 다르다: 병합 뒤에 낸 사람은 위 현황표에 «제출»로 뜨는데 여기엔 그대로 남아,
            같은 화면에서 3/9와 미제출 7명이 동시에 보인다 (실제로 그렇게 보였다).
            그래서 **시점을 문장에 박아 두고**, 그 뒤 제출이 있으면 다시 병합하라고 말한다.
          */}
          {state.missing.length > 0 && (
            <p className="mt-3 text-sm text-body">
              <span className="font-medium">이 병합본에 빠진 사람 {state.missing.length}명</span>
              <span className="ml-1.5 text-muted">{state.missing.join(', ')}</span>
              <span className="ml-1 text-muted-soft">
                — {state.finishedAtKst ?? '병합'} 기준입니다. 그 뒤에 낸 사람이 있으면 [다시 병합]을 눌러주세요
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
