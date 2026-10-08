'use client';
// 상단 통합 내비 (top-nav, 64px) — 워드마크 + 부서 배지 + 활성 표시 메뉴 + 사용자 드롭다운.
// 비밀번호·로그아웃은 드롭다운으로 내려 상단을 행동 중심 메뉴만 남긴다.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { buildNav, isNavActive } from '@/lib/nav';
import type { TourProp } from '@/server/tour';
import { TourHost } from './Tour';
export type { NavItem } from '@/lib/nav';


export function AppHeader({
  slug,
  divisionName,
  userName,
  isLead,
  isOperator,
  readAll = false,
  hqDesk = false,
  orgDesk = false,
  viaCloudflare,
  foreign = false,
  ownSlug,
  tour = null,
}: {
  slug: string | null; // null이면 부서 컨텍스트 없음 (/ops 단독 등)
  divisionName: string;
  userName: string;
  isLead: boolean;
  isOperator: boolean;
  /** PG-49 — 전 부서 읽기 (총괄·운영자). 켜지면 `전사` 메뉴가 생긴다 (「전사」 화면의 제출 열) */
  readAll?: boolean;
  /** RU-31 — `본부 취합` 메뉴 (TACP-21) */
  hqDesk?: boolean;
  /** RU-32 · PG-49f — 「전사」 화면의 취합 부분 (TACP-21). 이것만 있어도 `전사` 메뉴가 생긴다 */
  orgDesk?: boolean;
  viaCloudflare: boolean;
  /** 내 부서가 아닌 부서를 열람 중 (AU-15·16) — 칩으로 명시한다 (TACP-9 · AU-17c) */
  foreign?: boolean;
  /** 타 부서 열람 중일 때 [내 부서로]의 행선지 — 신원의 부서 슬러그 */
  ownSlug?: string;
  /**
   * PG-84 — 화면 둘러보기(서버가 계산한 장 목록·제안 — `getTour`). 머리를 그리는 여섯 곳이 모두 넘긴다(PG-T152).
   * 있으면 구석 카드와 사용자 메뉴 「화면 둘러보기」가 생긴다
   */
  tour?: TourProp | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // 사용자 메뉴 「화면 둘러보기」 — 누를 때마다 하나씩 올라가고 TourHost가 지금 페이지의 장을 연다
  const [tourAsk, setTourAsk] = useState(0);

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

  // PG-49d — 역할별 메뉴는 buildNav 하나가 정한다
  const items = buildNav({ slug, foreign, isLead, isOperator, readAll, hqDesk, orgDesk });
  const isActive = (href: string) => isNavActive(href, pathname, items, slug);
  // PG-71 — 부서원의 메뉴는 「사용 안내」 하나다. 하나뿐이면 좁은 화면에서도 아랫줄을 만들지 않고 로고 줄에 둔다
  const single = items.length === 1;
  // 타 부서 열람 중이면 메뉴를 한 줄에 올리는 폭을 md → lg로 늦춘다. 열람 칩과 [내 부서로]가 로고 줄에 늘 있어야 하는데
  // (ADR-0017), 768~1023px에서는 메뉴 여섯 개와 함께 들어가지 않아 칩이 0px로 눌렸다 (2026-10-08 실측)
  const navTop = single ? 'ml-auto flex' : foreign ? 'hidden lg:flex' : 'hidden md:flex';
  const navBelow = foreign ? 'lg:hidden' : 'md:hidden';

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
    <>
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
            {/*
              부서 이름은 좁은 화면에서 감춘다 — 부서는 페이지 제목에도 있다.
              테두리 배지였을 때는 오른쪽 사용자 알약과 같은 모양이 둘 늘어서 버튼처럼 보였다 — 글자로 둔다.
            */}
            {foreign ? (
              <ForeignChip />
            ) : (
              <span
                className="hidden max-w-44 truncate border-l border-hairline pl-3 text-sm font-medium text-muted sm:inline-block"
                title={divisionName}
              >
                {divisionName}
              </span>
            )}
          </div>

          <nav className={`items-center gap-1 ${navTop}`} aria-label="주요 메뉴">
            <Nav />
          </nav>

          <UserMenu />
        </div>

        {/* 좁은 화면 — 메뉴를 아랫줄에 펼친다. 스크롤 없이 전부 보인다 */}
        {!single && (
          <nav className={`-mx-1 flex flex-wrap items-center gap-1 pb-2.5 ${navBelow}`} aria-label="주요 메뉴">
            <Nav />
          </nav>
        )}
      </div>
    </header>
    {/* 머리 **밖**에 둔다 — 머리의 backdrop-filter가 fixed 자식의 기준 상자가 되어 카드가 머리 안에 갇힌다 */}
    {tour && <TourHost tour={tour} ask={tourAsk} />}
    </>
  );

  /**
   * S13 · TACP-9 · AU-17c — 타 부서 열람 표시는 **머리의 칩 하나**다. 본문 위 띠(「○○ 열람 중 [내 부서로]」)는 걷었다:
   * 같은 말을 두 번 했고, 띠가 페이지마다 본문을 한 줄 밀어냈다(2026-10-08).
   * 띠가 하던 일 둘을 칩이 넘겨받는다 — ① 어느 폭에서도 보인다(내 부서 이름과 달리 좁은 화면에서 감추지 않는다,
   * 열람 중이라는 사실은 늘 명시해야 한다) ② 돌아갈 길 [내 부서로]가 칩 바로 옆에 있다.
   */
  function ForeignChip() {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="chip chip-warn max-w-56 min-w-0" title={`${divisionName} (타 부서 열람 중)`}>
          <span className="min-w-0 truncate">{divisionName}</span>
          <span className="shrink-0 font-semibold">열람</span>
        </span>
        {ownSlug && (
          <Link href={`/${ownSlug}`} className="shrink-0 text-sm whitespace-nowrap text-muted underline-offset-2 hover:text-ink hover:underline">
            내 부서로
          </Link>
        )}
      </span>
    );
  }

  function Nav() {
    return (
      <>
          {items.map((it) => {
            const active = isActive(it.href);
            // R18 (2026-10-08) — 「사용 안내」의 초록 강조를 걷었다. 업무 메뉴와 같은 모양이고 맨 끝에 있다
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={`tab-pill whitespace-nowrap ${active ? 'tab-pill-active' : ''}`}
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
            aria-label={userName} // 이름 글자를 감춰도(아래) 화면 낭독기에는 이름이 남는다
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-canvas py-1.5 pr-3 pl-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-soft"
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-ink"
            >
              {userName.slice(0, 1)}
            </span>
            {/* 타 부서 열람 중 좁은 화면에서는 이름을 감추고 머리글자만 — 그 자리를 열람 칩의 부서 이름에 준다 (ADR-0017) */}
            <span className={foreign ? 'hidden sm:inline' : undefined}>{userName}</span>
            {/* 화살표는 선으로 — ▾는 페이퍼로지에 없어 다른 글꼴로 샌다 */}
            <span
              aria-hidden
              className="relative -top-0.5 ml-0.5 inline-block h-1.5 w-1.5 rotate-45 border-r-[1.5px] border-b-[1.5px] border-muted"
            />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-hairline bg-canvas py-1.5 shadow-[0_8px_24px_rgba(10,10,10,0.08)]"
            >
              {/* PG-84 — 언제든 다시: 지금 페이지의 장(없으면 홈의 부서원 장). 기록과 상관없이 시작한다 */}
              {tour && tour.chapters.length > 0 && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setTourAsk((n) => n + 1);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-body hover:bg-surface-soft"
                >
                  화면 둘러보기
                </button>
              )}
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
