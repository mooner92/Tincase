// WA-35 · WA-36 — 웹 작성 화면의 순수 판단. 화면 밖에서 시험할 수 있게 여기 둔다.

type Bucket = 'achievements' | 'plans' | 'notes';
const BUCKETS: Bucket[] = ['achievements', 'plans', 'notes'];
export type Buckets<R> = Record<Bucket, R[]>;

/** 어디서 시작했나 — 화면 맨 위 한 줄이 이것을 말한다 */
export type ComposerFrom = 'draft' | 'submission' | 'blank';

const hasContent = <R extends { content: string }>(d: Partial<Buckets<R>> | null | undefined) =>
  !!d && BUCKETS.some((b) => d[b]?.some((r) => typeof r?.content === 'string' && r.content.trim() !== ''));

/** 브라우저 임시본. 모양이 틀리면(깨졌거나 옛 형식) 없는 것으로 친다 — 조용히 버린다 */
function parseDraft<R extends { content: string }>(raw: string | null): Buckets<R> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Buckets<R>> | null;
    if (!v || typeof v !== 'object' || !BUCKETS.every((b) => Array.isArray(v[b]))) return null;
    return v as Buckets<R>;
  } catch {
    return null;
  }
}

/**
 * WA-35 — [웹에서 작성]을 어디서 시작하나.
 *
 *   1. 같은 주차의 **저장 안 한 임시본**(내용이 한 줄이라도 있는 것) — 적던 것을 지우지 않는다
 *   2. **지금 낸 판** — 한 줄 고치려고 일곱 줄을 다시 적게 하지 않는다. 표마다 이어 적을 빈 줄을 붙인다
 *   3. 빈 표
 *
 * 내용 없는 임시본은 임시본이 아니다. 예전 화면은 열기만 해도 빈 표를 임시본으로 써 두었는데,
 * 그걸 1번으로 치면 「다시 작성」이 또 빈 표로 열린다.
 */
export function composerStart<R extends { content: string }>(
  draftRaw: string | null,
  submitted: Partial<Buckets<R>> | null | undefined,
  blank: () => R,
): { data: Buckets<R>; from: ComposerFrom } {
  const draft = parseDraft<R>(draftRaw);
  if (draft && hasContent(draft)) return { data: draft, from: 'draft' };
  if (submitted && hasContent(submitted)) {
    const pick = (b: Bucket) => [...(submitted[b] ?? []).map((r) => ({ ...r })), blank()];
    return { data: { achievements: pick('achievements'), plans: pick('plans'), notes: pick('notes') }, from: 'submission' };
  }
  return { data: { achievements: [blank(), blank(), blank()], plans: [blank(), blank()], notes: [blank()] }, from: 'blank' };
}

/**
 * WA-36a — 일자 칸 예시 「M/D」: 그 주(월요일 00:00 KST = `weekStartMs`) 화요일, `weeksAhead`주 뒤.
 * 고정 예시 '8/20'은 10월엔 낡은 날짜라 「이렇게 적는다」가 아니라 「틀린 날짜」로 읽힌다.
 * KST는 서머타임이 없어 +9시간이면 UTC 필드가 곧 한국 날짜다 — 실행 TZ와 상관없다.
 */
export function dateHint(weekStartMs: number, weeksAhead = 0): string {
  const d = new Date(weekStartMs + (1 + 7 * weeksAhead) * 86_400_000 + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** WA-37이 비교하는 칸 — 문서로 나가는 것 전부 */
interface Comparable {
  content: string;
  date?: string;
  place?: string;
  attendee?: string;
  emphasis?: boolean;
}

/**
 * WA-37 — 두 표가 **내용으로** 같은가. 표마다 내용 있는 줄만, 칸은 앞뒤 공백을 뺀 값으로, 순서대로 견준다.
 *
 * 예전 「손대기 전」 판정은 참조 비교(`data === start.data`)였다. 한 글자 쳤다 지우기만 해도 「바뀜」이라
 * [제출]이 켜지고, 같은 내용의 새 판이 생겼다(2판 이상 0건인 지금도 그 길은 열려 있었다).
 * 내용 없는 줄은 제출 때 빠지므로(끝의 빈 줄 포함) 보지 않는다. 「공유」를 켜면 문서 색이 바뀌므로 다르다.
 */
export function sameRows<R extends Comparable>(a: Buckets<R> | null | undefined, b: Buckets<R> | null | undefined): boolean {
  const norm = (rows: R[] | undefined) =>
    (rows ?? [])
      .filter((r) => typeof r?.content === 'string' && r.content.trim() !== '')
      .map((r) => [r.content.trim(), (r.date ?? '').trim(), (r.place ?? '').trim(), (r.attendee ?? '').trim(), r.emphasis === true]);
  return BUCKETS.every((k) => JSON.stringify(norm(a?.[k])) === JSON.stringify(norm(b?.[k])));
}

/**
 * WA-37 — [제출]이 꺼져 있는가. 화면은 이 식 하나로 정한다(WA-T51).
 *
 * `done`: 낸 뒤 작성 화면이 닫히기까지(0.9초) 다시 누르지 못하게 한다. 예전에는 응답이 오면 `busy`가 풀리면서
 * [제출]이 다시 켜졌다 — 「제출되었습니다」를 보고 한 번 더 누르면 같은 내용의 판이 하나 더 생겼다(2026-10-08 UX 리뷰).
 */
export function submitBlocked(s: { busy: boolean; done: boolean; filled: number; from: ComposerFrom; unchanged: boolean }): boolean {
  return s.busy || s.done || s.filled === 0 || (s.from === 'submission' && s.unchanged);
}
