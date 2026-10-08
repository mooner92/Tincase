// PG-03·PG-49 — 역할별 상단 메뉴.
//
// 2026-10-06에 총괄(기획조정실)이 로그인해 보니 전 부서 열람 권한은 있는데 **그 화면으로 가는
// 메뉴가 없었다.** 권한(TACP)은 맞았고 길이 빠져 있었다. 어느 역할에 무엇이 보이는지를 여기서 고정한다.
import { describe, expect, it } from 'vitest';
import { buildNav, isNavActive, type NavRole } from '@/lib/nav';

const base: NavRole = { slug: 'psd', foreign: false, isLead: false, isOperator: false, readAll: false };
const labels = (r: Partial<NavRole>) => buildNav({ ...base, ...r }).map((i) => i.label);

describe('PG-49 역할별 메뉴', () => {
  it('[PG-T60] 부서원 — 업무 메뉴 없이 「사용 안내」 하나. 로고가 홈이다 (PG-71, 2026-10-08)', () => {
    expect(labels({})).toEqual(['사용 안내']);
    // R18 — 「사용 안내」를 업무 메뉴와 다르게 칠하던 표시가 없다
    expect(buildNav(base).some((i) => 'hint' in i)).toBe(false);
  });

  it('[PG-T61] 부서 담당자 — 제출 · 수합 관리 · 사용 안내. 「부서 설정」은 메뉴가 아니라 수합 관리 머리의 링크 (P5)', () => {
    const l = labels({ isLead: true });
    expect(l).toEqual(['제출', '수합 관리', '사용 안내']);
    expect(l).not.toContain('부서 설정');
    expect(l).not.toContain('전사');
    expect(l).not.toContain('운영');
  });

  it('[PG-T62] ★ 총괄 — `전사`가 보이고(/org로 들어간다 — PG-49f) `운영`은 안 보인다', () => {
    // 기획조정실 총괄: 부서원 + 총괄. 업무일지 내용은 전권, 인원·페이지 관리는 아니다
    const items = buildNav({ ...base, readAll: true });
    expect(items.map((i) => i.label)).toContain('전사');
    expect(items.find((i) => i.label === '전사')?.href).toBe('/org');
    expect(items.map((i) => i.label)).not.toContain('운영');
  });

  it('[PG-T63] 운영자 — `전사`와 `운영`을 둘 다 본다 (열람과 관리는 하는 일이 다르다)', () => {
    const l = labels({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    expect(l).toContain('전사');
    expect(l).toContain('운영');
    expect(l.indexOf('전사')).toBeLessThan(l.indexOf('운영'));
  });

  it('[PG-T64] 타 부서 열람 중 — 첫 항목은 `수합 관리`. `개요`·`보관함`·`내 이력`·`제출`은 없다 (PG-70)', () => {
    const l = labels({ foreign: true, readAll: true, isLead: true });
    expect(l[0]).toBe('수합 관리');
    for (const gone of ['개요', '보관함', '내 이력', '제출']) expect(l).not.toContain(gone);
  });
});

describe('PG-49 활성 메뉴 판정', () => {
  const op = buildNav({ ...base, isLead: true, isOperator: true, readAll: true, orgDesk: true });
  const active = (path: string) => op.filter((i) => isNavActive(i.href, path, op, 'psd')).map((i) => i.label);

  it('[PG-T65] 「전사」를 보는 동안 `운영`이 같이 켜지지 않고, 운영 화면에서는 `전사`가 켜지지 않는다', () => {
    // 예전 「전사」 주소 /ops/monitor는 /ops 아래라 둘이 같이 켜질 뻔했다 — 지금은 /org로 보낸다(PG-49f), 거기서 헤더를 그리지 않는다
    expect(active('/org')).toEqual(['전사']);
    expect(active('/ops')).toEqual(['운영']);
    expect(active('/ops/audit')).toEqual(['운영']);
  });

  it('[PG-T66] 부서 메뉴 — 제출과 수합 관리가 겹쳐 켜지지 않고, 수합 관리는 그 아래 전부(지난 주·부서 설정)에서 켜진다', () => {
    expect(active('/psd')).toEqual(['제출']);
    expect(active('/psd/manage')).toEqual(['수합 관리']);
    expect(active('/psd/manage/2026-W40')).toEqual(['수합 관리']);
    expect(active('/psd/manage/settings')).toEqual(['수합 관리']);
    // 이름이 비슷한 주소에 속지 않는다
    expect(active('/psd/manager')).toEqual([]);
  });
});

describe('RU-31·32 취합 메뉴 (TACP-21)', () => {
  it('[PG-T67] 본부 담당자 — `본부 취합`이 부서 메뉴 다음, 전사 메뉴 앞에 (넓어지는 순서)', () => {
    const l = labels({ isLead: true, hqDesk: true });
    expect(l).toContain('본부 취합');
    expect(l.indexOf('수합 관리')).toBeLessThan(l.indexOf('본부 취합'));
    expect(labels({ isLead: true })).not.toContain('본부 취합');
  });

  it('[PG-T68] 총괄 — 전사 메뉴는 `전사` **하나**. 「전사 현황」·「전사 취합」 두 메뉴로 나뉘지 않는다 (PG-49e)', () => {
    const l = labels({ readAll: true, orgDesk: true });
    expect(l.filter((x) => x.startsWith('전사'))).toEqual(['전사']);
    expect(l).not.toContain('전사 현황');
    expect(l).not.toContain('전사 취합');
    expect(labels({ isLead: true })).not.toContain('전사');
  });
});

describe('PG-49f 「전사」 메뉴 하나 · 화면 하나', () => {
  const nav = (r: Partial<NavRole>) => buildNav({ ...base, ...r });
  const lit = (items: ReturnType<typeof buildNav>, path: string) =>
    items.filter((i) => isNavActive(i.href, path, items, 'psd')).map((i) => i.label);

  it('[PG-T74] ★ `전사`는 주소 하나(/org) — 누가 보든 같은 곳으로 가고 거기서 불이 들어온다. 탭 주소를 거느리지 않는다', () => {
    const op = nav({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    const coord = nav({ readAll: true, orgDesk: true });
    for (const items of [op, coord]) {
      expect(items.find((i) => i.label === '전사')).toEqual({ href: '/org', label: '전사' });
      expect(lit(items, '/org')).toEqual(['전사']);
    }
    // 옛 탭 시절의 「같이 속하는 주소」(also)가 남아 있지 않다
    expect(op.some((i) => 'also' in i)).toBe(false);
  });

  it('[PG-T75] `/ops`·`/ops/audit`에서는 `전사`가 켜지지 않는다 — 운영 화면은 운영 메뉴의 것이다', () => {
    const op = nav({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    for (const p of ['/ops', '/ops/audit']) {
      expect(lit(op, p), p).toEqual(['운영']);
    }
    // 이름이 비슷한 주소에 속지 않는다 — 앞부분 글자가 아니라 경로 마디로 본다
    expect(lit(op, '/organization')).toEqual([]);
  });

  it('[PG-T76] 3단계가 꺼진 총괄(취합 없음)에게도 `전사`는 /org — 화면이 제출 열만으로 선다 (PG-51d)', () => {
    const coordOff = nav({ readAll: true, orgDesk: false });
    expect(coordOff.find((i) => i.label === '전사')).toEqual({ href: '/org', label: '전사' });
    expect(lit(coordOff, '/org')).toEqual(['전사']);
  });

  it('[PG-T77] 전 부서 읽기 없이 취합만 열 수 있어도 `전사`는 /org — 화면의 문이 둘 중 하나면 열리므로 (PG-49f)', () => {
    const items = nav({ readAll: false, orgDesk: true });
    expect(items.find((i) => i.label === '전사')?.href).toBe('/org');
    expect(lit(items, '/org')).toEqual(['전사']);
  });
});
