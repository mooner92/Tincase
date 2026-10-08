/**
 * OPS-47 — 한 주 리허설(`scripts/rehearsal.ts`)의 **각본과 판정**. DB도 서버도 만지지 않는다 — 그래서 시험할 수 있다(tests/rehearsal.test.ts).
 *
 * 각본: 13개 단위(전사 최종본 섹션 하나씩)마다 누가 안 내고, 부서장이 언제 승인하나. 본부장(기획경영본부)도.
 * 판정: 실제로 일어난 일(병합이 끝난 시각 · 승인한 시각 · 위로 올라간 시각)을 받아 **어느 알림이 누구에게 언제 한 번** 가야 했는지 계산하고,
 *       가짜 알림 수신함(NT-56)의 기록과 맞춘다. 알림 규칙은 src/server/notify·rollup/notices의 것을 그대로 옮겨 적었다 —
 *       코드를 불러 쓰지 않는 이유: 리허설은 그 코드를 **밖에서** 확인하는 것이다. 같은 함수로 기대값을 만들면 틀린 것도 맞다고 나온다.
 */
import { dayBeforeAt } from '../src/lib/week';
import { kindBase } from '../src/lib/messenger-sink';

export const MIN = 60_000;

// ── 각본 ────────────────────────────────────────────────────────────────────

/** 부서장이 언제 승인하나 — 받은 알림을 보고(사람처럼) */
export type ApproveWhen =
  /** 검토 요청(NT-40 merge_review)을 받고 나서, 마감 + earliest분보다 이르지 않게 */
  | { after: 'merge_review'; earliest: number }
  /** 기한 15분 전 알림(RU-56a ru_unit_due_soon)을 받고 나서 — 늦게 보는 부서장 */
  | { after: 'ru_unit_due_soon' }
  /** 승인하지 않는다 */
  | null;

export interface UnitScript {
  /** 부서 이름 (Division.nameKo — 전사 섹션이 이 이름으로 부서를 찾는다) */
  div: string;
  /** 리허설이 만드는 사람의 이메일 앞부분 머리 — 가짜 조직(fake-org)에 이미 있는 단위는 null */
  code: string | null;
  /** 기획경영본부 산하(본부 단계로 간다) */
  toHq: boolean;
  /** 부서장이 있나 — 없으면 마감 뒤 최종본이 저절로 올라간다(RU-71) */
  head: boolean;
  /** 새로 만드는 단위의 부원 수(담당 빼고) */
  members: number;
  /** 아무도 내지 않는다 */
  nobody?: boolean;
  approve: ApproveWhen;
}

/**
 * 13개 단위 — 2026-10-12(월)부터 전 섹션이 Tincase다. 각 줄이 확인하는 것:
 *   일찍 승인(검토 요청 뒤)   → NT-46′ 담당자 「승인 완료 — 올라갔어요」 · +30분 안내 없음(NT-47′)
 *   늦게 승인(기한 임박 뒤)    → RU-56a 부서장 「15분 남았어요」 · +30분 안내 「승인 전」
 *   부서장 없음               → 마감 뒤 최종본이 저절로 위로(RU-71) · +30분 「올라갔어요」
 *   승인 안 함                → 임박 알림 · 전사본은 일부로(RU-57)
 *   아무도 안 냄              → 10분 전 알림 전원 · 「병합본이 아직 없어요」(NT-40 merge_missing)
 */
export const UNITS: UnitScript[] = [
  { div: '기획조정실', code: null, toHq: true, head: true, members: 0, approve: { after: 'merge_review', earliest: 11 } },
  { div: '연구관리실', code: null, toHq: true, head: true, members: 0, approve: { after: 'merge_review', earliest: 13 } },
  { div: 'AI홍보전략실', code: null, toHq: true, head: true, members: 0, approve: { after: 'merge_review', earliest: 15 } },
  { div: '인사관리실', code: 'hr', toHq: true, head: true, members: 3, approve: { after: 'ru_unit_due_soon' } },
  { div: '경영지원실', code: 'ms', toHq: true, head: false, members: 3, approve: null },
  { div: '기후대기전략연구본부', code: null, toHq: false, head: true, members: 0, approve: { after: 'merge_review', earliest: 12 } },
  { div: '임원실', code: 'ex', toHq: false, head: false, members: 2, approve: null },
  { div: '글로벌대외협력단', code: 'gc', toHq: false, head: true, members: 2, approve: { after: 'merge_review', earliest: 14 } },
  { div: '생활환경연구본부', code: 'le', toHq: false, head: true, members: 3, approve: { after: 'merge_review', earliest: 16 } },
  { div: '국토환경연구본부', code: 'la', toHq: false, head: false, members: 3, approve: null },
  { div: '환경평가본부', code: 'ea', toHq: false, head: true, members: 2, approve: null },
  { div: '국가기후위기적응센터', code: 'ad', toHq: false, head: true, members: 2, approve: { after: 'ru_unit_due_soon' } },
  { div: '국가지속가능발전연구센터', code: 'sd', toHq: false, head: true, members: 2, nobody: true, approve: null },
];

export const HQ_DIV = '기획경영본부';
/** 본부장은 「본부 → 총괄」 기한 15분 전 알림(RU-56)을 받고 나서 승인한다 */
export const HQ_APPROVE_AFTER = 'ru_hq_due_soon';

/** 가짜 조직(fake-org)에 이미 있는 넷의 안 낸 사람 (이메일 앞부분) */
export const EXISTING_MISSING: Record<string, string[]> = {
  AI홍보전략실: ['member2', 'ai-10'],
  기획조정실: ['pc-05'],
  연구관리실: ['rm-04'],
  기후대기전략연구본부: ['ca-06'],
};

/** 새 단위의 사람 — 이름은 역할 그대로(지어낸 사람 이름도 쓰지 않는다 — 실명과 겹칠 길이 없다) */
export function newPeople(u: UnitScript): { local: string; name: string; role: 'lead' | 'head' | 'member'; missing: boolean }[] {
  if (!u.code) return [];
  const short = SHORT[u.div] ?? u.div;
  const out: { local: string; name: string; role: 'lead' | 'head' | 'member'; missing: boolean }[] = [
    { local: `rh-${u.code}-lead`, name: `${short}담당`, role: 'lead', missing: !!u.nobody },
  ];
  if (u.head) out.push({ local: `rh-${u.code}-head`, name: `${short}부서장`, role: 'head', missing: false });
  for (let i = 1; i <= u.members; i++) {
    // 마지막 한 명은 안 낸다 — 10분 전 알림(NT-42)을 받을 사람
    out.push({ local: `rh-${u.code}-m${i}`, name: `${short}부원${i}`, role: 'member', missing: !!u.nobody || i === u.members });
  }
  return out;
}

const SHORT: Record<string, string> = {
  인사관리실: '인사',
  경영지원실: '경영지원',
  임원실: '임원',
  글로벌대외협력단: '글로벌',
  생활환경연구본부: '생활환경',
  국토환경연구본부: '국토환경',
  환경평가본부: '환경평가',
  국가기후위기적응센터: '적응센터',
  국가지속가능발전연구센터: '지속가능',
};

// ── 판정 ────────────────────────────────────────────────────────────────────

export interface Person {
  email: string;
  name: string;
}

/** 리허설이 끝난 뒤 본 사실들 — 시각은 ms */
export interface UnitFacts {
  div: string;
  toHq: boolean;
  lead: Person;
  head: Person | null;
  /** 끝까지 안 낸 사람(제출 대상 — 담당 포함, 부서장 빼고) */
  missing: Person[];
  /** 마감 때 낸 사람 수 */
  submitted: number;
  /** 마감 뒤 처음 성공한 병합이 끝난 시각 (없으면 null) */
  mergedAt: number | null;
  /** 부서장이 승인한 시각 (없으면 null) */
  approvedAt: number | null;
  /** 위로 올라간(사본이 생긴) 시각 — 승인 또는 부서장 없는 단위의 자동 (없으면 null) */
  arrivedAt: number | null;
}

export interface Facts {
  /** 리허설을 시작한 시각 — 그 전의 알림은 보지 않는다 */
  runStart: number;
  /** 부서 마감 */
  deadline: number;
  /** 「실·팀 → 본부」 · 「본부 → 총괄」 기한 */
  unitDue: number;
  hqDue: number;
  units: UnitFacts[];
  hqHead: Person;
  hqApprovedAt: number | null;
  coordinators: Person[];
  /** 「병합 점검」을 받는 사람 — 운영자 ∪ 총괄이 있는 부서의 lead (활성 · 알림 켬 · 사번 있음 — TACP-30 · NT-60) */
  batchAudience: Person[];
}

export interface Expect {
  /** NotifyLog 종류 앞부분 (kindBase) */
  kind: string;
  to: Person;
  from: number;
  until: number;
  /** false면 「와도 되고 안 와도 된다」(경계에 걸린 경우) — 오면 한 번, 창 안이어야 한다 */
  required: boolean;
  why: string;
}

/** 스케줄러 창(12분) · 마감 전 최후 알림 창(3분) — src/server/notify·rollup/notices와 같은 값 */
const WINDOW = 12;
const LAST_CALL_WINDOW = 3;
const REVIEW = 10;
const SUBMIT = 30;
const LATE_LIMIT = 60;
const DUE_SOON = 15;
/** 판정 여유 — 1분 주기 스케줄러가 창 안의 첫 틱에 보내고, 받는 데 몇 초 걸린다 */
const SLACK_BEFORE = 5_000;
const SLACK_AFTER = 90_000;
/** 사건 알림(승인 순간·다 모인 순간)이 늦어도 되는 만큼 — 요청 뒤(after())에서 바로 보낸다 */
const EVENT_SLACK = 2 * MIN;
/** 창이 열린 뒤 스케줄러의 첫 틱까지 — 1분 주기 + 한 바퀴 일하는 시간 */
const FIRST_TICK = 2 * MIN;
/** 자동 병합은 마감 +1분부터(HM-25) · 「병합 점검」 첫 통은 줄이 빈 순간, 늦어도 마감 +15분(HM-54b) */
const MERGE_DELAY = 1;
const BATCH_BY = 15;

/**
 * 「이 사람에게 이 알림이 [창] 안에 한 번」의 목록. 규칙은 messenger.md §4·4-2·4-3의 표 그대로:
 * 시각 알림은 창이 리허설 시작 전에 끝났으면 기대하지 않고, 창 도중에 시작했으면 「와도 된다」로 둔다.
 */
export function expectNotices(f: Facts): Expect[] {
  const out: Expect[] = [];
  const at = (m: number) => f.deadline + m * MIN;
  const push = (e: Omit<Expect, 'from' | 'until'> & { from: number; until: number }) => out.push(e);
  /** 시각 알림 하나 — 창 [start, start+w분]. 리허설 시작 기준으로 반드시·혹시·아님 */
  const timed = (kind: string, to: Person, start: number, w: number, why: string, required = true) => {
    const end = start + w * MIN;
    if (end < f.runStart) return; // 시작 전에 끝난 창 — 알림은 소급하지 않는다(NT-43)
    push({ kind, to, from: start, until: end, required: required && start >= f.runStart + 30_000, why });
  };
  /**
   * 승인하면 안 가는 알림 — 창이 열린 뒤 **첫 틱**(1분 주기)에 판정한다. 창이 열리기 전에 승인했으면 없음, 첫 틱 언저리(2분 안)면 혹시,
   * 그 뒤(또는 안 함)면 반드시 — 첫 틱에 이미 나갔다.
   */
  const unlessApproved = (approvedAt: number | null, start: number) =>
    approvedAt === null || approvedAt > start + FIRST_TICK ? 'required' : approvedAt < start - SLACK_BEFORE ? 'none' : 'optional';

  // NT-41 · NT-10 · NT-42 — 마감 전 미제출자
  const stages: [string, number, number][] = [
    ['deadline_1d', dayBeforeAt(new Date(f.deadline), '11:45').getTime(), WINDOW],
    ['deadline_1h', at(-60), WINDOW],
    ['deadline_10m', at(-10), LAST_CALL_WINDOW],
  ];
  for (const u of f.units) {
    for (const [kind, start, w] of stages) for (const p of u.missing) timed(kind, p, start, w, `${u.div} 미제출`);
  }

  for (const u of f.units) {
    const settled = u.mergedAt;
    // NT-40 — +10분: 성공이면 부서장에게 검토 요청, 낸 사람이 없으면 담당자에게 「병합본이 아직 없어요」. 창은 병합이 끝난 뒤에 연다(HM-50)
    if (u.submitted === 0) {
      timed('merge_missing', u.lead, at(REVIEW), WINDOW, `${u.div} 낸 사람 없음`);
    } else if (u.head && settled !== null) {
      const start = Math.max(at(REVIEW), settled);
      const v = unlessApproved(u.approvedAt, start);
      if (start <= at(LATE_LIMIT) && v !== 'none') timed('merge_review', u.head, start, WINDOW, `${u.div} 병합본 검토`, v === 'required');
    }
    // NT-40 · NT-47′ — +30분 담당자. 3단계에서 부서장이 승인해 이미 올라갔으면 없다
    {
      const start = Math.max(at(SUBMIT), settled ?? at(SUBMIT));
      if (start <= at(LATE_LIMIT)) {
        const v = u.submitted > 0 && u.head ? unlessApproved(u.approvedAt, start) : 'required';
        if (v !== 'none') timed('merge_done', u.lead, start, WINDOW, `${u.div} 마지막 안내`, v === 'required');
      }
    }
    // NT-46′ — 승인 순간 담당자에게
    if (u.approvedAt !== null) {
      push({ kind: 'merge_approved', to: u.lead, from: u.approvedAt, until: u.approvedAt + EVENT_SLACK, required: true, why: `${u.div} 승인` });
    }
    // RU-56a — 그 단위 기한 15분 전, 마감 뒤 병합본이 승인 전이면 부서장에게
    if (u.head && settled !== null) {
      const start = (u.toHq ? f.unitDue : f.hqDue) - DUE_SOON * MIN;
      if (settled <= start) {
        const v = unlessApproved(u.approvedAt, start);
        if (v !== 'none') timed('ru_unit_due_soon', u.head, start, WINDOW, `${u.div} 기한 임박`, v === 'required');
      } else if (settled <= start + WINDOW * MIN) {
        timed('ru_unit_due_soon', u.head, start, WINDOW, `${u.div} 기한 임박(병합이 창 안에 끝남)`, false);
      }
    }
  }

  // NT-60 · HM-54 — 「병합 점검」: 운영자와 기획조정실 담당에게. 첫 통은 줄이 빈 순간(늦어도 +15분) — 그때 남은 부서가 있었으면
  // 다 끝나는 순간 「완료」 한 통 더. 낸 사람이 있는 단위가 다 병합돼야 「다 끝남」이다(없는 단위는 「제출 없음」으로 끝난 것)
  {
    const merging = f.units.filter((u) => u.submitted > 0);
    const lastMerged = merging.every((u) => u.mergedAt !== null) ? Math.max(f.deadline, ...merging.map((u) => u.mergedAt!)) : null;
    const firstEnd = at(BATCH_BY) + FIRST_TICK;
    for (const p of f.batchAudience) {
      if (firstEnd < f.runStart) continue; // 첫 통의 창이 시작 전에 끝났다 — 「완료」도 그 첫 통이 있어야 간다
      timed('merge_batch', p, at(MERGE_DELAY), BATCH_BY - MERGE_DELAY + FIRST_TICK / MIN, '병합 점검');
      if (lastMerged === null || lastMerged + FIRST_TICK < at(BATCH_BY)) continue; // 다 끝나지 않았다 · 첫 통이 이미 「다 끝남」
      const required = lastMerged > at(BATCH_BY) + FIRST_TICK; // +15분에 남은 곳이 있었다 — 첫 통이 「n곳 남음」
      push({ kind: 'merge_batch_done', to: p, from: required ? lastMerged : Math.min(lastMerged, at(BATCH_BY)), until: lastMerged + FIRST_TICK, required, why: '병합 점검 완료' });
    }
  }

  // RU-54 — 본부장: 산하가 다 모인 순간, 아니면 「실·팀 → 본부」 기한에 일부로 (그 뒤 다 모이면 한 번 더)
  const hqUnits = f.units.filter((u) => u.toHq);
  const all = hqUnits.every((u) => u.arrivedAt !== null) ? Math.max(...hqUnits.map((u) => u.arrivedAt!)) : null;
  const anyBy = (t: number) => hqUnits.some((u) => u.arrivedAt !== null && u.arrivedAt <= t);
  if (all !== null && all < f.unitDue) {
    push({ kind: 'ru_hq_ready', to: f.hqHead, from: all, until: all + EVENT_SLACK, required: true, why: '본부 산하 다 모임' });
  } else {
    if (anyBy(f.unitDue) && (f.hqApprovedAt === null || f.hqApprovedAt > f.unitDue)) {
      timed('ru_hq_ready', f.hqHead, f.unitDue, WINDOW, '「실·팀 → 본부」 기한 — 일부');
      if (all !== null) {
        const kind = f.hqApprovedAt === null || all < f.hqApprovedAt ? 'ru_hq_complete' : 'ru_hq_reapprove';
        push({ kind, to: f.hqHead, from: all, until: all + EVENT_SLACK, required: true, why: '기한 뒤 다 모임' });
      }
    } else if (all !== null) {
      push({ kind: 'ru_hq_ready', to: f.hqHead, from: all, until: all + EVENT_SLACK, required: true, why: '본부 산하 다 모임(기한 뒤)' });
    }
  }
  // RU-56 — 「본부 → 총괄」 기한 15분 전, 본부본이 승인을 기다리면 본부장에게
  {
    const start = f.hqDue - DUE_SOON * MIN;
    if (anyBy(start)) {
      const v = unlessApproved(f.hqApprovedAt, start);
      if (v !== 'none') timed('ru_hq_due_soon', f.hqHead, start, WINDOW, '「본부 → 총괄」 기한 임박', v === 'required');
    }
  }
  // RU-57 — 총괄 각자: 모든 섹션이 들어온 순간, 아니면 「본부 → 총괄」 기한에 일부로
  const sectionIn = f.units.map((u) => (u.toHq ? (f.hqApprovedAt !== null && u.arrivedAt !== null && u.arrivedAt <= f.hqApprovedAt ? f.hqApprovedAt : null) : u.arrivedAt));
  const orgAll = sectionIn.every((t) => t !== null) ? Math.max(...(sectionIn as number[])) : null;
  for (const c of f.coordinators) {
    if (orgAll !== null && orgAll < f.hqDue) {
      push({ kind: 'ru_org_ready', to: c, from: orgAll, until: orgAll + EVENT_SLACK, required: true, why: '전 섹션 도착' });
    } else {
      timed('ru_org_ready', c, f.hqDue, WINDOW, '「본부 → 총괄」 기한 — 일부');
      if (orgAll !== null) push({ kind: 'ru_org_complete', to: c, from: orgAll, until: orgAll + EVENT_SLACK, required: true, why: '기한 뒤 전 섹션 도착' });
    }
  }
  return out;
}

/** 수신함 한 통 — 받는 사람마다 한 줄로 편 것 */
export interface Received {
  at: number;
  kind: string;
  email: string;
  employeeNo: string;
  subject: string;
}

export interface Verdict {
  ok: boolean;
  rows: { expect: Expect; got: Received[]; ok: boolean; problem: string | null }[];
  unexpected: Received[];
}

/** 기대와 받은 것을 맞춘다. 같은 (종류, 사람)이 여럿 기대되면(승인 두 번 등) 시각 순으로 하나씩 짝짓는다 */
export function judge(expects: Expect[], received: Received[]): Verdict {
  const key = (kind: string, email: string) => `${kind}|${email}`;
  const pool = new Map<string, Received[]>();
  for (const r of [...received].sort((a, b) => a.at - b.at)) {
    const k = key(kindBase(r.kind), r.email);
    pool.set(k, [...(pool.get(k) ?? []), r]);
  }
  const rows: Verdict['rows'] = [];
  const byKey = new Map<string, Expect[]>();
  for (const e of expects) byKey.set(key(e.kind, e.to.email), [...(byKey.get(key(e.kind, e.to.email)) ?? []), e]);
  for (const [k, es] of byKey) {
    const got = pool.get(k) ?? [];
    pool.delete(k);
    const sorted = [...es].sort((a, b) => a.from - b.from);
    const left = [...got];
    for (const e of sorted) {
      const i = left.findIndex((r) => r.at >= e.from - SLACK_BEFORE && r.at <= e.until + SLACK_AFTER);
      const mine = i >= 0 ? left.splice(i, 1) : [];
      const problem = mine.length ? null : e.required ? (got.length ? '창 밖에 왔다' : '안 왔다') : null;
      rows.push({ expect: e, got: mine, ok: problem === null, problem });
    }
    // 짝이 없는 나머지 — 두 번 왔거나 창 밖에 왔다
    for (const r of left) {
      const row = rows.find((x) => key(x.expect.kind, x.expect.to.email) === k && x.got.length > 0) ?? rows.find((x) => key(x.expect.kind, x.expect.to.email) === k);
      if (row) {
        row.ok = false;
        row.problem = row.got.length ? '두 번 이상 왔다' : '창 밖에 왔다';
        row.got.push(r);
      }
    }
  }
  const unexpected = [...pool.values()].flat().sort((a, b) => a.at - b.at);
  return { ok: rows.every((r) => r.ok) && unexpected.length === 0, rows, unexpected };
}
