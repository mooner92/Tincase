// RH-90~95 — ERP 「주간업무보고」(경영지원 > 주간업무보고) 인쇄본의 글자를 읽어 업무일지 후보로. 순수 함수 — PDF에서 글자를 뽑는 것은 서버(pdftotext)다.
// 모양(2026-09·10 실측): 머리 「[부서명] (2026-10-08 ~ 2026-10-15)」, 구분 「1. 회의개최」 … 아래
//   회의개최: 「○ 과제명(유형, 책임자)」 → 「- 내용(일자, 장소, 참석자…)」
//   그 밖: 줄 하나가 한 건 — 「○/- 이름(…, 일자, 장소, 사람)」 · 대외활동 「○ 활동(2026-10-14 09:30~11:30, 장소, 사람)」
// 한 줄이 넘치면 다음 줄로 이어진다(-layout 출력). 이 파일은 저장소 공개 대상이다 — 예시는 지어낸 것이다.

export const ERP_SECTIONS = ['회의개최', '국내출장', '시내출장', '해외출장', '대외활동', '행사개최'] as const;
export type ErpSection = (typeof ERP_SECTIONS)[number];

export interface ErpTask {
  title: string;
  type: string;
  owner: string;
}

export interface ErpEntry {
  /** PDF 머리의 부서명 */
  unit: string;
  sec: ErpSection;
  /** 회의개최의 ○ 과제 · 출장의 앞머리(과제명) · 그 밖은 없음 */
  task: ErpTask | null;
  content: string;
  /** [월, 일] — 여럿이면 기간 */
  days: [number, number][];
  place: string;
  people: string[];
  raw: string;
}

const HEAD = new RegExp(`^\\s*\\d+\\.\\s*(${ERP_SECTIONS.join('|')})\\s*$`);
const TITLE = /^\s*\[(.+?)\]\s*\((\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\)/;
const HANGUL = /[가-힣]/;

/** 줄바꿈으로 갈린 글 — 한글끼리면 붙이고(「경기\n도」) 아니면 띄운다 */
function joinWrapped(a: string, b: string): string {
  return HANGUL.test(a.slice(-1)) && HANGUL.test(b[0] ?? '') ? a + b : `${a} ${b}`;
}

/** 끝의 괄호 묶음 하나(안에 괄호가 또 있어도) — [앞, 안] */
export function tailParen(s: string): [string, string] {
  const t = s.trimEnd();
  if (!t.endsWith(')')) return [t.trim(), ''];
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ')') depth++;
    else if (t[i] === '(') {
      depth--;
      if (depth === 0) return [t.slice(0, i).trim(), t.slice(i + 1, -1)];
    }
  }
  return [t.trim(), ''];
}

/** 괄호 밖의 쉼표로만 가른다 */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DATE = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})(?:\s*[~-]\s*(?:(\d{1,2})\/)?(\d{1,2}))?/g;

/** 글 속의 날짜들 — 「10/14」 · 「9/17~18」 · 「2026-10-14」 · 「09/ 10」(띄어 쓴 것도) */
export function daysOf(text: string): [number, number][] {
  const t = text.replace(/(\d)\s*([/-])\s*(\d)/g, '$1$2$3');
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const add = (m: number, d: number) => {
    const k = `${m}/${d}`;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && !seen.has(k)) {
      seen.add(k);
      out.push([m, d]);
    }
  };
  for (const m of t.matchAll(DATE)) {
    if (m[1]) add(Number(m[2]), Number(m[3]));
    else {
      const mo = Number(m[4]);
      const d1 = Number(m[5]);
      add(mo, d1);
      if (m[7]) {
        const mo2 = m[6] ? Number(m[6]) : mo;
        const d2 = Number(m[7]);
        if (mo2 === mo && d2 > d1 && d2 <= 31) for (let d = d1 + 1; d <= d2; d++) add(mo, d);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** 날짜들 → 「10/14」 · 「9/17~18」 · 「9/30, 10/2」 */
export function formatErpDays(days: readonly [number, number][]): string {
  if (days.length === 0) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1][0] === days[i][0] && days[j + 1][1] === days[j][1] + 1) j++;
    parts.push(j > i ? `${days[i][0]}/${days[i][1]}~${days[j][1]}` : `${days[i][0]}/${days[i][1]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

const people = (fields: string[]) =>
  fields
    .flatMap((f) => f.split(/[,·]/))
    .map((p) => p.trim())
    .filter((p) => p && !/\d/.test(p) && p.length <= 12);

/** RH-91 — pdftotext -layout 글 하나(PDF 하나) → 건들. 머리가 없으면 빈 배열 */
export function parseErpText(text: string): { unit: string | null; entries: ErpEntry[] } {
  let unit: string | null = null;
  let sec: ErpSection | null = null;
  const raw: { sec: ErpSection; marker: '○' | '-'; text: string }[] = [];
  for (const line of text.split('\n')) {
    const ln = line.replace(/\f/g, '');
    if (!ln.trim()) continue;
    const t = TITLE.exec(ln);
    if (t) {
      unit = t[1].trim();
      continue;
    }
    const h = HEAD.exec(ln);
    if (h) {
      sec = h[1] as ErpSection;
      continue;
    }
    if (!sec) continue;
    const s = ln.trim();
    if (/^[○◦ㅇ]/.test(s)) raw.push({ sec, marker: '○', text: s.slice(1).trim() });
    // 해외출장의 「-」 줄은 그 출장의 목적 글머리다 — 새 건이 아니다
    else if (/^[-\uFF0D]/.test(s) && sec === '해외출장' && raw.length && raw[raw.length - 1].sec === '해외출장') raw[raw.length - 1].text += ` · ${s.slice(1).trim()}`;
    else if (/^[-\uFF0D]/.test(s)) raw.push({ sec, marker: '-', text: s.slice(1).trim() });
    else if (raw.length) raw[raw.length - 1].text = joinWrapped(raw[raw.length - 1].text, s);
  }
  const entries: ErpEntry[] = [];
  let task: ErpTask | null = null;
  for (const r of raw) {
    if (r.sec === '해외출장') {
      // 「이름 : (2026-10-14 ~ 2026-10-17) 나라, 목적…」
      const m = /^(.+?)\s*:\s*\(([^)]*)\)\s*(.*)$/.exec(r.text);
      const dest = (m?.[3] ?? r.text).split(/[,\uFF0C]/)[0].trim().slice(0, 30);
      entries.push({ unit: unit ?? '', sec: r.sec, raw: r.text, days: daysOf(m?.[2] ?? ''), task: null, content: `해외출장 — ${dest}`, place: dest, people: m ? [m[1].trim()] : [] });
      continue;
    }
    const [head, inner] = tailParen(r.text);
    const f = splitTop(inner);
    if (r.sec === '회의개최' && r.marker === '○') {
      task = { title: head, type: f.length > 1 ? f[0] : '', owner: f.length > 1 ? f[f.length - 1] : f[0] ?? '' };
      continue;
    }
    const base = { unit: unit ?? '', sec: r.sec, raw: r.text, days: daysOf(inner || r.text) };
    if (r.sec === '회의개최') {
      entries.push({ ...base, task, content: head, place: f[1] ?? '', people: people(f.slice(2)) });
    } else if (r.sec === '국내출장' || r.sec === '시내출장') {
      // 「과제명 (목적, 일자, 장소, 사람)」
      entries.push({ ...base, task: head ? { title: head, type: '', owner: '' } : null, content: f[0] ?? head, place: f[2] ?? '', people: people(f.slice(3)) });
    } else {
      // 대외활동 · 행사개최 — 「이름(일시, 장소, 사람)」
      entries.push({ ...base, task: null, content: head, place: f[1] ?? '', people: people(f.slice(2)) });
    }
  }
  return { unit, entries };
}

// ── RH-92 같은 일 묶기 ─────────────────────────────

const squash = (s: string) => s.replace(/[\s·,.()[\]「」'"‘’“”:~\-]/g, '');

/** 글자 두 개씩 겹침(Dice) — 한쪽이 다른 쪽에 통째로 들어 있으면 높게 */
export function similarity(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return 0.9;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let both = 0;
  for (const [g, n] of gx) both += Math.min(n, gy.get(g) ?? 0);
  return (2 * both) / Math.max(1, x.length - 1 + (y.length - 1));
}

const sameDay = (a: ErpEntry, b: ErpEntry) => a.days.some(([m, d]) => b.days.some(([m2, d2]) => m === m2 && d === d2));

export function groupEntries(entries: readonly ErpEntry[]): ErpEntry[][] {
  const groups: ErpEntry[][] = [];
  for (const e of entries) {
    const g = e.days.length
      ? groups.find((g) =>
          g.some(
            (f) =>
              // 같은 실 안에서만 — 같은 날 다른 실의 「최종자문회의」는 다른 일이다
              squash(e.unit) === squash(f.unit) &&
              sameDay(e, f) &&
              ((e.task && f.task && similarity(e.task.title, f.task.title) >= 0.8) || similarity(e.content, f.content) >= 0.55),
          ),
        )
      : undefined;
    if (g) g.push(e);
    else groups.push([e]);
  }
  return groups;
}

// ── RH-93 미리 고르기 · RH-94 다듬기 · RH-95 자리 ─────────

export type CandidateSection = 'results' | 'plans' | 'notes';
/** RH-97 — 자문회의 표의 칸: 0 자문회의 · 1 전문가 세미나 · 2 포럼·워크샵 등 · 3 기타 회의 */
export type ConsultKind = 0 | 1 | 2 | 3;

export interface ErpCandidate {
  id: number;
  /** 부서명(PDF 머리) */
  unitKo: string;
  secs: ErpSection[];
  task: ErpTask | null;
  content: string;
  date: string;
  place: string;
  people: string;
  pick: boolean;
  reason: string;
  section: CandidateSection;
  kind: ConsultKind;
  /** 원문(묶인 것 모두) — 화면의 「원문」 */
  raw: string[];
  /** 정렬용 첫 날 [월, 일] */
  first: [number, number] | null;
}

const PREP = /논의|점검|사전|준비|반영|섭외|진행방향|세부사항|자료\s*검토|주간심의|추진일정/;
const MILE = /착수|중간|최종|자문회의|보고회|포럼|세미나|워크숍|워크샵|간담회|라운드테이블|공청회|설명회|심포지엄/;
const OUTSIDE = /서울역|오송|비즈센터|스페이스쉐어|컨퍼런스센터|컨벤션|DCC|AREX|KTX|공항철도|용산역/;

export function kindOf(content: string): ConsultKind {
  if (/세미나/.test(content)) return 1;
  if (/포럼|워크숍|워크샵|라운드테이블/.test(content)) return 2;
  if (/착수|중간|최종|자문|보고회/.test(content)) return 0;
  return 3;
}

/** RH-94 — 내용 다듬기 */
export function tidyContent(s: string): string {
  return s
    .replace(/^(기본과제|일반과제|수탁과제|과제)\s+/, '')
    .replace(/\s*(추진\s*)?계획\s*\(안\)$/, '')
    .replace(/\s*개최$/, '')
    .replace(/\s*참석$/, '')
    .replace(/보고회$/, '보고회의')
    .trim();
}

/** RH-94 — 장소 다듬기(제출본에서 쓰던 짧은 이름) */
export function tidyPlace(s: string): string {
  const p = s.trim();
  if (!p) return '';
  if (/서울역|공항철도|AREX|KTX|비즈센터|스페이스쉐어/.test(p)) return '서울역';
  if (/오송/.test(p)) return '오송역';
  if (/용산역/.test(p)) return '용산역';
  if (/대전컨벤션|DCC/.test(p)) return 'DCC';
  if (/회의실\s*샘/.test(p)) return '회의실샘';
  const room = /(\d{3,4})호/.exec(p);
  if (room && /KEI|한국환경연구원|^\d|회의실|^9층|^10층/.test(p)) return `${room[1]}호`;
  const cut = p.replace(/\(.*?\)/g, '').replace(/\s*\d+(\.\d+)?km\s*$/, '').trim();
  return cut.length > 14 ? cut.slice(0, 14).trim() : cut;
}

function pickRule(g: ErpEntry[], hqKo: string): { pick: boolean; reason: string } {
  const secs = new Set(g.map((e) => e.sec));
  const text = g.map((e) => `${e.content} ${e.place}`).join(' ');
  const contents = g.map((e) => e.content).join(' ');
  const hosted = secs.has('회의개최') || secs.has('행사개최');
  if ([...secs].every((s) => s === '대외활동')) return { pick: false, reason: '대외활동 — 개인 자격' };
  if ([...secs].every((s) => s === '해외출장')) return { pick: false, reason: '해외출장' };
  if (/서면/.test(text)) return { pick: false, reason: '서면' };
  if (PREP.test(contents)) return { pick: false, reason: '준비·내부 논의' };
  if (hosted) {
    if (MILE.test(contents)) return { pick: true, reason: '단계 회의·행사' };
    if (OUTSIDE.test(g.map((e) => e.place).join(' '))) return { pick: true, reason: '외부 회의장' };
    return { pick: false, reason: '내부 회의' };
  }
  if (MILE.test(contents) && g.some((e) => squash(e.unit) === squash(hqKo))) return { pick: true, reason: '본부 공식 일정' };
  if (MILE.test(contents) && /위탁/.test(contents)) return { pick: true, reason: '위탁과제 보고' };
  return { pick: false, reason: '다른 기관 행사 참석' };
}

const ORDER: ErpSection[] = ['회의개최', '행사개최', '국내출장', '시내출장', '해외출장', '대외활동'];

/**
 * RH-92~95 — 건들 → 후보. `hqKo` 본부 이름(본부 자신의 일은 특이사항으로) · `today` [월, 일](뒤의 일은 계획으로).
 * 출장만 있는 일의 유형·책임자는 같은 묶음 안의 회의개최 과제에서 이름으로 찾는다.
 */
export function buildCandidates(entries: readonly ErpEntry[], hqKo: string, today: [number, number]): ErpCandidate[] {
  const known = entries.filter((e) => e.sec === '회의개최' && e.task).map((e) => e.task!);
  const lookup = (t: ErpTask | null): ErpTask | null => {
    if (!t) return null;
    if (t.type || t.owner) return t;
    const hit = known.find((k) => similarity(k.title, t.title) >= 0.8);
    return hit ? { title: hit.title, type: hit.type, owner: hit.owner } : t;
  };
  return groupEntries(entries).map((g, id) => {
    const lead = [...g].sort((a, b) => ORDER.indexOf(a.sec) - ORDER.indexOf(b.sec))[0];
    const days = [...new Map(g.flatMap((e) => e.days).map((d) => [`${d[0]}/${d[1]}`, d] as const)).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const task = lookup(lead.task ?? g.find((e) => e.task)?.task ?? null);
    const who = lead.people.length ? lead.people : g.flatMap((e) => e.people);
    const first = task?.owner && who.includes(task.owner) ? task.owner : who[0] ?? task?.owner ?? '';
    const { pick, reason } = pickRule(g, hqKo);
    const isHq = squash(lead.unit) === squash(hqKo);
    const future = days.length > 0 && (days[days.length - 1][0] > today[0] || (days[days.length - 1][0] === today[0] && days[days.length - 1][1] > today[1]));
    const content = tidyContent(lead.content);
    return {
      id,
      unitKo: lead.unit,
      secs: [...new Set(g.map((e) => e.sec))],
      task,
      content,
      date: formatErpDays(days),
      place: tidyPlace(lead.place || (g.find((e) => e.place)?.place ?? '')),
      people: first ? `${first} 외` : '',
      pick,
      reason,
      // RH-95 — 본부 자신의 일은 특이사항(제출본 실측 — 본부 회의개최도), 뒤의 일은 계획
      section: future ? 'plans' : isHq ? 'notes' : 'results',
      kind: kindOf(content),
      raw: g.map((e) => `[${e.sec}] ${e.raw}`),
      first: days[0] ?? null,
    };
  });
}

