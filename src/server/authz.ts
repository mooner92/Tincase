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
}

/** AU-15·16 — 전 부서 읽기 판정. 축소 시 이 함수 한 곳만 바꾼다. */
export function canReadAllDivisions(user: Pick<User, 'isOperator' | 'isCoordinator'>): boolean {
  return user.isOperator || user.isCoordinator;
}

/** AU-04/04b — 신원 → 활성 사용자 + 부서 */
export async function requireScope(headers: Headers): Promise<Scope> {
  const identity = await verifyAccess(headers);
  const user = await prisma.user.findUnique({
    where: { email: identity.email },
    include: { division: true },
  });
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
  };
}

/** lead 전용 진입점 — member에게는 404 (존재 은닉, AU-06) */
export async function requireLead(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!scope.isLead && !scope.readAll) throw notFound();
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
 * 페이지 라우팅용 — slug/별칭 해석 (PG-01).
 * 반환: 접근 가능하면 division, 별칭이면 canonical로 redirect 필요 표시.
 */
export async function resolveDivisionPage(
  scope: Scope,
  slugParam: string,
): Promise<{ division: Division; redirectTo: string | null }> {
  const own = scope.division;
  if (slugParam === own.slug) return { division: own, redirectTo: null };
  if (own.shortSlug && slugParam === own.shortSlug) {
    return { division: own, redirectTo: `/${own.slug}` };
  }
  if (scope.readAll) {
    const other = await prisma.division.findFirst({
      where: { OR: [{ slug: slugParam }, { shortSlug: slugParam }] },
    });
    if (other) {
      if (slugParam === other.shortSlug) return { division: other, redirectTo: `/${other.slug}` };
      await audit(scope.user.email, 'cross_division_read', other.id, `page:${slugParam}`);
      return { division: other, redirectTo: null };
    }
  }
  // 남의 부서든 없는 부서든 동일 404 (AU-T17)
  throw notFound();
}
