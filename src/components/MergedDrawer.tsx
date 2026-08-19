'use client';
// 병합본 보기·고치기·복사 (CP-70~74).
//
// 담당자의 실제 동선은 이렇다: 병합본 받기 → 한글로 열기 → 표 복사 → 게시판에 붙여넣기.
// 중간에 이상한 행이 하나 보이면 그것만 고치려고 한글을 연다.
// **한글을 여는 유일한 이유가 그것**이라면, 여기서 보고 고치면 한글을 열 일이 없다.
//
// 붙여넣기는 `text/html`로 쓴다 — 한글도 게시판 편집기도 HTML 표를 받으면
// 표 그대로 들어간다. text/plain만 쓰면 줄글로 쏟아진다 (붙여넣기 파싱에서 배운 것과 같은 이유).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { copyRich, copyText } from '@/lib/clipboard';

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

/**
 * 복사·저장에 쓰는 행 — **내용 칸이 빈 행은 뺀다.**
 * 양식에 미리 그려진 빈 줄(특이사항 4행 등)이 그대로 게시판에 붙으면 빈 표가 된다.
 * 화면에서는 그대로 보여준다 — 거기에 적으라고 있는 칸이기 때문이다.
 */
const filledRows = (t: TableView) => bodyRows(t).filter((r) => r.slice(1).some((c) => c.trim()));

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

  /** 표를 **표째로** 클립보드에 — 한글·게시판 편집기가 그대로 받는다 */
  const copyTables = useCallback(async () => {
    if (!data) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const useful = data.tables.filter((t) => filledRows(t).length > 0);

    /*
      한글은 **폭 정보가 없는 표를 최소 폭으로 접는다.** 처음엔 border만 주고 폭을 안 줬더니
      «본원 소회의실»이 두세 글자마다 줄바꿈되며 무너졌다.
      그래서 부서 양식 표의 실제 칸 폭(HWPUNIT 실측)을 pt로 환산해 그대로 싣는다.

        구분 30.2 · 내용 177.3 · 일자 61.3 · 장소 81.1 · 참석자 157.5 (합 507.3pt)

      `word-break: keep-all` — 한글은 단어 중간에서 끊으면 안 읽힌다.
    */
    /*
      한컴 웹에디터는 `<colgroup>`을 무시한다 — 폭을 거기에만 주면 칸이 다시 최소로 접힌다.
      그래서 **모든 `<td>`에 픽셀 `width` 속성을 직접** 단다. 옛 HTML 속성이라
      웹에디터·한글·메일 어디서든 가장 잘 먹힌다. style은 보조로 함께 둔다.
    */
    /*
      폭은 **양식에서 읽어 온 값**을 쓴다 (API-53). 코드에 박아 두면 부서가 양식을
      바꾸는 순간 어긋난다 — 게시판 양식을 그대로 등록해 쓰는 것이 «완벽히 같게»의 길이라
      폭도 그 파일을 따라가야 한다. 못 읽으면 우리 양식 실측 비율로 떨어진다.
    */
    const FALLBACK = [40, 236, 82, 108, 210];
    const raw = useful[0]?.widths?.filter((w) => w > 0) ?? [];
    const TOTAL_PX = 676; // A4 본문 폭에 들어가는 픽셀 폭
    const COL_PX =
      raw.length === 5
        ? raw.map((w) => Math.round((w / raw.reduce((a, b) => a + b, 0)) * TOTAL_PX))
        : FALLBACK;
    const cellStyle = 'border:1px solid #000;padding:3px 4px;word-break:keep-all;vertical-align:middle';
    const td = (c: string, i: number, center: boolean, bold = false) =>
      `<td width="${COL_PX[i]}" style="${cellStyle};width:${COL_PX[i]}px` +
      `${center ? ';text-align:center' : ''}${bold ? ';font-weight:bold' : ''}">${esc(c) || '&nbsp;'}</td>`;

    const html = useful
      .map(
        (t) =>
          `<p><b>${esc(t.title)}</b></p>` +
          `<table border="1" cellspacing="0" cellpadding="3" width="${TOTAL_PX}"` +
          ` style="border-collapse:collapse;table-layout:fixed;width:${TOTAL_PX}px;font-size:10pt">` +
          `<tbody>` +
          `<tr>${t.columns.map((c, i) => td(c, i, true, true)).join('')}</tr>` +
          filledRows(t)
            .map((r) => `<tr>${r.map((c, i) => td(c, i, i === 0)).join('')}</tr>`)
            .join('') +
          `</tbody></table><p></p>`,
      )
      .join('');
    const plain = useful
      .map((t) => `${t.title}\n` + filledRows(t).map((r) => r.join('\t')).join('\n'))
      .join('\n\n');
    setErr(null);
    const ok = await copyRich(html, plain);
    if (ok) flash('표');
    else setErr('복사하지 못했습니다. 브라우저가 막았을 수 있으니 [hwp로 받기]를 이용해 주세요.');
  }, [data]);

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
          <button onClick={copyTables} disabled={!data} className="btn-primary btn-sm">
            표 복사
          </button>
          <a
            href={`/api/division/merged?division=${divisionSlug}&isoKey=${isoKey}`}
            className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            hwp로 받기
          </a>
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
