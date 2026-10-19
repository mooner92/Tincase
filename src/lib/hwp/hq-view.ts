// RH-85 · RH-88 — 연구실 문서(제출물 · 병합본 · 본부본)를 화면의 표 격자로. 두 층 표는 한 격자에 과제 줄과 항목 줄을 번갈아 놓는다.
// 제출물 보기 드로어와 병합본 드로어가 같은 것을 쓴다(두 벌이면 갈라진다).
import { evaluationLabels, parseHqForm, type HqTask } from './hq-form';

export interface ViewTable {
  key: string;
  title: string;
  columns: string[];
  /** 첫 줄이 머리 */
  rows: string[][];
  emphasis?: boolean[];
  /** 과제 줄(두 층 표의 윗층) — 화면이 굵게 그린다. 본문 행과 나란하다 */
  taskRows?: boolean[];
}

const PROJECT_COLS = ['구분', '유형 · 번호', '과제명 · 내용', '일자', '장소', '책임자 · 참석자'];
const CONSULT_COLS = ['구분', '자문회의', '전문가 세미나', '포럼, 워크샵 등', '기타 회의'];
const NOTE_COLS = ['구분', '업무실적 내용', '일자', '장소', '참석자'];

function grid(tasks: HqTask[], prefix: number) {
  const rows: string[][] = [];
  const emphasis: boolean[] = [];
  const taskRows: boolean[] = [];
  let n = 0;
  let prev: string | null = null;
  for (const t of tasks) {
    rows.push([t.unit !== prev ? t.unit : '', t.type, t.title, '', '', t.owner]);
    emphasis.push(false);
    taskRows.push(true);
    prev = t.unit;
    for (const it of t.items) {
      n += 1;
      rows.push(['', `${prefix}-${n}`, it.content, it.date, it.place, it.people]);
      emphasis.push(it.emphasis === true);
      taskRows.push(false);
    }
  }
  return { rows, emphasis, taskRows };
}

/** 연구실 hwp → 화면 표들(자문회의 · 평가 실적 · 1 · 2 · 3). 빈 표는 머리만 */
export function projectTables(bytes: Buffer, opts: { onlyConsultOf?: string } = {}): ViewTable[] {
  const d = parseHqForm(bytes);
  const r = grid(d.results, 1);
  const p = grid(d.plans, 2);
  const evalNames = evaluationLabels(bytes);
  const squash = (s: string) => s.replace(/\s+/g, '');
  const consult = (d.consult ?? []).filter((c) => !opts.onlyConsultOf || squash(c.label) === squash(opts.onlyConsultOf));
  const hasEval = (d.evaluation ?? []).some((v) => v.trim() && v.trim() !== '-');
  return [
    ...(consult.some((c) => c.values.some((v) => v.trim() && v.trim() !== '-')) || !opts.onlyConsultOf
      ? [{ key: 'consult', title: '※ 자문회의 실적', columns: CONSULT_COLS, rows: [CONSULT_COLS, ...consult.map((c) => [c.label, ...c.values])] }]
      : []),
    ...(evalNames.length && (hasEval || !opts.onlyConsultOf)
      ? [{ key: 'evaluation', title: '※ 평가 실적', columns: ['항목', '건수'], rows: [['항목', '건수'], ...evalNames.map((n, i) => [n, d.evaluation?.[i] ?? '-'])] }]
      : []),
    { key: 'achievements', title: '1. 주요 업무실적', columns: PROJECT_COLS, rows: [PROJECT_COLS, ...r.rows], emphasis: r.emphasis, taskRows: r.taskRows },
    { key: 'plans', title: '2. 주요 업무계획', columns: PROJECT_COLS, rows: [PROJECT_COLS, ...p.rows], emphasis: p.emphasis, taskRows: p.taskRows },
    {
      key: 'notes',
      title: '3. 기타 특이사항',
      columns: NOTE_COLS,
      rows: [NOTE_COLS, ...d.notes.map((n, i) => [`3-${i + 1}`, n.content, n.date, n.place, n.people])],
      emphasis: d.notes.map((n) => n.emphasis === true),
    },
  ];
}
