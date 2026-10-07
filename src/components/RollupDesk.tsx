'use client';
// RU-31·32 — 본부 취합·전사 취합 화면의 공통 부품.
//
// 두 단계는 하는 일이 같다: 아래에서 **보낸 것**을 정한 순서대로 이어 붙이고, 결과를 받아 보고, 위로 보낸다.
// 다른 것은 「아래」가 무엇이냐(실·팀 / 본부)뿐이라 부품을 나누지 않는다.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface StatusChip {
  /** 「제출됨」·「병합만」·「대기」 */
  kind: 'sent' | 'merged' | 'waiting';
  label: string;
  /** 보낸 사본 받기 */
  href?: string;
}

export interface DeskRow {
  id: string;
  name: string;
  chip: StatusChip;
  /** 전사 화면: 본부 아래 실·팀들 */
  children?: { name: string; chip: StatusChip }[];
  /** 본부 단계 없이 바로 총괄로 오는 단위 (RU-07) */
  direct?: boolean;
}

export interface RunView {
  id: string;
  status: string;
  finishedAtKst: string | null;
  units: { name: string; rows: { achievements: number; plans: number; notes: number }; emphasis: number }[];
  warnings: string[];
  errorText: string | null;
  stale: boolean;
}

const chipClass: Record<StatusChip['kind'], string> = {
  sent: 'bg-success/10 text-success border-success/30',
  merged: 'bg-warning-soft text-ink border-warning/40',
  waiting: 'bg-canvas text-muted border-hairline',
};

export function Chip({ chip }: { chip: StatusChip }) {
  const body = (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${chipClass[chip.kind]}`}>
      {chip.kind === 'sent' && <span aria-hidden>✓</span>}
      {chip.label}
    </span>
  );
  return chip.href ? (
    <a href={chip.href} className="hover:opacity-80" title="보낸 사본 받기">
      {body}
    </a>
  ) : (
    body
  );
}

/** 순서 + 현황. 쓸 수 있는 사람에게만 ▲▼와 저장이 보인다 (TACP-9) */
export function OrderList({
  rows,
  canWrite,
  saveUrl,
  note,
  pageBreak,
  self,
  unitWord,
}: {
  rows: DeskRow[];
  canWrite: boolean;
  saveUrl: string;
  note: string;
  pageBreak: boolean;
  /** 본부 단계에서만 — 본부 자기 문서 넣기 (RU-08). undefined면 그리지 않는다 */
  self?: { value: boolean; nodeId: string; nodeName: string };
  unitWord: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(rows.map((r) => r.id));
  const [noteText, setNoteText] = useState(note);
  const [pb, setPb] = useState(pageBreak);
  const [selfOn, setSelfOn] = useState(self?.value ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const dirty =
    order.join() !== rows.map((r) => r.id).join() || noteText !== note || pb !== pageBreak || (self ? selfOn !== self.value : false);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(saveUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order, note: noteText, pageBreak: pb, ...(self ? { self: selfOn } : {}) }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '저장하지 못했습니다.');
      else {
        setSaved(true);
        router.refresh();
      }
    } catch {
      setErr('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">
          이어 붙이는 순서
          <span className="ml-2 text-xs font-normal text-muted">위에서부터 문서에 들어갑니다 · {unitWord} 안의 내용은 바꾸지 않습니다</span>
        </h2>
      </div>
      <ol className="mt-3 divide-y divide-hairline-soft">
        {order.map((id, i) => {
          const r = byId.get(id);
          if (!r) return null;
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span className="w-6 text-right text-sm tabular-nums text-muted">{i + 1}</span>
              {canWrite && (
                <span className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${r.name} 위로`} className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                    ▲
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`${r.name} 아래로`} className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                    ▼
                  </button>
                </span>
              )}
              <span className="min-w-[8rem] font-medium text-ink">
                {r.name}
                {r.direct && <span className="ml-1.5 text-xs font-normal text-muted">바로 제출</span>}
              </span>
              <Chip chip={r.chip} />
              {r.children && r.children.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {r.children.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1">
                      <span className={c.chip.kind === 'sent' ? 'text-success' : c.chip.kind === 'merged' ? 'text-warning' : 'text-muted-soft'}>●</span>
                      {c.name}
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {canWrite && (
        <div className="mt-4 space-y-3 border-t border-hairline-soft pt-4">
          <label className="block text-sm">
            <span className="text-muted">메모 — 순서를 왜 이렇게 했는지, 편집할 때 지킬 것 (사람이 읽는 것입니다. 순서는 위 목록이 정합니다)</span>
            <textarea
              value={noteText}
              onChange={(e) => {
                setNoteText(e.target.value);
                setSaved(false);
              }}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border-strong px-3 py-2 text-sm"
              placeholder="예: 기획조정실 → 연구관리실 → 인사관리실 순. 본부장 지시로 AI홍보전략실은 맨 뒤"
            />
          </label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pb} onChange={(e) => (setPb(e.target.checked), setSaved(false))} />
              {unitWord}마다 새 쪽에서 시작
            </label>
            {self && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selfOn} onChange={(e) => (setSelfOn(e.target.checked), setSaved(false))} />
                {self.nodeName} 자체 문서도 넣기
              </label>
            )}
            <button onClick={save} disabled={busy || !dirty} className="btn-secondary btn-sm">
              {busy ? '저장 중…' : '순서 저장'}
            </button>
            {saved && !dirty && <span className="text-xs text-success">저장했습니다 — 다음 이어 붙이기부터 이 순서입니다</span>}
          </div>
          {err && <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
        </div>
      )}
      {!canWrite && note && <p className="mt-3 text-sm text-muted">메모: {note}</p>}
    </section>
  );
}

/** 이어 붙이기 실행 + 결과 */
export function RunCard({
  run,
  canWrite,
  runUrl,
  isoKey,
  ready,
  title,
  resultWord,
}: {
  run: RunView | null;
  canWrite: boolean;
  runUrl: string;
  isoKey: string;
  /** 이어 붙일 것이 하나라도 있나 */
  ready: number;
  title: string;
  resultWord: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = run?.status === 'succeeded';

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(runUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isoKey }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '이어 붙이지 못했습니다.');
      router.refresh();
    } catch {
      setErr('네트워크 오류로 이어 붙이지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const total = run?.units.reduce(
    (a, u) => ({ a: a.a + u.rows.achievements, p: a.p + u.rows.plans, n: a.n + u.rows.notes, e: a.e + u.emphasis }),
    { a: 0, p: 0, n: 0, e: 0 },
  );

  return (
    <section className={`card-feature px-7 py-6 ${ok && !run?.stale ? 'bg-brand-soft' : 'bg-surface-strong'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="display text-xl">
            {ok ? (
              <>
                <span aria-hidden className="mr-1.5 text-success">
                  ✓
                </span>
                {resultWord} 준비됨
              </>
            ) : run?.status === 'failed' ? (
              '이어 붙이기 실패'
            ) : (
              title
            )}
          </h2>
          {ok && total && (
            <p className="mt-1 text-sm text-body">
              {run!.units.length}개 단위 → 실적 {total.a} · 계획 {total.p}
              {total.n > 0 && ` · 특이 ${total.n}`}
              {total.e > 0 && ` · 공유 ${total.e}`}
              {run!.finishedAtKst && ` · ${run!.finishedAtKst}`}
            </p>
          )}
          {run?.status === 'failed' && <p className="mt-1 text-sm text-error">{run.errorText}</p>}
          {!run && <p className="mt-1 text-sm text-body">{ready > 0 ? `제출된 ${ready}개를 순서대로 이어 붙입니다.` : '아직 제출된 것이 없습니다.'}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ok && (
            <a href={`/api/rollup/run/${run!.id}`} className="btn-oncolor">
              {resultWord} 받기
            </a>
          )}
          {canWrite && (
            <button onClick={go} disabled={busy || ready === 0} className="btn-secondary btn-sm">
              {busy ? '이어 붙이는 중…' : ok ? '다시 이어 붙이기' : '이어 붙이기'}
            </button>
          )}
        </div>
      </div>

      {ok && run!.stale && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
          이어 붙인 뒤 제출이 바뀌었습니다(새로 냄·취소·순서 변경) — <strong>다시 이어 붙이기</strong>를 누르세요.
        </p>
      )}
      {ok && run!.units.length > 0 && (
        <ol className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">
          {run!.units.map((u, i) => (
            <li key={`${u.name}-${i}`} className="flex items-baseline gap-2 rounded-lg bg-surface-card/70 px-3 py-1.5">
              <span className="w-5 text-right tabular-nums text-muted">{i + 1}</span>
              <span className="font-medium text-ink">{u.name}</span>
              <span className="ml-auto text-xs tabular-nums text-muted">
                실적 {u.rows.achievements} · 계획 {u.rows.plans}
                {u.rows.notes > 0 && ` · 특이 ${u.rows.notes}`}
                {u.emphasis > 0 && <span className="ml-1 font-semibold text-[#1d4ed8]"> · 공유 {u.emphasis}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {ok && run!.warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
          <p className="text-sm font-semibold text-ink">확인해 주세요</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-body">
            {run!.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error">{err}</p>}
    </section>
  );
}
