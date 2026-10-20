// RH-70~77 — 연구실(연구 본부·센터 양식) 작성의 서버 쪽: 양식 판정 · 입력 검사와 hwp 만들기 · 우리 실 최근 과제.
import { prisma } from '@/server/db';
import { HttpError } from '@/server/authz';
import { readStoredFile } from '@/server/storage';
import { logger } from '@/server/logger';
import { cleanCell } from '@/server/worklog-doc';
import { normalizeEvaluation } from '@/lib/evaluation';
import { consultLabels, evaluationLabels, fillHqForm, isProjectForm, parseHqForm, type HqFormData, type HqItem, type HqTask } from '@/lib/hwp/hq-form';
import { unitAbbr } from '@/lib/unit-abbr';

export type FormKind = 'unit' | 'project';

/** RH-70 — 양식 판정 캐시. 같은 sha256이면 같은 답이다(양식 파일은 바뀌면 새 판·새 해시) */
const formCache = new Map<string, FormKind>();

export async function templateFormOf(template: { sha256: string; filePath: string }): Promise<FormKind> {
  const hit = formCache.get(template.sha256);
  if (hit) return hit;
  let kind: FormKind = 'unit';
  try {
    kind = isProjectForm(await readStoredFile(template.filePath)) ? 'project' : 'unit';
  } catch (e) {
    logger.warn({ err: String(e), filePath: template.filePath }, '[연구실] 양식 판정 실패 — 실형으로 본다');
  }
  formCache.set(template.sha256, kind);
  return kind;
}

export async function divisionFormOf(divisionId: string): Promise<FormKind> {
  const t = await prisma.template.findFirst({ where: { divisionId, isActive: true }, select: { sha256: true, filePath: true } });
  return t ? templateFormOf(t) : 'unit';
}

// ── RH-75 · RH-77 입력 검사 ────────────────────────────

export const LIMITS = { tasks: 30, items: 30, notes: 30, type: 20 } as const;

interface ItemIn {
  content?: unknown;
  date?: unknown;
  place?: unknown;
  people?: unknown;
  emphasis?: unknown;
}
interface TaskIn {
  /** RH-96 — 구분(실 약칭). 본부·센터 담당·부서장만 — 그 밖은 서버가 부서에서 정한다 */
  unit?: unknown;
  type?: unknown;
  title?: unknown;
  owner?: unknown;
  items?: unknown;
}
export interface ProjectBody {
  kind: 'project';
  results?: unknown;
  plans?: unknown;
  notes?: unknown;
  /** RH-82 — 이 실의 자문회의 실적 넷(자문회의 · 전문가 세미나 · 포럼·워크샵 · 기타 회의). 담당·부서장 것만 받는다 */
  consult?: unknown;
  /** RH-82 — 평가 실적 값(양식의 값 칸 순서). 본부·센터의 담당·부서장 것만 받는다 */
  evaluation?: unknown;
  /** RH-97 — 자문회의 여러 줄 `{label, values[4]}` — 본부·센터 담당·부서장만, 이 본부와 산하 실 줄만 */
  consultRows?: unknown;
}

const COUNT_MAX = 20;
function cleanCounts(raw: unknown, n: number | null, what: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || (n !== null && raw.length !== n) || raw.length > 20) throw new HttpError(422, 'invalid_request', `${what} 형식이 올바르지 않습니다.`);
  const vals = raw.map((v, i) => {
    const c = cleanCell(v, `${what} ${i + 1}번째 칸`);
    if (c.length > COUNT_MAX) throw new HttpError(422, 'cell_too_long', `${what}은 칸마다 ${COUNT_MAX}자까지입니다.`);
    return c;
  });
  return vals.some((v) => v && v !== '-') ? vals : undefined;
}

const SECTION_KO = { results: '실적', plans: '계획', notes: '특이사항' } as const;

function cleanItem(v: ItemIn, where: string): HqItem {
  const it: HqItem = {
    content: cleanCell(v.content, `${where} 내용`),
    date: cleanCell(v.date, `${where} 일자`),
    place: cleanCell(v.place, `${where} 장소`),
    people: cleanCell(v.people, `${where} 참석자`),
  };
  if (v.emphasis === true) it.emphasis = true;
  return it;
}
const hasText = (i: HqItem) => !!(i.content || i.date || i.place || i.people);

function cleanTasks(raw: unknown, key: 'results' | 'plans', unit: string, allowedUnits: readonly string[] = []): HqTask[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(422, 'invalid_request', `${SECTION_KO[key]} 형식이 올바르지 않습니다.`);
  if (raw.length > LIMITS.tasks) throw new HttpError(422, 'too_many', `${SECTION_KO[key]} 과제는 ${LIMITS.tasks}개까지입니다.`);
  const out: HqTask[] = [];
  raw.forEach((t: TaskIn, ti) => {
    const where = `${SECTION_KO[key]} ${ti + 1}번 과제`;
    const items = Array.isArray(t?.items) ? (t.items as ItemIn[]) : [];
    if (items.length > LIMITS.items) throw new HttpError(422, 'too_many', `${where}의 항목은 ${LIMITS.items}개까지입니다.`);
    const type = cleanCell(t?.type, `${where} 유형`);
    if (type.length > LIMITS.type) throw new HttpError(422, 'cell_too_long', `${where}의 유형은 ${LIMITS.type}자까지입니다.`);
    const asked = typeof t?.unit === 'string' ? t.unit.trim() : '';
    const task: HqTask = {
      unit: asked && allowedUnits.includes(asked) ? asked : unit, // RH-96 — 고른 구분은 이 본부·산하 실 약칭일 때만
      type,
      title: cleanCell(t?.title, `${where} 과제명`),
      owner: cleanCell(t?.owner, `${where} 책임자`),
      items: items.map((it, ii) => cleanItem(it ?? {}, `${where} ${ii + 1}번 항목`)).filter(hasText),
    };
    if (task.items.length === 0) return; // RH-33 — 항목 없는 과제는 나가지 않는다
    if (!task.title) throw new HttpError(422, 'invalid_request', `${where}의 과제명을 적어 주세요.`);
    out.push(task);
  });
  return out;
}

/**
 * RH-75 — 본문을 검사해 본부 양식에 채운 hwp를 만든다. 실 약칭은 부서에서(쓰는 사람이 고르지 않는다).
 * RH-82 — `counts`(담당·부서장)일 때만 자문회의 줄·평가 실적을 싣는다 — 부서원이 보낸 값은 버린다(화면도 그리지 않는다)
 */
export function buildProjectHwp(
  templateBytes: Buffer,
  body: ProjectBody,
  divisionNameKo: string,
  opts: { counts?: boolean; hq?: HqScope | null } = {},
): { bytes: Buffer; data: HqFormData } {
  const unit = unitAbbr(divisionNameKo);
  const hq = opts.counts ? opts.hq ?? null : null; // RH-96 · RH-97 — 본부·센터 담당·부서장일 때만
  const allowed = hq ? hq.units.map((u) => u.abbr) : [];
  const notesRaw = body.notes ?? [];
  if (!Array.isArray(notesRaw)) throw new HttpError(422, 'invalid_request', '특이사항 형식이 올바르지 않습니다.');
  if (notesRaw.length > LIMITS.notes) throw new HttpError(422, 'too_many', `특이사항은 ${LIMITS.notes}줄까지입니다.`);
  const data: HqFormData = {
    results: cleanTasks(body.results, 'results', unit, allowed),
    plans: cleanTasks(body.plans, 'plans', unit, allowed),
    notes: (notesRaw as ItemIn[]).map((n, i) => cleanItem(n ?? {}, `특이사항 ${i + 1}번`)).filter(hasText),
  };
  const consult = opts.counts ? cleanCounts(body.consult, 4, '자문회의 실적') : undefined;
  const evaluation = opts.counts ? cleanCounts(body.evaluation, null, '평가 실적') : undefined;
  if (consult) data.consult = [{ label: divisionNameKo, values: consult }];
  if (hq && body.consultRows !== undefined && body.consultRows !== null) {
    if (!Array.isArray(body.consultRows) || body.consultRows.length > hq.units.length) throw new HttpError(422, 'invalid_request', '자문회의 실적 형식이 올바르지 않습니다.');
    const names = new Map(hq.units.map((u) => [u.nameKo.replace(/\s+/g, ''), u.nameKo]));
    const rows: { label: string; values: string[] }[] = [];
    for (const r of body.consultRows as { label?: unknown; values?: unknown }[]) {
      const label = typeof r?.label === 'string' ? names.get(r.label.replace(/\s+/g, '')) : undefined;
      if (!label) throw new HttpError(422, 'invalid_request', '자문회의 실적에 이 본부 밖의 줄이 있습니다.');
      const values = cleanCounts(r.values, 4, `자문회의 실적(${label})`);
      if (values) rows.push({ label, values });
    }
    if (rows.length) data.consult = rows;
  }
  // RH-89 — 「8」 → 「8건」 · 비워 둔 총 검토건수는 합으로(양식의 이름 칸 순서)
  if (evaluation) data.evaluation = normalizeEvaluation(evaluationLabels(templateBytes), evaluation);
  const items = (ts: HqTask[]) => ts.reduce((a, t) => a + t.items.length, 0);
  if (items(data.results) + items(data.plans) + data.notes.length === 0 && !data.consult?.length && !evaluation) {
    throw new HttpError(422, 'empty_content', '항목을 하나 이상 적어 주세요.');
  }
  if (!isProjectForm(templateBytes)) {
    throw new HttpError(409, 'form_mismatch', '부서 양식이 연구실 양식이 아닙니다 — 화면을 새로 고쳐 주세요.');
  }
  const bytes = fillHqForm(templateBytes, data);
  // RH-36 — 만든 것을 다시 읽어 넣은 대로인지
  const back = parseHqForm(bytes);
  if (items(back.results) !== items(data.results) || items(back.plans) !== items(data.plans) || back.notes.length !== data.notes.length) {
    logger.error({ want: [items(data.results), items(data.plans), data.notes.length], got: [items(back.results), items(back.plans), back.notes.length] }, '[연구실] 만든 hwp 다시 읽기 불일치');
    throw new HttpError(500, 'internal', '문서를 만들다 내용이 어긋났습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  return { bytes, data };
}

// ── RH-71 · RH-72 · RH-74 우리 실 최근 과제 ──────────

export interface RecentTask {
  type: string;
  title: string;
  owner: string;
  /** 가장 최근에 쓰인 주차(`2026-W42`) */
  lastIsoKey: string;
  /** 6주 동안 몇 번(사람·주차) 쓰였나 */
  uses: number;
  /** 이번 주에 누가 이미 썼다 */
  thisWeek: boolean;
}

export interface RecentForDivision {
  tasks: RecentTask[];
  places: string[];
  people: string[];
  /** RH-74 — 내가 지난주에 낸 판의 계획 */
  lastWeekPlans: HqTask[];
}

const WEEKS_BACK = 6;
const key = (t: { type: string; title: string; owner: string }) => `${t.title.replace(/\s+/g, '')}|${t.owner.replace(/\s+/g, '')}`;

export async function recentForDivision(divisionId: string, userId: string, currentSlot: { id: string; opensAt: Date }): Promise<RecentForDivision> {
  const slots = await prisma.weekSlot.findMany({
    where: { opensAt: { lte: currentSlot.opensAt } },
    orderBy: { opensAt: 'desc' },
    take: WEEKS_BACK,
    select: { id: true, isoKey: true },
  });
  const order = new Map(slots.map((s, i) => [s.id, i]));
  const subs = await prisma.submission.findMany({
    where: { divisionId, isLatest: true, weekSlotId: { in: slots.map((s) => s.id) } },
    select: { userId: true, weekSlotId: true, filePath: true },
  });
  const tasks = new Map<string, RecentTask & { rank: number }>();
  const places = new Map<string, number>();
  const people = new Map<string, number>();
  let lastWeekPlans: HqTask[] = [];
  const bump = (m: Map<string, number>, v: string) => {
    const t = v.trim();
    if (t && t !== '-' && t.length <= 40) m.set(t, (m.get(t) ?? 0) + 1);
  };
  for (const s of subs) {
    let data: HqFormData;
    try {
      data = parseHqForm(await readStoredFile(s.filePath));
    } catch {
      continue; // 실형으로 낸 옛 판 등 — 목록에서 빠질 뿐이다
    }
    const rank = order.get(s.weekSlotId) ?? WEEKS_BACK;
    const isoKey = slots[rank]?.isoKey ?? '';
    for (const t of [...data.results, ...data.plans]) {
      if (!t.title.trim()) continue;
      const k = key(t);
      const prev = tasks.get(k);
      if (!prev) tasks.set(k, { type: t.type, title: t.title, owner: t.owner, lastIsoKey: isoKey, uses: 1, thisWeek: rank === 0, rank });
      else {
        prev.uses += 1;
        if (rank < prev.rank) Object.assign(prev, { type: t.type, title: t.title, owner: t.owner, lastIsoKey: isoKey, rank });
        if (rank === 0) prev.thisWeek = true;
      }
      for (const it of t.items) {
        bump(places, it.place);
        bump(people, it.people);
      }
    }
    for (const it of data.notes) bump(places, it.place);
    if (rank === 1 && s.userId === userId) lastWeekPlans = data.plans;
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([v]) => v);
  return {
    tasks: [...tasks.values()]
      .sort((a, b) => a.rank - b.rank || b.uses - a.uses || a.title.localeCompare(b.title, 'ko'))
      .map((t) => ({ type: t.type, title: t.title, owner: t.owner, lastIsoKey: t.lastIsoKey, uses: t.uses, thisWeek: t.thisWeek })),
    places: top(places),
    people: top(people),
    lastWeekPlans,
  };
}

// ── RH-82 · RH-90 · RH-96 작성 화면이 그릴 칸 ──────────

export interface HqScope {
  /** 이 본부와 산하 실 — 자문회의 표 줄 순서(양식). 첫째가 본부 자신 */
  units: { nameKo: string; abbr: string }[];
}

/**
 * RH-96 · RH-97 — 본부·센터 부서(산하 실이 있고 양식이 연구실 것)면 그 본부와 산하 실의 이름·약칭, 아니면 null.
 * 이름은 양식의 자문회의 줄에서 읽는다 — 화면·서버·병합이 같은 줄 이름을 쓴다.
 */
export async function hqScopeOf(division: { id: string; nameKo: string }): Promise<HqScope | null> {
  if ((await prisma.division.count({ where: { parentKo: division.nameKo } })) === 0) return null;
  const t = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true }, select: { sha256: true, filePath: true } });
  if (!t || (await templateFormOf(t)) !== 'project') return null;
  let labels: string[] = [];
  try {
    labels = consultLabels(await readStoredFile(t.filePath));
  } catch {
    labels = [];
  }
  const self = division.nameKo.replace(/\s+/g, '');
  if (!labels.some((l) => l.replace(/\s+/g, '') === self)) labels = [division.nameKo, ...labels];
  return { units: labels.map((l) => ({ nameKo: l, abbr: unitAbbr(l) })) };
}

export interface ProjectDesk {
  /** 담당·부서장 — 자문회의(·평가) 칸을 그린다 */
  canCount: boolean;
  /** 자문회의 표에서 이 실의 줄 이름 */
  consultLabel: string;
  /** 평가 실적 이름 칸들 — 본부·센터 부서이고 양식에 평가 실적 표가 있을 때만(실은 쓰지 않는다) */
  evaluationLabels: string[];
  /** RH-90 — [ERP 보고서 가져오기] · RH-96 구분 고르기 · RH-97 자문회의 여러 줄: 본부·센터 담당·부서장에게만 */
  hq?: HqScope;
}

export async function projectDesk(division: { id: string; nameKo: string }, canCount: boolean): Promise<ProjectDesk> {
  const hq = canCount ? await hqScopeOf(division) : null;
  let labels: string[] = [];
  if (hq) {
    const t = await prisma.template.findFirst({ where: { divisionId: division.id, isActive: true }, select: { filePath: true } });
    try {
      labels = t ? evaluationLabels(await readStoredFile(t.filePath)) : [];
    } catch {
      labels = [];
    }
  }
  return { canCount, consultLabel: division.nameKo, evaluationLabels: labels, ...(hq ? { hq } : {}) };
}
