// PG-84 — 첫 로그인 **화면 둘러보기**. 실제 화면 위에 체험하기와 같은 말풍선·고리를 놓아 「어디에 무엇이 있나」만 짚는다.
//
// 사용자(2026-10-08): 「처음이시죠? 30초 둘러보기 [시작] [괜찮아요]」 — 구석의 작은 카드, 방해하지 않게. 그래서 여기 규칙은 셋이다:
//   1. **한 번만 권한다.** 시작이든 괜찮아요든 고르면 그 장은 다시 저절로 뜨지 않는다(기록은 서버 — DM-25)
//   2. **새 역할만 다시 권한다.** 장은 체험하기와 같은 쌓기(`stackedChapters` — 부서원 → + 부서담당자 → …)라, 담당자가 된
//      부서원에게는 「부서담당자」 장 하나만 권한다
//   3. **실제 화면에 이미 있는 것만 짚는다.** 단계는 앵커(`data-guide`)를 가리키고, 그 사람에게 그려지지 않은 앵커는 건너뛴다
//      (TACP-9가 거른 화면 그대로 — 보이는 것을 늘리지 않는다)
// 순수 함수만 둔다 — 제안·장·단계 고르기를 테스트로 고정한다(PG-T148~150).
import { ROLE_CHAPTERS, stackedChapters, type GuideCap, type RoleChapterId } from './deck';

export type TourChapterId = RoleChapterId;
export const TOUR_OUTCOMES = ['dismissed', 'started', 'done', 'skipped'] as const;
export type TourOutcome = (typeof TOUR_OUTCOMES)[number];

/** 둘러보기의 판 — 내용이 크게 바뀌어 모두에게 다시 권해야 할 때 올린다(DM-25 `version`) */
export const TOUR_VERSION = 1;

export interface TourStep {
  /** 가리킬 앵커 (`data-guide`) — 보이는 첫 것 */
  anchor: string;
  /** 말풍선 머리 — 13자까지. `fromAnchor`면 앵커의 첫 줄 글자를 쓰고(숫자가 실제와 같다), 이것은 글자가 없을 때의 이름 */
  label: string;
  /** 한 문장, 해요체 — 30자까지 */
  say: string;
  /** 앵커의 화면 글자(첫 줄)를 머리로 — 「미제출 4명 이름 복사」·「열기」처럼 그 사람의 화면 그대로 */
  fromAnchor?: boolean;
}

export interface TourChapter {
  id: TourChapterId;
  /** 도크의 「부서원 2/4」 */
  title: string;
  /** 장마다 한 페이지 — 그 사람의 홈·수합 관리·본부 취합·전사 */
  page: 'home' | 'manage' | 'hq' | 'org';
  /** 새 역할이 생겼을 때 카드 문구의 앞말 — 「[수합 관리]가 생겼어요」 */
  gained: string;
  steps: TourStep[];
}

/**
 * 장마다 3~5단계 (PG-T150). 작성 드로어(붙여넣기·공유·제출)는 넣지 않는다 — 드로어를 여는 것도 둘러보기가 대신 누르는
 * 「실제 동작」이다. 그것은 체험하기(그림)가 맡는다.
 */
export const TOUR: readonly TourChapter[] = [
  {
    id: 'member',
    title: '부서원',
    page: 'home',
    gained: '',
    steps: [
      { anchor: 'week-card', label: '이번 주', say: '마감과 제출 여부가 여기 보여요', fromAnchor: true },
      { anchor: 'compose-open', label: '작성하기', say: '이번 주 일지는 이 버튼 하나예요', fromAnchor: true },
      { anchor: 'past-weeks', label: '지난 주차', say: '지난 주가 달마다 묶여 있어요' },
      { anchor: 'past-open', label: '내 일지', say: '지난 주에 낸 것을 다시 열어요' },
    ],
  },
  {
    id: 'lead',
    title: '부서담당자',
    page: 'manage',
    gained: '[수합 관리]가 생겼어요',
    steps: [
      { anchor: 'status-card', label: '제출 현황', say: '우리 부서 몇 명이 냈는지 보여요' },
      { anchor: 'copy-missing', label: '이름 복사', say: '메신저에 붙여 안 낸 사람에게 알려요', fromAnchor: true },
      { anchor: 'merge-ready', label: '준비됨', say: '마감 1분 뒤 병합본이 저절로 생겨요' },
      { anchor: 'merged-open', label: '내용 보기', say: '열어서 칸을 눌러 바로 고쳐요' },
      { anchor: 'report-unit-submit', label: '올라가는 병합본', say: '부서장이 승인하면 저절로 올라가요' },
    ],
  },
  {
    id: 'head',
    title: '실·팀장',
    page: 'manage',
    gained: '승인 단추가 생겼어요',
    steps: [
      { anchor: 'merged-approve', label: '고칠 것 없음 · 승인', say: '고칠 게 없으면 이것만 눌러요' },
      { anchor: 'merged-open', label: '내용 보기', say: '고쳐 저장하면 그게 승인이에요' },
      { anchor: 'report-unit-submit', label: '올라가는 병합본', say: '승인하면 바로 위로 올라가요' },
    ],
  },
  {
    id: 'hq',
    title: '본부',
    page: 'hq',
    gained: '[본부 취합]이 생겼어요',
    steps: [
      { anchor: 'hq-units', label: '산하 현황', say: '승인된 실·팀이 저절로 모여요' },
      { anchor: 'hq-run-button', label: '자동으로 이어 붙임', say: '본부본은 저절로 이어 붙어요' },
      { anchor: 'hq-approve', label: '검토 완료 · 승인', say: '승인하면 바로 총괄로 가요' },
    ],
  },
  {
    id: 'org',
    title: '총괄',
    page: 'org',
    gained: '[전사]가 생겼어요',
    steps: [
      { anchor: 'org-total', label: '제출', say: '전사에서 몇 명이 냈는지 보여요' },
      { anchor: 'org-run-button', label: '전사본', say: '들어온 섹션으로 늘 준비돼 있어요' },
      { anchor: 'org-download', label: '전사본 받기', say: '받아서 게시판에 올려요' },
      { anchor: 'schedule-open', label: '일정 바꾸기', say: '연휴엔 여기서 마감을 당겨요', fromAnchor: true },
    ],
  },
];

export const tourChapterOf = (id: TourChapterId): TourChapter => TOUR.find((c) => c.id === id)!;
export const isTourChapter = (v: unknown): v is TourChapterId => typeof v === 'string' && (ROLE_CHAPTERS as readonly string[]).includes(v);

/** PG-T148 — 이 사람의 둘러보기 장. 체험하기와 **같은 쌓기**(장 = 능력, 이야기 순서) */
export function tourChapters(caps: Iterable<GuideCap>): TourChapterId[] {
  return stackedChapters(caps);
}

export interface TourSeen {
  chapter: string;
  outcome: string;
  version?: number;
}

export interface TourOfferView {
  /** 권하는 장 — 이야기 순서 */
  chapters: TourChapterId[];
  /** 처음(기록이 하나도 없다) · 새 역할(기록 있는 장 밖의 장이 생겼다) */
  kind: 'first' | 'new-role';
  /** 카드의 첫 줄 — 「처음이시죠?」·「화면이 바뀌었어요」·「[수합 관리]가 생겼어요」 */
  title: string;
}

/**
 * PG-T149 — 권할 것. 가진 장 − 기록 있는 장(판이 지금 것인 기록만). `dismissed`도 「봤음」이다 — 고른 사람에게 다시 묻지 않는다.
 * 기록이 하나도 없으면 「처음」(전에 낸 적이 있으면 「화면이 바뀌었어요」 — 운영을 이 판으로 덮은 뒤의 파일럿 부서),
 * 있으면 「새 역할」 — 문구는 이야기 순서의 첫 새 장의 것
 */
export function tourOffer(chapters: readonly TourChapterId[], seen: readonly TourSeen[], opts: { submittedBefore?: boolean } = {}): TourOfferView | null {
  const current = seen.filter((s) => (s.version ?? TOUR_VERSION) >= TOUR_VERSION);
  const done = new Set(current.map((s) => s.chapter));
  const fresh = chapters.filter((c) => !done.has(c));
  if (fresh.length === 0) return null;
  if (current.length === 0) {
    return { chapters: fresh, kind: 'first', title: opts.submittedBefore ? '화면이 바뀌었어요' : '처음이시죠?' };
  }
  return { chapters: fresh, kind: 'new-role', title: tourChapterOf(fresh[0]).gained || '처음이시죠?' };
}

/** 장의 페이지 — 그 사람 부서의 홈·수합 관리, 본부 취합, 전사 */
export function tourPath(chapter: TourChapterId, slug: string): string {
  const page = tourChapterOf(chapter).page;
  if (page === 'home') return `/${slug}`;
  if (page === 'manage') return `/${slug}/manage`;
  return `/${page}`;
}

/** 지금 페이지에서 할 수 있는 장 — 사용자 메뉴 「화면 둘러보기」가 쓴다. 없으면 빈 목록(홈의 부서원 장으로 간다) */
export function chaptersAt(pathname: string, slug: string, mine: readonly TourChapterId[]): TourChapterId[] {
  return mine.filter((c) => tourPath(c, slug) === pathname.replace(/\/$/, ''));
}

/** 단계 고르기 — 이 화면에 그려진 앵커만(없거나 크기가 0이면 조용히 건너뛴다) */
export function pickSteps<T extends { anchor: string }>(steps: readonly T[], present: (anchor: string) => boolean): T[] {
  return steps.filter((s) => present(s.anchor));
}

/**
 * 기록 덮어쓰기 규칙(API-60) — `done`은 끝, 나머지는 마지막 것이 이긴다. 같은 요청을 두 번 보내도 같다
 */
export function nextOutcome(prev: string | null | undefined, incoming: TourOutcome): TourOutcome {
  if (prev === 'done') return 'done';
  return incoming;
}

/** 앵커 글자의 첫 줄을 말풍선 머리로 — 13자까지(넘으면 대신 이름) */
export function labelFromText(text: string | null | undefined, fallback: string, max = 13): string {
  const first = (text ?? '').split('\n').map((t) => t.trim()).find(Boolean) ?? '';
  return first && [...first].length <= max ? first : fallback;
}
