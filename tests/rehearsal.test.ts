// OPS-47 — 한 주 리허설의 각본과 판정 (scripts/rehearsal-plan.ts · scripts/fake-model.ts).
//
// 리허설 자체는 서버·스케줄러·시간이 있어야 돌아서 여기서 돌리지 않는다(docs/REHEARSAL.md의 절차 — local로 끝까지 확인).
// 여기서 고정하는 것은 판정이 틀리지 않는 것이다: 판정이 느슨하면 리허설은 늘 「통과」라고 말하고, 엄하면 늘 「실패」라고 말한다 —
// 둘 다 주말 내내 돌려도 아무것도 알려 주지 않는다.
import { describe, expect, it } from 'vitest';
import { EXISTING_MISSING, HQ_DIV, MIN, UNITS, expectNotices, judge, newPeople, type Expect, type Facts, type Received, type UnitFacts } from '../scripts/rehearsal-plan';
import { fakeModelReply } from '../scripts/fake-model';


const D = Date.parse('2026-10-10T14:00:00+09:00'); // 토요일 리허설 — 마감 14:00
const at = (m: number) => D + m * MIN;
const P = (id: string) => ({ email: `${id}@example.invalid`, name: id });

function unit(div: string, o: Partial<UnitFacts> & { head?: boolean } = {}): UnitFacts {
  const code = div;
  return {
    div,
    toHq: o.toHq ?? false,
    lead: P(`${code}-lead`),
    head: o.head === false ? null : P(`${code}-head`),
    missing: o.missing ?? [P(`${code}-m`)],
    submitted: o.submitted ?? 3,
    mergedAt: o.mergedAt === undefined ? at(1.5) : o.mergedAt,
    approvedAt: o.approvedAt ?? null,
    arrivedAt: o.arrivedAt ?? null,
  };
}

/** 각본 그대로 흘러간 한 주 — 실·팀 → 본부 D+40, 본부 → 총괄 D+50 */
function perfectWeek(): Facts {
  const unitDue = at(40);
  const hqDue = at(50);
  return {
    runStart: at(-12),
    deadline: D,
    unitDue,
    hqDue,
    units: [
      unit('pco', { toHq: true, approvedAt: at(11), arrivedAt: at(11) }),
      unit('ai', { toHq: true, approvedAt: at(15), arrivedAt: at(15) }),
      // 늦게 보는 부서장 — 기한 15분 전(D+25) 알림을 받고 30초 뒤에
      unit('hr', { toHq: true, approvedAt: at(25.5), arrivedAt: at(25.5) }),
      unit('ms', { toHq: true, head: false, arrivedAt: at(1.6) }), // 부서장 없음 — 마감 뒤 최종본이 저절로
      unit('ca', { approvedAt: at(12), arrivedAt: at(12) }),
      unit('ex', { head: false, arrivedAt: at(1.6) }),
      unit('ea', {}), // 승인 안 함
      unit('sd', { submitted: 0, mergedAt: null, missing: [P('sd-lead'), P('sd-m1')] }), // 아무도 안 냄
    ],
    hqHead: P('hq-head'),
    hqApprovedAt: at(35.5), // 「본부 → 총괄」 15분 전(D+35) 알림을 받고
    coordinators: [P('coord')],
  };
}

const keyOf = (e: Pick<Expect, 'kind' | 'to'>) => `${e.kind} ${e.to.email.replace('@example.invalid', '')}`;
const required = (es: Expect[]) => es.filter((e) => e.required).map(keyOf).sort();

describe('[OPS-T30] 각본 — 13개 단위 = 전사 최종본 13섹션, 확인할 길이 하나씩', () => {
  it('단위는 기본 섹션의 부서와 같다 — 본부(기획경영본부)는 섹션이 없다', async () => {
    // sections.ts는 DB 모듈을 불러 env 검사를 거친다 — 형식상 값을 채운다(DB는 열지 않는다)
    process.env.DATABASE_URL ??= 'file:./test-rehearsal.db';
    process.env.STORAGE_ROOT ??= '/tmp/tincase-test-rehearsal';
    process.env.CF_ACCESS_TEAM ??= 'test-team';
    const { DEFAULT_SECTIONS } = await import('@/server/rollup/sections');
    expect(UNITS.map((u) => u.div).sort()).toEqual(DEFAULT_SECTIONS.map((s) => s.division).sort());
    expect(UNITS.map((u) => u.div)).not.toContain(HQ_DIV);
    // 본부 단계로 가는 것은 기획경영본부 산하 다섯
    expect(UNITS.filter((u) => u.toHq).map((u) => u.div)).toEqual(['기획조정실', '연구관리실', 'AI홍보전략실', '인사관리실', '경영지원실']);
  });

  it('갈래가 다 있다 — 일찍 승인 · 늦게 승인(임박 알림 뒤) · 부서장 없음 · 승인 안 함 · 아무도 안 냄 (본부 산하·밖 모두)', () => {
    const has = (pred: (u: (typeof UNITS)[number]) => boolean) => [UNITS.some((u) => u.toHq && pred(u)), UNITS.some((u) => !u.toHq && pred(u))];
    expect(has((u) => u.approve?.after === 'merge_review')).toEqual([true, true]);
    expect(has((u) => u.approve?.after === 'ru_unit_due_soon')).toEqual([true, true]);
    expect(has((u) => !u.head)).toEqual([true, true]);
    expect(UNITS.some((u) => u.head && !u.approve && !u.nobody)).toBe(true);
    expect(UNITS.filter((u) => u.nobody)).toHaveLength(1);
  });

  it('새로 만드는 사람은 역할 이름뿐이다 — 지어낸 사람 이름도 쓰지 않는다(실명과 겹칠 길이 없다) · 모두 @example.invalid 앞부분', () => {
    const made = UNITS.flatMap(newPeople);
    expect(made.length).toBeGreaterThan(20);
    for (const p of made) {
      expect(p.name).toMatch(/(담당|부서장|부원\d)$/);
      expect(p.local).toMatch(/^rh-[a-z]{2}-(lead|head|m\d)$/);
    }
    expect(new Set(made.map((p) => p.local)).size).toBe(made.length);
    // 단위마다 안 낸 사람이 있다 — 10분 전 알림(NT-42)을 받을 사람
    for (const u of UNITS) {
      const missing = u.code ? newPeople(u).filter((p) => p.missing).length : (EXISTING_MISSING[u.div] ?? []).length;
      expect(missing, u.div).toBeGreaterThan(0);
    }
  });
});

describe('[OPS-T31] ★ 기대 알림 — 「누구에게 · 언제 · 한 번」', () => {
  it('각본대로 흘러간 한 주의 반드시 올 알림', () => {
    const es = expectNotices(perfectWeek());
    expect(required(es)).toEqual(
      [
        // NT-42 — 10분 전, 단위마다 안 낸 사람 (아무도 안 낸 곳은 전원)
        ...['pco-m', 'ai-m', 'hr-m', 'ms-m', 'ca-m', 'ex-m', 'ea-m', 'sd-lead', 'sd-m1'].map((p) => `deadline_10m ${p}`),
        // NT-40 +10분 — 창이 끝날 때까지 승인하지 않은 부서장에게 검토 요청 · 낸 사람이 없는 곳은 담당자에게 「병합본이 아직 없어요」
        'merge_review ai-head', // D+15에 승인 — 첫 틱(D+10) 뒤라 이미 나갔다
        'merge_review hr-head',
        'merge_review ea-head',
        'merge_missing sd-lead',
        // NT-40 +30분 — 부서장 없음 · 승인 안 함 · 아무도 안 냄. 그 전에 승인해 올라간 곳에는 없다(NT-47′ — hr은 D+25.5에 승인했다)
        ...['ms', 'ex', 'ea', 'sd'].map((u) => `merge_done ${u}-lead`),
        // NT-46′ — 승인 순간 담당자에게
        ...['pco', 'ai', 'hr', 'ca'].map((u) => `merge_approved ${u}-lead`),
        // RU-56a — 승인하지 않는 부서장 (늦게 보는 부서장은 받고 나서 승인하므로 「와도 되는」 쪽 — 아래)
        'ru_unit_due_soon ea-head',
        // RU-54 — 산하가 다 모인 순간(D+25.5 < 기한 D+40)
        'ru_hq_ready hq-head',
        // RU-57 — 본부 → 총괄 기한에 일부로 (ea·sd가 없다)
        'ru_org_ready coord',
      ].sort(),
    );
    // 받고 나서 움직이는 사람의 알림은 「와도 되는」 쪽으로 남는다 — 안 왔으면 리허설이 기다리다 넘긴 승인(note)이 실패로 잡는다
    const optional = es.filter((e) => !e.required).map(keyOf);
    expect(optional).toEqual(expect.arrayContaining(['merge_review pco-head', 'ru_unit_due_soon hr-head', 'ru_hq_due_soon hq-head']));
    // 부서장 없는 곳에는 검토 요청·임박 알림이 없다 · 일찍 승인한 곳에는 임박 알림이 없다
    expect(es.map(keyOf)).not.toContain('merge_review ms-head');
    expect(es.map(keyOf)).not.toContain('ru_unit_due_soon pco-head');
    expect(es.map(keyOf)).not.toContain('ru_hq_complete hq-head');
  });

  it('승인하지 않으면 「와도 되는」이 「반드시」가 된다 — 검토 요청·임박 알림을 놓치면 실패로 잡힌다', () => {
    const f = perfectWeek();
    f.units = f.units.map((u) => (u.div === 'pco' || u.div === 'hr' ? { ...u, approvedAt: null, arrivedAt: null } : u));
    f.hqApprovedAt = null;
    const r = required(expectNotices(f));
    expect(r).toEqual(expect.arrayContaining(['merge_review pco-head', 'ru_unit_due_soon pco-head', 'ru_unit_due_soon hr-head', 'ru_hq_due_soon hq-head', 'merge_done pco-lead']));
    // 산하가 다 모이지 않았다 → 「실·팀 → 본부」 기한에 일부로
    expect(expectNotices(f).find((e) => e.kind === 'ru_hq_ready')?.from).toBe(f.unitDue);
  });

  it('병합이 늦게 끝나면 창도 늦게 연다(HM-50) — 대외 마감(+60분) 뒤에 끝난 병합에는 안내가 없다', () => {
    const f = perfectWeek();
    f.units = [unit('slow', { mergedAt: at(23) }), unit('late', { mergedAt: at(61) })];
    const es = expectNotices(f);
    expect(es.find((e) => keyOf(e) === 'merge_review slow-head')?.from).toBe(at(23));
    expect(es.find((e) => keyOf(e) === 'merge_done slow-lead')?.from).toBe(at(30));
    expect(es.map(keyOf)).not.toContain('merge_review late-head');
    expect(es.map(keyOf)).not.toContain('merge_done late-lead');
  });

  it('리허설을 시작하기 전에 지난 창은 기대하지 않는다 · 창 도중에 시작했으면 「와도 되는」 (알림은 소급하지 않는다, NT-43)', () => {
    const late = { ...perfectWeek(), runStart: at(-8) }; // 10분 전 창(D-10~D-7) 도중
    expect(expectNotices(late).filter((e) => e.kind === 'deadline_10m').every((e) => !e.required)).toBe(true);
    const later = { ...perfectWeek(), runStart: at(-5) };
    expect(expectNotices(later).filter((e) => e.kind === 'deadline_10m')).toEqual([]);
    // 한 시간 전(D-60)에 시작하면 1시간 전 알림도 반드시
    const early = { ...perfectWeek(), runStart: at(-61) };
    expect(expectNotices(early).filter((e) => e.kind === 'deadline_1h' && e.required).length).toBe(9);
  });
});

describe('[OPS-T32] ★ 판정 — 한 번, 창 안에, 그 사람에게. 뜻밖의 것도 실패', () => {
  const e = (kind: string, who: string, from: number, until: number, req = true): Expect => ({ kind, to: P(who), from, until, required: req, why: '' });
  const r = (kind: string, who: string, t: number): Received => ({ at: t, kind, email: `${who}@example.invalid`, employeeNo: 'X', subject: '' });

  it('창 안에 한 번 → 통과', () => {
    const v = judge([e('merge_review', 'a', at(10), at(22))], [r('merge_review', 'a', at(10.2))]);
    expect(v.ok).toBe(true);
  });
  it('두 번 → 실패 (같은 말을 두 번 하면 두 번째부터 안 읽힌다)', () => {
    const v = judge([e('merge_review', 'a', at(10), at(22))], [r('merge_review', 'a', at(10.2)), r('merge_review', 'a', at(11.2))]);
    expect(v.ok).toBe(false);
    expect(v.rows[0].problem).toBe('두 번 이상 왔다');
  });
  it('창 밖 → 실패 · 안 옴 → 실패 · 「와도 되는」이 안 옴 → 통과', () => {
    expect(judge([e('merge_done', 'a', at(30), at(42))], [r('merge_done', 'a', at(50))]).rows[0].problem).toBe('창 밖에 왔다');
    expect(judge([e('merge_done', 'a', at(30), at(42))], []).rows[0].problem).toBe('안 왔다');
    expect(judge([e('merge_done', 'a', at(30), at(42), false)], []).ok).toBe(true);
  });
  it('기대하지 않은 알림 · 다른 사람에게 간 알림은 뜻밖으로 실패', () => {
    const v = judge([e('merge_review', 'a', at(10), at(22))], [r('merge_review', 'a', at(10.5)), r('merge_review', 'b', at(10.5)), r('ru_hq_reapprove:x', 'h', at(30))]);
    expect(v.ok).toBe(false);
    expect(v.unexpected.map((x) => `${x.kind} ${x.email}`)).toEqual(['merge_review b@example.invalid', 'ru_hq_reapprove:x h@example.invalid']);
  });
  it('종류에 붙은 꼬리(`merge_approved:<승인 id>`)는 앞부분으로 맞춘다 · 승인이 둘이면 둘 다 짝지어진다', () => {
    const v = judge(
      [e('merge_approved', 'a', at(11), at(13)), e('merge_approved', 'a', at(20), at(22))],
      [r('merge_approved:r1', 'a', at(11.1)), r('merge_approved:r2', 'a', at(20.1))],
    );
    expect(v.ok).toBe(true);
  });
});

describe('[OPS-T33] 가짜 병합 모델 — 묶을 것 없음 · 분류는 첫 이름 · 데우기는 빈 답', () => {
  it('요청의 format(스키마)을 보고 답한다 — 앱의 검증을 통과하는 모양', () => {
    expect(JSON.parse(fakeModelReply({ format: { properties: { duplicates: {} } } }))).toEqual({ duplicates: [] });
    const assign = JSON.parse(fakeModelReply({ format: { properties: { assign: { properties: { '1': { enum: ['AI', '홍보', '기타'] }, '2': { enum: ['AI', '홍보', '기타'] } } } } } }));
    expect(assign).toEqual({ assign: { '1': 'AI', '2': 'AI' } });
    expect(fakeModelReply({})).toBe('');
  });
});
