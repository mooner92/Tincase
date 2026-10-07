'use client';
// WA-20 · TACP-22 — 담당자 첨삭. 부서원 제출물을 고쳐 **그 사람의 새 판**으로 저장한다.
//
// 표 모양은 웹 작성(WebComposer)과 같다 — 구분은 시스템이 다시 매기므로 번호 표시만 둔다(ABS-5).
// 원래 판은 그대로 남는다는 것을 저장 버튼 바로 옆에 적는다 — 「내가 남의 글을 지우나」 하는 망설임을 없앤다.
import { useLayoutEffect, useRef, useState } from 'react';

type Bucket = 'achievements' | 'plans' | 'notes';
export interface EditRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
  emphasis?: boolean;
}

const SECTIONS: { key: Bucket; no: number; title: string }[] = [
  { key: 'achievements', no: 1, title: '주요 업무실적' },
  { key: 'plans', no: 2, title: '주요 업무계획' },
  { key: 'notes', no: 3, title: '기타 특이사항' },
];
const blank = (): EditRow => ({ content: '', date: '', place: '', attendee: '', emphasis: false });

/**
 * 칸 높이를 내용에 맞춘다 — MergedDrawer와 같은 방식 (`field-sizing`은 사내 PC 브라우저를 장담할 수 없다).
 * 한 칸에 두 줄을 적는 것은 정상이다(HM-39). `<input>`은 값의 줄바꿈을 **조용히 지운다** —
 * 그래서 고치지도 않은 칸의 줄바꿈이 저장하는 순간 사라졌다 (2026-10-07 리뷰). 그래서 textarea다.
 */
const fit = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
};

export function SubmissionEditor({
  submissionId,
  ownerName,
  version,
  initial,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  submissionId: string;
  ownerName: string;
  version: number;
  initial: Record<Bucket, EditRow[]>;
  onSaved: (newId: string, newVersion: number) => void;
  onCancel: () => void;
  /** 저장하지 않은 수정이 생겼다 — 드로어가 닫기 전에 묻는다 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<Record<Bucket, EditRow[]>>(() => ({
    achievements: initial.achievements.length ? initial.achievements.map((r) => ({ ...r })) : [blank()],
    plans: initial.plans.length ? initial.plans.map((r) => ({ ...r })) : [blank()],
    notes: initial.notes.length ? initial.notes.map((r) => ({ ...r })) : [blank()],
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /*
   * 줄을 지우면 아래 줄의 값이 위 칸(같은 textarea)으로 올라온다 — 칸 높이는 그대로라서
   * 여러 줄 값이 한 줄 높이 칸에 들어가면 `overflow-hidden`에 가려 안 보인다. 값이 바뀔 때마다 다시 맞춘다
   * (MergedDrawer와 같은 방식)
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    rootRef.current?.querySelectorAll('textarea').forEach((el) => fit(el as HTMLTextAreaElement));
  }, [data]);

  const touch = () => onDirtyChange?.(true);
  const set = (b: Bucket, i: number, f: keyof EditRow, v: string | boolean) => {
    setData((d) => ({ ...d, [b]: d[b].map((r, k) => (k === i ? { ...r, [f]: v } : r)) }));
    touch();
  };
  const add = (b: Bucket) => {
    setData((d) => ({ ...d, [b]: [...d[b], blank()] }));
    touch();
  };
  const remove = (b: Bucket, i: number) => {
    setData((d) => {
      const rows = d[b].filter((_, k) => k !== i);
      return { ...d, [b]: rows.length ? rows : [blank()] };
    });
    touch();
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/submissions/${submissionId}/content`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const b = (await r.json().catch(() => ({}))) as { message?: string; id?: string; version?: number };
      if (!r.ok || !b.id) setErr(b.message ?? '저장하지 못했습니다.');
      else {
        onDirtyChange?.(false);
        onSaved(b.id, b.version ?? version + 1);
      }
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const cell =
    'block resize-none overflow-hidden rounded-md border border-border-strong bg-canvas px-2 py-1.5 text-[13px] leading-snug text-ink focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none';
  /** 칸 하나 — 줄바꿈을 지키는 textarea (HM-39) */
  const field = (b: Bucket, i: number, f: 'content' | 'date' | 'place' | 'attendee', label: string, extra: string) => (
    <textarea
      aria-label={label}
      rows={1}
      ref={fit}
      value={data[b][i][f]}
      onChange={(e) => {
        fit(e.target);
        set(b, i, f, e.target.value);
      }}
      className={`${cell} ${extra}`}
    />
  );

  return (
    <div ref={rootRef} className="space-y-5">
      <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-body-strong">
        <strong>{ownerName}</strong>님의 업무일지를 고칩니다. 저장하면 <strong>새 판(v{version + 1})</strong>이 생기고,
        지금 판(v{version})은 그대로 남습니다. 판 목록에 「고친 사람」이 함께 표시됩니다.
      </p>
      {SECTIONS.map((s) => (
        <section key={s.key}>
          <h3 className="mb-1.5 text-sm font-semibold text-body">
            {s.no}. {s.title}
          </h3>
          <div className="overflow-hidden rounded-xl border border-hairline">
            <div className="flex gap-1.5 border-b border-hairline bg-surface-card px-2 py-1.5 text-[11px] font-semibold text-muted">
              <span className="w-8 shrink-0 text-center">구분</span>
              <span className="flex-1">업무 내용</span>
              <span className="w-16 shrink-0">일자</span>
              <span className="w-20 shrink-0">장소</span>
              <span className="w-20 shrink-0">참석자</span>
              <span className="w-9 shrink-0 text-center">공유</span>
              <span className="w-5 shrink-0" />
            </div>
            {data[s.key].map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 border-b border-hairline-soft px-2 py-1 last:border-0">
                <span className="w-8 shrink-0 pt-1.5 text-center text-xs tabular-nums text-muted">
                  {s.no}-{i + 1}
                </span>
                {field(s.key, i, 'content', `${s.title} ${i + 1} 내용`, `min-w-0 flex-1 ${r.emphasis ? 'text-[#1d4ed8]' : ''}`)}
                {field(s.key, i, 'date', '일자', 'w-16 shrink-0')}
                {field(s.key, i, 'place', '장소', 'w-20 shrink-0')}
                {field(s.key, i, 'attendee', '참석자', 'w-20 shrink-0')}
                <span className="flex w-9 shrink-0 justify-center pt-2">
                  <input type="checkbox" aria-label="공유(파란색)" checked={!!r.emphasis} onChange={(e) => set(s.key, i, 'emphasis', e.target.checked)} />
                </span>
                <button onClick={() => remove(s.key, i)} aria-label="이 줄 지우기" className="w-5 shrink-0 pt-1.5 text-muted-soft hover:text-error">
                  ×
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => add(s.key)} className="mt-1 text-xs text-muted underline">
            + 줄 추가
          </button>
        </section>
      ))}
      {err && <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-hairline bg-canvas py-3">
        <button onClick={save} disabled={busy} className="btn-primary btn-sm">
          {busy ? '저장 중…' : `고쳐서 저장 (v${version + 1})`}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-secondary btn-sm">
          취소
        </button>
        <span className="text-xs text-muted">병합본에는 [다시 병합]을 눌러야 들어갑니다</span>
      </div>
    </div>
  );
}
