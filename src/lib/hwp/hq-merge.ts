// RH-80~86 — 연구실 병합(실)과 본부 합치기. 둘 다 **데이터로** 합친다 — hwp는 양식에 한 번 쓴다(RH-30 · fillHqForm).
// AI 중복 묶기·분류를 쓰지 않는다: 과제가 묶음의 단위이고(RH-20), 같은 과제 아래 같은 항목은 글자로 같을 때만 하나로 친다(RH-40).
import type { HqFormData, HqItem, HqTask } from './hq-form';

const norm = (s: string) => s.replace(/\s+/g, '');
const taskKey = (t: Pick<HqTask, 'title' | 'owner'>) => `${norm(t.title)}|${norm(t.owner)}`;
const itemKey = (i: HqItem) => `${norm(i.content)}|${norm(i.date)}|${norm(i.place)}`;
const filled = (vals: readonly string[] | undefined) => !!vals && vals.some((v) => v.trim() !== '' && v.trim() !== '-');

export interface PersonDoc {
  name: string;
  /** 담당·부서장 — 자문회의·평가 실적을 이 사람 것에서 먼저 가져온다(RH-82) */
  isManager: boolean;
  data: HqFormData;
}

export interface AuthoredItem {
  content: string;
  authors: string[];
}

export interface MergedProject {
  data: HqFormData;
  /** 화면의 「누가 썼나」(TACP-17) — 표에 들어간 항목 순서 그대로 */
  authors: { results: AuthoredItem[]; plans: AuthoredItem[]; notes: AuthoredItem[] };
  /** 둘 이상이 같은 항목을 적어 하나로 친 수 */
  merged: number;
  warnings: string[];
}

/**
 * RH-80 — 실 병합: 사람 순서대로(명단 순 — 부르는 쪽이 정렬해 넘긴다) 과제를 처음 나온 자리에 두고 그 아래에 항목을 모은다.
 * 같은 과제 = 과제명·책임자가 같다(띄어쓰기 무시). 같은 항목 = 같은 과제 아래 내용·일자·장소가 같다 → 하나로, 강조는 누구라도 했으면 강조.
 * RH-82 — 자문회의(이 실의 줄)·평가 실적은 담당·부서장이 적은 것을 먼저, 없으면 누구든 적은 것 하나.
 */
export function mergeProjectDocs(people: readonly PersonDoc[], unitNameKo: string): MergedProject {
  let merged = 0;
  const warnings: string[] = [];
  const section = (pick: (d: HqFormData) => HqTask[]) => {
    const order: string[] = [];
    const byKey = new Map<string, { task: HqTask; items: { item: HqItem; authors: Set<string> }[] }>();
    for (const p of people) {
      for (const t of pick(p.data)) {
        const k = taskKey(t);
        if (!byKey.has(k)) {
          byKey.set(k, { task: { ...t, items: [] }, items: [] });
          order.push(k);
        }
        const slot = byKey.get(k)!;
        if (!slot.task.type && t.type) slot.task.type = t.type;
        for (const it of t.items) {
          const same = slot.items.find((x) => itemKey(x.item) === itemKey(it));
          if (same) {
            same.authors.add(p.name);
            if (it.emphasis) same.item.emphasis = true;
            if (!same.item.people.trim() && it.people.trim()) same.item.people = it.people;
            merged += 1;
          } else slot.items.push({ item: { ...it }, authors: new Set([p.name]) });
        }
      }
    }
    const tasks = order.map((k) => ({ ...byKey.get(k)!.task, items: byKey.get(k)!.items.map((x) => x.item) }));
    const authors = order.flatMap((k) => byKey.get(k)!.items.map((x) => ({ content: x.item.content, authors: [...x.authors] })));
    return { tasks, authors };
  };
  const results = section((d) => d.results);
  const plans = section((d) => d.plans);

  const notes: { item: HqItem; authors: Set<string> }[] = [];
  for (const p of people) {
    for (const n of p.data.notes) {
      const same = notes.find((x) => itemKey(x.item) === itemKey(n));
      if (same) {
        same.authors.add(p.name);
        merged += 1;
      } else notes.push({ item: { ...n }, authors: new Set([p.name]) });
    }
  }

  // RH-82 — 담당·부서장 먼저, 그다음 누구든. 둘 이상이 서로 다르게 적었으면 알린다(고르는 것은 사람 몫이다)
  // RH-97 — 줄마다 따로 고른다: 본부·센터 담당은 산하 실 줄도 적는다(서버가 그 본부의 줄만 받았다). 이 실 자신의 줄은 부서 이름으로
  const byPriority = [...people.filter((p) => p.isManager), ...people.filter((p) => !p.isManager)];
  const labels: string[] = [];
  for (const p of people) for (const c of p.data.consult ?? []) if (filled(c.values) && !labels.some((l) => norm(l) === norm(c.label))) labels.push(c.label);
  labels.sort((a, b) => (norm(b) === norm(unitNameKo) ? 1 : 0) - (norm(a) === norm(unitNameKo) ? 1 : 0));
  const distinct = (vals: (readonly string[] | undefined)[]) => new Set(vals.filter(filled).map((v) => JSON.stringify(v))).size;
  const consult: { label: string; values: readonly string[] }[] = [];
  for (const label of labels) {
    const rowOf = (p: PersonDoc) => p.data.consult?.find((c) => norm(c.label) === norm(label))?.values;
    const from = byPriority.find((p) => filled(rowOf(p)))!;
    const own = norm(label) === norm(unitNameKo);
    consult.push({ label: own ? unitNameKo : label, values: rowOf(from)! });
    if (distinct(people.map(rowOf)) > 1) warnings.push(`자문회의 실적${own ? '' : `(${label})`}을 여러 사람이 다르게 적었습니다 — ${from.name} 님 것을 넣었습니다`);
  }
  const evalFrom = byPriority.find((p) => filled(p.data.evaluation));
  if (distinct(people.map((p) => p.data.evaluation)) > 1) warnings.push(`평가 실적을 여러 사람이 다르게 적었습니다 — ${evalFrom!.name} 님 것을 넣었습니다`);

  return {
    data: {
      results: results.tasks,
      plans: plans.tasks,
      notes: notes.map((x) => x.item),
      consult,
      ...(evalFrom ? { evaluation: evalFrom.data.evaluation } : {}),
    },
    authors: { results: results.authors, plans: plans.authors, notes: notes.map((x) => ({ content: x.item.content, authors: [...x.authors] })) },
    merged,
    warnings,
  };
}

export interface UnitDoc {
  /** 실(또는 본부 자신)의 부서 이름 — 자문회의 줄 이름과 같다 */
  nameKo: string;
  data: HqFormData;
}

/**
 * RH-84 — 본부 합치기: 실 병합본(올라온 것)들을 **본부가 정한 순서대로**(부르는 쪽이 정렬) 한 표에 늘어놓는다(RH-10).
 * 과제의 구분 칸(실 약칭)은 실 병합본이 이미 들고 있다. 자문회의는 실마다 자기 줄을, 본부 줄과 평가 실적은 본부 자신의 병합본에서.
 * 번호는 표마다 처음부터 다시 매긴다(RH-32 — 쓸 때 매긴다).
 */
export function combineHqDocs(units: readonly UnitDoc[], hqNameKo: string): HqFormData {
  const hq = units.find((u) => norm(u.nameKo) === norm(hqNameKo));
  const consult = units.flatMap((u) => {
    const row = u.data.consult?.find((c) => norm(c.label) === norm(u.nameKo) && filled(c.values));
    return row ? [{ label: u.nameKo, values: row.values }] : [];
  });
  // RH-97 — 산하 실 자신의 줄이 없으면 본부 판의 그 줄(본부·센터 담당이 대신 적은 것). 다른 실 판에 적힌 남의 줄은 쓰지 않는다
  for (const c of hq?.data.consult ?? []) {
    if (norm(c.label) === norm(hqNameKo) || !filled(c.values) || consult.some((x) => norm(x.label) === norm(c.label))) continue;
    consult.push({ label: c.label, values: c.values });
  }
  return {
    results: units.flatMap((u) => u.data.results),
    plans: units.flatMap((u) => u.data.plans),
    notes: units.flatMap((u) => u.data.notes),
    consult,
    ...(hq?.data.evaluation && filled(hq.data.evaluation) ? { evaluation: hq.data.evaluation } : {}),
  };
}

/** 항목 수 — 기록(rowCounts)·화면 줄 수 */
export function itemCounts(d: HqFormData): { achievements: number; plans: number; notes: number } {
  const n = (ts: HqTask[]) => ts.reduce((a, t) => a + t.items.length, 0);
  return { achievements: n(d.results), plans: n(d.plans), notes: d.notes.length };
}
