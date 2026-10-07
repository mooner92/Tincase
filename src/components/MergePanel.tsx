'use client';
// HM-26 — 병합 결과 검토. **볼 곳만 보여준다.**
//
// "슥 보고 제출"이 되려면 전체를 다시 읽게 하면 안 된다. 나머지 행은 제출자가 쓴 원문
// 그대로이므로 확인할 필요가 없다. 확인이 필요한 건 **기계가 판단한 곳**뿐이다:
// 합쳐진 행, 안 합친 이유, 빠진 사람, 실패.
//
// 2026-10-07 (PG-52 · CP-97) — 초록 칠한 카드 안에 흰 상자 둘·경고 상자·11px 줄이 겹겹이 들어 있었다.
// 이제 흰 카드 하나: 머리(병합본 + 상태 칩) → 승인 한 줄 → 행동 한 줄(주 버튼 하나) → 확인할 것.
// 합쳐진 행은 접어 둔다 — 대부분 「똑같이 적어서 합침」이라 펼쳐 볼 일이 드물다.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MergedDrawer } from './MergedDrawer';
import { contentCovered, MODEL_NOT_CONFIGURED } from '@/lib/merge-rows';

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
  /** HM-47 — 이 화면이 보여 주는 판 (실행 id + 파일 sha256). [승인]이 그대로 돌려보낸다 */
  runId: string | null;
  sha256: string | null;
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
  /** HM-47 — 부서장 승인. 없으면 아직 승인 전 */
  review: ReviewStateView | null;
  /** 부서장 계정이 있는 부서인가 — 없으면 「승인 전」을 띄우지 않는다 */
  hasHead: boolean;
}

export interface ReviewStateView {
  by: string;
  atKst: string;
  kind: 'edit' | 'approve';
  summary: string;
  lines: string[];
  changedAfter: boolean;
}

export function MergePanel({
  state,
  isoKey,
  divisionSlug,
  canRun,
  canDownload,
  canEditMerged,
  canApprove = false,
  submitted,
}: {
  state: MergeStateView;
  isoKey: string;
  divisionSlug: string;
  canRun: boolean;
  canDownload: boolean;
  /** 병합본 수정 — 담당자 + 내 부서 (TACP-15). «병합 실행»과 다른 판정이다 */
  canEditMerged: boolean;
  /** HM-47 — [고칠 것 없음 · 승인]. 이 부서의 head에게만 (TACP-16) */
  canApprove?: boolean;
  submitted: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState(false);
  const [openContent, setOpenContent] = useState(false);
  const router = useRouter();

  const [openReview, setOpenReview] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const approve = () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    fetch('/api/division/merged/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // HM-47 — 이 화면이 보여 준 판에만 승인한다. 그 사이 바뀌었으면 서버가 409로 다시 열라고 한다
      body: JSON.stringify({ isoKey, runId: state.runId, sha256: state.sha256 }),
    })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as { message?: string; notified?: number; unchanged?: boolean };
        if (!r.ok) {
          setErr(b.message ?? '승인하지 못했습니다.');
          return;
        }
        // 알림이 실제로 나갔을 때만 「알렸습니다」라고 말한다
        setNote(
          b.unchanged
            ? '이미 승인한 판입니다'
            : (b.notified ?? 0) > 0
              ? '승인 완료 — 담당자에게 알렸습니다'
              : '승인 기록됨 — 알림은 보내지 않았어요',
        );
        router.refresh();
      })
      .catch(() => setErr('네트워크 오류로 승인하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

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
  // HM-47 — 부서장에게 승인할 판이 있으면 이 카드의 주 버튼은 [승인]이고 [내용 보기]는 보조로 물러난다 (CP-99)
  const approveNow = done && canApprove && (!state.review || state.review.changedAfter);
  // 이 서버에 모델이 원래 없다 — 매주 같은 ⚠를 되풀이하지 않는다. 이번 주에 **실패한** 경고만 남긴다
  const noModel = !state.modelUsed && state.modelReason === MODEL_NOT_CONFIGURED;
  const warnings = noModel ? state.warnings.filter((w) => !w.includes(MODEL_NOT_CONFIGURED)) : state.warnings;

  return (
    <section className="card" aria-labelledby="merge-panel">
      <div className="card-head">
        <div className="min-w-0">
          <h2 id="merge-panel" className="card-title">
            병합본
          </h2>
          <p className="card-desc">
            {done && state.rowCounts ? (
              <>
                제출 {state.sourceCount}건 → 실적 {state.rowCounts.achievements} · 계획 {state.rowCounts.plans}
                {state.rowCounts.notes > 0 && ` · 특이 ${state.rowCounts.notes}`}
                {state.trigger === 'auto' && ' · 마감 후 자동'}
              </>
            ) : state.status === 'failed' ? (
              <span className="text-error">{state.errorText}</span>
            ) : state.status === 'none' ? (
              submitted === 0 ? '제출된 파일이 없습니다.' : '마감이 지나면 자동으로 병합됩니다.'
            ) : null}
          </p>
        </div>
        {done ? (
          <span className="chip chip-ok">
            <span aria-hidden className="dot" />
            준비됨{state.finishedAtKst && ` ${state.finishedAtKst}`}
          </span>
        ) : state.status === 'failed' ? (
          <span className="chip chip-error">병합 실패</span>
        ) : state.status === 'running' ? (
          <span className="chip chip-info">병합 중</span>
        ) : (
          <span className="chip chip-muted">아직 병합 전</span>
        )}
      </div>

      {/* HM-47 — 부서장 승인. 한 줄로: 상태 · 누가 · 언제. 담당자가 「언제·무엇을」 고쳤는지 여기서 본다 */}
      {done && (state.review || state.hasHead) && (
        <div className="mt-3 text-sm">
          {state.review ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`chip ${state.review.changedAfter ? 'chip-warn' : 'chip-ok'}`}>
                  {state.review.changedAfter ? '승인 뒤 바뀜' : '승인 완료'}
                </span>
                <span className="text-ink">{state.review.by}</span>
                <span className="text-muted">
                  {state.review.atKst} · {state.review.kind === 'approve' ? '고친 곳 없이 승인' : state.review.summary}
                </span>
                {state.review.lines.length > 0 && (
                  <button onClick={() => setOpenReview((v) => !v)} className="text-muted underline underline-offset-2 hover:text-ink">
                    {openReview ? '접기' : '바뀐 곳 보기'}
                  </button>
                )}
              </p>
              {state.review.changedAfter && (
                <p className="mt-1 text-muted">
                  승인한 뒤 병합본이 다시 만들어졌거나 고쳐졌습니다 — 지금 판은 승인한 판과 다릅니다.
                </p>
              )}
              {openReview && (
                <ul className="mt-2 space-y-0.5 text-[13px] text-body">
                  {state.review.lines.map((l, i) => (
                    <li key={i}>· {l}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="chip chip-muted">부서장 승인 전</span>
              <span className="text-muted">부서장이 고쳐 저장하거나 [승인]을 누르면 담당자에게 알림이 갑니다</span>
            </p>
          )}
        </div>
      )}

      {/* 행동 한 줄 — 주 버튼은 하나: 보통은 [내용 보기], 부서장이 승인할 판이 있으면 [승인] */}
      {((done && canDownload) || canRun || approveNow) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {approveNow && (
            <button onClick={approve} disabled={busy} className="btn-primary">
              고칠 것 없음 · 승인
            </button>
          )}
          {done && canDownload && (
            <button onClick={() => setOpenContent(true)} className={approveNow ? 'btn-secondary' : 'btn-primary'}>
              내용 보기
            </button>
          )}
          {done && canDownload && (
            <a href={href} className="btn-secondary">
              받기
            </a>
          )}
          {canRun && (
            <button onClick={run} disabled={busy || submitted === 0} className={done ? 'btn-ghost' : 'btn-secondary'}>
              {busy ? '병합 중…' : done ? '다시 병합' : '지금 병합'}
            </button>
          )}
        </div>
      )}
      {approveNow && (
        <p className="mt-2 text-sm text-muted">고칠 곳이 있으면 [내용 보기]에서 고쳐 저장하세요 — 저장이 곧 승인입니다.</p>
      )}

      {err && <p className="callout callout-error mt-4">{err}</p>}
      {note && !err && <p className="mt-3 text-sm font-medium text-success">{note}</p>}

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
            <div className="callout callout-warn mt-5">
              <p className="font-semibold text-ink">확인이 필요한 내용 {state.flagged.length}건</p>
              <ul className="mt-1.5 space-y-1 text-body">
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
              <p className="mt-1.5 text-xs text-muted">
                내용이 비어 있는 것처럼 보입니다. 빼야 할 것 같으면 [내용 보기]에서 그 행을 지우고 저장하세요 —
                <strong className="font-medium"> 제출자가 올린 원본은 그대로입니다.</strong>
              </p>
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="callout callout-warn mt-4 space-y-1">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
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
            <p className="mt-4 text-sm text-body">
              <span className="font-medium text-ink">이 병합본에 빠진 사람 {state.missing.length}명</span>
              <span className="ml-1.5">{state.missing.join(', ')}</span>
              <span className="ml-1 text-muted">
                — {state.finishedAtKst ?? '병합'} 기준입니다. 그 뒤에 낸 사람이 있으면 [다시 병합]을 눌러주세요
              </span>
            </p>
          )}

          {(state.groups.length > 0 || !noModel) && (
            <div className="card-section space-y-3">
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
            <div>
              {/* 접기 — 화살표는 선으로 그린다(globals.css의 disclosure와 같은 모양). 내용이 다른 묶음이 있으면 제목이 경고색이다 */}
              <button
                onClick={() => setOpenGroups((v) => !v)}
                aria-expanded={openGroups}
                className="flex w-full flex-wrap items-baseline gap-x-2 text-left text-sm font-medium text-ink hover:underline"
              >
                <span
                  aria-hidden
                  className={`relative -top-0.5 inline-block h-1.5 w-1.5 border-r-[1.5px] border-b-[1.5px] border-current transition-transform ${
                    openGroups ? 'rotate-45' : '-rotate-45'
                  }`}
                />
                합쳐진 행 {state.groups.length}건
                <span className={`font-normal ${확인.length === 0 ? 'text-muted' : 'text-warning'}`}>
                  {확인.length === 0
                    ? '— 모두 똑같이 적은 것이라 확인할 것이 없습니다'
                    : `— 그중 ${확인.length}건은 내용이 달라 확인이 필요합니다`}
                </span>
              </button>
              {openGroups && (
                <ul className="mt-3 space-y-2">
                  {/* 확인이 필요한 것 먼저 — 아래로 내려가면 안 보고 넘어간다 */}
                  {확인.map((g, i) => {
                    const ki = keptAt(g);
                    return (
                      <li key={`d${i}`} className="callout callout-warn">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{g.authors.join(' + ')}</span>
                          {g.category && (
                            <span className="chip bg-canvas text-xs text-body">{g.category}</span>
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
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
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
                                  <span className="text-xs text-muted">— 이 내용은 위에 다 들어 있습니다</span>
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
                    <li key={`s${i}`} className="callout callout-muted">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{g.authors.join(' + ')}</span>
                        {g.category && (
                          <span className="chip chip-muted text-xs">{g.category}</span>
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

              {/* 기계가 한 일을 숨기지 않는다. 다만 모델이 원래 없는 서버에서 매주 같은 말을 하지 않는다 */}
              {!noModel && (
                <p className="text-xs leading-5 text-muted">
                  {state.modelUsed ? '중복 묶기·분류에 모델을 사용했습니다.' : `모델 미사용 — ${state.modelReason ?? ''}`}
                  {state.categoryOrder.length > 0 && ` · 분류 순서 ${state.categoryOrder.join(' → ')}`}
                  {' · 문서 글자는 제출된 원문 그대로이며 무엇도 새로 쓰지 않았습니다.'}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
