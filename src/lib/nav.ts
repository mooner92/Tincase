// PG-03·PG-49 — 상단 메뉴 구성. **역할별 메뉴는 이 함수 하나가 정한다** (PG-49d).
//
// 헤더 안에서 조건을 하나씩 붙여 가면, 어느 역할에 무엇이 보이는지가 코드 여기저기에
// 흩어져 테스트할 곳이 없다. 2026-10-06에 총괄(기획조정실)이 로그인해 보니 전 부서 열람
// 권한은 있는데 **그 화면으로 가는 메뉴가 없었다** — 그런 빈칸이 바로 이렇게 생긴다.

export interface NavItem {
  href: string;
  label: string;
  /** 업무 메뉴가 아니라 도움말 — 시각적으로 구분한다 */
  hint?: boolean;
}

export interface NavRole {
  /** 부서 컨텍스트. null이면 부서 메뉴를 그리지 않는다 (/ops 단독 등) */
  slug: string | null;
  /** 내 부서가 아닌 부서를 열람 중 */
  foreign: boolean;
  /** 부서 문서 화면을 볼 수 있다 (lead·head, 또는 readAll의 읽기) */
  isLead: boolean;
  isOperator: boolean;
  /** 전 부서 읽기 (총괄·운영자 — TACP `canReadAllDivisions`) */
  readAll: boolean;
}

export function buildNav(r: NavRole): NavItem[] {
  return [
    ...(r.slug
      ? [
          { href: `/${r.slug}`, label: r.foreign ? '개요' : '제출' },
          // TACP-15 — 병합본은 부서원 모두가 본다. 타 부서 열람 중에도 그 부서 보관함을 본다
          { href: `/${r.slug}/archive`, label: '보관함' },
          ...(r.foreign ? [] : [{ href: `/${r.slug}/history`, label: '내 이력' }]),
          ...(r.isLead
            ? [
                { href: `/${r.slug}/manage`, label: '수합 관리' },
                { href: `/${r.slug}/manage/settings`, label: '부서 설정' },
              ]
            : []),
        ]
      : []),
    // PG-49a — 타 부서로 가는 길은 readAll에게 이것 하나뿐이다 (P5의 예외 그대로)
    ...(r.readAll ? [{ href: '/ops/monitor', label: '전사 현황' }] : []),
    ...(r.isOperator ? [{ href: '/ops', label: '운영' }] : []),
    // 안내는 **처음 쓰는 사람**이 찾는 것이다. 드롭다운 안은 이미 아는 사람만 여는 자리라
    // 정작 필요한 사람에게 안 보인다. 맨 끝에 두되 물음표를 붙여 업무 메뉴와 구분한다
    { href: '/guide', label: '사용 안내', hint: true },
  ];
}

/**
 * 지금 화면이 이 메뉴인가.
 *
 * `/ops/monitor`는 `/ops` 아래에 있지만 **다른 메뉴다** — 앞부분만 맞춰 보면 전사 현황을
 * 보는 동안 `운영`까지 같이 켜진다. 그래서 더 긴 메뉴 주소가 있으면 그쪽이 이긴다.
 */
export function isNavActive(href: string, pathname: string, items: readonly NavItem[], slug: string | null): boolean {
  if (slug && href === `/${slug}`) return pathname === href;
  if (href.endsWith('/manage')) return pathname === href || /\/manage\/\d{4}-W\d{2}$/.test(pathname);
  const hit = pathname === href || pathname.startsWith(href + '/');
  if (!hit) return false;
  // 더 구체적인 메뉴가 이 경로를 차지하면 양보한다
  return !items.some(
    (o) => o.href.length > href.length && o.href.startsWith(href + '/') && (pathname === o.href || pathname.startsWith(o.href + '/')),
  );
}
