// RH-120~126 — 본부 다듬기. 산하 실 병합본(올라온 사본)의 항목을 **빼기만** 해서 본부본을 덜어 낸다 — 글을 고치지 않는다(ADR-0024).
// 본부마다 취합 규칙이 있으면 그 규칙이 미리 고른다(RH-121) — 사람이 체크를 바꾼 것만 저장되고, 없는 것은 언제나 규칙의 답이다.
// 규칙이 없는 본부는 다듬기 전과 똑같다(모두 넣음 · 사본 그대로). 순수 함수 — 서버(본부본 만들기 · 다듬기 화면)와 시험이 같이 쓴다.
import type { HqFormData, HqItem, HqTask } from './hwp/hq-form';
import { combineHqDocs, type UnitDoc } from './hwp/hq-merge';

export type CurateSection = 'results' | 'plans' | 'notes';

/** 자문회의 표 네 칸 — 자문회의 · 전문가 세미나 · 포럼·워크샵 · 기타 회의 */
export type ConsultCol = 0 | 1 | 2 | 3;

export interface CurateRules {
  /** 규칙이 바뀌면 판도 바뀐다 — 본부본 입력 열쇠에 들어간다(RH-124) */
  version: string;
  /** 화면 머리에 보이는 규칙의 출처 */
  source: string;
  /**
   * 「연구원 사업」 과제 유형 — 그 과제의 착수·중간·최종 보고회는 목록에 적지 않고 자문회의로만 센다.
   * 가정(2026-10-22): 기관 고유 사업 = 기본 · 수시 · 일반 · 연적금. 수탁 · R&D · 정부지원 · 역무대행 · 위탁대행 · 연계협동은 목록에 적는다 — 본부 담당 확인 전
   */
  instituteTypes: readonly string[];
  /** 요약 — 다듬기 화면의 「규칙」 접이 */
  summary: readonly string[];
}

// 2026-10-22 국토환경연구본부 본부 담당이 보낸 취합 규칙(§20). 9월 4주 · 10월 3주 제출본으로 대조함
const LAND_RULES: CurateRules = {
  version: 'land-2026-10-22',
  source: '국토환경연구본부 취합 규칙(2026-10-22)',
  instituteTypes: ['기본', '수시', '일반', '연적금'],
  summary: [
    '실적은 이번 주 월~일, 계획은 다음 주 월~일 — 기간 밖은 빼요',
    '연구원 사업(기본·수시·일반·연적금)의 착수·중간·최종 보고회는 목록에 적지 않고 자문회의로만 세요',
    '수탁·R&D 과제는 보고회까지 목록에 적어요',
    '자문회의 건수: 실이 적은 값이 먼저 · 비어 있으면 실적 항목으로 세요(출장은 세지 않아요)',
    '특이사항: 이번 주 실적 중 기관평가에 들어갈 것만 — 다음 주 일은 빼요',
    '넣는 것: 국회·관계부처·위원회 회의, 포럼·협의체 발제·토론, 학회 특별세션',
    '빼는 것: 강의·교육, 연수, 시연 참관, 내부 논의, 개인 사업 자문 · 애매하면 기본은 빼요',
  ],
};

const RULES: Record<string, CurateRules> = { 국토환경연구본부: LAND_RULES };

const norm = (s: string) => s.replace(/\s+/g, '');

export function curateRulesOf(hqNameKo: string): CurateRules | null {
  return RULES[norm(hqNameKo)] ?? null;
}

// ── 날짜 ────────────────────────────────────────────────

const DAY = 86_400_000;
const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY);

/** 주의 월요일(KST 날짜) — 일 번호(1970-01-01부터 날 수) */
export function mondayDay(opensAt: Date): number {
  return Math.floor((opensAt.getTime() + 9 * 3_600_000) / DAY);
}

/**
 * 항목의 「일자」 칸 → [첫날, 끝날](일 번호). 「10/16」「10/10-10/19」「10/17~10/26」「10/19~23」「10/29, 10/30」「9.30」.
 * 연도는 그 주 월요일에 가까운 쪽(12월·1월을 넘는 주). 날짜가 없으면 null — 기간 판정을 하지 않는다
 */
export function dateSpan(text: string, monday: number): [number, number] | null {
  const t = text.replace(/\s+/g, '');
  const md = [...t.matchAll(/(\d{1,2})[./](\d{1,2})/g)];
  if (md.length === 0) return null;
  const year0 = new Date(monday * DAY).getUTCFullYear();
  const pick = (m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const cands = [year0 - 1, year0, year0 + 1].map((y) => dayOf(y, m, d));
    return cands.reduce((a, b) => (Math.abs(b - monday) < Math.abs(a - monday) ? b : a));
  };
  const days: number[] = [];
  for (const x of md) {
    const v = pick(Number(x[1]), Number(x[2]));
    if (v !== null) days.push(v);
  }
  // 「10/19~23」 — 물결·줄표 뒤 날만 있으면 같은 달
  const tail = md.length === 1 ? /^[~\-–](\d{1,2})(?![./\d])/.exec(t.slice((md[0].index ?? 0) + md[0][0].length)) : null;
  if (tail) {
    const v = pick(Number(md[0][1]), Number(tail[1]));
    if (v !== null) days.push(v);
  }
  if (days.length === 0) return null;
  return [Math.min(...days), Math.max(...days)];
}

const overlaps = (s: [number, number], from: number, to: number) => s[0] <= to && s[1] >= from;

// ── 판정 ────────────────────────────────────────────────

const MILESTONE = (c: string) => (/착수|중간|최종/.test(c) && /보고|자문/.test(c)) || /보고회/.test(c);
const TRIP = /출장/;

export function isInstitute(rules: CurateRules, type: string): boolean {
  const t = norm(type);
  return rules.instituteTypes.some((x) => t === x || t.startsWith(x));
}

/**
 * RH-122 — 실적 항목 하나가 자문회의 표의 어느 칸인가(규칙이 있는 본부). 세지 않으면 null.
 * 출장은 세지 않는다 · 연구원 사업 보고회 → 자문회의 · 수탁 보고회 · 정책실무협의회 → 기타 회의 · 세미나 · 포럼·워크숍 · 그 밖의 회의 → 기타
 */
export function consultColOf(rules: CurateRules, type: string, content: string): ConsultCol | null {
  const c = norm(content);
  if (TRIP.test(c)) return null;
  if (MILESTONE(c)) return isInstitute(rules, type) ? 0 : 3;
  if (/정책실무협의/.test(c)) return 3;
  if (/세미나/.test(c)) return 1;
  if (/포럼|워크숍|워크샵|라운드테이블/.test(c)) return 2;
  if (/자문회의/.test(c)) return isInstitute(rules, type) ? 0 : 3;
  if (/회의|협의회|간담회/.test(c)) return 3;
  return null;
}

const NOTE_OUT: [RegExp, string][] = [
  [/강의|강연|교육/, '강의·교육은'],
  [/연수/, '연수는'],
  [/시연|참관/, '시연 참관은'],
  [/내부(논의|회의|검토|세미나|워크숍)|사전논의|준비회의|점검회의/, '내부 논의는'],
  [/(개인|개별)(사업)?자문/, '개인 사업 자문은'],
];
const NOTE_IN: [RegExp, string][] = [
  [/국회/, '국회'],
  [/관계부처|관계기관|기후부|환경부|국토부|국토교통부|해수부|해양수산부|농식품부|농림|산림청|국무조정실|기재부|기획재정부|행안부|산업부|과기정통부|대통령|총리/, '관계부처'],
  [/위원회/, '위원회'],
  [/협의체|협의회/, '협의체'],
  [/발제|토론|패널/, '발제·토론'],
  [/포럼/, '포럼'],
  [/특별세션|학회|학술대회|심포지엄|컨퍼런스|콘퍼런스/, '학회'],
];

export interface Verdict {
  suggested: boolean;
  /** 왜 뺐나(또는 넣었나) — 화면에 한 줄 */
  reason?: string;
}

/** RH-121 — 목록(실적·계획) 항목 하나의 규칙 답 */
export function judgeListItem(rules: CurateRules, section: 'results' | 'plans', type: string, item: HqItem, monday: number): Verdict {
  const span = dateSpan(item.date, monday);
  if (span) {
    const [from, to] = section === 'results' ? [monday, monday + 6] : [monday + 7, monday + 13];
    if (!overlaps(span, from, to)) return { suggested: false, reason: section === 'results' ? '기간 밖 — 실적은 이번 주 월~일' : '기간 밖 — 계획은 다음 주 월~일' };
  }
  if (isInstitute(rules, type) && MILESTONE(norm(item.content))) return { suggested: false, reason: '연구원 사업 보고회 — 자문회의 건수로만' };
  return { suggested: true };
}

/** RH-121 — 특이사항 하나의 규칙 답. 기간 → 빼는 말 → 넣는 말 → 애매하면 뺌 */
export function judgeNote(rules: CurateRules, item: HqItem, monday: number): Verdict {
  void rules;
  const span = dateSpan(item.date, monday);
  if (span && span[0] > monday + 6) return { suggested: false, reason: '다음 주 일 — 특이사항은 이번 주 실적만' };
  if (span && span[1] < monday) return { suggested: false, reason: '지난주 일' };
  const c = norm(`${item.content} ${item.place}`);
  for (const [re, why] of NOTE_OUT) if (re.test(c)) return { suggested: false, reason: `${why} 빼요` };
  for (const [re, why] of NOTE_IN) if (re.test(c)) return { suggested: true, reason: why };
  return { suggested: false, reason: '애매해요 — 기본은 빼요' };
}

// ── 열쇠 ────────────────────────────────────────────────

/** FNV-1a 두 번(시작값만 다르게) — 16자리. 서버·화면·시험이 같은 값을 내야 해서 node:crypto를 쓰지 않는다 */
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function itemKey(section: CurateSection, unitNameKo: string, task: Pick<HqTask, 'type' | 'title'> | null, item: HqItem): string {
  const s = [section, norm(unitNameKo), norm(task?.type ?? ''), norm(task?.title ?? ''), norm(item.content), norm(item.date)].join('|');
  return fnv(s, 0x811c9dc5) + fnv(s, 0x01000193);
}

// ── 후보 · 적용 ─────────────────────────────────────────

export interface SavedCuration {
  /** 사람이 바꾼 것만 — 열쇠 → 넣음(true)/뺌(false) */
  decisions: Record<string, boolean>;
  /** 사람이 고친 자문회의 줄 — 줄 이름 → 네 값 */
  consult: Record<string, string[]>;
}

export interface CurateItem {
  key: string;
  section: CurateSection;
  unit: string;
  task: { type: string; title: string; owner: string; abbr: string } | null;
  item: HqItem;
  suggested: boolean;
  reason?: string;
  /** 사람이 정한 값(없으면 규칙 답) */
  decided?: boolean;
  included: boolean;
}

export interface CurateConsult {
  label: string;
  /** 그 줄의 사본이 올라왔나(본부 줄은 본부 자신의 판) */
  copy: boolean;
  /** 실(또는 본부 담당이 그 실 줄에) 적은 값 — 비었으면 null */
  reported: string[] | null;
  /** 실적 항목으로 센 값(규칙이 있는 본부만) */
  counted: number[] | null;
  /** 사람이 고친 값 */
  override: string[] | null;
  /** 본부본에 들어가는 값 — 고친 값 → 적은 값 → 센 값(0은 「-」) */
  values: string[];
}

export interface CurateContext {
  hqNameKo: string;
  /** 그 주 월요일(KST) 일 번호 — `mondayDay(slot.opensAt)` */
  monday: number;
  rules: CurateRules | null;
}

const filled = (vals: readonly string[] | undefined | null): vals is readonly string[] => !!vals && vals.some((v) => v.trim() !== '' && v.trim() !== '-');
const shown = (n: number) => (n > 0 ? String(n) : '-');

/** RH-122 — 실 하나의 실적으로 자문회의 네 칸을 센다(이번 주 안의 항목 · 날짜 없는 항목) */
export function countConsult(rules: CurateRules, data: Pick<HqFormData, 'results'>, monday: number): number[] {
  const out = [0, 0, 0, 0];
  for (const t of data.results) {
    for (const it of t.items) {
      const span = dateSpan(it.date, monday);
      if (span && !overlaps(span, monday, monday + 6)) continue;
      const col = consultColOf(rules, t.type, it.content);
      if (col !== null) out[col] += 1;
    }
  }
  return out;
}

/** 실 줄의 적은 값 — 실 자신의 줄, 없으면 본부 판의 그 줄(RH-97과 같은 순서) */
function reportedRow(units: readonly UnitDoc[], label: string, hqNameKo: string): string[] | null {
  const own = units.find((u) => norm(u.nameKo) === norm(label))?.data.consult?.find((c) => norm(c.label) === norm(label));
  if (filled(own?.values)) return [...own.values];
  const hq = units.find((u) => norm(u.nameKo) === norm(hqNameKo))?.data.consult?.find((c) => norm(c.label) === norm(label));
  if (norm(label) !== norm(hqNameKo) && filled(hq?.values)) return [...hq.values];
  return null;
}

/** 다듬기 화면의 목록 — 사본 순서(본부가 정한 순서) 그대로 */
export function curateView(units: readonly UnitDoc[], ctx: CurateContext, saved: SavedCuration | null): { items: CurateItem[]; consult: CurateConsult[] } {
  const { rules, monday } = ctx;
  const items: CurateItem[] = [];
  const seen = new Map<string, number>();
  const keyed = (k: string) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}.${n}`; // 같은 실의 같은 항목이 두 번 — 둘째부터 번호
  };
  const push = (section: CurateSection, unit: string, task: HqTask | null, item: HqItem, v: Verdict) => {
    const key = keyed(itemKey(section, unit, task, item));
    const decided = saved?.decisions[key];
    items.push({
      key,
      section,
      unit,
      task: task ? { type: task.type, title: task.title, owner: task.owner, abbr: task.unit } : null,
      item,
      suggested: v.suggested,
      ...(v.reason ? { reason: v.reason } : {}),
      ...(decided !== undefined ? { decided } : {}),
      included: decided ?? v.suggested,
    });
  };
  for (const u of units) {
    for (const section of ['results', 'plans'] as const) {
      for (const t of u.data[section]) {
        for (const it of t.items) push(section, u.nameKo, t, it, rules ? judgeListItem(rules, section, t.type, it, monday) : { suggested: true });
      }
    }
  }
  for (const u of units) for (const it of u.data.notes) push('notes', u.nameKo, null, it, rules ? judgeNote(rules, it, monday) : { suggested: true });

  const labels: string[] = [];
  const add = (l: string) => {
    if (l.trim() && !labels.some((x) => norm(x) === norm(l))) labels.push(l);
  };
  for (const u of units) for (const c of u.data.consult ?? []) add(c.label);
  for (const u of units) add(u.nameKo);
  const consult = labels.map((label): CurateConsult => {
    const reported = reportedRow(units, label, ctx.hqNameKo);
    const doc = units.find((u) => norm(u.nameKo) === norm(label));
    const counted = rules && doc ? countConsult(rules, doc.data, monday) : null;
    const override = saved?.consult[label] ?? null;
    const values = override ?? reported ?? (counted ? counted.map(shown) : ['-', '-', '-', '-']);
    return { label, copy: !!doc, reported, counted, override, values };
  });
  return { items, consult };
}

/**
 * RH-124 — 본부본에 들어갈 사본들(항목만 — 자문회의는 `curateHq`가 합친 뒤에 맞춘다). 규칙도 저장한 다듬기도 없으면 **받은 그대로**(다듬기 전과 같은 본부본).
 * 뺀 항목을 걷고, 항목이 다 빠진 과제와 과제가 다 빠진 실 칸은 줄째 없앤다(규칙 「실적이 없는 연구실 칸은 삭제」).
 * 자문회의는 실마다 자기 줄 하나로 — 고친 값 → 적은 값 → 센 값. 합치기(`combineHqDocs`)는 그 줄을 그대로 쓴다
 */
export function curateUnits(units: readonly UnitDoc[], ctx: CurateContext, saved: SavedCuration | null): UnitDoc[] {
  if (!ctx.rules && !saved) return [...units];
  const view = curateView(units, ctx, saved);
  const keep = new Set(view.items.filter((i) => i.included).map((i) => i.key));
  let n = 0; // curateView와 같은 순서로 열쇠를 다시 짚는다
  const next = () => view.items[n++].key;
  const pass = units.map((u) => ({
    nameKo: u.nameKo,
    data: {
      ...u.data,
      results: [] as HqTask[],
      plans: [] as HqTask[],
      notes: [] as HqItem[],
    },
  }));
  for (const [k, u] of units.entries()) {
    for (const section of ['results', 'plans'] as const) {
      pass[k].data[section] = u.data[section]
        .map((t) => ({ ...t, items: t.items.filter(() => keep.has(next())) }))
        .filter((t) => t.items.length > 0);
    }
  }
  for (const [k, u] of units.entries()) pass[k].data.notes = u.data.notes.filter(() => keep.has(next()));
  return pass;
}

/**
 * RH-124 — 본부본 데이터. 규칙도 다듬기도 없으면 `combineHqDocs` 그대로. 있으면 항목을 걷고, 자문회의 표는 줄마다 화면의 값
 * (고친 값 → 실이 적은 값 → 센 값)으로 — 사본이 없는 실의 줄도 본부 담당이 고친 값이면 들어간다
 */
export function curateHq(units: readonly UnitDoc[], ctx: CurateContext, saved: SavedCuration | null): HqFormData {
  if (!ctx.rules && !saved) return combineHqDocs(units, ctx.hqNameKo);
  const combined = combineHqDocs(curateUnits(units, ctx, saved), ctx.hqNameKo);
  const consult = curateView(units, ctx, saved)
    .consult.filter((c) => filled(c.values))
    .map((c) => ({ label: c.label, values: c.values }));
  return { ...combined, consult };
}

/** 다듬기 저장값이 판에 미치는 몫 — 본부본 입력 열쇠에 들어간다(같으면 다시 만들지 않는다) */
export function curationFingerprint(saved: SavedCuration | null, rules: CurateRules | null): string | null {
  if (!saved && !rules) return null;
  const d = saved ? Object.keys(saved.decisions).sort().map((k) => `${k}:${saved.decisions[k] ? 1 : 0}`) : [];
  const c = saved ? Object.keys(saved.consult).sort().map((k) => `${norm(k)}:${saved.consult[k].join(',')}`) : [];
  return JSON.stringify({ r: rules?.version ?? null, d, c });
}
