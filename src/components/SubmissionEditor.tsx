'use client';
// WA-20 · TACP-22 — 담당자 첨삭. 부서원 제출물을 고쳐 **그 사람의 새 판**으로 저장한다.
//
// 표 모양은 웹 작성(WebComposer)과 같다 — 구분은 시스템이 다시 매기므로 번호 표시만 둔다(ABS-5).
// 원래 판은 그대로 남는다는 것을 저장 버튼 바로 옆에 적는다 — 「내가 남의 글을 지우나」 하는 망설임을 없앤다.
import { useState } from 'react';

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

export function SubmissionEditor({
  submissionId,
  ownerName,
  version,
  initial,
  onSaved,
  onCancel,
}: {
  submissionId: string;
  ownerName: string;
  version: number;
  initial: Record<Bucket, EditRow[]>;
  onSaved: (newId: string, newVersion: number) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<Record<Bucket, EditRow[]>>(() => ({
    achievements: initial.achievements.length ? initial.achievements.map((r) => ({ ...r })) : [blank()],
    plans: initial.plans.length ? initial.plans.map((r) => ({ ...r })) : [blank()],
    notes: initial.notes.length ? initial.notes.map((r) => ({ ...r })) : [blank()],
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (b: Bucket, i: number, f: keyof EditRow, v: string | boolean) =>
    setData((d) => ({ ...d, [b]: d[b].map((r, k) => (k === i ? { ...r, [f]: v } : r)) }));
  const add = (b: Bucket) => setData((d) => ({ ...d, [b]: [...d[b], blank()] }));
  const remove = (b: Bucket, i: number) =>
    setData((d) => {
      const rows = d[b].filter((_, k) => k !== i);
      return { ...d, [b]: rows.length ? rows : [blank()] };
    });

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
      else onSaved(b.id, b.version ?? version + 1);
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const cell =
    'h-8 rounded-md border border-border-strong bg-canvas px-2 text-[13px] text-ink focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none';

  return (
    <div className="space-y-5">
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
              <div key={i} className="flex items-center gap-1.5 border-b border-hairline-soft px-2 py-1 last:border-0">
                <span className="w-8 shrink-0 text-center text-xs tabular-nums text-muted">
                  {s.no}-{i + 1}
                </span>
                <input aria-label={`${s.title} ${i + 1} 내용`} value={r.content} onChange={(e) => set(s.key, i, 'content', e.target.value)} className={`${cell} min-w-0 flex-1 ${r.emphasis ? 'text-[#1d4ed8]' : ''}`} />
                <input aria-label="일자" value={r.date} onChange={(e) => set(s.key, i, 'date', e.target.value)} className={`${cell} w-16 shrink-0`} />
                <input aria-label="장소" value={r.place} onChange={(e) => set(s.key, i, 'place', e.target.value)} className={`${cell} w-20 shrink-0`} />
                <input aria-label="참석자" value={r.attendee} onChange={(e) => set(s.key, i, 'attendee', e.target.value)} className={`${cell} w-20 shrink-0`} />
                <span className="flex w-9 shrink-0 justify-center">
                  <input type="checkbox" aria-label="공유(파란색)" checked={!!r.emphasis} onChange={(e) => set(s.key, i, 'emphasis', e.target.checked)} />
                </span>
                <button onClick={() => remove(s.key, i)} aria-label="이 줄 지우기" className="w-5 shrink-0 text-muted-soft hover:text-error">
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
