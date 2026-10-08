'use client';
// 병합본 보기·고치기 (CP-70~74 · CP-116).
//
// 담당자의 실제 동선은 이렇다: 병합본 받기 → 한글로 열기 → 표 복사 → 게시판에 붙여넣기.
// 중간에 이상한 행이 하나 보이면 그것만 고치려고 한글을 연다.
// **한글을 여는 유일한 이유가 그것**이라면, 여기서 보고 고치면 한글을 열 일이 없다.
//
// 2026-10-08 (S5 · S9 — CP-116) — 받기·제목 복사는 수합 관리 카드의 [받기]·[제목 복사] 하나씩이다. 이 드로어의
// [hwp로 받기]·[제목 복사]는 같은 일을 두 곳에서 했다. [작성자 보기] 토글도 지웠다 — 작성자는 서버가 보낸 사람
// (lead·head·readAll)에게만 오고(TACP-17), 그 사람에게는 열이 늘 있다. 판정은 화면이 아니라 서버가 한다.
//
// **행 순서 바꾸기 (CP-90).** 부서장이 검토하면서 «이건 위로 올려야지»를 하는데, 지금은
// 칸 내용을 서로 오려 붙이는 수밖에 없다 — 다섯 칸짜리 행 하나를 옮기려고 다섯 번 오려 붙인다.
// 왼쪽 손잡이를 끌어 옮긴다. 손잡이만 `draggable`이고 행이 아니다 —
// 행을 통째로 draggable로 만들면 칸 안에서 글자를 선택하는 것부터 안 된다.
//
// 손가락(터치)에서는 HTML5 끌어놓기가 동작하지 않는다. 그래서 손잡이에 **↑/↓ 키**를 함께 붙였다.
// 보기·고치기·지우기는 터치에서 그대로 되고, 순서 바꾸기만 마우스·키보드다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { moveItem, rowNo } from '@/lib/merge-rows';
import { drawerControls, type DrawerVariant } from '@/lib/merged-drawer';

interface TableView {
  key: string;
  title: string;
  columns: string[];
  rows: string[][];
  /** 양식에서 읽은 칸 너비 (HWPUNIT = 1/7200 inch) */
  widths?: number[];
  /**
   * TACP-17 — 본문 행과 나란한 작성자. **권한이 없으면 서버가 아예 안 보낸다** —
   * 화면에서 숨기는 게 아니므로 여기서 `undefined`면 정말로 모르는 것이다
   */
  authors?: string[][];
  /**
   * HM-37 — 행별 강조(파란색). 본문 행과 나란하다.
   *
   * 「전체 공유·전달이 필요한 주요 사항」 표시다. 담당자가 여기서 보고 켜고 끌 수 있어야
   * 하는 이유: 낸 사람이 표시를 빠뜨렸거나, 반대로 다 파랗게 칠해 놓아 강조가 강조를
   * 잃은 경우를 **제출 직전에** 고칠 수 있는 유일한 자리가 여기다.
   */
  emphasis?: boolean[];
}
interface Content {
  title: string;
  slot: { isoKey: string; label: string; year: number; kind: 'weekly' | 'monthly' };
  tables: TableView[];
  /** 서버가 작성자를 보냈는가 (TACP-17) */
  canSeeAuthors?: boolean;
  /** HM-47 — 가장 최근 부서장 승인 */
  review?: { by: string; atKst: string; kind: 'edit' | 'approve'; summary: string; lines: string[]; changedAfter: boolean } | null;
  /** HM-47 — 이 사람이 승인할 수 있나 (이 부서의 head) */
  canApprove?: boolean;
  /** HM-47 — 지금 보는 판. 저장·승인 때 그대로 돌려보낸다 — 그 사이 바뀌었으면 서버가 409 */
  runId?: string;
  sha256?: string;
}

/** 헤더 행을 뺀 본문만. 서버가 준 격자는 첫 줄이 열 이름이다 */
const bodyRows = (t: TableView) => t.rows.slice(1);

/** 여섯 점 손잡이 — 노션의 그것. 「여기를 잡으면 옮겨진다」를 글자 없이 말하는 관용 표현이다 */
function GripIcon() {
  return (
    <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden fill="currentColor">
      {[3, 8, 13].map((cy) => (
        <g key={cy}>
          <circle cx="2.5" cy={cy} r="1.3" />
          <circle cx="7.5" cy={cy} r="1.3" />
        </g>
      ))}
    </svg>
  );
}

export function MergedDrawer({
  open,
  onClose,
  isoKey,
  divisionSlug,
  canEdit: canEditProp,
  variant = 'edit',
}: {
  open: boolean;
  onClose: () => void;
  isoKey: string;
  divisionSlug: string;
  /** 담당자만 고칠 수 있다 (TACP §3.2 — 병합 실행과 같은 권한) */
  canEdit: boolean;
  /** CP-114 — `view`는 부서원 홈의 [병합본]. 누구에게나 읽기만(고치기·승인 띠·복사·받기 없음) */
  variant?: DrawerVariant;
}) {
  const [data, setData] = useState<Content | null>(null);
  // CP-114 — 무엇을 그릴지는 순수 함수 하나가 정한다(CP-T100). view면 canEdit을 무시한다
  const ctl = drawerControls(variant, canEditProp, data);
  const canEdit = ctl.edit;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** 저장 결과 한 마디 (HM-47 — 승인·알림이 실제로 어떻게 됐는지) */
  const [notice, setNotice] = useState<string | null>(null);
  /*
   * TACP-17 · S9 — 작성자 열은 **서버가 작성자를 보냈을 때 늘** 있다. 예전에는 기본으로 접고 눌러 폈는데
   * (「슥 보고 제출」에는 사람이 필요 없다는 판단), 접어 둔 것을 펴는 사람을 잴 수 없었고 부서장이 물어볼 사람을
   * 찾는 순간에 토글을 먼저 찾아야 했다. 부서원에게는 서버가 보내지 않으므로 열이 생기지 않는다 (AU-T33)
   */
  const showAuthors = data?.canSeeAuthors === true;
  /** CP-90 — 끌고 있는 행. `over`는 지금 가리키는 자리(놓으면 여기로 간다) */
  const [drag, setDrag] = useState<{ ti: number; from: number; over: number } | null>(null);
  /**
   * 키보드로 옮긴 뒤 **손잡이에 초점을 되돌린다** — 안 그러면 ↓를 두 번 못 누른다.
   * 상태가 아니라 ref다: 이 값은 그리는 데 쓰이지 않으므로 바뀐다고 다시 그릴 이유가 없다.
   */
  const refocusRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const router = useRouter();

  /**
   * 칸 높이를 **내용에 맞춘다.**
   *
   * `rows={1}` 고정이면 «본원 소회의실»처럼 줄바꿈되는 값이 아래로 잘려서,
   * 확인하려면 칸마다 클릭해 스크롤해야 한다. 확인하려고 여는 화면인데 그러면 안 된다.
   * 세로로 길어지더라도 **한눈에 다 보이는 편**이 낫다.
   *
   * CSS `field-sizing: content`가 같은 일을 하지만 사내 PC 브라우저 버전을 장담할 수 없어
   * scrollHeight로 직접 맞춘다 — 어디서나 동작한다.
   */
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    // border-box이므로 테두리 두께를 더해야 한다 — scrollHeight는 테두리를 뺀 값이다
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  };

  // 값이 밖에서 바뀌는 경우(불러오기·저장 후 재조회)도 다시 맞춘다
  useLayoutEffect(() => {
    bodyRef.current?.querySelectorAll('textarea').forEach((el) => fit(el as HTMLTextAreaElement));
  }, [data]);

  useLayoutEffect(() => {
    const key = refocusRef.current;
    if (!key) return;
    refocusRef.current = null;
    bodyRef.current?.querySelector<HTMLButtonElement>(`[data-grip="${key}"]`)?.focus();
  }, [data]);

  // 상태 변경은 전부 비동기 콜백 안에서. `alive`는 드로어를 빨리 여닫았을 때
  // 늦게 도착한 응답이 새 상태를 덮어쓰는 것을 막는다
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/division/merged/content?division=${divisionSlug}&isoKey=${isoKey}`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? '불러오지 못했습니다.');
        const j = (await r.json()) as Content;
        if (!alive) return;
        setData(j);
        setErr(null);
        setDirty(false);
      } catch (e) {
        if (!alive) return;
        setData(null);
        setErr(String((e as Error).message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, isoKey, divisionSlug]);

  // CP-114 — 열면 제목에 초점(화면 읽기 프로그램이 무엇이 열렸는지 먼저 읽는다)
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!dirty) onClose();
        return;
      }
      // CP-114 — Tab은 드로어 안에서 돈다. 뒤 화면으로 새면 열린 줄 모르고 홈의 버튼을 누른다
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, dirty]);

  const flash = (what: string) => {
    setNotice(what);
    setTimeout(() => setNotice(null), 1600);
  };

  const edit = (ti: number, ri: number, ci: number, v: string) => {
    if (!data) return;
    const tables = data.tables.map((t, i) =>
      i !== ti ? t : { ...t, rows: t.rows.map((r, j) => (j !== ri + 1 ? r : r.map((c, k) => (k === ci ? v : c)))) },
    );
    setData({ ...data, tables });
    setDirty(true);
  };

  /*
   * TACP-17 — **작성자는 행과 나란한 배열이다.** `authors[ri]`가 `bodyRows[ri]`를 가리킨다.
   * 행을 지우거나 옮기면서 작성자를 같이 옮기지 않으면 **한 칸씩 밀려 남의 이름이 붙는다** —
   * 그 화면을 보고 부서장이 엉뚱한 사람에게 «이거 고쳐주세요»라고 말하게 된다.
   * (저장하면 서버가 내용으로 다시 맞추지만, 잘못 보는 것은 저장 전이다.)
   */
  const withoutAt = <T,>(a: T[] | undefined, i: number) => (a ? a.filter((_, j) => j !== i) : a);

  const removeRow = (ti: number, ri: number) => {
    if (!data) return;
    const tables = data.tables.map((t, i) =>
      i !== ti
        ? t
        : {
            ...t,
            rows: t.rows.filter((_, j) => j !== ri + 1),
            authors: withoutAt(t.authors, ri),
            emphasis: withoutAt(t.emphasis, ri),
          },
    );
    setData({ ...data, tables });
    setDirty(true);
  };

  /** HM-37 — 강조 켜고 끄기 */
  const toggleEmphasis = (ti: number, ri: number) => {
    if (!data) return;
    const tables = data.tables.map((t, i) => {
      if (i !== ti) return t;
      const next = [...(t.emphasis ?? [])];
      while (next.length < bodyRows(t).length) next.push(false);
      next[ri] = !next[ri];
      return { ...t, emphasis: next };
    });
    setData({ ...data, tables });
    setDirty(true);
  };

  /** CP-90 — `from`번째 행을 `to` 자리로. 범위를 벗어나면 아무 일도 하지 않는다 */
  const moveRow = (ti: number, from: number, to: number) => {
    if (!data || from === to) return;
    const tables = data.tables.map((t, i) => {
      if (i !== ti) return t;
      const body = bodyRows(t);
      if (to < 0 || to >= body.length) return t;
      return {
        ...t,
        rows: [t.rows[0], ...moveItem(body, from, to)],
        // 같은 (from, to)로 한 번 더 — 이게 작성자가 제 행을 따라가는 유일한 방법이다
        authors: t.authors ? moveItem(t.authors, from, to) : t.authors,
        // HM-37 — 강조도 같이 옮긴다. 안 옮기면 순서를 바꾼 순간 엉뚱한 줄이 파래진다
        emphasis: t.emphasis ? moveItem(t.emphasis, from, to) : t.emphasis,
      };
    });
    setData({ ...data, tables });
    setDirty(true);
  };

  const save = async () => {
    if (!data) return;
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/division/merged/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isoKey,
        runId: data.runId,
        sha256: data.sha256,
        tables: data.tables.map((t) => ({ key: t.key, rows: bodyRows(t), emphasis: t.emphasis ?? [] })),
      }),
    });
    if (!res.ok) {
      // 409 merged_changed — 연 뒤에 다시 병합했거나 누가 고쳤다. 고친 내용은 화면에 남겨 둔다(옮겨 적을 수 있게)
      setErr((await res.json().catch(() => ({}))).message ?? '저장하지 못했습니다.');
      setBusy(false);
      return;
    }
    const saved = (await res.json().catch(() => ({}))) as {
      approved?: { summary: string; notified: number; unchanged?: boolean } | null;
      runId?: string;
      sha256?: string;
    };
    // 방금 저장한 판이 이제 「본 판」이다 — 아래 재조회가 실패해도 이어서 고치거나 승인할 수 있게
    setData((d) => (d ? { ...d, runId: saved.runId ?? d.runId, sha256: saved.sha256 ?? d.sha256 } : d));
    setDirty(false);
    setBusy(false);
    // HM-47 — 부서장의 저장은 곧 승인이다. 무엇이 일어났는지 그 자리에서, **사실대로** 말한다
    flash(
      !saved.approved
        ? '저장'
        : saved.approved.unchanged
          ? '저장 — 이미 승인한 판입니다'
          : saved.approved.notified > 0
            ? '저장 · 승인 완료 — 담당자에게 알렸습니다'
            : '저장 · 승인 기록됨 — 알림은 보내지 않았어요',
    );
    router.refresh();
    // 채번이 다시 매겨지므로 서버가 쓴 결과를 다시 읽는다
    const fresh = await fetch(`/api/division/merged/content?division=${divisionSlug}&isoKey=${isoKey}`);
    if (fresh.ok) setData(await fresh.json());
  };

  // HM-47 — 고칠 것 없이 승인. **지금 보는 판**에만 붙는다
  const approve = async () => {
    if (!data) return;
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/division/merged/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isoKey, runId: data.runId, sha256: data.sha256 }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).message ?? '승인하지 못했습니다.');
      return;
    }
    const r = (await res.json().catch(() => ({}))) as { notified?: number; unchanged?: boolean };
    flash(
      r.unchanged
        ? '이미 승인한 판입니다'
        : (r.notified ?? 0) > 0
          ? '승인 완료 — 담당자에게 알렸습니다'
          : '승인 기록됨 — 알림은 보내지 않았어요',
    );
    router.refresh();
    const fresh = await fetch(`/api/division/merged/content?division=${divisionSlug}&isoKey=${isoKey}`);
    if (fresh.ok) setData(await fresh.json());
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 h-screen">
      {/* 배경 클릭 → 닫기 (다른 드로어들과 동일 구조). 수정 중이면 확인부터 */}
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={() => (!dirty || confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="병합본 보기"
        data-guide="merged-drawer"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-4xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm text-muted">병합본</p>
            <h2 ref={titleRef} tabIndex={-1} className="card-title truncate outline-none">
              {data?.title ?? '불러오는 중…'}
            </h2>
          </div>
          <button
            onClick={() => (!dirty || confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) && onClose()}
            aria-label="닫기"
            className="shrink-0 rounded-lg px-2 py-1 text-muted hover:bg-surface-soft hover:text-ink"
          >
            ✕
          </button>
        </header>

        {/*
          CP-116 · CP-110 — 머리 줄은 고칠 수 있는 사람에게만: 저장 결과 한 마디와 [수정 저장]. [수정 저장]은 처음부터 보이고
          고치기 전에는 꺼져 있다 — 고치는 순간 줄이 새로 생겨 표가 밀려 내려가지 않게. 받기·제목 복사는 수합 관리 카드에 있다(S5)
        */}
        {canEdit && (
          <div data-guide="merged-head" className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 sm:px-6">
            <span className="text-sm">
              {notice && <span className="font-medium text-success">{notice}</span>}
              {dirty && !notice && <span className="text-warning">저장하지 않은 수정</span>}
            </span>
            <button data-guide="merged-save" onClick={save} disabled={!dirty || busy} className="btn-primary btn-sm ml-auto">
              {busy ? '저장 중…' : '수정 저장'}
            </button>
          </div>
        )}

        {/* HM-47 — 승인 상태. 부서장에게는 [고칠 것 없음 · 승인] — 고쳐 저장하면 그 저장이 승인이다 */}
        {data && ctl.reviewBand && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline-soft bg-surface-soft px-4 py-2.5 text-sm sm:px-6">
            {data.review ? (
              <>
                <span className={`chip ${data.review.changedAfter ? 'chip-warn' : 'chip-ok'}`}>
                  {data.review.changedAfter ? '승인 뒤 바뀜' : '승인 완료'}
                </span>
                <span className="text-ink">{data.review.by}</span>
                <span className="text-muted">
                  {data.review.atKst} · {data.review.kind === 'approve' ? '고친 곳 없이 승인' : data.review.summary}
                </span>
              </>
            ) : (
              <span className="text-muted">
                {/* CP-110 — 「고쳐서」만으로는 어디를 어떻게 고치는지 모른다. 이 화면에서 바로 된다는 것을 먼저 말한다 */}
                {canEdit ? '승인 전 · 고쳐 저장하면 승인' : '승인 전'}
              </span>
            )}
            {ctl.approve && (
              <button onClick={approve} disabled={busy || dirty} className="btn-secondary btn-sm ml-auto">
                고칠 것 없음 · 승인
              </button>
            )}
          </div>
        )}

        <div ref={bodyRef} data-guide="merged-body" className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {err && <p className="callout callout-error mb-4">{err}</p>}
          {!data && !err && <p className="text-sm text-muted">불러오는 중…</p>}

          {data?.tables.map((t, ti) => {
            const rows = bodyRows(t);
            return (
              <section key={t.key} className="mb-7">
                <h3 className="mb-2 text-[15px] font-semibold text-ink">
                  {t.title} <span className="text-sm font-normal text-muted">{rows.length}행</span>
                </h3>
                {rows.length === 0 ? (
                  <p className="callout callout-muted text-muted">내용 없음</p>
                ) : (
                  /* 좁은 화면에서 칸을 짜부라뜨리지 않는다 — 한 글자씩 세로로 쪼개지던 것을 가로 스크롤로 */
                  <div className="overflow-x-auto rounded-lg border border-hairline">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="table-head border-b border-hairline bg-surface-soft">
                          {/* CP-90 — 손잡이 자리. 노션처럼 표 왼쪽 여백에 둔다 */}
                          {canEdit && <th className="w-7" />}
                          {t.columns.map((c, i) => (
                            <th
                              key={c}
                              // 구분 열은 두 자리 번호(1-10)에서 줄바꿈이 난다 — 폭을 잡아 준다
                              className={`px-3 py-2 font-medium ${
                                ['w-14 whitespace-nowrap', 'w-[38%]', 'w-[11%]', 'w-[22%]', 'w-[22%]'][i] ?? ''
                              }`}
                            >
                              {c}
                            </th>
                          ))}
                          {showAuthors && <th className="w-[15%] px-3 py-2 font-medium whitespace-nowrap">작성자</th>}
                          <th className="w-16 px-1 py-2 text-center font-medium whitespace-nowrap">공유</th>
                          {canEdit && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, ri) => {
                          const dragging = drag?.ti === ti && drag.from === ri;
                          // 놓을 자리 표시: 아래로 옮기는 중이면 아래 모서리, 위로면 위 모서리
                          const marked = drag?.ti === ti && drag.over === ri && drag.from !== ri;
                          const edge = marked ? (drag!.from < ri ? 'border-b-2 border-b-ink' : 'border-t-2 border-t-ink') : '';
                          return (
                          <tr
                            key={ri}
                            onDragOver={(e) => {
                              if (drag?.ti !== ti) return; // 다른 표로는 옮기지 않는다 (실적↔계획은 뜻이 다르다)
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (drag.over !== ri) setDrag({ ...drag, over: ri });
                            }}
                            onDrop={(e) => {
                              if (drag?.ti !== ti) return;
                              e.preventDefault();
                              moveRow(ti, drag.from, ri);
                              setDrag(null);
                            }}
                            className={`group border-b border-hairline-soft last:border-0 ${edge} ${
                              dragging ? 'opacity-40' : ''
                            }`}
                          >
                            {canEdit && (
                              <td className="px-0.5 py-0.5 align-top">
                                <button
                                  data-grip={`${ti}-${ri}`}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    // 손잡이만 끌리면 무엇을 옮기는지 안 보인다 — 행 전체를 끌리는 그림으로
                                    const tr = e.currentTarget.closest('tr');
                                    if (tr) e.dataTransfer.setDragImage(tr, 12, 12);
                                    setDrag({ ti, from: ri, over: ri });
                                  }}
                                  onDragEnd={() => setDrag(null)}
                                  onKeyDown={(e) => {
                                    const to = e.key === 'ArrowUp' ? ri - 1 : e.key === 'ArrowDown' ? ri + 1 : null;
                                    if (to === null || to < 0 || to >= rows.length) return;
                                    e.preventDefault();
                                    moveRow(ti, ri, to);
                                    refocusRef.current = `${ti}-${to}`;
                                  }}
                                  aria-label={`${rowNo(t.key, ri)}행 옮기기 — 끌거나 위·아래 화살표`}
                                  title="끌어서 옮기기"
                                  // 줄마다 늘 보이면 스물네 줄에 손잡이·공유·✕가 일흔두 개다 — 그 줄에 손이 갔을 때만 (넓은 화면)
                                  className="cursor-grab rounded px-1 py-1.5 text-muted-soft hover:bg-surface-soft hover:text-body focus:text-body focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                                >
                                  <GripIcon />
                                </button>
                              </td>
                            )}
                            {r.map((cell, ci) => (
                              <td key={ci} className="px-1 py-0.5 align-top">
                                {canEdit && ci > 0 ? (
                                  <textarea
                                    // CP-104 — 사용 안내의 「업무실적 내용」 단계는 첫 표 첫 줄의 내용 칸을 가리킨다(「칸을 눌러 고친다」)
                                    data-guide={ti === 0 && ri === 0 && ci === 1 ? 'merged-cell' : undefined}
                                    value={cell}
                                    rows={1}
                                    ref={fit}
                                    onChange={(e) => {
                                      fit(e.target);
                                      edit(ti, ri, ci, e.target.value);
                                    }}
                                    /*
                                      HM-37 — 강조 줄의 내용 칸은 **화면에서도 파랗게** 보인다.
                                      문서에서 파란색인 것을 화면에서는 회색 배지로만 알리면,
                                      담당자가 «제출본이 어떻게 보이는지»를 확인할 길이 없다.
                                      실제 색(emphasis 토큰 = hwp의 그 파랑)을 그대로 쓴다 — 비슷한 파랑이 아니라.
                                    */
                                    /*
                                      CP-110 — 테두리를 **늘** 그린다. 예전엔 마우스를 올려야 보여서, 처음 여는 실장에게는
                                      읽기 전용 표였다 — 고칠 수 있는 줄 몰라 hwp로 받아 한글에서 고쳤다(승인 기록이 안 남는다).
                                      옅은 선이면 표로 읽히면서도 「여기를 누르면 적힌다」가 보인다
                                    */
                                    className={`block w-full resize-none overflow-hidden rounded border border-hairline bg-canvas px-2 py-1.5 text-sm leading-snug hover:border-border-strong focus:border-ink focus:outline-none ${
                                      ci === 1 && t.emphasis?.[ri] ? 'font-medium text-emphasis' : 'text-ink'
                                    }`}
                                  />
                                ) : (
                                  <span
                                    className={`block px-2 py-1.5 whitespace-nowrap tabular-nums ${
                                      ci === 1 && t.emphasis?.[ri] ? 'font-medium text-emphasis' : 'text-body'
                                    }`}
                                  >
                                    {/*
                                      구분 번호는 **자리로 계산한다** (canEdit일 때).
                                      서버가 준 값을 그대로 두면 순서를 바꾸거나 행을 지운 뒤
                                      «1-3, 1-1, 1-2»가 되어, 저장 전까지 화면이 거짓을 보여준다.
                                      서버의 채번 규칙(ABS-5)과 같은 식이라 저장하면 그대로 굳는다.
                                    */}
                                    {canEdit && ci === 0 ? rowNo(t.key, ri) : cell}
                                  </span>
                                )}
                              </td>
                            ))}
                            {showAuthors && (
                              <td className="px-3 py-1.5 align-top text-xs whitespace-nowrap">
                                {(t.authors?.[ri] ?? []).length === 0 ? (
                                  // 담당자가 새로 써 넣었거나 대조하지 못한 행 — 모르는 걸 아는 척하지 않는다
                                  <span className="text-muted-soft">—</span>
                                ) : (
                                  <span className={(t.authors![ri].length > 1 ? 'font-medium text-ink' : 'text-body')}>
                                    {t.authors![ri].join(' + ')}
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="px-1 py-0.5 text-center align-top">
                              {canEdit ? (
                                <button
                                  onClick={() => toggleEmphasis(ti, ri)}
                                  aria-pressed={t.emphasis?.[ri] === true}
                                  aria-label={`${rowNo(t.key, ri)}행 공유 표시`}
                                  title="파란색으로 나감"
                                  className={`rounded border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                                    t.emphasis?.[ri]
                                      ? 'border-emphasis bg-emphasis text-white'
                                      : 'border-hairline bg-canvas text-muted-soft hover:border-ink hover:text-ink focus:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100'
                                  }`}
                                >
                                  공유
                                </button>
                              ) : t.emphasis?.[ri] ? (
                                <span className="text-xs font-semibold text-emphasis">공유</span>
                              ) : null}
                            </td>
                            {canEdit && (
                              <td className="px-1 py-0.5 align-top">
                                <button
                                  onClick={() => removeRow(ti, ri)}
                                  aria-label={`${ri + 1}행 삭제`}
                                  className="rounded px-1.5 py-1 text-muted-soft hover:bg-error-soft hover:text-error focus:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </td>
                            )}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
