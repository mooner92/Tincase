// PG-49e — 「전사」 메뉴의 탭 막대: [현황](/ops/monitor) · [취합](/org).
//
// 두 화면이 상단 메뉴 둘(「전사 현황」·「전사 취합」)로 나뉘어 있을 때, 총괄은 같은 질문(이번 주 전사가
// 어디까지 왔나)을 하러 두 메뉴를 오갔고 일정 카드도 양쪽에 하나씩 생겼다. 그래서 메뉴는 하나로 묶고
// 화면 사이 이동은 여기서 한다 — **이 막대가 1차 길**이고, 감사 로그 같은 곁가지는 오른쪽에 작게 둔다.
//
// 어느 탭을 그릴지는 페이지가 정해서 넘긴다(TACP-12 — 판정은 authz.ts). 못 여는 탭은 그리지 않는다(TACP-9).
import Link from 'next/link';
import type { ReactNode } from 'react';

export type OrgTab = 'monitor' | 'org';

const TABS: { key: OrgTab; href: string; label: string }[] = [
  { key: 'monitor', href: '/ops/monitor', label: '현황' },
  { key: 'org', href: '/org', label: '취합' },
];

export function OrgTabs({
  current,
  tabs,
  children,
}: {
  current: OrgTab;
  /** 탭마다 그 화면을 열 수 있는가 — `orgTabs(scope)` (authz) */
  tabs: Record<OrgTab, boolean>;
  /** 오른쪽 곁가지 링크 (그 탭에만 있는 것) */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-hairline-soft">
      <nav aria-label="전사 화면" className="-mb-px flex gap-1">
        {TABS.filter((t) => tabs[t.key]).map((t) => {
          const active = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`border-b-2 px-4 pt-1 pb-2.5 text-[15px] font-semibold transition-colors ${
                active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2.5 text-sm">{children}</div>}
    </div>
  );
}
