'use client';
// RH-70~77 — 연구실 작성 화면. 결과 hwp의 두 층 표(과제 줄 → 항목 줄)를 **과제 카드 → 항목 카드**로 받는다 — 폰에서도 쓰게(RH-61).
// 동작의 틀(임시본 · 바꾸기 전 [제출] 꺼짐 · 닫으면 임시본 · Esc · 초점 가두기)은 실형 작성 화면(WebComposer)과 같다(WA-35~38).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { composerDraftKey } from '@/lib/composer';
import { formatDays, parseDays, weekDayChips, type DayChip } from '@/lib/project-dates';

export interface PItem {
  content: string;
  date: string;
  place: string;
  people: string;
  emphasis?: boolean;
}
export interface PTask {
  type: string;
  title: string;
  owner: string;
  items: PItem[];
}
export interface PData {
  results: PTask[];
  plans: PTask[];
  notes: PItem[];
}
interface RecentTask {
  type: string;
  title: string;
  owner: string;
  lastIsoKey: string;
  uses: number;
  thisWeek: boolean;
}
interface Recent {
  tasks: RecentTask[];
  places: string[];
  people: string[];
  lastWeekPlans: PTask[];
}

type TaskSection = 'results' | 'plans';

/** RH-21 — 제출본에 나온 유형 8가지(§1-2 실측, 많은 순) */
const TYPES = ['수탁', '기본', '수시', '정부지원', 'R&D', '역무대행', '연적금', '일반'];

const blankItem = (): PItem => ({ content: '', date: '', place: '', people: '', emphasis: false });
const blankData = (): PData => ({ results: [], plans: [], notes: [] });
const itemHas = (i: PItem) => !!(i.content.trim() || i.date.trim() || i.place.trim() || i.people.trim());
const taskKey = (t: { title: string; owner: string }) => `${t.title.replace(/\s+/g, '')}|${t.owner.replace(/\s+/g, '')}`;

/** 내용 비교용 — 빈 항목·항목 없는 과제·앞뒤 공백을 뺀 모양(WA-37 「바뀌었나」는 내용으로) */
function normalize(d: PData) {
  const it = (i: PItem) => ({ c: i.content.trim(), d: i.date.trim(), p: i.place.trim(), a: i.people.trim(), e: !!i.emphasis });
  const tasks = (ts: PTask[]) =>
    ts
      .map((t) => ({ y: t.type.trim(), t: t.title.trim(), o: t.owner.trim(), i: t.items.filter(itemHas).map(it) }))
      .filter((t) => t.i.length > 0);
  return JSON.stringify({ r: tasks(d.results), p: tasks(d.plans), n: d.notes.filter(itemHas).map(it) });
}

function readDraft(key: string): PData | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as PData;
    return Array.isArray(v?.results) && Array.isArray(v?.plans) && Array.isArray(v?.notes) ? v : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, data: PData) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* 사생활 보호 모드 등 — 임시 보관만 못 할 뿐이다 */
  }
}
function dropDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 다음에 열 때 내용 비교가 다시 판정한다 */
  }
}

const input =
  'h-10 w-full rounded-md border border-border-strong bg-canvas px-2.5 text-[14px] text-ink focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none';

export function ProjectComposer({
  userId,
  isoKey,
  title,
  editedNote = null,
  initial,
  initialVersion,
  initialFailed = false,
  weekStartMs,
  onClose,
}: {
  userId: string;
  isoKey: string;
  title: string;
  editedNote?: string | null;
  /** RH-76 — 이번 주에 낸 판의 과제·항목. 없으면 null */
  initial?: PData | null;
  initialVersion?: number;
  initialFailed?: boolean;
  /** 이번 주 월요일 00:00 KST — 일자 칩(RH-73) */
  weekStartMs: number;
  onClose: () => void;
}) {
  const draftKey = `${composerDraftKey(userId, isoKey)}:project`;
  const [start, setStart] = useState<{ data: PData; from: 'draft' | 'submitted' | 'blank' }>(() => {
    const d = readDraft(draftKey);
    if (d) return { data: d, from: 'draft' };
    if (initial) return { data: initial, from: 'submitted' };
    return { data: blankData(), from: 'blank' };
  });
  const [data, setData] = useState<PData>(start.data);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [picker, setPicker] = useState<TaskSection | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const unchanged = useMemo(() => normalize(start.data) === normalize(data), [start, data]);
  const counts = useMemo(() => {
    const n = (ts: PTask[]) => ts.reduce((a, t) => a + t.items.filter(itemHas).length, 0);
    return { results: n(data.results), plans: n(data.plans), notes: data.notes.filter(itemHas).length };
  }, [data]);
  const total = counts.results + counts.plans + counts.notes;

  const chips = useMemo(
    () => ({ results: weekDayChips(weekStartMs), plans: weekDayChips(weekStartMs, 1), notes: weekDayChips(weekStartMs) }),
    [weekStartMs],
  );

  // RH-71 · RH-72 · RH-74 — 우리 실 최근 과제 · 장소·참석자 제안 · 내 지난주 계획. 못 받아도 직접 적으면 된다
  useEffect(() => {
    let alive = true;
    fetch('/api/division/tasks')
      .then((r) => (r.ok ? (r.json() as Promise<Recent>) : null))
      .then((b) => alive && b && setRecent(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 임시본 — 제출 전까지만, 바뀐 동안만(WA-35b)
  useEffect(() => {
    if (done) return;
    if (unchanged) {
      if (start.from === 'draft') writeDraft(draftKey, data);
      else dropDraft(draftKey);
      return;
    }
    const t = setTimeout(() => writeDraft(draftKey, data), 800);
    return () => clearTimeout(t);
  }, [data, draftKey, done, unchanged, start.from]);

  const close = useCallback(() => {
    if (!done && !unchanged) writeDraft(draftKey, data);
    onClose();
  }, [done, unchanged, draftKey, data, onClose]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (picker) setPicker(null);
        else close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
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
  }, [close, picker]);

  const restartFromSubmitted = () => {
    if (!initial || !confirm(`작성하던 임시본을 지우고 지금 낸 v${initialVersion}에서 다시 시작할까요?`)) return;
    dropDraft(draftKey);
    setStart({ data: initial, from: 'submitted' });
    setData(initial);
  };

  // ── 고치기 ──
  const setTasks = (s: TaskSection, f: (ts: PTask[]) => PTask[]) => setData((d) => ({ ...d, [s]: f(d[s]) }));
  const addTask = (s: TaskSection, t: { type: string; title: string; owner: string }) => {
    setTasks(s, (ts) => {
      const k = taskKey(t);
      if (ts.some((x) => taskKey(x) === k)) return ts;
      return [...ts, { type: t.type, title: t.title, owner: t.owner, items: [blankItem()] }];
    });
    setPicker(null);
  };
  const removeTask = (s: TaskSection, ti: number) => {
    const t = data[s][ti];
    if (t.items.some(itemHas) && !confirm(`「${t.title}」 과제와 그 아래 항목 ${t.items.filter(itemHas).length}개를 뺄까요?`)) return;
    setTasks(s, (ts) => ts.filter((_, i) => i !== ti));
  };
  const setItem = (s: TaskSection, ti: number, ii: number, patch: Partial<PItem>) =>
    setTasks(s, (ts) => ts.map((t, i) => (i !== ti ? t : { ...t, items: t.items.map((it, k) => (k !== ii ? it : { ...it, ...patch })) })));
  const addItem = (s: TaskSection, ti: number) =>
    setTasks(s, (ts) => ts.map((t, i) => (i !== ti || t.items.length >= 30 ? t : { ...t, items: [...t.items, blankItem()] })));
  const removeItem = (s: TaskSection, ti: number, ii: number) =>
    setTasks(s, (ts) => ts.map((t, i) => (i !== ti ? t : { ...t, items: t.items.length > 1 ? t.items.filter((_, k) => k !== ii) : [blankItem()] })));
  const setNote = (ni: number, patch: Partial<PItem>) =>
    setData((d) => ({ ...d, notes: d.notes.map((n, k) => (k !== ni ? n : { ...n, ...patch })) }));

  /**
   * RH-74 — 지난주 계획을 이번 주 실적으로. 같은 과제가 있으면 그 아래로 합친다.
   * **아직 안 들어온 항목만** — 이미 가져왔거나(다시 열기 · 두 번 누름) 손으로 같은 것을 적었으면 겹치지 않는다. 남은 것이 없으면 버튼도 없다
   */
  const itemKey = (taskK: string, i: PItem) => `${taskK}#${i.content.replace(/\s+/g, '')}#${i.date.replace(/\s+/g, '')}`;
  const pendingPlans = useMemo(() => {
    const have = new Set(data.results.flatMap((t) => t.items.filter(itemHas).map((i) => itemKey(taskKey(t), i))));
    return (recent?.lastWeekPlans ?? [])
      .map((t) => ({ ...t, items: t.items.filter((i) => itemHas(i) && !have.has(itemKey(taskKey(t), i))) }))
      .filter((t) => t.items.length > 0);
  }, [recent, data.results]);
  const pendingCount = pendingPlans.reduce((a, t) => a + t.items.length, 0);
  const importLastPlans = () => {
    setTasks('results', (ts) => {
      const next = ts.map((t) => ({ ...t, items: t.items.filter(itemHas) }));
      for (const p of pendingPlans) {
        const k = taskKey(p);
        const items = p.items.map((i) => ({ ...i }));
        const at = next.findIndex((t) => taskKey(t) === k);
        if (at >= 0) next[at] = { ...next[at], items: [...next[at].items, ...items] };
        else next.push({ type: p.type, title: p.title, owner: p.owner, items });
      }
      return next.filter((t) => t.items.length > 0);
    });
  };

  const submit = () => {
    setBusy(true);
    setMsg(null);
    fetch('/api/submissions/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'project', ...data }),
    })
      .then(async (r) => {
        const body = (await r.json()) as { message?: string; version?: number };
        if (!r.ok) {
          setMsg({ ok: false, text: body.message ?? '제출하지 못했습니다.' });
          return;
        }
        setDone(true);
        dropDraft(draftKey);
        setMsg({ ok: true, text: `제출되었습니다 (v${body.version}).` });
        router.refresh();
        setTimeout(onClose, 900);
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 제출하지 못했습니다.' }))
      .finally(() => setBusy(false));
  };

  const blocked = busy || done || total === 0 || (start.from !== 'draft' && unchanged);

  return (
    <div className="fixed inset-0 z-40 h-screen">
      <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pcomposer-title"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-3xl flex-col border-l border-hairline bg-canvas shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id="pcomposer-title" ref={titleRef} tabIndex={-1} className="card-title outline-none">
              {title}
            </h2>
            {editedNote && <p className="mt-0.5 text-sm text-warning">{editedNote}</p>}
          </div>
          <button onClick={close} aria-label="닫기" className="btn-ghost h-10 w-10 shrink-0 px-0 text-2xl leading-none text-muted">
            ×
          </button>
        </div>

        <datalist id="pc-places">
          {(recent?.places ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <datalist id="pc-people">
          {(recent?.people ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
          {start.from === 'draft' && (
            <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-body">
              <span className="font-semibold text-ink">저장하지 않은 임시본에서 이어 씁니다</span>
              {initial && initialVersion !== undefined && (
                <button onClick={restartFromSubmitted} className="text-xs text-muted underline hover:text-ink">
                  지금 낸 v{initialVersion}로 다시 시작
                </button>
              )}
            </p>
          )}
          {start.from === 'blank' && initialFailed && <p className="mb-3 text-sm text-warning">지금 낸 판을 불러오지 못해 빈 화면으로 시작합니다.</p>}

          {(['results', 'plans'] as const).map((s, si) => (
            <section key={s} className="mb-7" aria-labelledby={`pc-h-${s}`}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1">
                <h3 id={`pc-h-${s}`} className="text-[16px] font-semibold text-ink">
                  {si + 1}. {s === 'results' ? '주요 업무실적' : '주요 업무계획'}
                </h3>
                <span className="text-xs text-muted">{s === 'results' ? '이번 주에 한 일' : '다음 주에 할 일'}</span>
                <span className="ml-auto text-xs font-medium text-muted tabular-nums">항목 {counts[s]}개</span>
              </div>

              {s === 'results' && pendingCount > 0 && (
                <button onClick={importLastPlans} className="btn-secondary btn-sm mb-3 w-full sm:w-auto">
                  지난주 계획 가져오기 · 항목 {pendingCount}개
                </button>
              )}

              <div className="space-y-3">
                {data[s].map((t, ti) => (
                  <div key={ti} className="overflow-hidden rounded-lg border border-hairline">
                    <div className="flex items-start gap-2 bg-info-soft px-3 py-2">
                      <span className="chip chip-info mt-0.5 shrink-0">{t.type || '유형 없음'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] leading-5 font-semibold text-ink">{t.title}</p>
                        <p className="text-xs text-muted">책임자 {t.owner || '—'}</p>
                      </div>
                      <button
                        onClick={() => removeTask(s, ti)}
                        aria-label={`${t.title} 과제 빼기`}
                        title="과제 빼기"
                        className="btn-ghost h-9 w-9 shrink-0 px-0 text-lg leading-none text-muted hover:text-error"
                      >
                        ×
                      </button>
                    </div>
                    {t.items.map((it, ii) => (
                      <ItemCard
                        key={ii}
                        item={it}
                        chips={chips[s]}
                        label={`${t.title} ${ii + 1}번째 항목`}
                        onChange={(patch) => setItem(s, ti, ii, patch)}
                        onRemove={() => removeItem(s, ti, ii)}
                      />
                    ))}
                    <button onClick={() => addItem(s, ti)} className="w-full border-t border-hairline-soft px-3 py-2.5 text-left text-sm font-medium text-brand hover:bg-surface-soft">
                      + 항목 추가
                    </button>
                  </div>
                ))}
              </div>

              {picker === s ? (
                <TaskPicker
                  recent={recent?.tasks ?? null}
                  taken={new Set(data[s].map(taskKey))}
                  onPick={(t) => addTask(s, t)}
                  onClose={() => setPicker(null)}
                />
              ) : (
                <button onClick={() => setPicker(s)} className="mt-3 h-11 w-full rounded-lg border-2 border-dashed border-border-strong text-sm font-semibold text-body hover:border-ink hover:text-ink">
                  + 과제 추가
                </button>
              )}
            </section>
          ))}

          <section className="mb-4" aria-labelledby="pc-h-notes">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
              <h3 id="pc-h-notes" className="text-[16px] font-semibold text-ink">
                3. 기타 특이사항
              </h3>
              <span className="text-xs text-muted">없으면 비워 두세요</span>
              <span className="ml-auto text-xs font-medium text-muted tabular-nums">{counts.notes}개</span>
            </div>
            {data.notes.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-hairline">
                {data.notes.map((n, ni) => (
                  <ItemCard
                    key={ni}
                    item={n}
                    chips={chips.notes}
                    first={ni === 0}
                    label={`특이사항 ${ni + 1}번째`}
                    onChange={(patch) => setNote(ni, patch)}
                    onRemove={() => setData((d) => ({ ...d, notes: d.notes.filter((_, k) => k !== ni) }))}
                  />
                ))}
              </div>
            )}
            <button
              onClick={() => setData((d) => (d.notes.length >= 30 ? d : { ...d, notes: [...d.notes, blankItem()] }))}
              className="mt-3 h-11 w-full rounded-lg border-2 border-dashed border-border-strong text-sm font-semibold text-body hover:border-ink hover:text-ink"
            >
              + 특이사항 추가
            </button>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline bg-canvas px-4 py-3 sm:px-6">
          <span aria-live="polite" className={`text-sm font-medium ${msg?.ok ? 'text-success' : 'text-error'}`}>
            {msg?.text}
          </span>
          <button onClick={submit} disabled={blocked} className="btn-primary ml-auto h-11 min-w-28">
            {busy ? '제출 중…' : '제출'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** RH-72 — 항목 카드: 내용 · 일자 칩 · 장소 · 참석자 · 강조 */
function ItemCard({
  item,
  chips,
  label,
  first = false,
  onChange,
  onRemove,
}: {
  item: PItem;
  chips: DayChip[];
  label: string;
  first?: boolean;
  onChange: (patch: Partial<PItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`space-y-2 px-3 py-3 ${first ? '' : 'border-t border-hairline-soft'}`}>
      <textarea
        value={item.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={2}
        placeholder="무엇을 했나요 · 할 건가요 (예: 착수보고회 개최)"
        aria-label={`${label} 내용`}
        className="w-full resize-y rounded-md border border-border-strong bg-canvas px-2.5 py-2 text-[14px] leading-5 text-ink focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none"
      />
      <DateChips value={item.date} chips={chips} label={label} onChange={(date) => onChange({ date })} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={item.place} onChange={(e) => onChange({ place: e.target.value })} list="pc-places" placeholder="장소" aria-label={`${label} 장소`} className={input} />
        <input value={item.people} onChange={(e) => onChange({ people: e.target.value })} list="pc-people" placeholder="참석자 (예: 홍길동 외 2인)" aria-label={`${label} 참석자`} className={input} />
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ emphasis: !item.emphasis })}
          aria-pressed={item.emphasis === true}
          aria-label={`${label} 강조`}
          title="결과 문서에서 파란색으로"
          className={`h-9 rounded-md border px-3 text-xs font-semibold transition-colors ${
            item.emphasis ? 'border-emphasis bg-emphasis text-white' : 'border-hairline bg-canvas text-muted hover:border-ink hover:text-ink'
          }`}
        >
          강조
        </button>
        <button onClick={onRemove} aria-label={`${label} 지우기`} className="btn-link-danger text-xs">
          항목 지우기
        </button>
      </div>
    </div>
  );
}

/** RH-73 — 그 주 월~금 칩. 하나 = 하루 · 이어진 날 = 기간 · 떨어진 날 = 쉼표. [직접]은 글자 그대로 */
function DateChips({ value, chips, label, onChange }: { value: string; chips: DayChip[]; label: string; onChange: (v: string) => void }) {
  const parsed = useMemo(() => parseDays(value, chips), [value, chips]);
  const [custom, setCustom] = useState(() => parsed === null);
  const chosen = new Set((parsed ?? []).map((c) => c.md));
  const toggle = (c: DayChip) => {
    const now = (parsed ?? []).filter((x) => x.md !== c.md);
    onChange(formatDays(chosen.has(c.md) ? now : [...now, c]));
  };
  return (
    <div>
      {/* 400px 폰에서 월~금 + [직접] 여섯이 한 줄에 — 가로 스크롤로 [직접]이 잘리지 않게 6칸 격자 */}
      <div className="grid grid-cols-6 gap-1" role="group" aria-label={`${label} 일자`}>
        {chips.map((c) => {
          const on = !custom && chosen.has(c.md);
          return (
            <button
              key={c.md}
              type="button"
              onClick={() => {
                setCustom(false);
                toggle(c);
              }}
              aria-pressed={on}
              className={`flex h-11 min-w-0 flex-col items-center justify-center rounded-md border px-0.5 leading-tight ${
                on ? 'border-ink bg-ink text-canvas' : 'border-border-strong bg-canvas text-body hover:border-ink'
              }`}
            >
              <span className="text-[11px]">{c.dow}</span>
              <span className="text-[12px] font-semibold tracking-tight tabular-nums sm:text-[13px]">{c.md}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          aria-pressed={custom}
          className={`h-11 min-w-0 rounded-md border px-0.5 text-xs font-semibold ${custom ? 'border-ink bg-ink text-canvas' : 'border-border-strong text-body hover:border-ink'}`}
        >
          직접
        </button>
      </div>
      {custom ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="예: 10월 중 · 10/29~30" aria-label={`${label} 일자 직접 입력`} className={`${input} mt-1.5`} />
      ) : (
        value && <p className="mt-1 text-xs text-muted">일자 {value}</p>
      )}
    </div>
  );
}

/** RH-71 — 과제 고르기: 우리 실 최근 과제 또는 새 과제 */
function TaskPicker({
  recent,
  taken,
  onPick,
  onClose,
}: {
  recent: RecentTask[] | null;
  taken: Set<string>;
  onPick: (t: { type: string; title: string; owner: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [custom, setCustom] = useState('');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const shown = (recent ?? []).filter((t) => {
    if (taken.has(taskKey(t))) return false;
    const k = q.replace(/\s+/g, '');
    return !k || `${t.title}${t.owner}${t.type}`.replace(/\s+/g, '').includes(k);
  });
  const finalType = type === '직접' ? custom.trim() : type;
  return (
    <div className="mt-3 rounded-lg border border-ink p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">과제 고르기</p>
        <button onClick={onClose} className="btn-ghost h-9 px-2 text-sm text-muted">
          닫기
        </button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="과제명·책임자로 찾기" aria-label="과제 찾기" className={input} autoFocus />
      <ul className="mt-2 max-h-72 divide-y divide-hairline-soft overflow-y-auto rounded-md border border-hairline">
        {recent === null && <li className="px-3 py-3 text-sm text-muted">우리 실 과제를 불러오는 중…</li>}
        {recent !== null && shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">{q ? '찾는 과제가 없습니다 — 아래에서 새로 적어 주세요' : '고를 과제가 없습니다 — 아래에서 새로 적어 주세요'}</li>}
        {shown.map((t) => (
          <li key={taskKey(t)}>
            <button onClick={() => onPick(t)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-soft">
              <span className="chip chip-muted mt-0.5 shrink-0">{t.type || '—'}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-5 text-ink">{t.title}</span>
                <span className="block text-xs text-muted">
                  {t.owner || '책임자 없음'}
                  {t.thisWeek && ' · 이번 주에 누가 썼어요'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-2 border-t border-hairline pt-3">
        <p className="text-sm font-semibold text-ink">새 과제</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="유형">
          {[...TYPES, '직접'].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setType(y)}
              aria-pressed={type === y}
              className={`h-9 rounded-md border px-2.5 text-xs font-semibold ${type === y ? 'border-ink bg-ink text-canvas' : 'border-border-strong text-body hover:border-ink'}`}
            >
              {y}
            </button>
          ))}
        </div>
        {type === '직접' && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="유형" aria-label="유형 직접 입력" maxLength={20} className={input} />}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="과제명" aria-label="새 과제명" className={input} />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="책임자" aria-label="새 과제 책임자" className={input} />
        <button
          disabled={!title.trim() || !finalType}
          onClick={() => onPick({ type: finalType, title: title.trim(), owner: owner.trim() })}
          className="btn-primary h-11 w-full"
        >
          이 과제 추가
        </button>
      </div>
    </div>
  );
}
