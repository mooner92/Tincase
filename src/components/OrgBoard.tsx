'use client';
// PG-51 — 「전사」 화면의 표. **섹션 하나 = 한 줄**, 최종본 순서대로.
//
// 예전에는 같은 부서가 두 번 나왔다 — [현황] 탭의 본부별 팀 막대와 [취합] 탭의 섹션 판. 둘 다 「이번 주 전사가
// 어디까지 왔나」에 답하는 그림이라 한 표로 합쳤다(2026-10-07): 왼쪽은 사람이 냈나(제출), 오른쪽은 그 섹션이
// 최종본에 무엇으로 들어가나(최종본에). 막대를 누르면 남은 사람·팀이 펼쳐지고, 거기서 바로 안내문을 복사한다.
//
// 어느 열을 그릴지는 서버가 정해 넘긴다(TACP-9·12 — `orgPageView`). 열이 없는 사람에게는 그 열의 값도 오지 않는다.
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SectionProgress } from '@/lib/org-groups';
import { NudgeButton } from './NudgeButton';

export type FinalSource = 'tincase' | 'upload' | 'waiting_hq' | 'not_in_hq' | 'missing';

export interface FinalCell {
  /** 파일 올리기 대상 — OrgSection.id */
  sectionId: string;
  source: FinalSource;
  label: string;
  refId: string | null;
}

export interface OrgBoardRow {
  key: string;
  /** 최종본 순서(1부터). 「섹션 밖」은 null */
  no: number | null;
  title: string;
  /** 섹션을 채울 Tincase 부서가 없다 — 게시판으로 받는 곳 */
  offline: boolean;
  /** 제출 — 전 부서를 읽는 사람에게만 (PG-51e) */
  progress: SectionProgress | null;
  /** 최종본에 — 전사 취합을 여는 사람에게만 (PG-51e). 「섹션 밖」은 늘 null */
  final: FinalCell | null;
  /** 본부 단계가 있는 본부의 섹션 — 그 본부 취합 화면 (취합을 여는 사람에게만) */
  hq: { name: string; href: string } | null;
}

const GRID = {
  both: 'md:grid-cols-[1.75rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)]',
  progress: 'md:grid-cols-[1.75rem_minmax(0,1.3fr)_minmax(0,1fr)]',
  final: 'md:grid-cols-[1.75rem_minmax(0,1.2fr)_minmax(0,1.5fr)]',
};

// CP-100 — 칩 하나에 낱말 하나. 「올린 파일」은 중립 정보라 info(파랑) — 예전의 hex 파랑 셋을 토큰 하나로
const TONE: Record<FinalSource, string> = {
  tincase: 'chip-ok',
  upload: 'chip-info',
  waiting_hq: 'chip-warn',
  not_in_hq: 'chip-warn',
  missing: 'chip-muted',
};
const WORD: Record<FinalSource, string> = {
  tincase: 'Tincase',
  upload: '올린 파일',
  waiting_hq: '본부 대기',
  // RU-32 — 실은 냈는데 본부가 낸 판에 없다. 회색 「미제출」이면 낸 실이 안 낸 것처럼 보인다
  not_in_hq: '본부본에 없음',
  missing: '미제출',
};

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = pct === 100 ? 'bg-success' : pct > 0 ? 'bg-brand' : 'bg-transparent';
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-surface-strong" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function Count({ value, max }: { value: number; max: number }) {
  const done = max > 0 && value === max;
  return (
    <span className={`text-right tabular-nums ${done ? 'font-semibold text-success' : 'text-body'}`}>
      {value}
      <span className="text-muted">/{max}</span>
    </span>
  );
}

export function OrgBoard({
  rows,
  columns,
  isoKey,
  weekLabel,
  deadlineText,
  head,
}: {
  rows: OrgBoardRow[];
  columns: { progress: boolean; final: boolean };
  /** 카드 머리 — 전사 합계와 [안내문 복사]. 숫자가 카드 밖에 떠 있지 않게 표와 한 카드에 둔다 */
  head?: ReactNode;
  isoKey: string;
  weekLabel: string;
  deadlineText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const grid = columns.progress && columns.final ? GRID.both : columns.progress ? GRID.progress : GRID.final;

  const call = async (key: string, url: string, init: RequestInit) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(url, init);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.message ?? '처리하지 못했습니다.');
      else router.refresh();
    } catch {
      setErr('네트워크 오류로 처리하지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File) => {
    if (!target) return;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('sectionId', target);
    fd.set('isoKey', isoKey);
    await call(`up:${target}`, '/api/rollup/org/sections/upload', { method: 'POST', body: fd });
    setTarget(null);
  };

  return (
    <section data-guide="org-board" className="card card-flush">
      {head && <div className="px-5 pt-5 pb-4 sm:px-6">{head}</div>}
      {/* RU-60 — 게시판으로 받은 섹션 파일. 제출 경로(웹 작성)와 다른 일이다 — 총괄이 받은 것을 최종본 자리에 넣는다 */}
      {columns.final && (
        <input
          ref={fileRef}
          type="file"
          accept=".hwp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) upload(f);
          }}
        />
      )}

      <div className={`hidden gap-x-4 border-y border-hairline-soft bg-surface-soft px-6 py-2.5 text-xs font-medium text-muted md:grid ${grid}`}>
        <span className="text-right">#</span>
        <span>섹션</span>
        {columns.progress && <span>제출</span>}
        {columns.final && <span>최종본에</span>}
      </div>

      <ol className="divide-y divide-hairline-soft border-t border-hairline-soft md:border-t-0">
        {rows.map((r) => {
          const isOpen = open === r.key;
          const p = r.progress;
          const canOpen = !!p && p.teams.some((t) => t.isActive);
          return (
            <li key={r.key} className={`grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 px-5 py-2.5 text-sm sm:px-6 ${grid}`}>
              <span className="text-right tabular-nums text-muted">{r.no ?? ''}</span>
              <span className={`min-w-0 ${r.no === null ? 'text-muted' : 'font-medium text-ink'}`}>{r.title}</span>

              {columns.progress && (
                <div className="col-start-2 min-w-0 md:col-start-auto">
                  {!p || p.teams.length === 0 ? (
                    <span className="text-xs text-muted">{r.offline ? 'Tincase 밖' : '세지 않음'}</span>
                  ) : !canOpen ? (
                    /* 줄마다 「Tincase 미사용 · 게시판으로 제출」을 되풀이하면 아홉 줄이 같은 문장이다 — 짧게 */
                    <span className="text-xs text-muted">Tincase 밖</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : r.key)}
                      aria-expanded={isOpen}
                      aria-label={`${r.title} 제출 ${p.submitted}/${p.roster} — ${isOpen ? '접기' : '남은 사람 보기'}`}
                      className="group grid w-full grid-cols-[minmax(0,1fr)_3.5rem_0.75rem] items-center gap-2 rounded-md text-left"
                    >
                      <Bar value={p.submitted} max={p.roster} />
                      <Count value={p.submitted} max={p.roster} />
                      <span aria-hidden className="text-xs text-muted group-hover:text-ink">
                        {isOpen ? '▾' : '▸'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {columns.final && (
                <div className="col-start-2 min-w-0 md:col-start-auto">
                  {r.final ? (
                    <FinalView
                      f={r.final}
                      hq={r.hq}
                      busy={busy}
                      onUpload={() => {
                        setTarget(r.final!.sectionId);
                        fileRef.current?.click();
                      }}
                      onWithdraw={(id) => call(`del:${id}`, `/api/rollup/org/sections/upload?id=${id}`, { method: 'DELETE' })}
                    />
                  ) : (
                    <span className="text-xs text-muted">최종본에 들어가지 않습니다</span>
                  )}
                </div>
              )}

              {isOpen && p && (
                <Detail row={r} p={p} weekLabel={weekLabel} deadlineText={deadlineText} />
              )}
            </li>
          );
        })}
      </ol>
      {err && <p className="callout callout-error mx-5 mb-4 sm:mx-6">{err}</p>}
    </section>
  );
}

/** 막대를 눌렀을 때 — 남은 사람과 팀. 본 다음 할 일은 언제나 「알려주기」라 안내문 복사를 바로 옆에 둔다 */
function Detail({ row, p, weekLabel, deadlineText }: { row: OrgBoardRow; p: SectionProgress; weekLabel: string; deadlineText: string }) {
  const teams = p.teams.filter((t) => t.isActive);
  return (
    <div className="callout callout-muted col-span-full md:ml-[2.75rem]">
      {teams.length > 1 || p.teams.length > teams.length ? (
        <ul className="space-y-2">
          {p.teams.map((t) => (
            <li key={t.id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-0.5">
              {t.isActive ? (
                <>
                  <Link href={`/${t.slug}/manage`} className="truncate font-medium text-ink hover:underline" title="수합 관리 열기 (읽기 전용)">
                    {t.name}
                  </Link>
                  <Bar value={t.submitted} max={t.roster} />
                  <Count value={t.submitted} max={t.roster} />
                  {t.missing.length > 0 && <p className="col-start-2 col-end-4 text-xs leading-5 text-body">{t.missing.join(' · ')}</p>}
                </>
              ) : (
                <>
                  <span className="truncate text-muted">{t.name}</span>
                  <span className="col-span-2 text-xs text-muted">Tincase 밖 · 게시판으로 제출</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-body">
          {p.missing.length > 0 ? (
            <>
              <span className="text-muted">미제출</span> {p.missing.join(' · ')}
            </>
          ) : (
            <span className="text-success">모두 냈습니다</span>
          )}
          <Link href={`/${teams[0].slug}/manage`} className="ml-3 text-xs text-muted underline hover:text-ink">
            수합 관리
          </Link>
        </p>
      )}
      {(p.missing.length > 0 || row.hq) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <NudgeButton names={p.missing} deadlineText={deadlineText} weekLabel={weekLabel} />
          {row.hq && (
            <Link href={row.hq.href} className="text-xs text-muted underline hover:text-ink">
              {row.hq.name} 취합 화면 보기
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function FinalView({
  f,
  hq,
  busy,
  onUpload,
  onWithdraw,
}: {
  f: FinalCell;
  hq: OrgBoardRow['hq'];
  busy: string | null;
  onUpload: () => void;
  onWithdraw: (uploadId: string) => void;
}) {
  const ok = f.source === 'tincase' || f.source === 'upload';
  // 미제출은 칩과 [올리기]가 다 말한다 — 「Tincase 밖 — 게시판 파일을 올려 주세요」를 줄마다 되풀이하면
  // 정작 다른 줄(본부 대기·제출 시각)이 묻힌다. Tincase를 쓰는 곳인지는 제출 열이 말한다
  const label = f.source === 'missing' ? '' : f.label;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`chip shrink-0 ${TONE[f.source]}`}>
        {ok && <span aria-hidden className="dot" />}
        {WORD[f.source]}
      </span>
      {label &&
        /* 본부 대기·본부본에 없음 — 고칠 곳은 본부다. 그 본부 취합 화면으로 가는 길을 단다 */
        ((f.source === 'waiting_hq' || f.source === 'not_in_hq') && hq ? (
          <Link href={hq.href} className="min-w-0 truncate text-xs text-muted underline hover:text-ink" title={`${label} — 본부 취합 보기`}>
            {label}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-xs text-muted" title={label}>
            {label}
          </span>
        ))}
      {/*
        줄 행동은 테두리 없는 버튼(CP-99) — 열두 줄에 테두리 버튼 「파일 올리기」가 늘어서면 표가 버튼 밭이 된다.
        RU-60 — 올리기는 Tincase로 온 것이 없는 줄에만. 본부 대기 줄에도 둔다: 본부가 늦으면 게시판으로 받은 것을 넣는다
      */}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {f.source === 'tincase' && f.refId && (
          <a href={`/api/rollup/report/${f.refId}`} className="btn-ghost h-8 px-2.5">
            받기
          </a>
        )}
        {f.source === 'upload' && f.refId && (
          <>
            <a href={`/api/rollup/org/sections/upload/${f.refId}`} className="btn-ghost h-8 px-2.5">
              받기
            </a>
            <button onClick={() => onWithdraw(f.refId!)} disabled={!!busy} className="btn-link-danger mx-1.5 text-xs">
              올린 것 취소
            </button>
          </>
        )}
        {f.source !== 'tincase' && (
          <button data-guide="org-upload" onClick={onUpload} disabled={!!busy} className="btn-ghost h-8 px-2.5" title="취합게시판으로 받은 그 섹션의 hwp를 올립니다">
            {busy === `up:${f.sectionId}` ? '올리는 중…' : f.source === 'upload' ? '다시 올리기' : '올리기'}
          </button>
        )}
      </span>
    </div>
  );
}
