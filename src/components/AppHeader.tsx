'use client';
// 상단 통합 내비 (top-nav, 64px) — 워드마크 + 부서 배지 + 활성 표시 메뉴 + 사용자 드롭다운.
// 비밀번호·로그아웃은 드롭다운으로 내려 상단을 행동 중심 메뉴만 남긴다.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface NavItem {
  href: string;
  label: string;
  /** 업무 메뉴가 아니라 도움말 — 시각적으로 구분한다 */
  hint?: boolean;
}

export function AppHeader({
  slug,
  divisionName,
  userName,
  isLead,
  isOperator,
  viaCloudflare,
  foreign = false,
}: {
  slug: string | null; // null이면 부서 컨텍스트 없음 (/ops 단독 등)
  divisionName: string;
  userName: string;
  isLead: boolean;
  isOperator: boolean;
  viaCloudflare: boolean;
  /** 내 부서가 아닌 부서를 열람 중 (AU-15·16) — 배지로 명시 */
  foreign?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: NavItem[] = [
    ...(slug
      ? [
          { href: `/${slug}`, label: foreign ? '개요' : '제출' },
          ...(foreign ? [] : [{ href: `/${slug}/history`, label: '내 이력' }]),
          ...(isLead
            ? [
                { href: `/${slug}/manage`, label: '수합 관리' },
                { href: `/${slug}/manage/settings`, label: '부서 설정' },
              ]
            : []),
        ]
      : []),
    ...(isOperator ? [{ href: '/ops', label: '운영' }] : []),
    // 안내는 **처음 쓰는 사람**이 찾는 것이다. 드롭다운 안은 이미 아는 사람만 여는 자리라
    // 정작 필요한 사람에게 안 보인다. 맨 끝에 두되 물음표를 붙여 업무 메뉴와 구분한다
    { href: '/guide', label: '사용 안내', hint: true },
  ];

  const isActive = (href: string) => {
    if (href === `/${slug}`) return pathname === href;
    if (href.endsWith('/manage')) return pathname === href || /\/manage\/\d{4}-W\d{2}$/.test(pathname);
    return pathname === href || pathname.startsWith(href + '/');
  };

  const logout = () => {
    if (viaCloudflare) {
      // Cloudflare 엣지 엔드포인트 — 앱 라우트가 아니다 (AU-08)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/cdn-cgi/access/logout';
      return;
    }
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      router.replace('/login');
      router.refresh();
    });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-hairline-soft bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={slug ? `/${slug}` : '/'} className="shrink-0" aria-label="Tincase 홈">
            {/* SVG 로고 — next/image는 최적화할 게 없고 레이아웃만 복잡해진다.
                h는 30px: viewBox 높이가 84→96으로 늘어(아래 잘림 수정) 같은 h면 12% 작아진다 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/tincase-lockup.svg" alt="Tincase" className="h-[30px] w-auto" />
          </Link>
          <span
            className={`badge-pill max-w-44 truncate ${foreign ? 'bg-warning-soft text-body-strong' : ''}`}
            title={foreign ? `${divisionName} (타 부서 열람 중)` : divisionName}
          >
            {divisionName}
            {foreign && <span className="ml-1 text-[11px] font-semibold">열람</span>}
          </span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto" aria-label="주요 메뉴">
          {items.map((it) => {
            const active = isActive(it.href);
            // 안내는 업무 메뉴가 아니다. 옅은 초록으로 눈에 띄게 하되,
            // 선택됐을 때도 초록을 유지한다 — 잉크색으로 바뀌면 다른 탭에 섞여 버린다
            const tone = it.hint
              ? active
                ? 'bg-brand text-white hover:bg-brand hover:text-white'
                : 'bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand-active'
              : active
                ? 'tab-pill-active'
                : '';
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={`tab-pill whitespace-nowrap ${tone} ${it.hint ? 'ml-2 font-semibold' : ''}`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>

        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-canvas py-1.5 pr-3 pl-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-soft"
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-ink"
            >
              {userName.slice(0, 1)}
            </span>
            {userName}
            <span aria-hidden className="text-[10px] text-muted">
              ▾
            </span>
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-44 overflow-hidden rounded-2xl border border-hairline bg-canvas py-1.5 shadow-[0_8px_24px_rgba(10,10,10,0.08)]"
            >
              <Link
                role="menuitem"
                href="/password"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-body hover:bg-surface-soft"
              >
                비밀번호 변경
              </Link>
              <button
                role="menuitem"
                onClick={logout}
                className="block w-full px-4 py-2 text-left text-sm text-body hover:bg-surface-soft"
              >
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
