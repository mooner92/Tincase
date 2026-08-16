'use client';
// WA-06 — 웹에서 작성해 바로 제출 (S-10).
//
// 화면을 **한글 표와 같은 모양**으로 둔다. 부서원은 한글에서 그 표를 채워 왔으므로,
// 다른 배치를 내밀면 어디에 뭘 넣는지 다시 배워야 한다. 머리글을 그대로 두고
// 칸 너비도 비슷하게 맞춘다.
//
// `구분`은 시스템이 다시 매기므로(ABS-5) 입력칸이 아니라 **번호 표시**로 둔다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseClipboardTable } from '@/lib/paste-table';

export interface ComposerRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
}

type Bucket = 'achievements' | 'plans' | 'notes';

const SECTIONS: { key: Bucket; no: number; title: string; hint: string }[] = [
  { key: 'achievements', no: 1, title: '주요 업무실적', hint: '이번 주에 한 일' },
  { key: 'plans', no: 2, title: '주요 업무계획', hint: '다음 주에 할 일' },
  { key: 'notes', no: 3, title: '기타 특이사항', hint: '휴가·출장 등 · 없으면 비워 두세요' },
];

const blank = (): ComposerRow => ({ content: '', date: '', place: '', attendee: '' });
const draftKey = (isoKey: string) => `tincase.compose.${isoKey}`;

export function WebComposer({
  isoKey,
  guideLines,
  initial,
  onClose,
}: {
  isoKey: string;
  guideLines: string[];
  initial?: Record<Bucket, ComposerRow[]> | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Record<Bucket, ComposerRow[]>>(() => {
    if (initial?.achievements?.length || initial?.plans?.length || initial?.notes?.length) {
      return {
        achievements: initial.achievements?.length ? initial.achievements : [blank()],
        plans: initial.plans?.length ? initial.plans : [blank()],
        notes: initial.notes?.length ? initial.notes : [blank()],
      };
    }
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(draftKey(isoKey));
      if (saved) {
        try {
          return JSON.parse(saved) as Record<Bucket, ComposerRow[]>;
        } catch {
          /* 깨진 임시본은 조용히 버린다 */
        }
      }
    }
    return { achievements: [blank(), blank(), blank()], plans: [blank(), blank()], notes: [blank()] };
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasted, setPasted] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(draftKey(isoKey), JSON.stringify(data)), 800);
    return () => clearTimeout(t);
  }, [data, isoKey]);

  const filled = useMemo(
    () =>
      Object.fromEntries(SECTIONS.map((s) => [s.key, data[s.key].filter((r) => r.content.trim()).length])) as Record<
        Bucket,
        number
      >,
    [data],
  );
  const total = filled.achievements + filled.plans + filled.notes;

  const set = useCallback((bucket: Bucket, i: number, field: keyof ComposerRow, v: string) => {
    setData((d) => {
      const rows = [...d[bucket]];
      rows[i] = { ...rows[i], [field]: v };
      if (i === rows.length - 1 && v.trim() && rows.length < 200) rows.push(blank());
      return { ...d, [bucket]: rows };
    });
  }, []);

  /** 구역 비우기 — 잘못 붙여넣었을 때 한 줄씩 지우게 두면 아무도 안 쓴다 */
  const clearSection = useCallback((bucket: Bucket) => {
    setData((d) => ({ ...d, [bucket]: [blank()] }));
  }, []);

  const clearAll = useCallback(() => {
    setData({ achievements: [blank(), blank(), blank()], plans: [blank(), blank()], notes: [blank()] });
  }, []);

  const removeRow = useCallback((bucket: Bucket, i: number) => {
    setData((d) => {
      const rows = d[bucket].filter((_, k) => k !== i);
      return { ...d, [bucket]: rows.length ? rows : [blank()] };
    });
  }, []);

  /** 한글·엑셀 표를 통째로 붙여넣기 — 이 줄부터 아래로 채운다 */
  const onPaste = useCallback((bucket: Bucket, at: number, e: React.ClipboardEvent) => {
    // 한글은 평문에 셀을 줄바꿈으로 넣어 격자가 무너진다 → HTML을 먼저 본다
    const rows = parseClipboardTable(
      e.clipboardData.getData('text/html'),
      e.clipboardData.getData('text/plain'),
    );
    if (!rows) return; // 표가 아니면 평범한 붙여넣기로 둔다
    e.preventDefault();
    setData((d) => {
      const next = [...d[bucket]];
      rows.forEach((r, k) => {
        next[at + k] = { ...r };
      });
      if (next[next.length - 1].content.trim()) next.push(blank());
      return { ...d, [bucket]: next };
    });
    setPasted(`${rows.length}줄을 붙여넣었습니다`);
    setTimeout(() => setPasted(null), 2500);
  }, []);

  const submit = () => {
    setBusy(true);
    setMsg(null);
    fetch('/api/submissions/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(async (r) => {
        const body = (await r.json()) as { message?: string; version?: number };
        if (!r.ok) {
          setMsg({ ok: false, text: body.message ?? '제출하지 못했습니다.' });
          return;
        }
        localStorage.removeItem(draftKey(isoKey));
        setMsg({ ok: true, text: `제출되었습니다 (v${body.version}).` });
        router.refresh();
        setTimeout(onClose, 900);
      })
      .catch(() => setMsg({ ok: false, text: '네트워크 오류로 제출하지 못했습니다.' }))
      .finally(() => setBusy(false));
  };

  const cell =
    'h-8 rounded-md border border-hairline bg-canvas px-2 text-[13px] text-ink focus:border-ink focus:outline-none';

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="웹에서 업무일지 작성"
        className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col bg-canvas shadow-2xl"
      >
        {/* 머리 */}
        <div className="flex items-center justify-between border-b border-hairline px-7 py-4">
          <div>
            <h2 className="display text-xl">웹에서 작성</h2>
            <p className="mt-0.5 text-sm text-muted">
              한글 없이 바로 제출합니다 · 제출하면 부서 양식으로 만들어집니다
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full px-3 py-1 text-xl leading-none text-muted-soft hover:bg-surface-soft hover:text-body"
          >
            ×
          </button>
        </div>

        {/* 붙여넣기 안내 — 이걸 모르면 한 칸씩 옮겨 적는다 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline-soft bg-brand-mint/25 px-7 py-2.5 text-xs text-body-strong">
          <span className="font-semibold">한글 표를 그대로 붙여넣을 수 있습니다</span>
          <span className="text-body">
            한글에서 표를 드래그 → <kbd className="rounded border border-hairline bg-canvas px-1">Ctrl</kbd>
            <kbd className="ml-0.5 rounded border border-hairline bg-canvas px-1">C</kbd> → 아래 첫 칸에 붙여넣기
          </span>
          {pasted && <span className="ml-auto font-semibold text-success">{pasted}</span>}
        </div>

        {guideLines.length > 0 && (
          <ul className="border-b border-hairline-soft bg-surface-soft px-7 py-2.5 text-xs leading-5 text-body">
            {guideLines.map((l) => (
              <li key={l}>· {l}</li>
            ))}
          </ul>
        )}

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-7 py-5">
          {SECTIONS.map((s) => (
            <section key={s.key} className="mb-5">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-[15px] font-bold text-ink">
                  {s.no}. {s.title}
                </h3>
                <span className="text-xs text-muted-soft">{s.hint}</span>
                <span className="ml-auto text-xs font-medium text-muted">{filled[s.key]}줄</span>
                {filled[s.key] > 0 && (
                  <button
                    onClick={() => clearSection(s.key)}
                    className="rounded-md px-2 py-0.5 text-xs text-muted-soft hover:bg-error/10 hover:text-error"
                  >
                    비우기
                  </button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-hairline">
                {/* 머리글 — 한글 표와 같은 이름·순서 */}
                <div className="flex gap-1.5 border-b border-hairline bg-surface-card px-2.5 py-1.5 text-[11px] font-semibold text-muted">
                  <span className="w-9 shrink-0 text-center">구분</span>
                  <span className="flex-1">업무 내용</span>
                  <span className="w-[74px] shrink-0">일자</span>
                  <span className="w-28 shrink-0">장소</span>
                  <span className="w-28 shrink-0">참석자</span>
                  <span className="w-5 shrink-0" />
                </div>

                {data[s.key].map((row, i) => {
                  const no = row.content.trim()
                    ? `${s.no}-${data[s.key].slice(0, i + 1).filter((r) => r.content.trim()).length}`
                    : '';
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-1.5 px-2.5 py-1 ${i % 2 ? 'bg-surface-soft/60' : ''}`}
                    >
                      <span className="w-9 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-soft">
                        {no}
                      </span>
                      <input
                        value={row.content}
                        onChange={(e) => set(s.key, i, 'content', e.target.value)}
                        onPaste={(e) => onPaste(s.key, i, e)}
                        placeholder={i === 0 ? '업무 내용을 적거나, 한글 표를 붙여넣으세요' : ''}
                        className={`${cell} flex-1`}
                      />
                      <input
                        value={row.date}
                        onChange={(e) => set(s.key, i, 'date', e.target.value)}
                        placeholder={i === 0 ? '8/20' : ''}
                        className={`${cell} w-[74px] shrink-0`}
                      />
                      <input
                        value={row.place}
                        onChange={(e) => set(s.key, i, 'place', e.target.value)}
                        placeholder={i === 0 ? '중회의실' : ''}
                        className={`${cell} w-28 shrink-0`}
                      />
                      <input
                        value={row.attendee}
                        onChange={(e) => set(s.key, i, 'attendee', e.target.value)}
                        placeholder={i === 0 ? '원장 외 3명' : ''}
                        className={`${cell} w-28 shrink-0`}
                      />
                      <button
                        onClick={() => removeRow(s.key, i)}
                        aria-label={`${i + 1}번째 줄 지우기`}
                        className="w-5 shrink-0 rounded text-base leading-none text-hairline hover:text-error"
                        title="이 줄 지우기"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <p className="pb-2 text-xs leading-6 text-muted-soft">
            일자는 특정 날짜가 있는 업무만 적습니다 (상시 업무는 비워 두세요) ·
            빈 줄은 저장되지 않습니다 · 구분 번호는 제출할 때 다시 매겨집니다
          </p>
        </div>

        {/* 바닥 */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline bg-surface-soft px-7 py-3.5">
          <span aria-live="polite" className={`text-sm font-medium ${msg?.ok ? 'text-success' : 'text-error'}`}>
            {msg?.text}
          </span>
          <div className="flex items-center gap-4">
            {total > 0 && (
              <button onClick={clearAll} className="text-sm text-muted-soft hover:text-error">
                전체 지우기
              </button>
            )}
            <span className="text-sm text-muted">
              실적 {filled.achievements} · 계획 {filled.plans}
              {filled.notes > 0 && ` · 특이 ${filled.notes}`}
            </span>
            <button onClick={submit} disabled={busy || total === 0} className="btn-primary">
              {busy ? '제출 중…' : '제출'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
