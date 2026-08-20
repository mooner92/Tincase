'use client';
// 보관함 목록 (CP-80~82). 주차 하나를 누르면 병합본 드로어가 열린다.
//
// 목록에 «몇 명이 냈고 몇 줄인지»를 같이 보여주는 이유: 부서원이 자기 주를 찾을 때
// 날짜보다 그 주의 규모를 먼저 기억한다. 그리고 그 수가 이상하면 그때 물어보게 된다.
import { useState } from 'react';
import { MergedDrawer } from './MergedDrawer';

export interface ArchiveItem {
  isoKey: string;
  label: string;
  monthly: boolean;
  madeAtKst: string;
  sources: number;
  counts: Record<string, number> | null;
}

export function ArchiveList({
  items,
  divisionSlug,
  canEdit,
}: {
  items: ArchiveItem[];
  divisionSlug: string;
  /** 수정은 담당자만 (TACP-15 — 열람은 모두, 쓰기는 그대로) */
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <section className="card px-6 py-10 text-center">
        <p className="display text-lg">아직 병합된 업무일지가 없습니다</p>
        <p className="mt-2 text-sm text-muted">
          마감(목요일 14:00)이 지나면 그 주 문서가 자동으로 합쳐져 여기에 쌓입니다.
        </p>
      </section>
    );
  }

  return (
    <>
      <ul className="space-y-2.5">
        {items.map((it) => {
          const c = it.counts;
          return (
            <li key={it.isoKey}>
              <button
                onClick={() => setOpen(it.isoKey)}
                className="card flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-6 py-4 text-left transition-colors hover:bg-surface-soft"
              >
                <span className="flex items-center gap-2 font-semibold text-ink">
                  {it.label}
                  {it.monthly && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">
                      월간
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted">
                  제출 {it.sources}건
                  {c && ` · 실적 ${c.achievements ?? 0} · 계획 ${c.plans ?? 0}`}
                  {c && (c.notes ?? 0) > 0 && ` · 특이 ${c.notes}`}
                </span>
                <span className="ml-auto text-sm text-muted-soft">{it.madeAtKst} 병합</span>
                <span aria-hidden className="text-muted-soft">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <MergedDrawer
        open={open !== null}
        onClose={() => setOpen(null)}
        isoKey={open ?? ''}
        divisionSlug={divisionSlug}
        canEdit={canEdit}
      />
    </>
  );
}
