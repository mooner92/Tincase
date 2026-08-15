// S-03 — 인가·부서 격리 (AU-04~06, AU-13~16).
// 모든 핸들러는 requireScope() 하나로 시작한다. 격리는 여기서 강제된다.
import type { Division, User } from '@prisma/client';
import { verifyAccess } from './auth';
import { prisma } from './db';
import { audit } from './audit';

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
 *   내 부서   lead 이상이 받는다 (member는 현황만 — 남의 업무 내용이 담겨 있다)
 *   타 부서   readAll(총괄·운영자)만 + 감사 로그
 */
export async function requireMergedAccess(
  scope: Scope,
  divisionId: string,
): Promise<void> {
  const own = divisionId === scope.division.id;
  if (own) {
    if (scope.isLead || scope.readAll) return;
    throw notFound(); // member — 존재 은닉 (TACP-5)
  }
  if (!scope.readAll) throw notFound();
  await audit(scope.user.email, 'cross_division_read', divisionId, 'merged');
}
