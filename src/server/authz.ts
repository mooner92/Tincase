// S-03 — 인가·부서 격리 (AU-04~06, AU-13~16).
// 모든 핸들러는 requireScope() 하나로 시작한다. 격리는 여기서 강제된다.
import type { Division, User } from '@prisma/client';
import { verifyAccess } from './auth';
import { prisma } from './db';
import { audit } from './audit';
import { isLocked } from '@/lib/week';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = () => new HttpError(404, 'not_found', '요청한 페이지를 찾을 수 없습니다');

export interface Scope {
  user: User;
  division: Division;
  isLead: boolean;
  /** AU-15·16 — operator(구축 단계) 또는 coordinator */
  readAll: boolean;
  /** 신원 출처 — 비밀번호 변경 강제 판단에 쓰인다 (AU-22) */
  source: 'session' | 'cloudflare' | 'dev';
}

/** AU-15·16 — 전 부서 읽기 판정. 축소 시 이 함수 한 곳만 바꾼다. */
export function canReadAllDivisions(user: Pick<User, 'isOperator' | 'isCoordinator'>): boolean {
  return user.isOperator || user.isCoordinator;
}

/** AU-04/04b — 신원 → 활성 사용자 + 부서. 신원 출처(세션/Cloudflare)는 여기서 흡수된다 */
export async function requireScope(headers: Headers): Promise<Scope> {
  const identity = await verifyAccess(headers);
  const user = identity.userId
    ? await prisma.user.findUnique({ where: { id: identity.userId }, include: { division: true } })
    : await prisma.user.findUnique({ where: { email: identity.email! }, include: { division: true } });
  if (!user || !user.isActive) {
    throw new HttpError(403, 'not_registered', '등록되지 않은 사용자입니다. 운영자에게 문의하세요.');
  }
  if (!user.division.isActive && !user.isOperator) {
    throw new HttpError(
      403,
      'division_not_onboarded',
      `${user.division.nameKo} 페이지는 아직 준비 중입니다. 도입을 원하시면 운영자에게 문의하세요.`,
    );
  }
  const { division, ...rest } = user;
  return {
    user: rest as User,
    division,
    isLead: user.divisionRole === 'lead',
    readAll: canReadAllDivisions(user),
    source: identity.source,
  };
}

/** lead 전용 진입점 — member에게는 404 (존재 은닉, AU-06) */
export async function requireLead(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!scope.isLead && !scope.readAll) throw notFound();
  return scope;
}

/**
 * API-45 — **제출 진입점.** 부서원이면 누구나 낼 수 있다.
 *
 * `onRoster`는 **집계 대상**이지 제출 권한이 아니다 (DM-16). 부서장·휴직자처럼
 * 매주 낼 것으로 기대하지 않는 사람도 낼 일이 생기면 낼 수 있어야 한다.
 * 권한과 기대치를 한 플래그로 묶으면, 안 내도 되는 사람이 **못 내는 사람**이 된다.
 *
 * 그래서 여기서 막는 것은 `requireScope`가 이미 보는 것뿐이다 —
 * 비활성 계정, 온보딩 안 된 부서. 게이트를 남겨 두는 이유는 제출에만 걸리는 규칙이
 * 생기면 여기 한 곳에 넣기 위함이다 (TACP-12).
 *
 * 명단 밖 제출이 묻히지 않도록 현황이 **추가 제출**로 따로 보여준다 (DM-17).
 */
export async function requireSubmitter(headers: Headers): Promise<Scope> {
  return requireScope(headers);
}

/**
 * operator 전용 진입점 — 그 외에게는 404 (존재 은닉).
 * TACP-12: 게이트는 이 파일에만 산다. 라우트에 복사하지 말 것
 * (v1.3.1까지 3개 라우트에 각각 복사되어 있었다).
 */
export async function requireOperator(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!scope.user.isOperator) throw notFound();
  return scope;
}

/**
 * AU-13 — 제출물 접근 판정. 항상 이 함수로만 Submission을 얻는다.
 * 반환되면 접근 허용이 이미 판정된 것. 아니면 404 (구별 불가).
 */
export async function findAccessibleSubmission(scope: Scope, submissionId: string) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { user: true, weekSlot: true, division: true },
  });
  if (!sub) throw notFound();

  const own = sub.userId === scope.user.id;
  const sameDivisionLead = scope.isLead && sub.divisionId === scope.division.id;

  if (own || sameDivisionLead) return sub;

  if (scope.readAll) {
    // AU-15/16 — 타 부서 열람은 감사 로그에 남긴다
    if (sub.divisionId !== scope.division.id) {
      await audit(scope.user.email, 'cross_division_read', sub.divisionId, `submission:${sub.id}`);
    }
    return sub;
  }
  throw notFound(); // ST-15: member의 타인 파일 → 404 (같은 부서여도)
}

/**
 * TACP-14 — 제출물 **삭제** 판정. 읽기(`findAccessibleSubmission`)와 별개다.
 *
 *   본인      → 마감 전까지만        (마감 후 409)
 *   operator  → 부서·마감 무관        (감사 로그는 호출부가 남긴다)
 *   lead      → **404**. 읽을 수는 있어도 지울 수는 없다
 *   그 외      → 404
 *
 * lead를 뺀 이유는 ADR-0007에 있다 — 담당자가 지울 수 있으면 현황표의 "미제출"이
 * "안 냈다 또는 지워졌다"가 되어, 독촉할지 말지 판단할 수 없게 된다.
 *
 * 마감만 409인 이유: 리소스 존재는 본인이 이미 아는 사실이라 누출이 아니고,
 * 이유를 안 알려주면 사용자는 버튼이 고장 난 줄 안다.
 */
export async function requireDeletableSubmission(scope: Scope, submissionId: string) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { user: true, weekSlot: true, division: true },
  });
  if (!sub) throw notFound();

  // operator는 시스템 소유자다 — 부서도 마감도 걸리지 않는다 (TACP §8, TACP-14)
  if (scope.user.isOperator) return sub;

  // 여기부터는 본인만이다. lead·coordinator는 남의 것을 읽어도 지우지 못한다
  if (sub.userId !== scope.user.id) throw notFound();

  if (isLocked({ opensAt: sub.weekSlot.opensAt }, sub.division)) {
    throw new HttpError(
      409,
      'slot_locked',
      '마감된 주차는 취소할 수 없습니다. 담당자에게 문의해 주세요.',
    );
  }
  return sub;
}

/**
 * AU-13 — 대상 부서 해석의 **단일 출처**. 페이지·API가 모두 이걸 통과한다.
 *
 * 규칙:
 *   요청 없음        → 내 부서
 *   내 부서(슬러그·별칭) → 내 부서
 *   타 부서          → readAll(operator·coordinator)만 허용 + 감사 로그. 그 외 404
 *
 * 이 함수를 우회해 `scope.division`을 직접 쓰면, 헤더는 A부서인데 본문은 B부서가 되는
 * 불일치가 생긴다 (v1.3.0에서 실제로 발생). 부서 스코프 데이터는 반드시 여기서 얻을 것.
 */
export async function resolveTargetDivision(
  scope: Scope,
  slugParam?: string | null,
): Promise<{ division: Division; isOwn: boolean; redirectTo: string | null }> {
  const own = scope.division;
  if (!slugParam || slugParam === own.slug) return { division: own, isOwn: true, redirectTo: null };
  if (own.shortSlug && slugParam === own.shortSlug) {
    return { division: own, isOwn: true, redirectTo: `/${own.slug}` };
  }
  if (scope.readAll) {
    const other = await prisma.division.findFirst({
      where: { OR: [{ slug: slugParam }, { shortSlug: slugParam }] },
    });
    if (other) {
      if (other.id === own.id) return { division: own, isOwn: true, redirectTo: `/${own.slug}` };
      if (slugParam === other.shortSlug) {
        return { division: other, isOwn: false, redirectTo: `/${other.slug}` };
      }
      await audit(scope.user.email, 'cross_division_read', other.id, `page:${slugParam}`);
      return { division: other, isOwn: false, redirectTo: null };
    }
  }
  // 남의 부서든 없는 부서든 동일 404 (AU-T17)
  throw notFound();
}

/** @deprecated resolveTargetDivision을 쓸 것 */
export async function resolveDivisionPage(
  scope: Scope,
  slugParam: string,
): Promise<{ division: Division; redirectTo: string | null }> {
  const { division, redirectTo } = await resolveTargetDivision(scope, slugParam);
  return { division, redirectTo };
}

/**
 * TACP §3.2 — 병합본 접근 판정. 병합본은 제출물과 다른 자원이다:
 * 개인 문서가 아니라 부서가 대외로 내보내는 산출물이라 공개 범위가 한 단계 넓다.
 *
 *   내 부서   부서원 모두 (TACP-15)
 *   타 부서   readAll(총괄·운영자)만 + 감사 로그
 */
export async function requireMergedAccess(
  scope: Scope,
  divisionId: string,
): Promise<void> {
  // TACP-15 — 내 부서 병합본은 **부서원 모두**가 본다.
  // v1.1까지는 lead부터였는데 그 근거("남의 업무 내용이 담겨 있다")가 틀렸다:
  // 병합본은 취합게시판에 올라가 전사가 보는 문서다. 자기가 쓴 글이 든 문서를
  // 정작 본인만 못 보는 상태였고, 숨겨서 지키는 것이 없었다.
  if (divisionId === scope.division.id) return;

  if (!scope.readAll) throw notFound();
  await audit(scope.user.email, 'cross_division_read', divisionId, 'merged');
}
