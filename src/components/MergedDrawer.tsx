'use client';
// 병합본 보기·고치기·복사 (CP-70~74).
//
// 담당자의 실제 동선은 이렇다: 병합본 받기 → 한글로 열기 → 표 복사 → 게시판에 붙여넣기.
// 중간에 이상한 행이 하나 보이면 그것만 고치려고 한글을 연다.
// **한글을 여는 유일한 이유가 그것**이라면, 여기서 보고 고치면 한글을 열 일이 없다.
//
// 붙여넣기는 `text/html`로 쓴다 — 한글도 게시판 편집기도 HTML 표를 받으면
// 표 그대로 들어간다. text/plain만 쓰면 줄글로 쏟아진다 (붙여넣기 파싱에서 배운 것과 같은 이유).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { copyText } from '@/lib/clipboard';

interface TableView {
  key: string;
  title: string;
  columns: string[];
  rows: string[][];
  /** 양식에서 읽은 칸 너비 (HWPUNIT = 1/7200 inch) */
  widths?: number[];
}
interface Content {
  title: string;
  slot: { isoKey: string; label: string; year: number; kind: 'weekly' | 'monthly' };
  tables: TableView[];
}

/** 헤더 행을 뺀 본문만. 서버가 준 격자는 첫 줄이 열 이름이다 */
const bodyRows = (t: TableView) => t.rows.slice(1);

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

  const removeRow = (ti: number, ri: number) => {
    if (!data) return;
    const tables = data.tables.map((t, i) =>
      i !== ti ? t : { ...t, rows: t.rows.filter((_, j) => j !== ri + 1) },
    );
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
      body: JSON.stringify({ isoKey, tables: data.tables.map((t) => ({ key: t.key, rows: bodyRows(t) })) }),
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
                          {canEdit && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, ri) => (
                          <tr key={ri} className="border-b border-hairline-soft last:border-0">
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
                                    className="block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-2 py-1.5 text-sm leading-snug text-ink hover:border-hairline focus:border-ink focus:bg-canvas focus:outline-none"
                                  />
                                ) : (
                                  <span className="block px-2 py-1.5 whitespace-nowrap tabular-nums text-body">
                                    {cell}
                                  </span>
                                )}
                              </td>
                            ))}
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
                        ))}
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
