'use client';
// RH-90~97 — [ERP 보고서 가져오기]: ERP 「주간업무보고」 PDF 여러 개 → 후보 목록 → 고른 것을 작성 화면으로.
// 규칙은 「미리 체크」일 뿐이다(RH-93) — 뺀 것도 이유와 함께 보이고, 체크로 바꾼다. 아무것도 저장하지 않는다(서버도 파일을 남기지 않는다).
import { useMemo, useRef, useState } from 'react';
import type { CandidateSection, ConsultKind, ErpCandidate } from '@/lib/erp-report';

interface FileResult {
  name: string;
  unitKo: string | null;
  entries: number;
  skipped?: string;
}

const SECTION_KO: Record<CandidateSection, string> = { results: '1. 실적', plans: '2. 계획', notes: '3. 특이사항' };
export const KIND_KO = ['자문회의', '전문가 세미나', '포럼·워크샵 등', '기타 회의'] as const;
const sq = (s: string) => s.replace(/\s+/g, '');

export function ErpImport({
  units,
  onImport,
  onClose,
}: {
  units: { nameKo: string; abbr: string }[];
  onImport: (picked: ErpCandidate[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<FileResult[] | null>(null);
  const [cands, setCands] = useState<ErpCandidate[] | null>(null);
  const [showLeft, setShowLeft] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | File[]) => {
    const pdfs = [...list].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length === 0) {
      setErr('PDF 파일을 골라 주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    pdfs.forEach((f) => fd.append('files', f));
    try {
      const r = await fetch('/api/division/erp-import', { method: 'POST', body: fd });
      const b = (await r.json()) as { message?: string; files?: FileResult[]; candidates?: ErpCandidate[] };
      if (!r.ok) {
        setErr(b.message ?? 'PDF를 읽지 못했습니다.');
        return;
      }
      setFiles(b.files ?? []);
      setCands(b.candidates ?? []);
    } catch {
      setErr('네트워크 오류로 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: number, p: Partial<ErpCandidate>) => setCands((cs) => (cs ? cs.map((c) => (c.id === id ? { ...c, ...p } : c)) : cs));
  const toggle = (set: Set<string> | Set<number>, setter: (s: never) => void, k: string | number) => {
    const n = new Set(set as Set<string | number>);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setter(n as never);
  };

  // 실별로 — 자문회의 표 순서(본부 → 산하 실), 그 안은 날짜순
  const groups = useMemo(() => {
    if (!cands) return [];
    const order = units.map((u) => sq(u.nameKo));
    const by = new Map<string, ErpCandidate[]>();
    for (const c of cands) by.set(c.unitKo, [...(by.get(c.unitKo) ?? []), c]);
    const rank = (ko: string) => (order.indexOf(sq(ko)) < 0 ? 999 : order.indexOf(sq(ko)));
    const day = (c: ErpCandidate) => (c.first ? c.first[0] * 100 + c.first[1] : 9999);
    return [...by.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([unitKo, list]) => ({ unitKo, abbr: units.find((u) => sq(u.nameKo) === sq(unitKo))?.abbr ?? unitKo, list: [...list].sort((a, b) => day(a) - day(b)) }));
  }, [cands, units]);
  const picked = (cands ?? []).filter((c) => c.pick);

  // 화면 안에서 만든 컴포넌트는 그릴 때마다 새로 붙는다(고르던 칸이 풀린다) — 함수로 그린다
  const row = (c: ErpCandidate) => (
    <li key={c.id} className={`px-3 py-2.5 ${c.pick ? '' : 'bg-surface-soft/60'}`}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={c.pick} onChange={(e) => patch(c.id, { pick: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-ink" aria-label={`${c.content} 넣기`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[14px] leading-5 ${c.pick ? 'font-semibold text-ink' : 'text-body'}`}>
            <span className="mr-1.5 tabular-nums text-muted">{c.date || '일자 없음'}</span>
            {c.content}
          </span>
          <span className="block text-xs text-muted">
            {[c.place, c.people, c.task?.title && `과제: ${c.task.title}`].filter(Boolean).join(' · ')}
          </span>
        </span>
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
        <span className={`chip ${c.pick ? 'chip-info' : 'chip-muted'}`}>{c.reason}</span>
        <span className="chip chip-muted">{c.secs.join(' + ')}</span>
        {c.pick && (
          <>
            <select value={c.section} onChange={(e) => patch(c.id, { section: e.target.value as CandidateSection })} aria-label={`${c.content} 넣을 자리`} className="h-8 rounded-md border border-border-strong bg-canvas px-1.5 text-xs text-ink">
              {(Object.keys(SECTION_KO) as CandidateSection[]).map((s) => (
                <option key={s} value={s}>
                  {SECTION_KO[s]}
                </option>
              ))}
            </select>
            {c.section !== 'plans' && (
              <select value={c.kind} onChange={(e) => patch(c.id, { kind: Number(e.target.value) as ConsultKind })} aria-label={`${c.content} 자문회의 표의 칸`} title="자문회의 실적 표에서 셀 칸" className="h-8 rounded-md border border-border-strong bg-canvas px-1.5 text-xs text-ink">
                {KIND_KO.map((k, i) => (
                  <option key={k} value={i}>
                    {k}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <button type="button" onClick={() => toggle(showRaw, setShowRaw as never, c.id)} className="text-xs text-muted underline hover:text-ink">
          {showRaw.has(c.id) ? '원문 닫기' : '원문'}
        </button>
      </div>
      {showRaw.has(c.id) && <pre className="mt-1.5 ml-6 overflow-x-auto rounded-md bg-surface-soft px-2 py-1.5 text-xs leading-5 whitespace-pre-wrap text-body">{c.raw.join('\n')}</pre>}
    </li>
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-canvas" role="region" aria-labelledby="erp-title">
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 id="erp-title" className="card-title">
            ERP 보고서 가져오기
          </h2>
          <p className="mt-0.5 text-sm text-muted">고른 것만 작성 화면에 들어가요 — 들어간 뒤에도 고칠 수 있어요</p>
        </div>
        <button onClick={onClose} aria-label="가져오기 닫기" className="btn-ghost h-10 w-10 shrink-0 px-0 text-2xl leading-none text-muted">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {err && <p className="callout callout-error mb-3">{err}</p>}

        {!cands ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void upload(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center ${drag ? 'border-ink bg-surface-soft' : 'border-border-strong'}`}
          >
            <p className="text-[16px] font-semibold text-ink">{busy ? 'PDF를 읽는 중…' : 'ERP 주간업무보고 PDF를 여기에 끌어다 놓으세요'}</p>
            <p className="mt-2 max-w-md text-sm text-body">
              ERP 「경영지원 › 주간업무보고」에서 본부와 실을 각각 PDF로 받아 한 번에 올리면 돼요. 파일 이름은 상관없어요 — PDF 첫 줄의 부서 이름으로 알아봐요.
            </p>
            <p className="mt-1 text-xs text-muted">올린 파일은 저장하지 않아요 · 한 번에 10개까지</p>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="btn-primary mt-5 h-11 min-w-36">
              PDF 고르기
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {(files ?? []).map((f, i) => (
                  <span key={i} className={`chip ${f.skipped ? 'chip-warn' : 'chip-muted'}`} title={f.skipped ?? f.name}>
                    {f.skipped ? `${f.name} — 뺌` : `${f.unitKo} · ${f.entries}건`}
                  </span>
                ))}
              </div>
              {(files ?? []).filter((f) => f.skipped).map((f, i) => (
                <p key={i} className="text-xs text-warning">
                  {f.name}: {f.skipped}
                </p>
              ))}
              <p className="text-sm text-body">
                같은 일은 하나로 묶어 <span className="font-semibold text-ink tabular-nums">{cands.length}건</span> · 미리 고른 것{' '}
                <span className="font-semibold text-ink tabular-nums">{picked.length}건</span>
                <span className="text-muted"> — 단계 회의·행사, 외부 회의장 회의를 골랐어요. 준비 회의·대외활동·출장 참석은 빼 두었어요</span>
              </p>
            </div>

            {groups.map((g) => {
              const on = g.list.filter((c) => c.pick);
              const off = g.list.filter((c) => !c.pick);
              return (
                <section key={g.unitKo} className="mb-5">
                  <h3 className="mb-1.5 flex items-baseline gap-2 px-1 text-[15px] font-semibold text-ink">
                    {g.unitKo}
                    <span className="chip chip-muted">{g.abbr}</span>
                    <span className="ml-auto text-xs font-medium text-muted tabular-nums">
                      고른 {on.length} / {g.list.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-hairline-soft overflow-hidden rounded-lg border border-hairline">
                    {on.map(row)}
                    {on.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">미리 고른 것이 없어요</li>}
                    {off.length > 0 && (
                      <li>
                        <button type="button" onClick={() => toggle(showLeft, setShowLeft as never, g.unitKo)} className="w-full px-3 py-2 text-left text-xs font-medium text-muted hover:bg-surface-soft hover:text-ink">
                          {showLeft.has(g.unitKo) ? '뺀 것 접기' : `뺀 것 ${off.length}건 보기`} —{' '}
                          {[...new Set(off.map((c) => c.reason))].join(' · ')}
                        </button>
                      </li>
                    )}
                    {showLeft.has(g.unitKo) && off.map(row)}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline bg-canvas px-4 py-3 sm:px-6">
        {cands ? (
          <button
            type="button"
            onClick={() => {
              setCands(null);
              setFiles(null);
              setErr(null);
            }}
            className="btn-secondary h-11"
          >
            다른 PDF 올리기
          </button>
        ) : (
          <span />
        )}
        <button type="button" disabled={!cands || picked.length === 0} onClick={() => onImport(picked)} className="btn-primary ml-auto h-11 min-w-36">
          고른 {picked.length}건 넣기
        </button>
      </div>
    </div>
  );
}
