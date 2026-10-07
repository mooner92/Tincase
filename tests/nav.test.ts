// PG-03·PG-49 — 역할별 상단 메뉴.
//
// 2026-10-06에 총괄(기획조정실)이 로그인해 보니 전 부서 열람 권한은 있는데 **그 화면으로 가는
// 메뉴가 없었다.** 권한(TACP)은 맞았고 길이 빠져 있었다. 어느 역할에 무엇이 보이는지를 여기서 고정한다.
import { describe, expect, it } from 'vitest';
import { buildNav, isNavActive, type NavRole } from '@/lib/nav';

const base: NavRole = { slug: 'psd', foreign: false, isLead: false, isOperator: false, readAll: false };
const labels = (r: Partial<NavRole>) => buildNav({ ...base, ...r }).map((i) => i.label);

describe('PG-49 역할별 메뉴', () => {
  it('[PG-T60] 부서원 — 자기 부서 메뉴뿐. 전사·운영 메뉴는 없다 (P5)', () => {
    expect(labels({})).toEqual(['제출', '보관함', '내 이력', '사용 안내']);
  });

  it('[PG-T61] 부서 담당자 — 수합 관리·부서 설정이 붙지만 타 부서로 가는 길은 없다 (P5)', () => {
    const l = labels({ isLead: true });
    expect(l).toContain('수합 관리');
    expect(l).not.toContain('전사');
    expect(l).not.toContain('운영');
  });

  it('[PG-T62] ★ 총괄 — `전사`가 보이고(/ops/monitor로 들어간다) `운영`은 안 보인다', () => {
    // 기획조정실 총괄: 부서원 + 총괄. 업무일지 내용은 전권, 인원·페이지 관리는 아니다
    const items = buildNav({ ...base, readAll: true });
    expect(items.map((i) => i.label)).toContain('전사');
    expect(items.find((i) => i.label === '전사')?.href).toBe('/ops/monitor');
    expect(items.map((i) => i.label)).not.toContain('운영');
  });

  it('[PG-T63] 운영자 — `전사`와 `운영`을 둘 다 본다 (열람과 관리는 하는 일이 다르다)', () => {
    const l = labels({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    expect(l).toContain('전사');
    expect(l).toContain('운영');
    expect(l.indexOf('전사')).toBeLessThan(l.indexOf('운영'));
  });

  it('[PG-T64] 타 부서 열람 중 — `내 이력`은 없다 (남의 부서에 내 이력은 없다)', () => {
    expect(labels({ foreign: true, readAll: true, isLead: true })).not.toContain('내 이력');
    expect(labels({ foreign: true, readAll: true })[0]).toBe('개요');
  });
});

describe('PG-49 활성 메뉴 판정', () => {
  const op = buildNav({ ...base, isLead: true, isOperator: true, readAll: true, orgDesk: true });
  const active = (path: string) => op.filter((i) => isNavActive(i.href, path, op, 'psd')).map((i) => i.label);

  it('[PG-T65] 전사 현황을 보는 동안 `운영`이 같이 켜지지 않는다 (/ops/monitor는 /ops 아래지만 다른 메뉴)', () => {
    expect(active('/ops/monitor')).toEqual(['전사']);
    expect(active('/ops/monitor/graph')).toEqual(['전사']);
    expect(active('/ops')).toEqual(['운영']);
    expect(active('/ops/audit')).toEqual(['운영']);
  });

  it('[PG-T66] 부서 메뉴 — 제출·수합 관리·부서 설정이 서로 겹쳐 켜지지 않는다', () => {
    expect(active('/psd')).toEqual(['제출']);
    expect(active('/psd/manage')).toEqual(['수합 관리']);
    expect(active('/psd/manage/2026-W40')).toEqual(['수합 관리']);
    expect(active('/psd/manage/settings')).toEqual(['부서 설정']);
  });
});

describe('RU-31·32 취합 메뉴 (TACP-21)', () => {
  it('[PG-T67] 본부 담당자 — `본부 취합`이 부서 메뉴 다음, 전사 메뉴 앞에 (넓어지는 순서)', () => {
    const l = labels({ isLead: true, hqDesk: true });
    expect(l).toContain('본부 취합');
    expect(l.indexOf('부서 설정')).toBeLessThan(l.indexOf('본부 취합'));
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

describe('PG-49e 「전사」 메뉴 하나 · 탭 둘', () => {
  const nav = (r: Partial<NavRole>) => buildNav({ ...base, ...r });
  const lit = (items: ReturnType<typeof buildNav>, path: string) =>
    items.filter((i) => isNavActive(i.href, path, items, 'psd')).map((i) => i.label);

  it('[PG-T74] ★ [취합] 탭(/org)에 있는 동안에도 `전사`에 불이 들어온다 — 다른 메뉴로 나온 것처럼 보이지 않는다', () => {
    const op = nav({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    expect(lit(op, '/org')).toEqual(['전사']);
    const coord = nav({ readAll: true, orgDesk: true });
    expect(lit(coord, '/ops/monitor')).toEqual(['전사']);
    expect(lit(coord, '/org')).toEqual(['전사']);
  });

  it('[PG-T75] `/ops`·`/ops/audit`에서는 `전사`가 켜지지 않는다 — 운영 화면은 운영 메뉴의 것이다', () => {
    const op = nav({ isLead: true, isOperator: true, readAll: true, orgDesk: true });
    for (const p of ['/ops', '/ops/audit']) {
      expect(lit(op, p), p).toEqual(['운영']);
    }
    // 이름이 비슷한 주소에 속지 않는다 — 앞부분 글자가 아니라 경로 마디로 본다
    expect(lit(op, '/organization')).toEqual([]);
  });

  it('[PG-T76] [취합]을 못 여는 사람에게는 `전사`가 /org를 거느리지 않는다 (TACP-9 — 3단계가 꺼진 총괄)', () => {
    const coordOff = nav({ readAll: true, orgDesk: false });
    expect(coordOff.find((i) => i.label === '전사')).toMatchObject({ href: '/ops/monitor', also: [] });
    expect(lit(coordOff, '/org')).toEqual([]);
  });

  it('[PG-T77] [현황]을 못 여는데 [취합]만 열 수 있으면 `전사`는 /org로 바로 간다 — 누르자마자 404인 링크를 주지 않는다', () => {
    const items = nav({ readAll: false, orgDesk: true });
    expect(items.find((i) => i.label === '전사')?.href).toBe('/org');
    expect(lit(items, '/org')).toEqual(['전사']);
  });
});
