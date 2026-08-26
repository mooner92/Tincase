'use client';
// 상단 통합 내비 (top-nav, 64px) — 워드마크 + 부서 배지 + 활성 표시 메뉴 + 사용자 드롭다운.
// 비밀번호·로그아웃은 드롭다운으로 내려 상단을 행동 중심 메뉴만 남긴다.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { NotifyToggle } from './NotifyToggle';
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
  notifyEnabled,
  foreign = false,
}: {
  slug: string | null; // null이면 부서 컨텍스트 없음 (/ops 단독 등)
  divisionName: string;
  userName: string;
  isLead: boolean;
  isOperator: boolean;
  viaCloudflare: boolean;
  /** NT-21 — 본인 알림 받기 상태. 드롭다운에서 바로 끌 수 있다 */
  notifyEnabled?: boolean;
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
          // TACP-15 — 병합본은 부서원 모두가 본다. 타 부서 열람 중에도 그 부서 보관함을 본다
          { href: `/${slug}/archive`, label: '보관함' },
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
      {/*
        UX-01 — 좁은 화면에서 메뉴가 로고를 덮던 것을 고쳤다 (v1.23.2).
        폭이 모자라면 셋(로고·메뉴·사용자)이 서로를 밀어내는데, 로고만 `shrink-0`이라
        메뉴가 그 위로 겹쳐 「Tincase」의 글자를 가렸다 (390px 실측).
        게다가 메뉴는 `overflow-x-auto`라 «가로로 더 있다»는 표시가 없어,
        휴대폰에서는 「내 이력」·「사용 안내」가 **없는 것처럼** 보였다.

        고친 방향: 한 줄에 우겨넣지 않는다. 좁으면 메뉴를 **아랫줄로 내린다** —
        가로 스크롤은 있는 줄도 모르는 사람이 대부분이다.
      */}
      <div className="mx-auto max-w-[1120px] px-5">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 shrink items-center gap-3">
            <Link href={slug ? `/${slug}` : '/'} className="shrink-0" aria-label="Tincase 홈">
              {/* SVG 로고 — next/image는 최적화할 게 없고 레이아웃만 복잡해진다.
                  h는 30px: viewBox 높이가 84→96으로 늘어(아래 잘림 수정) 같은 h면 12% 작아진다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/tincase-lockup.svg" alt="Tincase" className="h-[30px] w-auto" />
            </Link>
            {/* 부서 배지는 좁은 화면에서 감춘다 — 부서는 페이지 제목에도 있다 */}
            <span
              className={`badge-pill hidden max-w-44 truncate sm:inline-block ${foreign ? 'bg-warning-soft text-body-strong' : ''}`}
              title={foreign ? `${divisionName} (타 부서 열람 중)` : divisionName}
            >
              {divisionName}
              {foreign && <span className="ml-1 text-[11px] font-semibold">열람</span>}
            </span>
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="주요 메뉴">
            <Nav />
          </nav>

          <UserMenu />
        </div>

        {/* 좁은 화면 — 메뉴를 아랫줄에 펼친다. 스크롤 없이 전부 보인다 */}
        <nav
          className="-mx-1 flex flex-wrap items-center gap-1 pb-2.5 md:hidden"
          aria-label="주요 메뉴"
        >
          <Nav />
        </nav>
      </div>
    </header>
  );

  function Nav() {
    return (
      <>
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
      </>
    );
  }

  function UserMenu() {
    return (
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
              className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-hairline bg-canvas py-1.5 shadow-[0_8px_24px_rgba(10,10,10,0.08)]"
            >
              {/* NT-21 — 알림을 끌 수 없으면 싫은 사람은 메신저에서 «차단»해 버린다.
                  끄는 길을 열어두는 편이 알림 자체를 살린다 */}
              {notifyEnabled !== undefined && <NotifyToggle initial={notifyEnabled} />}
              <div className="my-1 border-t border-hairline-soft" />
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
    );
  }
}
