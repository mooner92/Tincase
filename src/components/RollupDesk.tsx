'use client';
// RU-31·82 — 본부 취합 화면의 부품: 산하 현황·순서(OrderList)와 본부본(RunCard).
//
// 2026-10-08(ADR-0015) — 본부본은 산하 사본이 바뀔 때마다 **저절로** 이어 붙는다. 그래서 이 화면에는 [이어 붙이기]가 없고,
// 대신 **상태**가 보인다(언제·무엇 때문에·산하 몇 곳). 사람이 누르는 것은 본부장의 [승인] 하나다(HqApprovalCard).
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface StatusChip {
  /**
   * RU-82 — 산하 칩.
   *   sent        올라옴 (승인 시각 · 승인한 사람 흐리게)
   *   nohead      부서장 없음 — 마감 뒤 병합본이 저절로 올라옴
   *   unapproved  주황 「부서장 승인 없이」 (RU-77 비상구)
   *   pending     부서장 승인 전 (마감 뒤 병합본은 있다)
   *   waiting     아직 병합 전 · 미제출
   */
  kind: 'sent' | 'nohead' | 'unapproved' | 'pending' | 'waiting';
  label: string;
  /** 승인한 사람·올린 사람 — 칩 밖에 흐리게 */
  by?: string;
  /** 보낸 사본 받기 */
  href?: string;
}

export interface DeskRow {
  id: string;
  name: string;
  chip: StatusChip;
}

export interface RunView {
  id: string;
  status: string;
  finishedAtKst: string | null;
  /** fixed — RU-19: 엔진이 이미 고친 것. 「확인해 주세요」와 따로 접어 둔다 (옛 기록에는 없다) */
  units: { name: string; rows: { achievements: number; plans: number; notes: number }; emphasis: number; fixed?: string[] }[];
  warnings: string[];
  errorText: string | null;
  stale: boolean;
  /** RU-55 — 이 판의 sha. 본부장 승인이 「본 판」으로 싣는다 */
  sha256: string | null;
  /** RU-78 — 무엇 때문에 다시 이어 붙었나 (「기획조정실 승인으로」) */
  causeLabel: string;
}

const chipClass: Record<StatusChip['kind'], string> = {
  sent: 'chip-ok',
  nohead: 'chip-ok',
  unapproved: 'chip-warn',
  pending: 'chip-muted',
  waiting: 'chip-muted',
};

export function Chip({ chip }: { chip: StatusChip }) {
  const ok = chip.kind === 'sent' || chip.kind === 'nohead' || chip.kind === 'unapproved';
  const body = (
    <span className={`chip ${chipClass[chip.kind]}`}>
      {ok && <span aria-hidden className="dot" />}
      {chip.label}
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      {chip.href ? (
        <a href={chip.href} className="hover:opacity-80" title="올라온 사본 받기">
          {body}
        </a>
      ) : (
        body
      )}
      {chip.by && <span className="text-xs text-muted">{chip.by}</span>}
    </span>
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
  approved = false,
}: {
  rows: DeskRow[];
  canWrite: boolean;
  saveUrl: string;
  note: string;
  pageBreak: boolean;
  /** 본부 단계에서만 — 본부 자기 문서 넣기 (RU-08). undefined면 그리지 않는다 */
  self?: { value: boolean; nodeId: string; nodeName: string };
  unitWord: string;
  /** RU-82 — 본부장 승인이 지금 판에 있다. 순서를 바꾸면 본부본이 다시 만들어지고 승인이 풀린다 — 저장 앞에 그 사실을 한 줄로 */
  approved?: boolean;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(rows.map((r) => r.id));
  const [noteText, setNoteText] = useState(note);
  const [pb, setPb] = useState(pageBreak);
  const [selfOn, setSelfOn] = useState(self?.value ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
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
    // CP-104 — 이 부품은 본부 취합(/hq)만 쓴다
    <section data-guide="hq-units" className="card" aria-labelledby="order-list">
      <div className="card-head">
        <div className="min-w-0">
          <h2 id="order-list" className="card-title">
            산하 현황 · 이어 붙이는 순서
          </h2>
          <p className="card-desc">부서장이 승인하면 저절로 올라옵니다 · 위에서부터 문서에 들어갑니다 · {unitWord} 안의 내용은 바꾸지 않습니다</p>
        </div>
        {/*
          순서는 한 번 정하면 거의 안 바꾼다. 그런데 ▲▼·메모·체크박스·[순서 저장]이 늘 펼쳐져 있으면 매주 보는
          「누가 냈나」가 그 밑에 묻힌다(2026-10-07). 그래서 평소에는 읽기만, 바꿀 때만 펼친다 — 바꿀 수 있는 사람에게만 (TACP-9)
        */}
        {canWrite && (
          <button onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="btn-ghost">
            {editing ? '순서 바꾸기 닫기' : '순서 바꾸기'}
          </button>
        )}
      </div>
      <ol className="mt-3 divide-y divide-hairline-soft">
        {order.map((id, i) => {
          const r = byId.get(id);
          if (!r) return null;
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="w-6 text-right text-sm tabular-nums text-muted">{i + 1}</span>
              {canWrite && editing && (
                <span className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${r.name} 위로`} className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                    ▲
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`${r.name} 아래로`} className="px-1 text-xs leading-none text-muted hover:text-ink disabled:opacity-30">
                    ▼
                  </button>
                </span>
              )}
              <span className="min-w-[8rem] font-medium text-ink">{r.name}</span>
              <Chip chip={r.chip} />
            </li>
          );
        })}
      </ol>

      {canWrite && editing && (
        <div className="card-section space-y-3">
          <label className="block text-sm">
            <span className="text-muted">메모 — 순서를 왜 이렇게 했는지, 편집할 때 지킬 것 (사람이 읽는 것입니다. 순서는 위 목록이 정합니다)</span>
            <textarea
              value={noteText}
              onChange={(e) => {
                setNoteText(e.target.value);
                setSaved(false);
              }}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border-strong px-3 py-2 text-sm focus:border-ink focus:outline-none"
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
            <button onClick={save} disabled={busy || !dirty} className="btn-primary btn-sm">
              {busy ? '저장 중…' : '순서 저장'}
            </button>
          </div>
          {approved && dirty && (
            <p className="text-sm text-warning">순서를 바꾸면 본부본이 다시 만들어지고 본부장이 다시 승인해야 합니다.</p>
          )}
          {err && <p className="callout callout-error">{err}</p>}
        </div>
      )}
      {saved && !dirty && <p className="mt-3 text-sm text-success">저장했습니다 — 본부본이 이 순서로 다시 이어 붙습니다</p>}
      {(!canWrite || !editing) && note && <p className="mt-3 text-sm text-muted">메모: {note}</p>}
    </section>
  );
}

/**
 * RU-82 — 「본부본」 카드. 본부본은 저절로 이어 붙으므로 **버튼이 아니라 상태**다: 언제·무엇 때문에·산하 몇 곳(Q0~Qf).
 * 행동은 [본부본 받기], 만들기가 **실패했을 때만** [다시 시도](RU-76 — 성공 상태에서는 그리지 않는다: 들어온 것이 바뀌면 이미 다시
 * 만들어지므로 누를 이유가 없고, 누를 이유가 없는 버튼은 「눌러야 하나?」를 만든다). 아래 구역(`children`)은 본부장 승인 · 총괄로 간 것.
 */
export function RunCard({
  current,
  failed,
  arrived,
  canRetry,
  isoKey,
  children,
}: {
  /** 가장 최근 성공한 본부본 — 본부장이 보는 판 */
  current: RunView | null;
  /** 그 뒤의 시도가 실패했으면 그 실패 */
  failed: RunView | null;
  /** 산하 몇 곳이 올라왔나 (안 온 곳 이름) */
  arrived: { n: number; of: number; missing: string[] };
  /** [다시 시도] — 본부 lead·head, 실패일 때만 */
  canRetry: boolean;
  isoKey: string;
  /** 같은 카드의 아래 구역 — 본부장 승인 · 총괄로 간 것 (각자 `card-section`을 그린다) */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFixed, setShowFixed] = useState(false);
  const run = current;

  const retry = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rollup/hq', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isoKey }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '이어 붙이지 못했습니다.');
      router.refresh();
    } catch {
      setErr('네트워크 오류로 이어 붙이지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const fixedUnits = run?.units.filter((u) => u.fixed?.length) ?? [];
  const fixedCount = fixedUnits.reduce((n, u) => n + u.fixed!.length, 0);
  const total = run?.units.reduce(
    (a, u) => ({ a: a.a + u.rows.achievements, p: a.p + u.rows.plans, n: a.n + u.rows.notes, e: a.e + u.emphasis }),
    { a: 0, p: 0, n: 0, e: 0 },
  );
  const progress = `산하 ${arrived.n}/${arrived.of}${arrived.missing.length ? ` (미제출 ${arrived.missing.join('·')})` : ''}`;

  return (
    <section data-guide="hq-run" className="card" aria-labelledby="run-card">
      {/* 사용 안내의 카메라 자리 — 제목·상태 줄까지 (CP-104). 감싸기만 한다 */}
      <div data-guide="hq-run-head">
        <div className="card-head">
          <div className="min-w-0">
            <h2 id="run-card" className="card-title">
              본부본
            </h2>
            {/* RU-82 — 상태 한 줄. 이어 붙이기는 저절로 일어난다 — 언제·무엇 때문에·몇 곳인지만 말한다 */}
            <p data-guide="hq-run-button" className="card-desc">
              {run ? (
                <>
                  자동으로 이어 붙임 {run.finishedAtKst}
                  {run.causeLabel && ` · ${run.causeLabel}`} · {progress}
                  {total && (
                    <>
                      {' · '}실적 {total.a} · 계획 {total.p}
                      {total.n > 0 && ` · 특이 ${total.n}`}
                      {total.e > 0 && <span className="text-emphasis"> · 공유 {total.e}</span>}
                    </>
                  )}
                </>
              ) : failed ? (
                <span className="text-error">이어 붙이지 못했어요 — {failed.errorText}</span>
              ) : (
                '아직 올라온 실·팀이 없어요 — 부서장이 승인하면 저절로 이어 붙습니다'
              )}
            </p>
          </div>
          {failed ? (
            <span className="chip chip-error">이어 붙이지 못함</span>
          ) : run ? (
            <span className="chip chip-ok">
              <span aria-hidden className="dot" />
              준비됨
            </span>
          ) : (
            <span className="chip chip-muted">비어 있음</span>
          )}
        </div>

        {failed && run && (
          <p className="callout callout-error mt-4">
            새로 올라온 것을 이어 붙이지 못했어요 — {failed.errorText}. 아래는 그 전({run.finishedAtKst})에 이어 붙인 본부본입니다.
          </p>
        )}

        {(run || (failed && canRetry)) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {run && (
              <a href={`/api/rollup/run/${run.id}`} className="btn-secondary">
                본부본 받기
              </a>
            )}
            {failed && canRetry && (
              <button onClick={retry} disabled={busy} className="btn-secondary">
                {busy ? '이어 붙이는 중…' : '다시 시도'}
              </button>
            )}
          </div>
        )}
      </div>

      {run && run.units.length > 0 && (
        <ol className="mt-4 grid gap-x-8 text-sm sm:grid-cols-2">
          {run.units.map((u, i) => (
            <li key={`${u.name}-${i}`} className="flex items-baseline gap-2 border-t border-hairline-soft py-2">
              <span className="w-5 text-right tabular-nums text-muted">{i + 1}</span>
              <span className="min-w-0 truncate font-medium text-ink">{u.name}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                실적 {u.rows.achievements} · 계획 {u.rows.plans}
                {u.rows.notes > 0 && ` · 특이 ${u.rows.notes}`}
                {u.emphasis > 0 && <span className="font-semibold text-emphasis"> · 공유 {u.emphasis}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {run && run.warnings.length > 0 && (
        <div className="callout callout-warn mt-4">
          <p className="font-semibold">확인해 주세요</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-body">
            {run.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {/*
        RU-19 — 엔진이 이미 고친 것은 주황 상자에 넣지 않는다. 할 일이 없는 줄이 [승인] 바로 위에서 경고처럼 뜨면
        「무엇을 확인하라는 거지?」로 멈춘다(2026-10-08). 전사 카드처럼 중립 글자로 접어 두고, 궁금하면 펼친다
      */}
      {run && fixedUnits.length > 0 && (
        <div className="mt-3 text-sm">
          <button onClick={() => setShowFixed((v) => !v)} aria-expanded={showFixed} className="flex items-center gap-2 text-muted hover:text-ink hover:underline">
            <span
              aria-hidden
              className={`relative -top-px inline-block h-1.5 w-1.5 border-r-[1.5px] border-b-[1.5px] border-current transition-transform ${
                showFixed ? 'rotate-45' : '-rotate-45'
              }`}
            />
            자동으로 고친 것 {fixedCount}건
          </button>
          {showFixed && (
            <ul className="mt-2 space-y-1 pl-4 text-xs text-muted">
              {fixedUnits.map((u, i) => (
                <li key={`${u.name}-${i}`}>
                  <span className="text-body">{u.name}</span> — {u.fixed!.join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {err && <p className="callout callout-error mt-4">{err}</p>}
      {children}
    </section>
  );
}
