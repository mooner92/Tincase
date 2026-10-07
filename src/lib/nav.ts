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
  /** 전 부서 읽기 (총괄·운영자 — TACP `canReadAllDivisions`) — 「전사」 화면의 제출 현황 */
  readAll: boolean;
  /** RU-31 — 내 부서가 본부 단계가 있는 본부이고 내가 lead·head (TACP-21 `hasHqDesk`) */
  hqDesk?: boolean;
  /** RU-32 — 「전사」 화면의 취합 부분 (총괄·운영자, 3단계 스위치 — TACP-21 `canOpenOrgDesk`) */
  orgDesk?: boolean;
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
    // RU-31 — 본부 단계는 부서 메뉴 다음, 전사 메뉴 앞 (넓어지는 순서 그대로)
    ...(r.hqDesk ? [{ href: '/hq', label: '본부 취합' }] : []),
    // PG-49a·f — 전사는 **메뉴 하나, 화면 하나**(`/org`)다. 「전사 현황」·「전사 취합」 두 메뉴였다가(~10-06) 한 메뉴 두 탭이
    // 되었고(PG-49e), 같은 부서를 두 모양으로 두 번 보여 줄 뿐이라 한 화면으로 합쳤다(2026-10-07).
    // 문은 화면과 같다 — 읽기(readAll)든 취합(orgDesk)이든 하나면 열린다 (`orgPageView`). 타 부서로 가는 길은
    // readAll에게 이것 하나뿐이다 (P5의 예외 그대로)
    ...(r.readAll || r.orgDesk ? [{ href: '/org', label: '전사' }] : []),
    ...(r.isOperator ? [{ href: '/ops', label: '운영' }] : []),
    // 안내는 **처음 쓰는 사람**이 찾는 것이다. 드롭다운 안은 이미 아는 사람만 여는 자리라
    // 정작 필요한 사람에게 안 보인다. 맨 끝에 두되 물음표를 붙여 업무 메뉴와 구분한다
    { href: '/guide', label: '사용 안내', hint: true },
  ];
}

/** 이 주소가 경로를 차지하는 길이 (주소 자체이거나 그 아래). 아니면 -1 */
function claim(prefix: string, pathname: string): number {
  return pathname === prefix || pathname.startsWith(prefix + '/') ? prefix.length : -1;
}

/**
 * 지금 화면이 이 메뉴인가.
 *
 * 경로를 **더 길게** 차지하는 메뉴가 이긴다 — 앞부분만 맞춰 보면 한 경로에 메뉴 둘이 같이 켜진다.
 * (예전에는 `/ops/monitor`가 「전사」였는데 `/ops`(운영) 아래라 둘이 같이 켜졌다. 지금 그 주소는 `/org`로 보낸다 — PG-49f)
 */
export function isNavActive(href: string, pathname: string, items: readonly NavItem[], slug: string | null): boolean {
  if (slug && href === `/${slug}`) return pathname === href;
  if (href.endsWith('/manage')) return pathname === href || /\/manage\/\d{4}-W\d{2}$/.test(pathname);
  const mine = claim(href, pathname);
  if (mine < 0) return false;
  // 더 구체적인 메뉴가 이 경로를 차지하면 양보한다
  return !items.some((o) => o.href !== href && claim(o.href, pathname) > mine);
}
