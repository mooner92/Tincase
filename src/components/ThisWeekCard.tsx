'use client';
// CP-112 — 부서원 홈의 **이번 주 카드** (PG-67). 주 버튼은 하나다: 내기 전 [작성하기], 낸 뒤 [열기].
//
// 2026-10-08 (사용자: 제출·보관함·내 이력을 홈 하나로, 화면 설명 문장 걷기) — 예전 카드는 버튼이 넷([다시 작성 (새 버전)] ·
// [열어보기] · 내 파일 받기 · 제출 취소)이었고 위에는 카운트다운, 옆에는 부서 명단이 있었다. 실측으로 2판 이상 낸 사람은 0명이고,
// [열어보기] 80건 중 62건이 이번 주 것이었다 — 「다시 쓰기」와 「보기」는 같은 행동이었다. 그래서 [열기] 하나가
// 낸 판으로 채운 작성 화면을 열고, 내용을 바꾸기 전에는 [제출]이 꺼져 있다(WA-37).
//
// 판정(마감·열림·양식·취소 가능)은 전부 서버가 해서 넘긴다 — 이 컴포넌트는 그리기만 한다(CP-03).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WebComposer, type ComposerRow } from './WebComposer';
import { FileDrawer } from './FileDrawer';
import { MergedDrawer } from './MergedDrawer';

type Rows = Record<'achievements' | 'plans' | 'notes', ComposerRow[]>;

export interface ThisWeekCardProps {
  /** WA-36a — weekStartMs: 이번 주 월요일 00:00 KST (일자 예시) */
  week: { isoKey: string; label: string; month: number; monthly: boolean; weekStartMs: number };
  /** text: `formatDeadlineNearKo` · changedNote: WS-18 사유 */
  deadline: { text: string; changedNote: string | null };
  /** opened = TACP-18 마감 후 열림 */
  phase: 'open' | 'opened' | 'locked';
  /** "15:30" */
  openUntilText: string | null;
  /** PG-67d — 보이지 않는 새로 고침 */
  refresh: { atMs: number; serverNowMs: number } | null;
  /** version은 취소 확인 문구에만 쓴다. 고친 사람은 싣지 않는다 — 「고침」 여부만(PG-66e) */
  mine: { id: string; at: string; version: number; edited: boolean } | null;
  /** user.onRoster — 집계 제외(부서장·휴직)에게는 「미제출」이 없다 (D17) */
  showMissing: boolean;
  /** 마감 전(또는 열림)이고 부서 양식이 있다 */
  canCompose: boolean;
  /** TACP-14 — 낸 것이 있고 잠기지 않았다. 게이트(requireDeletableSubmission)와 같은 식 */
  canCancel: boolean;
  /** PG-09 — 잠기지 않았는데 부서 양식이 없다 */
  noTemplate: boolean;
  /** PG-67c — 잠긴 뒤 마감 이벤트 뒤에 만든 성공 병합본이 있다 */
  doc: boolean;
  divisionSlug: string;
  /** FileDrawer members=[me] */
  me: { id: string; name: string };
  /** HM-33 → WebComposer */
  emptyWordsRaw: string;
  /** PG-66b·d — paired: 5칸 sticky · alone: 지난 주차가 없어 7칸 */
  layout: 'paired' | 'alone';
}

export function ThisWeekCard({
  week,
  deadline,
  phase,
  openUntilText,
  refresh,
  mine,
  showMissing,
  canCompose,
  canCancel,
  noTemplate,
  doc,
  divisionSlug,
  me,
  emptyWordsRaw,
  layout,
}: ThisWeekCardProps) {
  const router = useRouter();
  const [composing, setComposing] = useState<{ initial: Rows | null; failed: boolean; editedNote: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // WA-38 — 닫으면 연 단추로 초점을 돌린다. 주 버튼은 「작성하기」·「열기」가 바뀌어도 같은 요소다
  const mainRef = useRef<HTMLButtonElement>(null);
  const docRef = useRef<HTMLButtonElement>(null);

  /*
   * PG-67d — 마감·열림 끝·KST 자정·다음 주 월요일에 **보이지 않게** 새로 고친다.
   * 카운트다운은 지웠지만 「마감 순간 [작성하기]가 사라지는 일」(옛 CP-13)은 남긴다. 시계는 서버 것을 믿는다 —
   * 이 PC 시계가 틀려도 서버와의 차이만큼 밀어서 맞춘다. 탭을 오래 숨겼다 돌아오면 바로 확인한다.
   */
  const atMs = refresh?.atMs ?? null;
  const serverNowMs = refresh?.serverNowMs ?? null;
  useEffect(() => {
    if (atMs === null || serverNowMs === null) return;
    const due = atMs + (Date.now() - serverNowMs) + 1000;
    const t = setTimeout(() => router.refresh(), Math.max(0, due - Date.now()));
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= due) router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [atMs, serverNowMs, router]);

  /**
   * PG-67b — [열기]가 여는 곳. 낼 수 있으면 낸 판으로 채운 작성 화면(WA-35), 낼 수 없으면(마감 뒤·양식 없음)
   * 읽기 전용 제출물 드로어. 표는 열람과 같은 응답(`rowsByTable`)에서 온다 — 본인 것은 원래 열람할 수 있다(AU-13).
   * 고친 사람의 이름도 같은 응답에 있다(TACP-22). 홈은 「고침」만 알고, 이름은 열었을 때 본다.
   */
  const openMain = async () => {
    if (!mine) {
      setComposing({ initial: null, failed: false, editedNote: null });
      return;
    }
    if (!canCompose) {
      setViewId(mine.id);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/submissions/${mine.id}/preview`);
      const b = r.ok
        ? ((await r.json()) as { rowsByTable?: Rows; submission?: { editedBy?: string | null; editedAt?: string | null } })
        : null;
      const by = b?.submission?.editedBy;
      const at = b?.submission?.editedAt;
      setComposing({
        initial: b?.rowsByTable ?? null,
        failed: !b?.rowsByTable,
        editedNote: by ? `${by} 고침${at ? ` · ${at.slice(5, 16).replace('T', ' ')}` : ''}` : null,
      });
    } catch {
      setComposing({ initial: null, failed: true, editedNote: null });
    } finally {
      setLoading(false);
    }
  };

  // 되돌릴 수 없는 행동이다 (ADR-0007). 무엇이 사라지는지 먼저 말한다(CP-106) — 문구는 예전 카드 그대로
  const cancel = async () => {
    if (!mine) return;
    const warn =
      mine.version > 1
        ? `이번 주 제출을 취소합니다.\n이번 주에 낸 ${mine.version}개 버전(v1~v${mine.version})이 모두 삭제되고 미제출 상태가 됩니다.\n되돌릴 수 없습니다.`
        : '이번 주 제출을 취소합니다.\n이번 주에 낸 것이 삭제되고 미제출 상태가 됩니다.\n되돌릴 수 없습니다.';
    if (!confirm(warn)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/submissions/${mine.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body.message ?? '취소하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    router.refresh();
  };

  const chip = mine ? (
    <span className="chip chip-ok">
      <span aria-hidden className="dot" />
      제출 완료
    </span>
  ) : showMissing ? (
    <span className="chip chip-muted">미제출</span>
  ) : null;

  const changed = deadline.changedNote !== null;
  const showMain = canCompose || !!mine;
  // WA-38 — 작성 화면 제목은 그 주. 월간 주에는 무엇을 내는지가 바뀐다(WS-14)
  const title = week.monthly ? `${week.month}월 월간 업무일지` : `${week.label} 업무일지`;

  return (
    <>
      <section
        data-guide="week-card"
        aria-labelledby="this-week"
        className={`card ${layout === 'paired' ? 'lg:sticky lg:top-[88px] lg:col-span-5' : 'lg:col-span-7'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          {/* D18 — 카드 제목이 이 페이지의 h1이다(PG-66a, CP-98의 예외). 페이지 제목을 따로 두면 주차를 두 번 읽는다 */}
          <h1 id="this-week" className="flex flex-wrap items-center gap-2 text-[20px] leading-7 font-semibold text-ink">
            {week.label}
            {week.monthly && <span className="chip chip-ok">월간</span>}
          </h1>
          <span aria-live="polite">{chip}</span>
        </div>

        <p className="mt-1 text-[13px] leading-5 text-muted">
          {phase === 'locked' ? (
            '마감됨'
          ) : phase === 'opened' ? (
            // TACP-18 — 담당자가 연 동안. 언제까지인지가 제일 중요하다
            <span className="chip chip-warn">마감 후 열림 · {openUntilText}까지</span>
          ) : (
            <>
              마감 <span className={changed ? 'font-semibold text-error' : ''}>{deadline.text}</span>
            </>
          )}
        </p>
        {/* WS-18 — 이번 주만 마감이 다르면 이미 보는 글자의 색을 바꾸고 이유를 한 줄 붙인다 */}
        {changed && (
          <p className="text-[13px] leading-5 text-muted">
            <strong className="font-semibold text-error">이번 주만 변경</strong> · {deadline.changedNote}
          </p>
        )}
        {mine && (
          <p className="text-[13px] leading-5 text-muted tabular-nums">
            {mine.at} 제출
            {/* TACP-22 — 담당자가 고친 판. 이름은 열었을 때(작성 화면·제출물 드로어 머리) 보인다 */}
            {mine.edited && <span className="text-warning"> · 고침</span>}
          </p>
        )}

        {/* PG-09 — 양식이 없으면 웹 작성도 못 한다(제출물이 부서 양식으로 만들어진다). 잠긴 주에는 그릴 것이 없다 */}
        {noTemplate && (
          <p className="callout callout-warn mt-4">등록된 부서 양식이 없습니다. 담당자에게 양식 등록을 요청하세요.</p>
        )}

        {(showMain || doc || canCancel) && (
          <div data-guide="my-actions" className="mt-5 flex flex-wrap items-center gap-2">
            {showMain && (
              <button
                ref={mainRef}
                data-guide="compose-open"
                onClick={openMain}
                disabled={loading}
                className={mine ? 'btn-secondary' : 'btn-primary'}
              >
                {loading ? '불러오는 중…' : mine ? '열기' : '작성하기'}
              </button>
            )}
            {doc && (
              <button ref={docRef} onClick={() => setDocOpen(true)} className="btn-secondary">
                병합본
              </button>
            )}
            {/* 파괴적 행동이라 다른 버튼과 같은 무게로 두지 않는다 — 글자 링크, 줄 맨 끝. 마감 뒤에는 그리지 않는다(TACP-9) */}
            {canCancel && (
              <button onClick={cancel} disabled={busy} className="btn-link-danger ml-auto">
                {busy ? '취소하는 중…' : '제출 취소'}
              </button>
            )}
            {err && <p className="w-full text-sm text-error">{err}</p>}
          </div>
        )}
      </section>

      {/*
        드로어는 카드 **밖**에 둔다. 카드는 넓은 화면에서 sticky라 제 쌓임 맥락을 만들고, 그 안의 fixed 드로어는
        z-40이어도 머리(z-30) 밑에 깔린다. 드로어는 fixed라 격자의 칸을 차지하지 않는다
      */}
      {composing && (
        <WebComposer
          userId={me.id}
          isoKey={week.isoKey}
          title={title}
          editedNote={composing.editedNote}
          emptyWordsRaw={emptyWordsRaw}
          initial={composing.initial}
          initialVersion={mine?.version}
          initialFailed={composing.failed}
          weekStartMs={week.weekStartMs}
          onClose={() => {
            setComposing(null);
            mainRef.current?.focus();
          }}
        />
      )}
      <FileDrawer
        openId={viewId}
        members={[{ userId: me.id, name: me.name, latestId: mine?.id ?? null }]}
        onClose={() => {
          setViewId(null);
          mainRef.current?.focus();
        }}
        onNavigate={setViewId}
      />
      {doc && (
        <MergedDrawer
          open={docOpen}
          onClose={() => {
            setDocOpen(false);
            docRef.current?.focus();
          }}
          isoKey={week.isoKey}
          divisionSlug={divisionSlug}
          canEdit={false}
          variant="view"
        />
      )}
    </>
  );
}
