'use client';
// WA-06 — 웹에서 작성해 바로 제출 (S-10).
//
// 표를 그대로 흉내 내지 않는다. 부서원이 채우는 건 결국 **한 줄에 네 칸**이고,
// `구분`은 시스템이 다시 매기므로(ABS-5) 사람이 볼 이유가 없다.
// 화면은 그 네 칸만 보여주고, 문서 모양은 제출할 때 시스템이 만든다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ComposerRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
}

type Bucket = 'achievements' | 'plans' | 'notes';

const SECTIONS: { key: Bucket; title: string; hint: string; optional?: boolean }[] = [
  { key: 'achievements', title: '1. 주요 업무실적', hint: '이번 주에 한 일' },
  { key: 'plans', title: '2. 주요 업무계획', hint: '다음 주에 할 일' },
  { key: 'notes', title: '3. 기타 특이사항', hint: '휴가·출장 등 (없으면 비워 두세요)', optional: true },
];

const blank = (): ComposerRow => ({ content: '', date: '', place: '', attendee: '' });

/** 로컬 임시 보관 — 서버 초안(WA-03)은 아직 없다. 최소한 새로고침으로 잃지는 않게 */
const draftKey = (isoKey: string) => `tincase.compose.${isoKey}`;

export function WebComposer({
  isoKey,
  guideLines,
  initial,
  onClose,
}: {
  isoKey: string;
  guideLines: string[];
  /** 이전 제출물을 불러와 이어 쓰기 (WA-07) */
  initial?: Record<Bucket, ComposerRow[]> | null;
  onClose: () => void;
}) {
  // 초기값을 한 번에 정한다 — 효과 안에서 setState 하면 렌더가 두 번 돈다.
  // 불러온 내용 > 로컬 임시본 > 빈 줄 순으로 우선한다
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
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(draftKey(isoKey), JSON.stringify(data)), 800);
    return () => clearTimeout(t);
  }, [data, isoKey]);

  const filled = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map((s) => [s.key, data[s.key].filter((r) => r.content.trim()).length]),
      ) as Record<Bucket, number>,
    [data],
  );
  const total = filled.achievements + filled.plans + filled.notes;

  const set = useCallback((bucket: Bucket, i: number, field: keyof ComposerRow, v: string) => {
    setData((d) => {
      const rows = [...d[bucket]];
      rows[i] = { ...rows[i], [field]: v };
      // 마지막 줄을 채우면 새 줄이 따라온다 — "추가" 버튼을 누르러 가지 않게
      if (i === rows.length - 1 && v.trim() && rows.length < 200) rows.push(blank());
      return { ...d, [bucket]: rows };
    });
  }, []);

  const removeRow = useCallback((bucket: Bucket, i: number) => {
    setData((d) => {
      const rows = d[bucket].filter((_, k) => k !== i);
      return { ...d, [bucket]: rows.length ? rows : [blank()] };
    });
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

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="웹에서 업무일지 작성"
        className="absolute inset-y-0 right-0 flex w-full max-w-4xl flex-col bg-canvas shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-3">
          <div>
            <h2 className="text-base font-bold text-ink">웹에서 작성</h2>
            <p className="mt-0.5 text-xs text-muted">
              한글 없이 바로 제출할 수 있습니다 · 제출하면 부서 양식으로 만들어집니다
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded px-2 py-1 text-lg leading-none text-muted-soft hover:text-body">
            ×
          </button>
        </div>

        {guideLines.length > 0 && (
          <ul className="border-b border-hairline-soft bg-surface-soft px-6 py-2.5 text-xs leading-5 text-body">
            {guideLines.map((l) => (
              <li key={l}>· {l}</li>
            ))}
          </ul>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {SECTIONS.map((s) => (
            <section key={s.key} className="mb-6">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
                <span className="text-xs text-muted-soft">{s.hint}</span>
                <span className="ml-auto text-xs text-muted">{filled[s.key]}줄</span>
              </div>
              <div className="space-y-1.5">
                {data[s.key].map((row, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="w-9 shrink-0 pt-2 text-right font-mono text-[11px] text-muted-soft">
                      {row.content.trim() ? `${SECTIONS.indexOf(s) + 1}-${data[s.key].slice(0, i + 1).filter((r) => r.content.trim()).length}` : ''}
                    </span>
                    <textarea
                      value={row.content}
                      onChange={(e) => set(s.key, i, 'content', e.target.value)}
                      rows={1}
                      placeholder={i === 0 ? '업무 내용' : ''}
                      className="min-h-9 flex-1 resize-y rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-sm leading-6"
                    />
                    <input
                      value={row.date}
                      onChange={(e) => set(s.key, i, 'date', e.target.value)}
                      placeholder={i === 0 ? '일자' : ''}
                      className="h-9 w-20 shrink-0 rounded-lg border border-hairline px-2 text-sm"
                    />
                    <input
                      value={row.place}
                      onChange={(e) => set(s.key, i, 'place', e.target.value)}
                      placeholder={i === 0 ? '장소' : ''}
                      className="h-9 w-28 shrink-0 rounded-lg border border-hairline px-2 text-sm"
                    />
                    <input
                      value={row.attendee}
                      onChange={(e) => set(s.key, i, 'attendee', e.target.value)}
                      placeholder={i === 0 ? '참석자' : ''}
                      className="h-9 w-28 shrink-0 rounded-lg border border-hairline px-2 text-sm"
                    />
                    <button
                      onClick={() => removeRow(s.key, i)}
                      aria-label={`${i + 1}번째 줄 지우기`}
                      className="h-9 w-7 shrink-0 rounded text-muted-soft hover:bg-surface-soft hover:text-error"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="pb-2 text-[11px] leading-5 text-muted-soft">
            일자는 특정 날짜가 있는 업무만 적습니다 (상시 업무는 비워 두세요).
            빈 줄은 저장되지 않으며, 구분 번호는 제출할 때 시스템이 다시 매깁니다.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-3">
          <span aria-live="polite" className={`text-sm ${msg?.ok ? 'text-success' : 'text-error'}`}>
            {msg?.text}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{total}줄</span>
            <button onClick={submit} disabled={busy || total === 0} className="btn-primary btn-sm">
              {busy ? '제출 중…' : '제출'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
