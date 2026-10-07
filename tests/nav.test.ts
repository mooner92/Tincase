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
    expect(l).not.toContain('전사 현황');
    expect(l).not.toContain('운영');
  });

  it('[PG-T62] ★ 총괄 — `전사 현황`이 보이고 `운영`은 안 보인다', () => {
    // 기획조정실 총괄: 부서원 + 총괄. 업무일지 내용은 전권, 인원·페이지 관리는 아니다
    const items = buildNav({ ...base, readAll: true });
    expect(items.map((i) => i.label)).toContain('전사 현황');
    expect(items.find((i) => i.label === '전사 현황')?.href).toBe('/ops/monitor');
    expect(items.map((i) => i.label)).not.toContain('운영');
  });

  it('[PG-T63] 운영자 — `전사 현황`과 `운영`을 둘 다 본다 (열람과 관리는 하는 일이 다르다)', () => {
    const l = labels({ isLead: true, isOperator: true, readAll: true });
    expect(l).toContain('전사 현황');
    expect(l).toContain('운영');
    expect(l.indexOf('전사 현황')).toBeLessThan(l.indexOf('운영'));
  });

  it('[PG-T64] 타 부서 열람 중 — `내 이력`은 없다 (남의 부서에 내 이력은 없다)', () => {
    expect(labels({ foreign: true, readAll: true, isLead: true })).not.toContain('내 이력');
    expect(labels({ foreign: true, readAll: true })[0]).toBe('개요');
  });
});

describe('PG-49 활성 메뉴 판정', () => {
  const op = buildNav({ ...base, isLead: true, isOperator: true, readAll: true });
  const active = (path: string) => op.filter((i) => isNavActive(i.href, path, op, 'psd')).map((i) => i.label);

  it('[PG-T65] 전사 현황을 보는 동안 `운영`이 같이 켜지지 않는다 (/ops/monitor는 /ops 아래지만 다른 메뉴)', () => {
    expect(active('/ops/monitor')).toEqual(['전사 현황']);
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

  it('[PG-T68] 총괄 — `전사 현황` 다음에 `전사 취합`. 부서원·담당자에게는 없다', () => {
    const l = labels({ readAll: true, orgDesk: true });
    expect(l.indexOf('전사 현황')).toBeLessThan(l.indexOf('전사 취합'));
    expect(labels({ isLead: true })).not.toContain('전사 취합');
    const nav = buildNav({ ...base, readAll: true, orgDesk: true });
    expect(nav.filter((i) => isNavActive(i.href, '/org', nav, 'psd')).map((i) => i.label)).toEqual(['전사 취합']);
  });
});
