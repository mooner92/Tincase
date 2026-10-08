// PG-84 · DM-25 — 화면 둘러보기의 서버 쪽: 페이지가 그릴 때 **무엇을 권할지** 계산하고(`getTour`), 사람이 고른 것을
// 기록한다(`recordTour` — `POST /api/me/tour`). 둘 다 세션의 사람 것만 다룬다(TACP v1.10 노트 — 새 권한 없음).
//
// 제안을 GET 라우트로 두지 않은 이유: 머리(AppHeader)를 그리는 서버 쪽이 이미 이 사람의 역할을 안다 — 페이지와 같은 요청에서
// 계산해 넘기면 카드가 깜빡이지 않고, 남의 기록을 읽는 길이 처음부터 없다.
import { cache } from 'react';
import { prisma } from './db';
import { logger } from './logger';
import { guideCaps, tourEligible, type Scope } from './authz';
import { nextOutcome, tourChapters, tourOffer, TOUR_VERSION, type TourChapterId, type TourOfferView, type TourOutcome } from '@/lib/guide/tour';

/** 머리에 넘기는 둘러보기 정보 (CP-123) */
export interface TourProp {
  /** 이 사람의 둘러보기 장 — 체험하기와 같은 쌓기, 이야기 순서 */
  chapters: TourChapterId[];
  /** 권할 것 — 없으면 카드가 없다 */
  offer: TourOfferView | null;
  /** 장의 페이지를 만드는 **내** 부서 슬러그 — 남의 부서를 보는 중이어도 둘러보기는 내 화면이다 */
  slug: string;
}

/**
 * PG-T149 — 이 사람에게 권할 둘러보기. 남의 부서를 보는 중·운영자(`tourEligible`)면 권하지 않는다(장 목록은 준다 —
 * 사용자 메뉴로 언제든 본다). 요청당 한 번(React cache).
 */
export const getTour = cache(async (scope: Scope, foreign: boolean): Promise<TourProp> => {
  const chapters = tourChapters(await guideCaps(scope));
  const base = { chapters, offer: null, slug: scope.division.slug };
  if (foreign || !tourEligible(scope)) return base;
  try {
    const seen = await prisma.guideTourSeen.findMany({ where: { userId: scope.user.id }, select: { chapter: true, outcome: true, version: true } });
    // 「처음」일 때만 낸 적이 있는지 센다 — 한 번의 count. 운영을 이 판으로 덮어쓴 뒤의 파일럿 부서에게는 「화면이 바뀌었어요」
    const submittedBefore = seen.length === 0 ? (await prisma.submission.count({ where: { userId: scope.user.id } })) > 0 : false;
    return { ...base, offer: tourOffer(chapters, seen, { submittedBefore }) };
  } catch (e) {
    // 표가 아직 없다(배포에서 `prisma db push`를 빠뜨렸다) — 카드 하나 때문에 머리가 있는 모든 페이지가 죽으면 안 된다. 권하지 않고 넘어간다
    logger.warn({ err: (e as Error).message }, 'tour: GuideTourSeen을 읽지 못해 둘러보기를 권하지 않습니다 (prisma db push?)');
    return base;
  }
});

/**
 * API-60 — 고른 것을 기록한다. 대상은 **세션의 사람뿐**이고, 가지지 않은 장은 조용히 뺀다(역할이 빠진 뒤 남은 탭이 보내도
 * 오류가 아니다). `done`은 끝 — 뒤의 다른 결과로 바꾸지 않는다. 감사 기록은 남기지 않는다(문서·경계와 무관 — TACP-10 대상 아님)
 */
export async function recordTour(scope: Scope, chapters: readonly TourChapterId[], outcome: TourOutcome) {
  const mine = new Set(tourChapters(await guideCaps(scope)));
  const userId = scope.user.id;
  for (const chapter of new Set(chapters)) {
    if (!mine.has(chapter)) continue;
    const prev = await prisma.guideTourSeen.findUnique({ where: { userId_chapter: { userId, chapter } } });
    const next = nextOutcome(prev?.outcome, outcome);
    if (prev && prev.outcome === next && prev.version === TOUR_VERSION) continue; // 같은 요청 두 번 — 그대로
    await prisma.guideTourSeen.upsert({
      where: { userId_chapter: { userId, chapter } },
      create: { userId, chapter, outcome: next, version: TOUR_VERSION },
      update: { outcome: next, version: TOUR_VERSION },
    });
  }
  const rows = await prisma.guideTourSeen.findMany({ where: { userId }, select: { chapter: true, outcome: true } });
  return rows;
}
