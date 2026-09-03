'use client';
// 병합본 보기·고치기·복사 (CP-70~74).
//
// 담당자의 실제 동선은 이렇다: 병합본 받기 → 한글로 열기 → 표 복사 → 게시판에 붙여넣기.
// 중간에 이상한 행이 하나 보이면 그것만 고치려고 한글을 연다.
// **한글을 여는 유일한 이유가 그것**이라면, 여기서 보고 고치면 한글을 열 일이 없다.
//
// 붙여넣기는 `text/html`로 쓴다 — 한글도 게시판 편집기도 HTML 표를 받으면
// 표 그대로 들어간다. text/plain만 쓰면 줄글로 쏟아진다 (붙여넣기 파싱에서 배운 것과 같은 이유).
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
import { copyText } from '@/lib/clipboard';
import { moveItem, rowNo } from '@/lib/merge-rows';

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
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  isoKey: string;
  divisionSlug: string;
  /** 담당자만 고칠 수 있다 (TACP §3.2 — 병합 실행과 같은 권한) */
  canEdit: boolean;
}) {
  const [data, setData] = useState<Content | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /*
   * TACP-17 — 작성자 열은 **기본으로 접혀 있다.**
   *
   * 이 화면의 주된 쓰임은 «슥 보고 제출»이고, 그때 필요한 건 내용이지 사람이 아니다.
   * 늘 켜 두면 표가 좁아지고 시선이 사람 이름으로 먼저 간다 — 검토가 «누가 뭘 냈나»로
   * 바뀐다. 잘못된 행을 찾은 **그 순간에만** 펼치면 된다.
   */
  const [showAuthors, setShowAuthors] = useState(false);
  /** CP-90 — 끌고 있는 행. `over`는 지금 가리키는 자리(놓으면 여기로 간다) */
  const [drag, setDrag] = useState<{ ti: number; from: number; over: number } | null>(null);
  /**
   * 키보드로 옮긴 뒤 **손잡이에 초점을 되돌린다** — 안 그러면 ↓를 두 번 못 누른다.
   * 상태가 아니라 ref다: 이 값은 그리는 데 쓰이지 않으므로 바뀐다고 다시 그릴 이유가 없다.
   */
  const refocusRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dirty && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, dirty]);

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
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
        tables: data.tables.map((t) => ({ key: t.key, rows: bodyRows(t), emphasis: t.emphasis ?? [] })),
      }),
    });
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).message ?? '저장하지 못했습니다.');
      setBusy(false);
      return;
    }
    setDirty(false);
    setBusy(false);
    flash('저장');
    router.refresh();
    // 채번이 다시 매겨지므로 서버가 쓴 결과를 다시 읽는다
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
        role="dialog"
        aria-modal="true"
        aria-label="병합본 보기"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-4xl flex-col border-l border-hairline bg-canvas"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">병합본</p>
            <h2 className="display mt-0.5 truncate text-lg">{data?.title ?? '불러오는 중…'}</h2>
          </div>
          <button
            onClick={() => (!dirty || confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) && onClose()}
            aria-label="닫기"
            className="shrink-0 rounded-lg px-2 py-1 text-muted hover:bg-surface-soft hover:text-ink"
          >
            ✕
          </button>
        </header>

        {/* 제출 동선 그대로 — 제목 복사 → 표 복사 → 게시판에 붙여넣기 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface-soft px-6 py-3">
          <button
            onClick={async () => {
              if (!data) return;
              setErr(null);
              if (await copyText(data.title)) flash('제목');
              else setErr('제목을 복사하지 못했습니다.');
            }}
            disabled={!data}
            className="btn-secondary btn-sm"
          >
            제목 복사
          </button>
          {/*
            «표 복사»는 뺐다 (v1.16.0). 한컴 웹에디터가 붙여넣은 HTML을 자기 방식으로
            다시 그려서 양식과 완전히 같게 만들 수 없었다 — 폭·정렬·머리행까지 맞춰도
            미세하게 어긋났다. 어설프게 비슷한 것보다 **확실한 길 하나**가 낫다.
            브라우저는 한글 고유 형식을 클립보드에 올릴 수 없으므로(text/plain·html·png만),
            hwp를 받아 한글에서 복사하는 것이 유일하게 서식이 100% 보존되는 경로다.
            되살릴 때는 v1.15.1의 표 복사 구현에서 이어가면 된다.
          */}
          <a
            href={`/api/division/merged?division=${divisionSlug}&isoKey=${isoKey}`}
            className="btn-primary btn-sm"
          >
            hwp로 받기
          </a>
          <span className="text-sm text-muted">→ 한글에서 열어 표를 복사해 게시판에 붙여넣습니다</span>
          {/* TACP-17 — 서버가 작성자를 보낸 사람에게만 보이는 토글 */}
          {data?.canSeeAuthors && (
            <button
              onClick={() => setShowAuthors((v) => !v)}
              aria-pressed={showAuthors}
              className={`btn-sm rounded-lg border px-2.5 py-1 text-sm ${
                showAuthors
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-hairline bg-canvas text-body hover:border-ink'
              }`}
            >
              작성자 {showAuthors ? '숨기기' : '보기'}
            </button>
          )}
          <span className="ml-auto text-sm">
            {copied && <span className="font-medium text-success">{copied} 복사됨</span>}
            {dirty && !copied && <span className="text-warning">저장하지 않은 수정</span>}
          </span>
          {canEdit && (
            <button onClick={save} disabled={!dirty || busy} className="btn-primary btn-sm">
              {busy ? '저장 중…' : '수정 저장'}
            </button>
          )}
        </div>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-5">
          {err && <p className="card border-error/40 bg-error-soft px-4 py-3 text-sm text-error">{err}</p>}
          {!data && !err && <p className="text-sm text-muted">불러오는 중…</p>}

          {data?.tables.map((t, ti) => {
            const rows = bodyRows(t);
            return (
              <section key={t.key} className="mb-7">
                <h3 className="label">
                  {t.title} <span className="font-normal text-muted-soft">{rows.length}행</span>
                </h3>
                {rows.length === 0 ? (
                  <p className="card px-4 py-3 text-sm text-muted-soft">내용 없음</p>
                ) : (
                  <div className="card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="table-head border-b border-hairline">
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
                            className={`border-b border-hairline-soft last:border-0 ${edge} ${
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
                                  title="끌어서 옮기기 · ↑↓ 키로도 됩니다"
                                  className="cursor-grab rounded px-1 py-1.5 text-muted-soft hover:bg-surface-soft hover:text-body focus:text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing"
                                >
                                  <GripIcon />
                                </button>
                              </td>
                            )}
                            {r.map((cell, ci) => (
                              <td key={ci} className="px-1 py-0.5 align-top">
                                {canEdit && ci > 0 ? (
                                  <textarea
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
                                      실제 색(#0000ff)을 그대로 쓴다 — 비슷한 파랑이 아니라.
                                    */
                                    className={`block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-2 py-1.5 text-sm leading-snug hover:border-hairline focus:border-ink focus:bg-canvas focus:outline-none ${
                                      ci === 1 && t.emphasis?.[ri] ? 'font-medium text-[#0000ff]' : 'text-ink'
                                    }`}
                                  />
                                ) : (
                                  <span
                                    className={`block px-2 py-1.5 whitespace-nowrap tabular-nums ${
                                      ci === 1 && t.emphasis?.[ri] ? 'font-medium text-[#0000ff]' : 'text-body'
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
                                  title="전체 공유·전달이 필요한 주요 사항 — 문서에 파란색으로 나갑니다"
                                  className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                                    t.emphasis?.[ri]
                                      ? 'border-[#0000ff] bg-[#0000ff] text-white'
                                      : 'border-hairline bg-canvas text-muted-soft hover:border-ink hover:text-ink'
                                  }`}
                                >
                                  공유
                                </button>
                              ) : t.emphasis?.[ri] ? (
                                <span className="text-[11px] font-semibold text-[#0000ff]">공유</span>
                              ) : null}
                            </td>
                            {canEdit && (
                              <td className="px-1 py-0.5 align-top">
                                <button
                                  onClick={() => removeRow(ti, ri)}
                                  aria-label={`${ri + 1}행 삭제`}
                                  className="rounded px-1.5 py-1 text-muted-soft hover:bg-error-soft hover:text-error"
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

          {data && canEdit && (
            <p className="text-xs text-muted-soft">
              고친 내용은 [수정 저장]을 눌러야 병합본에 반영됩니다. 구분 번호(1-1, 1-2…)는 저장할 때
              시스템이 다시 매깁니다. <strong className="font-medium">제출자가 올린 원본 파일은 바뀌지 않습니다.</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
