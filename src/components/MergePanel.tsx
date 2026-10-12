'use client';
// HM-26 — 병합 결과 검토. **볼 곳만 보여준다.**
//
// "슥 보고 제출"이 되려면 전체를 다시 읽게 하면 안 된다. 나머지 행은 제출자가 쓴 원문
// 그대로이므로 확인할 필요가 없다. 확인이 필요한 건 **기계가 판단한 곳**뿐이다:
// 합쳐진 행, 안 합친 이유, 빠진 사람, 실패.
//
// 2026-10-07 (PG-52 · CP-97) — 초록 칠한 카드 안에 흰 상자 둘·경고 상자·11px 줄이 겹겹이 들어 있었다.
// 이제 흰 카드 하나: 머리(병합본 + 상태 칩) → 승인 한 줄 → 행동 한 줄(주 버튼 하나) → 확인할 것.
//
// 2026-10-08 (CP-117 · PG-73 — 기능 정리) — 「규칙 바뀜」 칩(R4)·「빠진 사람 n명」 줄(R7)·합쳐진 행 목록(S8)을 걷었다.
// 합쳐진 행은 「내용 다른 묶음 n건」 한 줄이다 — 실제로 고치는 곳은 [내용 보기]의 병합본이다. 병합본 받기는 이 카드의
// [받기] 하나이고, 게시판에 올릴 때 쓰는 [제목 복사]가 그 옆으로 왔다(S5 — 드로어의 [hwp로 받기]·[제목 복사]는 지웠다).
//
// 2026-10-08 (CP-130 · HM-59·60 — 병합 줄) — [지금 병합]은 줄에 넣고 바로 돌아온다(202). 버튼은 서버가 알려 주는 자리(「줄 n번째」 ·
// 「병합 중…」)로 막는다 — 예전의 `busy`는 그 탭에만 있어서 다른 탭 · 다른 사람 · 스케줄러를 몰랐다. 끝날 때까지 2초마다 묻는다.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MergedDrawer } from './MergedDrawer';
import { HELD_TEXT, MODEL_NOT_CONFIGURED } from '@/lib/merge-rows';
import { copyText } from '@/lib/clipboard';

/** HM-26 — 실행 기록(`reviewJson.groups`)에 남는 합쳐진 묶음. 화면은 이제 그 수만 센다(`differingGroups`) */
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
  rowCounts: { achievements: number; plans: number; notes: number } | null;
  warnings: string[];
  errorText: string | null;
  /** S8 — 내용이 다른 합쳐진 묶음 수 (글자까지 같은 묶음은 세지 않는다 — `differingGroups`) */
  differing: number;
  /** 모델을 썼나·왜 안 썼나 — 모델이 원래 없는 서버면 그 경고를 매주 되풀이하지 않는다 (PG-52) */
  modelUsed: boolean;
  modelReason: string | null;
  sourceCount: number;
  /** HM-33 — 확인이 필요한 행 (「없음」 등). 지우지 않고 보여준다 */
  flagged: { no: string; who: string; content: string; bucket: string }[];
  /** HM-47 — 부서장 승인. 없으면 아직 승인 전 */
  review: ReviewStateView | null;
  /** 부서장 계정이 있는 부서인가 — 없으면 「승인 전」을 띄우지 않는다 */
  hasHead: boolean;
  /**
   * HM-49 — 지금 병합본(그 주차의 최신 성공 실행)을 사람이 고쳤나. 없으면 null.
   * [다시 병합] 전에 「누가 몇 곳」을 묻는 데 쓴다 — 확인하면 `overwriteEdits: true`로 보낸다 (API-55)
   */
  edits: MergeEditsView | null;
  /** CP-130 — 이 부서·주차의 줄 작업(대기 · 병합 중). 없으면 null */
  job?: MergeJobView | null;
  /** CP-130 · HM-61d — 가장 최근 병합이 「병합하는 동안 고친 판」을 지켜 쓰지 않았다. 카드는 고친 판을 그대로 그린다 */
  held?: boolean;
}

/** CP-130 — 줄의 자리. `position`은 병합 중인 작업이 1, 대기가 2, 3 … (HM-59f · API-65) */
export interface MergeJobView {
  id: string;
  status: 'queued' | 'running';
  position: number;
  etaMinutes: number | null;
}

/** CP-130 — 줄 작업을 묻는 간격 */
const POLL_MS = 2000;

/** CP-130 — 버튼 자리의 글. 대기면 순번(과 대략의 분), 병합 중이면 「병합 중…」 */
export function jobLabel(job: Pick<MergeJobView, 'status' | 'position' | 'etaMinutes'>): string {
  if (job.status === 'running') return '병합 중…';
  return `줄 ${job.position}번째${job.etaMinutes ? ` · 약 ${job.etaMinutes}분` : ''}`;
}

/** HM-49 — 고친 기록 요약. 409 `edited`의 `detail.edits`와 같은 모양이다 (API-55) */
export interface MergeEditsView {
  places: number;
  saves: number;
  by: string[];
  lastAtKst: string;
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
  title,
  canRun,
  canDownload,
  canEditMerged,
  canApprove = false,
  handoffTo = null,
  submitted,
}: {
  state: MergeStateView;
  isoKey: string;
  divisionSlug: string;
  /** S5 — 게시판에 올릴 제목 (`boardTitle` — 병합본 드로어 머리와 같은 글). [제목 복사]가 그대로 복사한다 */
  title: string;
  canRun: boolean;
  /** [내용 보기]·[받기]·[제목 복사] — 담당자 이상 (TACP §3.2) */
  canDownload: boolean;
  /** 병합본 수정 — 담당자 + 내 부서 (TACP-15). «병합 실행»과 다른 판정이다 */
  canEditMerged: boolean;
  /** HM-47 — [고칠 것 없음 · 승인]. 이 부서의 head에게만 (TACP-16) */
  canApprove?: boolean;
  /**
   * RU-80 — 3단계에서 승인이 곧 위로 가는 제출이면 받는 곳(「기획경영본부」·「총괄」). 없으면 null.
   * 있으면 [제목 복사]를 그리지 않는다 — 승인한 판이 저절로 올라가 취합게시판에 올리는 동선이 없다(S5 · ADR-0015).
   * 「승인하면 바로 ○○에」는 바로 아래 「위로」 카드(HandoffCard)가 말한다 — 이 카드에서 되풀이하지 않는다(PG-65)
   */
  handoffTo?: string | null;
  submitted: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openContent, setOpenContent] = useState(false);
  // CP-109a — 된 것만 「복사됨」. 사내망 평문 HTTP에서는 대체 경로(copyText)가 실패할 수 있다
  const [copied, setCopied] = useState<boolean | null>(null);
  const copyTitle = async () => {
    const ok = await copyText(title);
    setCopied(ok);
    setTimeout(() => setCopied(null), ok ? 2000 : 4000);
  };
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
        const b = (await r.json().catch(() => ({}))) as {
          message?: string;
          notified?: number;
          unchanged?: boolean;
          handedOff?: { target: string } | null;
        };
        if (!r.ok) {
          setErr(b.message ?? '승인하지 못했습니다.');
          return;
        }
        // 알림이 실제로 나갔을 때만 「알렸습니다」라고 말한다. 3단계면 승인이 곧 제출이다 — 어디로 갔는지를 먼저 (RU-80 · HM-T145)
        setNote(
          b.unchanged
            ? '이미 승인한 판입니다'
            : b.handedOff
              ? `승인했어요 — ${b.handedOff.target}에 올라갔어요${(b.notified ?? 0) > 0 ? ' · 담당자에게 알렸습니다' : ''}`
              : (b.notified ?? 0) > 0
                ? '승인 완료 — 담당자에게 알렸습니다'
                : '승인 기록됨 — 알림은 보내지 않았어요',
        );
        router.refresh();
      })
      .catch(() => setErr('네트워크 오류로 승인하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  /*
   * CP-106 · HM-49 — 사람이 고친 병합본은 **덮기 전에 이 카드 안에서 묻는다.**
   * 다시 병합은 같은 경로에 새로 쓰므로 고친 내용이 어디에도 남지 않는다. 묻지 않고 덮으면
   * 부서장 승인(= 고쳐 저장)이 통째로 사라지고, 화면에는 「승인 뒤 바뀜」만 남는다.
   * 이 화면을 연 뒤에 누가 고쳤으면 서버가 409로 멈추고 같은 요약을 주므로, 그때도 같은 자리에서 묻는다.
   */
  const [ask, setAsk] = useState<MergeEditsView | null>(null);

  /*
   * CP-130 — 줄 작업. 서버가 그려 준 것(`state.job`) 또는 [지금 병합]의 202 응답으로 알게 된다. 끝난 것으로 본 작업(`doneId`)은
   * 새로 그린 화면이 도착하기 전까지 서버의 옛 값으로 되살리지 않는다.
   */
  const [tracked, setTracked] = useState<MergeJobView | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const serverJob = state.job && state.job.id !== doneId ? state.job : null;
  const job = tracked ?? serverJob;
  const jobId = job?.id ?? null;
  useEffect(() => {
    // 타 부서를 읽는 사람(버튼이 없다)은 묻지 않는다 — 그 작업은 그 사람의 것이 아니다(API-65은 내 부서 작업만)
    if (!jobId || !canRun) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/division/merge?jobId=${encodeURIComponent(jobId)}`);
        if (stopped) return;
        const b = (await r.json().catch(() => ({}))) as {
          status?: string;
          position?: number | null;
          etaMinutes?: number | null;
          errorText?: string | null;
        };
        if (r.ok && (b.status === 'queued' || b.status === 'running')) {
          setTracked({ id: jobId, status: b.status, position: b.position ?? 1, etaMinutes: b.etaMinutes ?? null });
          return;
        }
        clearInterval(timer);
        setTracked(null);
        setDoneId(jobId);
        // 고친 판을 지킨 것(HM-61)은 실패가 아니다 — 새로 그린 카드가 그 한 줄을 보인다
        if (r.ok && b.status !== 'done' && b.errorText && b.errorText !== HELD_TEXT) setErr(b.errorText);
        router.refresh();
      } catch {
        // 네트워크가 잠깐 끊겨도 다음 번에 다시 묻는다
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, canRun, router]);

  const run = (overwriteEdits = false) => {
    if (!overwriteEdits && state.edits) {
      setErr(null);
      setAsk(state.edits);
      return;
    }
    setBusy(true);
    setErr(null);
    setAsk(null);
    fetch('/api/division/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 확인한 경우에만 붙인다 — 서버는 정확히 true만 확인으로 친다 (API-55)
      body: JSON.stringify(overwriteEdits ? { isoKey, overwriteEdits: true } : { isoKey }),
    })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          detail?: { edits?: MergeEditsView };
          jobId?: string;
          status?: 'queued' | 'running';
          position?: number;
          etaMinutes?: number | null;
        };
        if (r.status === 409 && b.error === 'edited' && b.detail?.edits) setAsk(b.detail.edits);
        else if (!r.ok) setErr(b.message ?? '병합에 실패했습니다.');
        // HM-60b — 202: 줄에 넣었다(또는 같은 부서 작업에 합류했다). 끝나면 위의 물음이 새로 그린다
        else if (b.jobId) setTracked({ id: b.jobId, status: b.status ?? 'queued', position: b.position ?? 1, etaMinutes: b.etaMinutes ?? null });
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
    <section data-guide="merge-card" className="card" aria-labelledby="merge-panel">
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
              </>
            ) : state.status === 'failed' ? (
              <span className="text-error">{state.errorText}</span>
            ) : state.status === 'none' ? (
              submitted === 0 ? '제출된 파일이 없습니다.' : '마감 후 자동 병합'
            ) : null}
          </p>
        </div>
        {done ? (
          // CP-104 — 사용 안내의 「준비됨」 단계(마감 뒤 저절로 합쳐진다)가 이 칩을 가리킨다
          <span data-guide="merge-ready" className="chip chip-ok">
            <span aria-hidden className="dot" />
            준비됨{state.finishedAtKst && ` ${state.finishedAtKst}`}
          </span>
        ) : job ? (
          <span className="chip chip-info">{job.status === 'running' ? '병합 중' : '대기 중'}</span>
        ) : state.status === 'failed' ? (
          <span className="chip chip-error">병합 실패</span>
        ) : state.status === 'running' ? (
          <span className="chip chip-info">병합 중</span>
        ) : (
          <span className="chip chip-muted">아직 병합 전</span>
        )}
      </div>

      {/* PG-58 · CP-104 — 사용 안내가 「승인 상태 + 할 일」 두 줄만 카메라에 담는 자리. 감싸기만 하고 모양은 바꾸지 않는다 */}
      <div data-guide="merge-review">
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
              </p>
            )}
          </div>
        )}

        {/* 행동 한 줄 — 주 버튼은 하나: 보통은 [내용 보기], 부서장이 승인할 판이 있으면 [승인] */}
        {((done && canDownload) || canRun || approveNow) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {approveNow && (
              <button data-guide="merged-approve" onClick={approve} disabled={busy} className="btn-primary">
                고칠 것 없음 · 승인
              </button>
            )}
            {done && canDownload && (
              <button data-guide="merged-open" onClick={() => setOpenContent(true)} className={approveNow ? 'btn-secondary' : 'btn-primary'}>
                내용 보기
              </button>
            )}
            {done && canDownload && (
              <a href={href} className="btn-secondary">
                받기
              </a>
            )}
            {/* S5 — 취합게시판에 올릴 때 붙여 넣는 제목. 3단계로 저절로 올라가는 부서에는 없다 — 게시판에 올리는 동선이 없어진다 (ADR-0018 · ADR-0015) */}
            {done && canDownload && !handoffTo && (
              <button onClick={copyTitle} className="btn-ghost">
                {copied === true ? '복사됨 ✓' : copied === false ? '복사하지 못했습니다' : '제목 복사'}
              </button>
            )}
            {canRun && (
              <button
                data-guide="merge-run"
                onClick={() => run()}
                disabled={busy || submitted === 0 || !!ask || !!job}
                className={done ? 'btn-ghost' : 'btn-secondary'}
              >
                {job ? jobLabel(job) : busy ? '병합 중…' : done ? '다시 병합' : '지금 병합'}
              </button>
            )}
          </div>
        )}
        {/*
          CP-106 — 무엇이 사라지는지(누가·몇 곳·언제)를 보여 줘야 고를 수 있다. 브라우저 확인 창엔 한 줄밖에 못 넣는다.
          누른 [다시 병합] 바로 밑에서 묻는다. 확인은 보조 버튼 — 이 카드의 주 버튼은 그대로 하나다 (CP-99)
        */}
        {canRun && ask && (
          <div role="alert" className="callout callout-warn mt-4">
            <p className="font-semibold text-ink">다시 병합하면 병합본을 고친 내용이 사라집니다</p>
            <p className="mt-1 text-body">
              {ask.by.length > 0 && <>고친 사람 {ask.by.join(', ')} · </>}
              고친 곳 {ask.places}곳{ask.saves > 1 && ` (저장 ${ask.saves}번)`}
              {ask.lastAtKst && ` · 마지막 ${ask.lastAtKst}`}
            </p>
            {/* 부서장이 고쳐 저장한 그 판이 지금 판이면, 바뀐 곳을 몇 줄 보여 준다 (HM-47이 남긴 것) */}
            {state.review?.kind === 'edit' && !state.review.changedAfter && state.review.lines.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[13px] text-body">
                {state.review.lines.slice(0, 3).map((l, i) => (
                  <li key={i}>· {l}</li>
                ))}
                {state.review.lines.length > 3 && <li className="text-muted">외 {state.review.lines.length - 3}곳</li>}
              </ul>
            )}
            {done && canDownload && <p className="mt-1.5 text-xs text-muted">고친 판이 필요하면 먼저 [받기]</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button onClick={() => run(true)} disabled={busy || !!job} className="btn-secondary btn-sm">
                {busy ? '병합 중…' : '고친 내용 버리고 다시 병합'}
              </button>
              <button onClick={() => setAsk(null)} disabled={busy} className="btn-ghost">
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HM-61d — 병합하는 동안 고친 판을 지켜 쓰지 않았다. 카드는 고친 판을 그대로 그린다 — 실패가 아니라 한 줄 */}
      {state.held && !job && <p className="callout callout-warn mt-4">{HELD_TEXT}</p>}
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
            S8 · CP-117 — 합쳐진 행은 수만. 글자까지 같게 적은 묶음은 잃은 것이 없어 세지 않는다.
            어느 줄인지는 [내용 보기]의 병합본에서 보고 고친다 — 고치는 곳이 거기다
          */}
          {state.differing > 0 && <p className="callout callout-warn mt-4">내용 다른 묶음 {state.differing}건</p>}
        </>
      )}
    </section>
  );
}
