// RS-T01~12 — 인원 최신화 계획기. **순수 함수라 DB 없이 못 박을 수 있다.**
//
// 이 테스트가 지키려는 것은 «잘 반영된다»가 아니라 **«잘못 반영되지 않는다»**이다.
// 엑셀 한 번 잘못 뽑으면 멀쩡한 사람 수백 명이 잠기는 기능이므로,
// 안전장치가 도는지를 먼저 확인한다.
import { describe, expect, it } from 'vitest';
import {
  planRosterSync,
  deriveRole,
  deriveOnRoster,
  toErpPerson,
  MAX_DEACTIVATIONS,
  type DbPerson,
  type ErpPerson,
} from '@/server/roster/sync';

const person = (o: Partial<DbPerson> & { name: string }): DbPerson => ({
  id: `id-${o.name}`,
  email: `${o.name}@kei.re.kr`,
  divisionId: 'd1',
  divisionKo: '가부서',
  divisionRole: 'member',
  employeeNo: '10001',
  jobTitle: null,
  onRoster: true,
  rosterNote: null,
  isActive: true,
  isOperator: false,
  isCoordinator: false,
  ...o,
});

const erp = (o: Partial<ErpPerson> & { name: string }): ErpPerson => ({
  parentKo: '한국환경연구원',
  divisionKo: '가부서',
  employeeNo: '10001',
  jobTitle: '담당',
  email: `${o.name}@kei.re.kr`,
  ...o,
});

describe('직책 유도 (RS-05·06)', () => {
  it('[RS-T01] 실장·본부장·단장·센터장 → head', () => {
    for (const t of ['실장', '본부장', '단장', '센터장']) expect(deriveRole(t)).toBe('head');
  });

  it('[RS-T02] 원장·부원장은 head가 **아니다** — 부서의 장이 아니라 원장단이다', () => {
    for (const t of ['원장', '경영부원장', '연구부원장']) expect(deriveRole(t)).toBe('member');
  });

  it('[RS-T03] 이미 담당자면 직책이 실장이어도 담당자로 남는다 (ADR-0008)', () => {
    expect(deriveRole('실장', 'lead')).toBe('lead');
  });

  it('[RS-T04] 「담당」이 아니면 집계 제외 — 원장단도 실장도', () => {
    expect(deriveOnRoster('담당')).toBe(true);
    for (const t of ['원장', '연구부원장', '실장', '본부장']) expect(deriveOnRoster(t)).toBe(false);
  });
});

describe('보존 규칙 (RS-07·09)', () => {
  it('[RS-T05] 직책이 그대로면 아무것도 바꾸지 않는다 — 매주 돌아도 멱등이다', () => {
    const db = [person({ name: '가', jobTitle: '담당' })];
    const plan = planRosterSync(db, [erp({ name: '가' })], ['가부서']);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it('[RS-T06] **수동 예외를 지우지 않는다** — 휴직으로 뺀 사람을 「담당이니 넣어라」로 뒤집지 않는다', () => {
    // 직책이 처음 채워지는 순간(jobTitle: null)이 가장 위험하다
    const db = [person({ name: '휴직자', jobTitle: null, onRoster: false, rosterNote: '휴직' })];
    const plan = planRosterSync(db, [erp({ name: '휴직자', jobTitle: '담당' })], ['가부서']);
    // 사람이 볼 변경은 없다 — 승인 화면에 뜨지 않는다
    expect(plan.changes.find((x) => x.name === '휴직자')).toBeUndefined();
    // 그래도 직책은 **반드시 저장된다** (RS-16). 안 그러면 다음 주에도 「첫 채움」이라
    // 진짜 승진·보직변경을 영영 감지하지 못한다
    const b = plan.backfills.find((x) => x.name === '휴직자');
    expect(b?.apply.jobTitle).toBe('담당');
    expect(b?.apply.onRoster).toBeUndefined(); // 집계는 건드리지 않는다
    expect(b?.apply.rosterNote).toBeUndefined(); // 「휴직」 사유도 그대로
  });

  it('[RS-T06b] 기록용 채움은 두 번째 동기화에서 사라진다 — 한 번 저장되면 끝', () => {
    const db = [person({ name: '휴직자', jobTitle: '담당', onRoster: false, rosterNote: '휴직' })];
    const plan = planRosterSync(db, [erp({ name: '휴직자', jobTitle: '담당' })], ['가부서']);
    expect(plan.backfills).toHaveLength(0);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it('[RS-T07] 첫 채움에도 «직책상 제외»는 반영한다 — 부원장이 집계에 남아 있으면 안 된다', () => {
    const db = [person({ name: '부원장', jobTitle: null, onRoster: true })];
    const plan = planRosterSync(db, [erp({ name: '부원장', jobTitle: '연구부원장' })], ['가부서']);
    const c = plan.changes.find((x) => x.name === '부원장');
    expect(c?.apply.onRoster).toBe(false);
    expect(c?.apply.rosterNote).toBe('연구부원장');
  });

  it('[RS-T08] 직책이 **바뀌면** 양방향으로 따라간다 — 실장에서 담당으로 내려오면 집계에 든다', () => {
    const db = [person({ name: '전실장', jobTitle: '실장', divisionRole: 'head', onRoster: false, rosterNote: '실장' })];
    const plan = planRosterSync(db, [erp({ name: '전실장', jobTitle: '담당' })], ['가부서']);
    const c = plan.changes.find((x) => x.name === '전실장');
    expect(c?.apply.divisionRole).toBe('member');
    expect(c?.apply.onRoster).toBe(true);
    expect(c?.apply.rosterNote).toBeNull();
  });
});

describe('안전장치 (RS-10·11)', () => {
  it('[RS-T09] 한 번에 10명 넘게 사라지면 **막는다** — 필터 걸린 엑셀을 의심한다', () => {
    const db = Array.from({ length: 20 }, (_, i) => person({ name: `사람${i}`, employeeNo: `2000${i}` }));
    const plan = planRosterSync(db, [], ['가부서']);
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers[0]).toContain('20명');
  });

  it('[RS-T10] 허용 범위 안이면 막지 않는다 — 진짜 퇴사는 한두 명이다', () => {
    const db = Array.from({ length: 5 }, (_, i) => person({ name: `사람${i}`, employeeNo: `2000${i}` }));
    const keep = db.slice(1).map((u) => erp({ name: u.name, employeeNo: u.employeeNo! }));
    const plan = planRosterSync(db, keep, ['가부서']);
    expect(plan.blockers).toHaveLength(0);
    expect(plan.changes.filter((c) => c.kind === 'deactivate')).toHaveLength(1);
    expect(MAX_DEACTIVATIONS).toBe(10);
  });

  it('[RS-T11] **담당자가 사라지면 반드시 알린다** — 조용히 넘어가면 그 부서가 무주공산이 된다', () => {
    const db = [person({ name: '담당자', divisionRole: 'lead' }), person({ name: '남는이', employeeNo: '10002' })];
    const plan = planRosterSync(db, [erp({ name: '남는이', employeeNo: '10002' })], ['가부서']);
    expect(plan.leadWarnings.join()).toContain('담당자');
    expect(plan.leadWarnings.join()).toContain('가부서');
  });

  it('[RS-T12] 사번과 이메일이 다른 사람을 가리키면 **건너뛴다** — 남의 계정을 덮지 않는다', () => {
    const db = [
      person({ name: '갑', employeeNo: '10001', email: 'gap@kei.re.kr' }),
      person({ name: '을', employeeNo: '10002', email: 'eul@kei.re.kr' }),
    ];
    // 사번은 갑, 이메일은 을을 가리키는 행
    const plan = planRosterSync(db, [erp({ name: '병', employeeNo: '10001', email: 'eul@kei.re.kr' })], ['가부서']);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.changes.filter((c) => c.kind !== 'deactivate')).toHaveLength(0);
    // 두 사람 다 «매칭된 것»으로 쳐서 퇴사 처리되지 않는다
    expect(plan.changes.filter((c) => c.kind === 'deactivate')).toHaveLength(0);
  });
});

describe('변화 감지 (RS-08·12)', () => {
  it('[RS-T13] 사번이 같으면 이메일이 바뀌어도 같은 사람이다 — 개명·주소 정정', () => {
    const db = [person({ name: '옛이름', employeeNo: '10001', email: 'old@kei.re.kr', jobTitle: '담당' })];
    const plan = planRosterSync(db, [erp({ name: '새이름', employeeNo: '10001', email: 'new@kei.re.kr' })], ['가부서']);
    expect(plan.changes.filter((c) => c.kind === 'deactivate')).toHaveLength(0);
    const c = plan.changes[0];
    expect(c.apply.name).toBe('새이름');
    expect(c.apply.email).toBe('new@kei.re.kr');
  });

  it('[RS-T14] 부서 이동을 잡아낸다', () => {
    const db = [person({ name: '이동', divisionKo: '가부서', jobTitle: '담당' })];
    const plan = planRosterSync(db, [erp({ name: '이동', divisionKo: '나부서' })], ['가부서', '나부서']);
    expect(plan.changes[0].kind).toBe('move');
    expect(plan.changes[0].apply.divisionKo).toBe('나부서');
  });

  it('[RS-T15] 엑셀에만 있는 부서는 새로 만든다 (비활성으로)', () => {
    const plan = planRosterSync([], [erp({ name: '신입', divisionKo: '새부서' })], ['가부서']);
    expect(plan.newDivisions).toEqual([{ nameKo: '새부서', parentKo: '한국환경연구원' }]);
  });

  it('[RS-T16] 신규는 직책에서 역할·집계를 유도한다', () => {
    const plan = planRosterSync([], [erp({ name: '새실장', jobTitle: '실장' })], ['가부서']);
    const c = plan.changes[0];
    expect(c.kind).toBe('create');
    expect(c.apply.divisionRole).toBe('head');
    expect(c.apply.onRoster).toBe(false);
    expect(c.apply.rosterNote).toBe('실장');
  });

  it('[RS-T17] 비활성이던 사람이 엑셀에 다시 나타나면 되살린다 — 재입사', () => {
    const db = [person({ name: '복귀', isActive: false, jobTitle: '담당' })];
    const plan = planRosterSync(db, [erp({ name: '복귀' })], ['가부서']);
    expect(plan.changes[0].apply.isActive).toBe(true);
  });

  it('[RS-T18] 이름·이메일이 없는 행은 버린다 — 합계행·빈 행', () => {
    expect(toErpPerson({ 성명: '', 'E-MAIL': 'x@kei.re.kr' })).toBeNull();
    expect(toErpPerson({ 성명: '합계', 'E-MAIL': '' })).toBeNull();
    expect(toErpPerson({ 성명: '가', 'E-MAIL': 'a@kei.re.kr', 부서: '가부서', 직책: '담당', 사번: '1' })).not.toBeNull();
  });
});
