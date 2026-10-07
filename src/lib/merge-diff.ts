// HM-47 — 부서장이 병합본을 **어떻게** 고쳤나. 담당자 알림과 화면이 같은 결과를 쓴다.
//
// 순수 함수다. 표마다 내용 글자로 최장 공통 부분열(LCS)을 맞추고, 짝이 안 맞는 줄을 같은 틈 안에서
// 「고침」으로 묶는다. 구분 번호는 저장 때 다시 매기므로(ABS-5) 비교하지 않는다.
import { BUCKETS, type BucketKey } from './merge-rows';

export interface DiffRow {
  content: string;
  date: string;
  place: string;
  attendee: string;
  emphasis: boolean;
}

export type ChangeOp = 'add' | 'remove' | 'edit' | 'move';

export interface RowChange {
  bucket: BucketKey;
  op: ChangeOp;
  /** 고치기 전 내용 (add면 없음) */
  before?: string;
  /** 고친 뒤 내용 (remove면 없음) */
  after?: string;
  /** 내용 말고 바뀐 칸 — 「일자」·「장소」·「참석자」·「공유」 */
  fields?: string[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function sideFields(x: DiffRow, y: DiffRow): string[] {
  const f: string[] = [];
  if (norm(x.date) !== norm(y.date)) f.push('일자');
  if (norm(x.place) !== norm(y.place)) f.push('장소');
  if (norm(x.attendee) !== norm(y.attendee)) f.push('참석자');
  if (x.emphasis !== y.emphasis) f.push('공유');
  return f;
}

/** 한 표의 바뀐 곳 */
export function diffTable(bucket: BucketKey, before: readonly DiffRow[], after: readonly DiffRow[]): RowChange[] {
  const a = before.map((r) => norm(r.content));
  const b = after.map((r) => norm(r.content));
  const pairs = lcs(a, b);
  const out: RowChange[] = [];

  // 1) 같은 글끼리 맞은 줄 — 곁칸·공유 표시만 바뀌었을 수 있다
  for (const [i, j] of pairs) {
    const f = sideFields(before[i], after[j]);
    if (f.length) out.push({ bucket, op: 'edit', before: before[i].content, after: after[j].content, fields: f });
  }

  // 2) 맞지 않은 줄 중 같은 글이 양쪽에 있으면 **자리만 옮긴 것**이다 — 「뺌+더함」으로 겁주지 않는다
  const usedA = new Set(pairs.map(([i]) => i));
  const usedB = new Set(pairs.map(([, j]) => j));
  for (let i = 0; i < a.length; i++) {
    if (usedA.has(i)) continue;
    const j = b.findIndex((x, k) => !usedB.has(k) && x === a[i]);
    if (j < 0) continue;
    usedA.add(i);
    usedB.add(j);
    // 옮기면서 곁칸·공유 표시도 바꿨을 수 있다 — 「옮김」만 적으면 그 고침이 기록에서 사라진다
    const f = sideFields(before[i], after[j]);
    out.push({ bucket, op: 'move', before: before[i].content, after: after[j].content, ...(f.length ? { fields: f } : {}) });
  }

  // 3) 남은 줄 — 맞은 줄 사이의 같은 틈 안에서 차례로 「고침(글)」, 남는 것은 뺌·더함
  const anchors: [number, number][] = [...pairs, [a.length, b.length]];
  let pi = 0;
  let pj = 0;
  for (const [i1, j1] of anchors) {
    const olds: number[] = [];
    const news: number[] = [];
    for (let i = pi; i < i1; i++) if (!usedA.has(i)) olds.push(i);
    for (let j = pj; j < j1; j++) if (!usedB.has(j)) news.push(j);
    const k = Math.min(olds.length, news.length);
    for (let t = 0; t < k; t++) {
      const x = before[olds[t]];
      const y = after[news[t]];
      const f = sideFields(x, y);
      out.push({ bucket, op: 'edit', before: x.content, after: y.content, ...(f.length ? { fields: f } : {}) });
    }
    for (const i of olds.slice(k)) out.push({ bucket, op: 'remove', before: before[i].content });
    for (const j of news.slice(k)) out.push({ bucket, op: 'add', after: after[j].content });
    pi = i1 + 1;
    pj = j1 + 1;
  }
  return out;
}

export function diffWorklog(
  before: Record<BucketKey, readonly DiffRow[]>,
  after: Record<BucketKey, readonly DiffRow[]>,
): RowChange[] {
  return BUCKETS.flatMap((b) => diffTable(b, before[b] ?? [], after[b] ?? []));
}

const TABLE = { achievements: '실적', plans: '계획', notes: '특이' } as const;
const VERB: Record<ChangeOp, string> = { edit: '고침', remove: '뺌', add: '더함', move: '옮김' };

/** 「실적 2줄 고침 · 1줄 뺌 · 계획 1줄 더함」. 바뀐 것이 없으면 「고친 곳 없음」 */
export function summarizeChanges(changes: readonly RowChange[]): string {
  if (changes.length === 0) return '고친 곳 없음';
  const parts: string[] = [];
  for (const b of BUCKETS) {
    const mine = changes.filter((c) => c.bucket === b);
    if (!mine.length) continue;
    const counts = (['edit', 'remove', 'add', 'move'] as ChangeOp[])
      .map((op) => [op, mine.filter((c) => c.op === op).length] as const)
      .filter(([, n]) => n > 0)
      .map(([op, n]) => `${n}줄 ${VERB[op]}`);
    parts.push(`${TABLE[b]} ${counts.join(' · ')}`);
  }
  return parts.join(' · ');
}

const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 알림·화면용 한 줄 — 「실적 「보도자료 배포(1건)」 → 「보도자료 배포(2건)」」 */
export function describeChange(c: RowChange): string {
  const t = TABLE[c.bucket];
  if (c.op === 'add') return `${t} 더함 「${clip(c.after ?? '')}」`;
  if (c.op === 'remove') return `${t} 뺌 「${clip(c.before ?? '')}」`;
  if (c.op === 'move') return `${t} 옮김 「${clip(c.before ?? '')}」${c.fields?.length ? ` · ${c.fields.join('·')} 고침` : ''}`;
  if (c.before === c.after) return `${t} 「${clip(c.before ?? '')}」 ${c.fields?.join('·') ?? ''} 고침`;
  return `${t} 「${clip(c.before ?? '')}」 → 「${clip(c.after ?? '')}」`;
}
