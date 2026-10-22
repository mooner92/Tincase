'use client';
// RH-120~123 — [다듬기]: 본부본에 들어갈 항목을 체크로 고른다(빼기만 — 글은 실이 고친다). 본부 규칙이 있으면 규칙이 미리 골라 두고
// 뺀 이유를 한 줄로 보인다. 자문회의 줄은 실이 적은 값 → 비었으면 항목으로 센 값, 본부 담당이 고칠 수 있다. 분량은 바꿀 때마다 다시 어림한다.
// 저장하면 본부본을 그 자리에서 다시 만든다 — 본부장 승인이 있었으면 새 판을 다시 승인해야 올라간다(RU-55a).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CurateConsult, CurateItem, CurateSection } from '@/lib/hq-curate';
import type { HqFormData, HqTask } from '@/lib/hwp/hq-form';
import { estimatePages } from '@/lib/hq-pages';

interface Board {
  slot: { isoKey: string; label: string };
  hq: string;
  rules: { source: string; summary: readonly string[] } | null;
  items: CurateItem[];
  consult: CurateConsult[];
  pages: number;
  limit: number;
  monthly: boolean;
  saved: { by: string; at: string } | null;
  unreadable: string[];
}

const KIND = ['자문회의', '전문가 세미나', '포럼·워크샵', '기타 회의'] as const;
const SECTION_KO: Record<CurateSection, string> = { results: '1. 주요 업무실적', plans: '2. 주요 업무계획', notes: '3. 기타 특이사항' };

/** 고른 항목으로 본부본 데이터를 다시 짠다 — 분량 어림만 쓴다(본부본은 서버가 같은 규칙으로 만든다) */
function formOf(items: readonly CurateItem[], on: (i: CurateItem) => boolean): HqFormData {
  const tasks = (section: 'results' | 'plans') => {
    const out: HqTask[] = [];
    let last: { unit: string; title: string; type: string } | null = null;
    for (const i of items) {
      if (i.section !== section || !on(i) || !i.task) continue;
      if (!last || last.unit !== i.unit || last.title !== i.task.title || last.type !== i.task.type) {
        out.push({ unit: i.task.abbr, type: i.task.type, title: i.task.title, owner: i.task.owner, items: [] });
        last = { unit: i.unit, title: i.task.title, type: i.task.type };
      }
      out[out.length - 1].items.push(i.item);
    }
    return out;
  };
  return { results: tasks('results'), plans: tasks('plans'), notes: items.filter((i) => i.section === 'notes' && on(i)).map((i) => i.item) };
}

export function HqCurate({ isoKey, node, onClose, onSaved }: { isoKey: string; node?: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<Board | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [vals, setVals] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const adopt = useCallback((b: Board) => {
    setData(b);
    setPick(Object.fromEntries(b.items.map((i) => [i.key, i.included])));
    setVals(Object.fromEntries(b.consult.map((c) => [c.label, [...c.values]])));
    setDirty(false);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({ isoKey, ...(node ? { node } : {}) });
    fetch(`/api/rollup/hq/curate?${q}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.message ?? '불러오지 못했습니다.');
        adopt(b as Board);
      })
      .catch((e: Error) => setErr(e.message));
    titleRef.current?.focus();
  }, [isoKey, node, adopt]);

  const close = () => (!dirty || confirm('저장하지 않은 다듬기가 있습니다. 닫을까요?')) && onClose();

  const pages = useMemo(() => {
    if (!data) return 0;
    return Math.round(estimatePages(formOf(data.items, (i) => pick[i.key] ?? i.included), { consultRows: data.consult.length || 4 }) * 10) / 10;
  }, [data, pick]);

  const counts = useMemo(() => {
    if (!data) return { on: 0, off: 0, changed: 0 };
    const on = data.items.filter((i) => pick[i.key]).length;
    return { on, off: data.items.length - on, changed: data.items.filter((i) => pick[i.key] !== i.suggested).length };
  }, [data, pick]);

  const toggle = (key: string) => {
    setPick((p) => ({ ...p, [key]: !p[key] }));
    setDirty(true);
    setNotice(null);
  };
  const setVal = (label: string, k: number, v: string) => {
    setVals((m) => ({ ...m, [label]: (m[label] ?? ['-', '-', '-', '-']).map((x, i) => (i === k ? v : x)) }));
    setDirty(true);
    setNotice(null);
  };
  const reset = () => {
    if (!data) return;
    setPick(Object.fromEntries(data.items.map((i) => [i.key, i.suggested])));
    setVals(Object.fromEntries(data.consult.map((c) => [c.label, [...(c.reported ?? (c.counted ? c.counted.map((n) => (n > 0 ? String(n) : '-')) : ['-', '-', '-', '-']))]])));
    setDirty(true);
    setNotice(null);
  };

  const save = async () => {
    if (!data) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/hq/curate', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isoKey, ...(node ? { node } : {}), decisions: pick, consult: vals }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.message ?? '저장하지 못했습니다.');
      adopt(b as Board);
      setNotice('저장했어요 — 본부본을 다시 만들었어요');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const over = data ? pages > data.limit : false;

  return (
    <div className="fixed inset-0 z-40 h-screen">
      <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="본부본 다듬기"
        data-guide="hq-curate"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-4xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm text-muted">본부본 다듬기{data ? ` · ${data.slot.label}` : ''}</p>
            <h2 ref={titleRef} tabIndex={-1} className="card-title outline-none">
              넣을 것만 체크해요
            </h2>
          </div>
          <button onClick={close} aria-label="닫기" className="shrink-0 rounded-lg px-2 py-1 text-muted hover:bg-surface-soft hover:text-ink">
            ✕
          </button>
        </header>

        {data && (
          <div data-guide="hq-curate-meter" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline-soft bg-surface-soft px-4 py-2.5 text-sm sm:px-6">
            <span className={`chip ${over ? 'chip-warn' : 'chip-ok'}`}>약 {pages.toFixed(1)}쪽</span>
            <span className="text-muted">
              {data.monthly ? '월간' : '주간'} {data.limit}쪽 이내{over ? ' — 넘어요' : ''} · 넣음 {counts.on} · 뺌 {counts.off}
              {counts.changed > 0 && ` · 규칙과 다르게 ${counts.changed}`}
            </span>
            {notice && <span className="font-medium text-success">{notice}</span>}
            {dirty && !notice && <span className="text-warning">저장하지 않음</span>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {err && <p className="callout callout-error mb-4">{err}</p>}
          {!data && !err && <p className="text-sm text-muted">불러오는 중…</p>}
          {data && (
            <>
              {data.rules ? (
                <div className="callout callout-info mb-5 text-sm">
                  <p>
                    <strong className="font-semibold">{data.rules.source}</strong>으로 미리 골랐어요. 체크를 바꾸면 그대로 남고, 실이 다시 내도 같은 항목이면 유지돼요.{' '}
                    <button onClick={() => setShowRules((v) => !v)} aria-expanded={showRules} className="underline underline-offset-2">
                      {showRules ? '규칙 접기' : '규칙 보기'}
                    </button>
                  </p>
                  {showRules && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5">
                      {data.rules.summary.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="callout callout-muted mb-5 text-sm text-muted">이 본부는 정한 취합 규칙이 없어 모두 넣어 두었어요. 뺄 것만 체크를 풀어요.</p>
              )}
              {data.unreadable.length > 0 && (
                <p className="callout callout-warn mb-5 text-sm">읽지 못한 사본: {data.unreadable.join(' · ')} — 그 실 항목은 여기 없어요</p>
              )}

              <section data-guide="hq-curate-consult" className="mb-7">
                <h3 className="mb-2 text-[15px] font-semibold text-ink">
                  ※ 자문회의 실적 <span className="text-sm font-normal text-muted">실이 적은 값이 먼저 · 비었으면 실적 항목으로 센 값</span>
                </h3>
                <div className="overflow-x-auto rounded-lg border border-hairline">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="table-head border-b border-hairline bg-surface-soft">
                        <th className="w-[28%] px-3 py-2 text-left font-medium">구분</th>
                        {KIND.map((k) => (
                          <th key={k} className="px-2 py-2 font-medium">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.consult.map((c) => (
                        <tr key={c.label} className="border-b border-hairline-soft last:border-0">
                          <td className="px-3 py-1.5 align-middle">
                            <span className="text-ink">{c.label}</span>
                            <span className="ml-1.5 text-xs text-muted">
                              {c.override ? '고친 값' : c.reported ? (c.label === data.hq ? '본부가 적음' : '실이 적음') : c.counted ? '항목으로 셈' : c.copy ? '' : '아직 안 옴'}
                            </span>
                          </td>
                          {[0, 1, 2, 3].map((k) => (
                            <td key={k} className="px-1 py-1">
                              <input
                                value={vals[c.label]?.[k] ?? '-'}
                                onChange={(e) => setVal(c.label, k, e.target.value)}
                                aria-label={`${c.label} ${KIND[k]}`}
                                className="input h-8 w-full text-center tabular-nums"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {(['results', 'plans', 'notes'] as const).map((section) => (
                <CurateList key={section} section={section} items={data.items.filter((i) => i.section === section)} pick={pick} onToggle={toggle} />
              ))}
            </>
          )}
        </div>

        <footer data-guide="hq-curate-footer" className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3 sm:px-6">
          <button onClick={reset} disabled={!data || busy} className="btn-ghost btn-sm">
            {data?.rules ? '규칙대로 되돌리기' : '모두 넣기'}
          </button>
          <span className="text-xs text-muted">저장하면 본부본을 다시 만들어요 · 본부장 승인이 있었으면 다시 받아요</span>
          <button data-guide="hq-curate-save" onClick={save} disabled={!data || busy || !dirty} className="btn-primary btn-sm ml-auto">
            {busy ? '저장 중…' : '저장'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CurateList({
  section,
  items,
  pick,
  onToggle,
}: {
  section: CurateSection;
  items: CurateItem[];
  pick: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const on = items.filter((i) => pick[i.key]).length;
  return (
    <section data-guide={`hq-curate-${section}`} className="mb-7">
      <h3 className="mb-2 text-[15px] font-semibold text-ink">
        {SECTION_KO[section]}{' '}
        <span className="text-sm font-normal text-muted">
          {on}/{items.length}
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="callout callout-muted text-muted">올라온 항목 없음</p>
      ) : (
        <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
          {items.map((i, k) => {
            const prev = items[k - 1];
            const head = i.task && (!prev || prev.unit !== i.unit || prev.task?.title !== i.task.title || prev.task?.type !== i.task.type);
            const unitHead = !prev || prev.unit !== i.unit;
            const checked = !!pick[i.key];
            return (
              <li key={i.key} data-guide={k === 0 ? `hq-curate-first-${section}` : undefined}>
                {(head || (section === 'notes' && unitHead)) && (
                  <p className="bg-surface-soft px-3 pt-2.5 pb-1 text-xs text-muted">
                    <span className="font-medium text-ink">{i.unit}</span>
                    {i.task && (
                      <>
                        {' · '}
                        {i.task.type} · {i.task.title}
                        {i.task.owner && ` (${i.task.owner})`}
                      </>
                    )}
                  </p>
                )}
                <label className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${checked ? '' : 'bg-surface-soft/60'}`}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(i.key)} className="mt-1 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className={`block whitespace-pre-line ${checked ? 'text-ink' : 'text-muted'}`}>{i.item.content || '(내용 없음)'}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {[i.item.date, i.item.place, i.item.people].filter((x) => x && x.trim() && x.trim() !== '-').join(' · ').replace(/\n/g, ' ')}
                    </span>
                    {(i.reason || checked !== i.suggested) && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {i.reason && <span className={`chip ${i.suggested ? 'chip-muted' : 'chip-warn'}`}>{i.suggested ? `넣음 · ${i.reason}` : i.reason}</span>}
                        {checked !== i.suggested && <span className="chip chip-info">{checked ? '규칙과 달리 넣음' : '규칙과 달리 뺌'}</span>}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
