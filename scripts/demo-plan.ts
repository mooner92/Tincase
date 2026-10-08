/**
 * RU-45~47 — 시연 시드(`demo-seed.ts`)의 **계획**: 어느 주차를 어디까지 채우고, 각 일이 몇 시에 일어났나.
 *
 * DB를 만지지 않는다 — 그래서 시험할 수 있다(`tests/demo-seed.test.ts`). 실행은 demo-seed.ts가 한다.
 *
 * 시각을 이렇게 따로 정하는 이유: 강당 화면에 「03:12 제출」·「병합 07:01, 제출 08:30」처럼 순서가 뒤집히거나 새벽인 시각이
 * 뜨면 시연이 가짜처럼 보인다. 그래서 일마다 「그럴듯한 시각」을 정하고, 시드는 행을 만든 뒤 그 시각으로 고쳐 쓴다.
 */
import path from 'node:path';
import { describeWeek } from '../src/lib/week';

export const STAGES = ['open', 'ready', 'hq', 'done'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * 2026-10-08(ADR-0015 · RU-84) — 승인이 곧 위로 가는 제출이다. 사람이 누르는 것은 실장 [승인]·본부장 [승인] 둘뿐이고,
 * 올라가기·본부본·전사본은 저절로 맞춰진다. 그래서 단계는 「남은 승인이 무엇인가」로 나눈다(이름은 RU-46 그대로).
 */
export const STAGE_NOTE: Record<Stage, string> = {
  open: '이번 주는 비어 있다 — 지난주만 끝까지',
  ready: '부서원 대부분 제출 · 실·팀 셋 병합·실장 승인(→ 저절로 올라감) · 본부본은 둘로 모여 본부장 승인 전 · AI홍보전략실은 병합 전 — 남은 것은 [지금 병합] → 실장 [승인] → 본부장 [승인]',
  hq: 'ready + AI홍보전략실 병합·실장 승인 — 본부본은 셋 다 모였고 남은 것은 본부장 [검토 완료 · 승인]',
  done: 'hq + 본부장 승인 — 총괄로 갔고 전사본까지 저절로',
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── 명령줄 ──────────────────────────────────────────────────────────────────

export interface DemoArgs {
  stage: Stage;
  /** 「2026-W45」 — 없으면 이야기 시각이 든 주 */
  isoKey: string | null;
  /** 이야기의 「지금」 — 없으면 진짜 지금 */
  until: Date | null;
  /** 그 주의 마감을 일요일 20:00으로 미룬다(주차 마감 예외, WS-18) — 마감이 지난 금요일에 리허설할 때 */
  keepOpen: boolean;
}

/** --keep-open의 마감 — 그 주 일요일 20:00. 3단계 기한(D+60·D+120분)도 그 주 안에 남는다 */
export const KEEP_OPEN = { dow: 7, time: '20:00', note: '시연 리허설 — 제출을 일요일 20:00까지 열어 둠' } as const;

export function parseArgs(argv: readonly string[], now: Date): DemoArgs {
  const out: DemoArgs = { stage: 'ready', isoKey: null, until: null, keepOpen: false };
  for (const a of argv) {
    const [k, v = ''] = a.split('=', 2);
    if (a === '--keep-open') {
      out.keepOpen = true;
    } else if (k === '--stage') {
      if (!(STAGES as readonly string[]).includes(v)) throw new Error(`--stage는 ${STAGES.join(' | ')} 중 하나입니다 (받은 값: ${v || '없음'})`);
      out.stage = v as Stage;
    } else if (k === '--week') {
      mondayOfIsoKey(v); // 형식·존재 확인
      out.isoKey = v;
    } else if (k === '--until') {
      out.until = parseUntil(v, now);
    } else {
      throw new Error(`모르는 인자: ${a} (--stage= · --week= · --until= · --keep-open)`);
    }
  }
  return out;
}

/** ISO 주차 키 → 그 주 월요일 00:00 KST. 없는 주차(「2026-W54」)는 거절한다 */
export function mondayOfIsoKey(key: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`--week는 「2026-W45」 꼴입니다 (받은 값: ${key || '없음'})`);
  const jan4 = Date.UTC(Number(m[1]), 0, 4); // ISO 1주차 = 1월 4일이 든 주
  const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const monday = new Date(firstMonday + (Number(m[2]) - 1) * 7 * DAY - 9 * HOUR); // 그 날짜의 00:00 KST
  if (describeWeek(monday).isoKey !== key) throw new Error(`없는 주차입니다: ${key}`);
  return monday;
}

/** 「09:40」(오늘, KST) 또는 ISO 시각 */
export function parseUntil(s: string, now: Date): Date {
  const hm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (hm) {
    const k = new Date(now.getTime() + 9 * HOUR);
    return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), Number(hm[1]), Number(hm[2])) - 9 * HOUR);
  }
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) throw new Error(`--until은 「09:40」 또는 ISO 시각(「2026-11-02T09:40+09:00」)입니다 (받은 값: ${s || '없음'})`);
  return new Date(t);
}

// ── 경로 ────────────────────────────────────────────────────────────────────

/**
 * 시연 데이터 디렉터리 — docker-compose.test.yml을 시연 모드(`TINCASE_TEST_MODE=demo`)로 띄울 때 11112에 붙는 볼륨.
 * 평소 11112의 볼륨(/data/worklog-test)은 운영 사본(실명)이라 여기와 겹치면 안 된다 — tests/demo-seed.test.ts RU-T85
 */
export const DEMO_ROOT = '/data/worklog-demo';

const inside = (p: string, root: string) => p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * DB 파일과 저장소가 **시연 디렉터리** 또는 **임시 디렉터리** 안인가. 둘 다 같은 곳이어야 한다.
 * 운영(/data/worklog)·테스트(/data/worklog-test)를 가리킬 길을 없앤다 — 이름이 비슷해도 경계(`/`)까지 본다.
 * 경로는 심볼릭 링크를 푼 진짜 경로로 받는다. 맞으면 null, 아니면 거절 이유.
 */
export function pathRefusal(dbFile: string, storageRoot: string, tmpRoot: string): string | null {
  if (!path.isAbsolute(dbFile)) return `DATABASE_URL은 절대 경로여야 합니다 (file:/…) — ${dbFile}`;
  if (!path.isAbsolute(storageRoot)) return `STORAGE_ROOT는 절대 경로여야 합니다 — ${storageRoot}`;
  const demo = inside(dbFile, DEMO_ROOT) && (storageRoot === DEMO_ROOT || inside(storageRoot, DEMO_ROOT));
  const tmp = inside(dbFile, tmpRoot) && inside(storageRoot, tmpRoot);
  if (demo || tmp) return null;
  return `DB(${dbFile})와 저장소(${storageRoot})가 ${DEMO_ROOT} 또는 임시 디렉터리(${tmpRoot}) 안에 함께 있어야 합니다`;
}

// ── 계획 ────────────────────────────────────────────────────────────────────

/** 등장인물 — 이메일 앞부분(fake-org PEOPLE). 명단은 정렬 순서대로, 부서장 빼고 */
export interface Cast {
  ai: string[];
  pco: string[];
  rmo: string[];
  ca: string[];
  member: string;
  memberPending: string;
  lead: string;
  head: string;
  hqLead: string;
  hqHead: string;
  coordinator: string;
  rmLead: string;
  caLead: string;
  /** 실·팀 셋의 부서장 — 승인이 곧 위로 가는 제출이다(fake-org `UNIT_HEADS`, RU-84) */
  pcHead: string;
  rmHead: string;
  caHead: string;
}

export const AI = 'AI홍보전략실';
export const PCO = '기획조정실';
export const RMO = '연구관리실';
export const CA = '기후대기전략연구본부';
export const HQ = '기획경영본부';

/** 총괄이 게시판으로 받아 올린 섹션 — 아직 Tincase를 안 쓰는 곳(섹션 제목, sections.ts DEFAULT_SECTIONS) */
const OFFLINE = ['임원실', '글로벌대외협력단', '기획경영본부(인사관리실)', '경영지원실', '생활환경연구본부', '국토환경연구본부', '환경평가본부', '국가기후위기적응센터', '국가지속가능발전연구센터'];
/** 지난주: 국가지속가능발전연구센터(게시판 없음)만 빠졌다 */
export const HISTORY_UPLOADS = OFFLINE.filter((t) => t !== '국가지속가능발전연구센터');
/** 이번 주(아침): 다섯 곳 도착 — 넷은 아직 「미제출」로 보인다 */
export const LIVE_UPLOADS = ['임원실', '글로벌대외협력단', '기획경영본부(인사관리실)', '국토환경연구본부', '국가기후위기적응센터'];

/**
 * 사람이 하는 일만 — 2026-10-08(RU-84)부터 [제출]·[이어 붙이기]·[총괄에 제출]·[전사 취합본 만들기]는 없다.
 * `approve`(실장)·`hqApprove`(본부장)가 그 요청 안에서 위로 올리고, 본부본·전사본은 시드가 그 뒤에 맞춘다(화면의 `after()`와 같다)
 */
export type Action =
  | { kind: 'submit'; who: string; div: string }
  | { kind: 'merge'; div: string; trigger: 'auto' | 'manual' }
  | { kind: 'approve'; div: string; who: string }
  | { kind: 'upload'; section: string; who: string }
  | { kind: 'hqApprove'; div: string; who: string };

export interface Planned {
  at: Date;
  action: Action;
}

export interface WeekPlanInput {
  cast: Cast;
  stage: Stage;
  /** 그 주 월요일 00:00 KST */
  monday: Date;
  /** 그 주 부서 마감 (기본 목 14:00) */
  deadline: Date;
  /** 이야기의 「지금」 — 모든 일이 이 전에 일어난다 */
  end: Date;
  /**
   * RU-60a — 총괄이 게시판 hwp를 올린 섹션을 넣나. 시드는 hwp 스위치(`hwpUploadOpen()`)를 그대로 넘긴다 — 스위치가 꺼진 서버
   * (테스트·시연 11112, 2026-10-12부터 운영도 전 섹션 Tincase)에 「올린 파일」·[올린 것 취소]가 보이지 않게. 계획만 볼 때는 기본 true
   */
  uploads?: boolean;
}

const without = (list: string[], ...drop: string[]) => list.filter((x) => !drop.includes(x));
const last = (list: string[]) => list[list.length - 1];

/** 부서들의 제출을 번갈아 — 한 부서가 몰아서 내지 않게 */
function interleave(groups: [string, string[]][]): Action[] {
  const out: Action[] = [];
  for (let i = 0; groups.some(([, l]) => i < l.length); i++) {
    for (const [div, list] of groups) if (i < list.length) out.push({ kind: 'submit', who: list[i], div });
  }
  return out;
}

/**
 * 한 주의 일들 — 순서대로, 시각과 함께.
 *
 * 그 주의 마감이 이야기 시각보다 **앞**이면 지난 주처럼(거의 다 냄 · 마감 뒤 자동 병합 · 15·16시 제출),
 * **뒤**면 「오늘 아침」 — 실·팀마다 한두 명이 남았고, 이야기 시각 앞 두어 시간에 일어난 것으로 찍는다.
 * 어디까지 가는지는 단계가 정한다 — 지난주는 늘 `done`으로 부른다.
 */
export function planWeek(input: WeekPlanInput): Planned[] {
  const { cast: c, stage, monday, deadline, end, uploads = true } = input;
  if (stage === 'open') return [];
  const past = end.getTime() >= deadline.getTime();

  // ── 무엇을 ──
  const subs: Action[] = past
    ? // 지난주 — 거의 다 냈다. 주인공(남시우)도 냈다(「지난번에 낸 것」). AI홍보전략실 한 명만 빠졌다
      interleave([[AI, without(c.ai, last(c.ai))], [PCO, c.pco], [RMO, c.rmo], [CA, c.ca]])
    : // 오늘 아침 — 실·팀마다 한두 명이 남았다. 주인공은 화면에서 낸다. 유단비는 고쳐 다시 냈다(v2)
      [
        ...interleave([[AI, without(c.ai, c.memberPending, last(c.ai))], [PCO, without(c.pco, last(c.pco))], [RMO, c.rmo], [CA, without(c.ca, last(c.ca))]]),
        { kind: 'submit', who: c.member, div: AI },
      ];

  const after: Action[] = [];
  const trigger = past ? 'auto' : 'manual';
  const whole = stage === 'hq' || stage === 'done'; // AI홍보전략실까지 승인했나
  for (const div of [PCO, RMO, CA, ...(whole ? [AI] : [])]) after.push({ kind: 'merge', div, trigger });
  if (uploads) for (const section of past ? HISTORY_UPLOADS : LIVE_UPLOADS) after.push({ kind: 'upload', section, who: c.coordinator });
  // RU-70 — 실장 승인 = 위로 제출. 기획조정실·연구관리실은 본부로, 기후대기(본부 단계 없는 본부)는 바로 총괄로(RU-07)
  after.push(
    { kind: 'approve', div: PCO, who: c.pcHead },
    { kind: 'approve', div: RMO, who: c.rmHead },
    { kind: 'approve', div: CA, who: c.caHead },
  );
  if (whole) after.push({ kind: 'approve', div: AI, who: c.head });
  // RU-55 — 본부장 승인 = 총괄로 제출. 전사본은 그 뒤 저절로
  if (stage === 'done') after.push({ kind: 'hqApprove', div: HQ, who: c.hqHead });

  // ── 언제 ── 제출은 한 구간에 고르게. 그 뒤의 일은 — 오늘 아침이면 다른 구간에 고르게, 지난 주면 실제 하루처럼
  const spread = (n: number, from: number, to: number, k: number) => (n <= 1 ? from : from + ((to - from) * k) / (n - 1));
  const raw: { t: number; action: Action }[] = past
    ? [
        // 수 11:00 ~ 목 13:45
        ...subs.map((action, k) => ({ t: spread(subs.length, deadline.getTime() - 27 * HOUR, deadline.getTime() - 15 * MIN, k), action })),
        ...after.map((action, k) => ({ t: deadline.getTime() + pastOffset(action, after.slice(0, k)), action })),
      ]
    : [
        ...subs.map((action, k) => ({ t: spread(subs.length, end.getTime() - 150 * MIN, end.getTime() - 45 * MIN, k), action })),
        ...after.map((action, k) => ({ t: spread(after.length, end.getTime() - 38 * MIN, end.getTime() - 3 * MIN, k), action })),
      ];
  raw.sort((a, b) => a.t - b.t);

  // 그 주 안, 이야기 시각 전으로 — 순서를 지키며 눌러 담는다(새벽에 시드하면 월요일 0시 뒤로)
  return squeeze(raw.map((r) => r.t), monday.getTime() + MIN, end.getTime() - MIN).map((t, k) => ({ at: new Date(t), action: raw[k].action }));
}

/**
 * 지난 주의 하루 — 마감(D)에서 몇 ms 뒤에. 3단계 기한(RU-51 기본: 실·팀 → 본부 D+60분 · 본부 → 총괄 D+120분) **안에** 승인한다 —
 * 승인이 곧 위로 가는 제출이라(RU-70) 고르게 펴면 15:28에 「실·팀 → 본부」로 올라간 것처럼 보여 지난주 화면에 기한을 넘긴 것이 생긴다.
 */
function pastOffset(a: Action, before: readonly Action[]): number {
  const k = before.filter((b) => b.kind === a.kind).length;
  switch (a.kind) {
    case 'merge':
      return MIN + k * 20_000; // 14:01 자동 병합 — 부서마다 몇 초씩
    case 'upload':
      return 15 * MIN + k * 2 * MIN; // 14:15~
    case 'approve':
      return 35 * MIN + k * 5 * MIN; // 14:35~ 실장 승인 = 위로 (네 곳이면 14:50까지)
    case 'hqApprove':
      return 95 * MIN; // 15:35 본부장 승인 = 총괄로
    case 'submit':
      return 0;
  }
}

/**
 * 정렬된 시각들을 [lo, hi] 안으로 — 넘치는 쪽만 줄이고 순서를 지킨다.
 * 지난 주는 위쪽(hi)만 줄어 모든 시각이 앞으로 당겨진다 — 마감 전 제출이 마감 뒤로 밀리는 일이 없다
 */
export function squeeze(ts: number[], lo: number, hi: number): number[] {
  if (ts.length === 0) return ts;
  const min = ts[0];
  const max = ts[ts.length - 1];
  const a = Math.max(lo, min);
  const b = Math.max(a, Math.min(hi, max));
  if (a === min && b === max) return ts;
  const span = max - min;
  return ts.map((t) => Math.round(span === 0 ? a : a + ((t - min) * (b - a)) / span));
}

/** 같은 사람·같은 주·같은 판이면 같은 내용 — 다시 시드해도 화면이 같다 */
export function contentNo(who: string, isoKey: string, version: number): number {
  let h = 2166136261;
  for (const ch of `${who}|${isoKey}|${version}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 100_000;
}
