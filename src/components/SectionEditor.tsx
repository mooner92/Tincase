'use client';
// RU-60·61 · PG-51f — 전사 섹션 구성 편집: 순서(▲▼)·제목·채우는 부서.
//
// 한 번 정하면 매주 그대로라 늘 펼쳐 둘 이유가 없다. 「전사」 화면 구석의 [섹션 구성 편집]으로 열고(`/org?edit=sections`),
// 그동안 표 자리를 이 편집기가 차지한다 — 매주 보는 표(제출·최종본)가 드물게 쓰는 편집 칸에 묻히지 않게.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface SectionEditRow {
  id: string;
  title: string;
  divisionId: string | null;
}

export function SectionEditor({
  sections,
  divisions,
  closeHref,
}: {
  sections: SectionEditRow[];
  divisions: { id: string; nameKo: string; isActive: boolean }[];
  /** 저장·닫기 뒤에 돌아갈 「전사」 화면 주소 (보던 주차 그대로) */
  closeHref: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(sections);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(sections);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/org/sections', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // 여기 보이는 것은 켜진 섹션뿐이다 — 저장해도 켜진 채로
        body: JSON.stringify({ sections: rows.map((x) => ({ ...x, isActive: true })) }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '저장하지 못했습니다.');
      else router.push(closeHref);
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">
          섹션 구성 편집
          <span className="ml-2 text-xs font-normal text-muted">이 순서·제목 그대로 최종본에 들어갑니다 · 섹션마다 새 쪽</span>
        </h2>
        <span className="flex gap-2">
          <button onClick={save} disabled={busy || !dirty} className="btn-primary btn-sm">
            {busy ? '저장 중…' : '저장'}
          </button>
          <Link href={closeHref} className="btn-secondary btn-sm">
            닫기
          </Link>
        </span>
      </div>

      <ol className="mt-3 divide-y divide-hairline-soft">
        {rows.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
            <span className="w-6 text-right tabular-nums text-muted">{i + 1}</span>
            <span className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로" className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                ▲
              </button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="아래로" className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                ▼
              </button>
            </span>
            <input
              value={r.title}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
              className="min-w-0 flex-1 basis-56 rounded-lg border border-border-strong px-2 py-1"
              aria-label={`${i + 1}번 섹션 제목`}
            />
            <select
              value={r.divisionId ?? ''}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, divisionId: e.target.value || null } : x)))}
              className="max-w-full rounded-lg border border-border-strong px-2 py-1"
              aria-label={`${i + 1}번 섹션을 채우는 부서`}
            >
              <option value="">— Tincase 밖 (파일 올림)</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameKo}
                  {d.isActive ? '' : ' (꺼짐)'}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      {err && <p className="callout callout-error mt-3">{err}</p>}
      <p className="mt-3 text-xs text-muted">
        Tincase로 낸 섹션은 낸 사람의 서식 그대로 들어갑니다. 본부 단계가 있는 본부의 실은 본부가 총괄에 낸 판의 것이 들어갑니다.
        올린 파일은 그 섹션의 제목·빨간 안내문을 빼고 본문만 씁니다.
      </p>
    </section>
  );
}
