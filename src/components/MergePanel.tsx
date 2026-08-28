'use client';
// HM-26 — 병합 결과 검토. **볼 곳만 보여준다.**
//
// "슥 보고 제출"이 되려면 전체를 다시 읽게 하면 안 된다. 나머지 행은 제출자가 쓴 원문
// 그대로이므로 확인할 필요가 없다. 확인이 필요한 건 **기계가 판단한 곳**뿐이다:
// 합쳐진 행, 안 합친 이유, 빠진 사람, 실패.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MergedDrawer } from './MergedDrawer';
import { contentCovered } from '@/lib/merge-rows';

export interface MergeGroupView {
  authors: string[];
  category: string;
  reason: string;
  sources: { who: string; content: string }[];
  kept: string;
  /** HM-36 — `sources` 중 문서에 들어간 것의 자리. 옛 실행에는 없다 */
  keptIndex?: number;
  /** HM-36 — 원문이 글자까지 똑같았는가. 참이면 잃은 것이 없다 */
  identical?: boolean;
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

          {/*
            HM-36 — 합쳐진 행. **두 경우를 나눠 보여준다.**

            처음에는 둘을 한 모양으로 그렸고, 「어느 줄이 들어갔나」를 `s.content === g.kept`,
            즉 **글자 비교**로 정했다. 그래서 두 사람이 똑같이 적으면 두 줄 다 「← 남김」이
            붙었다 — 「합쳤다」고 해 놓고 둘 다 남았다고 하니 읽는 사람이 이해할 수가 없다.
            (실제 피드백: 「내용이 같은데 왜 둘 다 남김이 떠있는거야?」)

            나눠 놓고 보면 둘은 아예 다른 일이다:
              **똑같이 적음** — 잃은 것이 없다. 확인할 것도 없다. 한 줄로 조용히 적는다
              **달라서 하나가 빠짐** — 여기가 위험한 곳이다. 빠진 글자를 눈에 띄게 보여준다
          */}
          {state.groups.length > 0 && (() => {
            /*
              옛 실행에는 `identical`이 없다. 그렇다고 전부 「확인 필요」로 몰면 잃은 것이
              없는 묶음까지 「빠짐」이라고 말하게 된다 — 없던 문제를 만들어 보여주는 셈이다.
              `sources`만 있으면 여기서 되짚을 수 있으므로 되짚는다.
            */
            const isSame = (g: MergeGroupView) =>
              g.identical ?? new Set(g.sources.map((s) => s.content.trim())).size === 1;
            const 확인 = state.groups.filter((g) => !isSame(g));
            const 동일 = state.groups.filter(isSame);
            /** 문서에 들어간 줄의 자리. 옛 실행에는 keptIndex가 없어 글자로 되짚는다 */
            const keptAt = (g: MergeGroupView) =>
              g.keptIndex ?? Math.max(0, g.sources.findIndex((s) => s.content === g.kept));

            return (
            <div className="mt-5">
              <button
                onClick={() => setOpenGroups((v) => !v)}
                aria-expanded={openGroups}
                className="flex w-full items-center justify-between rounded-xl bg-canvas/70 px-4 py-2.5 text-left text-sm font-semibold text-ink hover:bg-canvas"
              >
                <span>
                  합쳐진 행 {state.groups.length}건
                  <span className="ml-2 font-normal text-muted">
                    {확인.length === 0
                      ? '— 모두 똑같이 적은 것이라 확인할 것이 없습니다'
                      : `— 그중 ${확인.length}건은 내용이 달라 확인이 필요합니다`}
                  </span>
                </span>
                <span aria-hidden className="text-xs text-muted">
                  {openGroups ? '접기 ▲' : '펼치기 ▼'}
                </span>
              </button>
              {openGroups && (
                <ul className="mt-2 space-y-2">
                  {/* 확인이 필요한 것 먼저 — 아래로 내려가면 안 보고 넘어간다 */}
                  {확인.map((g, i) => {
                    const ki = keptAt(g);
                    return (
                      <li key={`d${i}`} className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{g.authors.join(' + ')}</span>
                          {g.category && (
                            <span className="badge-pill bg-canvas py-0 text-[11px]">{g.category}</span>
                          )}
                          <span className="text-xs text-muted">{g.reason}</span>
                        </div>
                        <ul className="mt-2 space-y-1">
                          {g.sources.map((s, k) => {
                            // 버린 줄의 말이 남긴 줄에 다 들어 있으면 「빠짐」이 아니다
                            const covered = k !== ki && contentCovered(g.kept, s.content);
                            return (
                              <li key={k} className="flex flex-wrap items-baseline gap-x-2">
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                    k === ki
                                      ? 'bg-ink text-canvas'
                                      : covered
                                        ? 'bg-canvas text-muted'
                                        : 'bg-canvas text-error'
                                  }`}
                                >
                                  {k === ki ? '문서에 들어감' : covered ? '안 씀' : '빠짐'}
                                </span>
                                <span className="text-xs text-muted">{s.who}</span>
                                <span className={k === ki ? 'text-ink' : 'text-body'}>{s.content}</span>
                                {covered && (
                                  <span className="text-xs text-muted-soft">— 이 내용은 위에 다 들어 있습니다</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <p className="mt-2 text-xs text-muted">
                          {g.sources.some((s, k) => k !== ki && !contentCovered(g.kept, s.content))
                            ? '「빠짐」 쪽에만 있는 내용이 있으면 [내용 보기]에서 그 행을 고쳐 주세요.'
                            : '내용은 다 들어갔습니다. 일자·장소가 다르면 [내용 보기]에서 확인해 주세요.'}
                        </p>
                      </li>
                    );
                  })}

                  {/* 똑같이 적은 것 — 잃은 것이 없으므로 한 줄로 조용히 */}
                  {동일.map((g, i) => (
                    <li key={`s${i}`} className="rounded-xl bg-canvas/70 px-4 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{g.authors.join(' + ')}</span>
                        {g.category && (
                          <span className="badge-pill bg-surface-card py-0 text-[11px]">{g.category}</span>
                        )}
                        <span className="text-xs text-muted">똑같이 적어서 한 줄로 합쳤습니다</span>
                      </div>
                      <p className="mt-0.5 text-body">{g.kept}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            );
          })()}

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
