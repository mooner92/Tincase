'use client';
// RU-60·65 — 전사 섹션 판. 13섹션을 **최종본 순서대로**, 섹션마다 무엇이 들어갈지(Tincase 제출 / 총괄 업로드 / 미제출)를 한 줄로.
//
// 총괄이 매주 NAMS 목록을 눈으로 세던 일(분석 §11.4 우선순위 1)을 여기서 끝낸다.
// Tincase를 아직 안 쓰는 섹션은 게시판으로 받은 파일을 그 줄에 올리면 같은 조립에 들어간다.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SectionRowView {
  id: string;
  title: string;
  divisionId: string | null;
  kind: string;
  source: 'tincase' | 'upload' | 'waiting_hq' | 'missing';
  label: string;
  refId: string | null;
  offline: boolean;
}

const tone: Record<SectionRowView['source'], string> = {
  tincase: 'border-success/30 bg-success/10 text-success',
  upload: 'border-[#9db8f5] bg-[#e9f0ff] text-[#1e3a8a]',
  waiting_hq: 'border-warning/40 bg-warning-soft text-ink',
  missing: 'border-hairline bg-canvas text-muted',
};
const sourceWord: Record<SectionRowView['source'], string> = {
  tincase: 'Tincase',
  upload: '올린 파일',
  waiting_hq: '본부 대기',
  missing: '없음',
};

export function SectionBoard({
  isoKey,
  sections,
  divisions,
}: {
  isoKey: string;
  sections: SectionRowView[];
  divisions: { id: string; nameKo: string; isActive: boolean }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(sections.map((s) => ({ ...s, isActive: true })));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const dirty = JSON.stringify(rows.map((r) => [r.id, r.title, r.divisionId])) !== JSON.stringify(sections.map((r) => [r.id, r.title, r.divisionId]));

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  const call = async (key: string, init: RequestInit, url: string) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(url, init);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '처리하지 못했습니다.');
      else router.refresh();
      return r.ok;
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const ok = await call(
      'save',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: rows.map((r) => ({ id: r.id, title: r.title, divisionId: r.divisionId, isActive: r.isActive })) }),
      },
      '/api/rollup/org/sections',
    );
    if (ok) setEditing(false);
  };
  const upload = async (file: File) => {
    if (!target) return;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('sectionId', target);
    fd.set('isoKey', isoKey);
    await call(`up:${target}`, { method: 'POST', body: fd }, '/api/rollup/org/sections/upload');
    setTarget(null);
  };
  const counts = {
    in: sections.filter((s) => s.source === 'tincase' || s.source === 'upload').length,
    total: sections.length,
  };

  return (
    <section className="card px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">
          섹션 {counts.in}/{counts.total}
          <span className="ml-2 text-xs font-normal text-muted">최종본 순서 그대로 · 제목은 여기 적힌 대로 들어갑니다 · 섹션마다 새 쪽</span>
        </h2>
        {editing ? (
          <span className="flex gap-2">
            <button onClick={save} disabled={!!busy || !dirty} className="btn-primary btn-sm">
              {busy === 'save' ? '저장 중…' : '순서·제목 저장'}
            </button>
            <button onClick={() => (setRows(sections.map((s) => ({ ...s, isActive: true }))), setEditing(false))} className="btn-secondary btn-sm">
              취소
            </button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
            순서·제목 고치기
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".hwp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) upload(f);
        }}
      />

      <ol className="mt-3 divide-y divide-hairline-soft">
        {rows.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
            <span className="w-6 text-right tabular-nums text-muted">{i + 1}</span>
            {editing ? (
              <>
                <span className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로" className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="아래로" className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">▼</button>
                </span>
                <input
                  value={r.title}
                  onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
                  className="min-w-56 flex-1 rounded-lg border border-border-strong px-2 py-1"
                  aria-label={`${i + 1}번 섹션 제목`}
                />
                <select
                  value={r.divisionId ?? ''}
                  onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, divisionId: e.target.value || null } : x)))}
                  className="rounded-lg border border-border-strong px-2 py-1"
                  aria-label="채우는 부서"
                >
                  <option value="">— Tincase 밖 (파일 올림)</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nameKo}
                      {d.isActive ? '' : ' (꺼짐)'}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <span className="min-w-56 flex-1 font-medium text-ink">{r.title}</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone[r.source]}`}>
                  {(r.source === 'tincase' || r.source === 'upload') && <span aria-hidden>✓</span>}
                  {sourceWord[r.source]} · {r.label}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {r.source === 'tincase' && r.refId && (
                    <a href={`/api/rollup/report/${r.refId}`} className="text-muted underline">받기</a>
                  )}
                  {r.source === 'upload' && r.refId && (
                    <>
                      <a href={`/api/rollup/org/sections/upload/${r.refId}`} className="text-muted underline">받기</a>
                      <button
                        onClick={() => call(`del:${r.id}`, { method: 'DELETE' }, `/api/rollup/org/sections/upload?id=${r.refId}`)}
                        disabled={!!busy}
                        className="text-muted underline"
                      >
                        올린 것 취소
                      </button>
                    </>
                  )}
                  {r.source !== 'tincase' && (
                    <button
                      onClick={() => {
                        setTarget(r.id);
                        fileRef.current?.click();
                      }}
                      disabled={!!busy}
                      className="btn-secondary btn-sm"
                      title="취합게시판으로 받은 그 섹션의 hwp를 올립니다"
                    >
                      {busy === `up:${r.id}` ? '올리는 중…' : r.source === 'upload' ? '다시 올리기' : '파일 올리기'}
                    </button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
      <p className="mt-3 text-xs text-muted-soft">
        Tincase로 낸 섹션은 낸 사람의 서식 그대로 들어갑니다. 본부 단계가 있는 본부의 실은 본부가 총괄에 낸 판의 것이 들어갑니다.
        올린 파일은 그 섹션의 제목·빨간 안내문을 빼고 본문만 씁니다.
      </p>
    </section>
  );
}
