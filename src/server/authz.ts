// S-03 — 인가·부서 격리 (AU-04~06, AU-13~16).
// 모든 핸들러는 requireScope() 하나로 시작한다. 격리는 여기서 강제된다.
import type { Division, User } from '@prisma/client';
import { verifyAccess } from './auth';
import { prisma } from './db';
import { audit } from './audit';
import { openingOf } from './deadline';
import { isSubmissionLocked } from '@/lib/deadline';
import { hqNodeOf, loadOrgSetting, loadTree, submitTarget, type RollupNode } from './rollup/tree';
import type { GuideCap } from '@/lib/guide/deck';

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
  /** 부서담당자 — 대외 제출까지 책임진다 */
  isLead: boolean;
  /** TACP-16 — 부서장(실·본부·단·센터장) */
  isHead: boolean;
  /**
   * TACP-16 — **부서 문서를 다루는 사람** = lead 또는 head.
   *
   * 문서 권한에서 둘은 구별되지 않는다. 차이는 권한이 아니라 알림 시점이므로,
   * 게이트는 이 하나만 본다. `isLead`를 직접 비교하는 코드가 남으면 부서장이
   * 화면은 보는데 저장은 404가 나는, 딱 v1.3.0과 같은 종류의 불일치가 생긴다.
   */
  isManager: boolean;
  /** AU-15·16 — operator(구축 단계) 또는 coordinator */
  readAll: boolean;
  /** 신원 출처 — 비밀번호 변경 강제 판단에 쓰인다 (AU-22) */
  source: 'session' | 'cloudflare' | 'dev';
}

/** AU-15·16 — 전 부서 읽기 판정. 축소 시 이 함수 한 곳만 바꾼다. */
export function canReadAllDivisions(user: Pick<User, 'isOperator' | 'isCoordinator'>): boolean {
  return user.isOperator || user.isCoordinator;
}

/** TACP-16 — 부서 문서 담당 판정. lead·head를 가르는 유일한 곳 */
export function isDocumentManager(user: Pick<User, 'divisionRole'>): boolean {
  return user.divisionRole === 'lead' || user.divisionRole === 'head';
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
    isHead: user.divisionRole === 'head',
    isManager: isDocumentManager(user),
    readAll: canReadAllDivisions(user),
    source: identity.source,
  };
}

/**
 * TACP-16 — **부서 문서 진입점.** lead·head 또는 readAll이면 통과. 그 외 404 (AU-06).
 *
 * `readAll`(총괄·운영자)을 통과시키는 것은 lead 전용 **화면**을 보게 하기 위함이지
 * 남의 부서에 쓰라는 뜻이 아니다 (TACP-8). 쓰기에는 `requireOwnManager`를 쓴다.
 */
export async function requireManager(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!scope.isManager && !scope.readAll) throw notFound();
  return scope;
}

/**
 * TACP §3.2 — **병합본 수정 진입점.** lead·head 또는 operator만.
 *
 * `requireManager`와 다른 점은 **coordinator를 빼는 것**이다. §3.2 표에서 「내 부서 병합본
 * 수정」의 coordinator 칸은 `—`다 — 총괄이 필요한 것은 부서의 결론이지 그 부서 문서를
 * 손보는 일이 아니다. 반면 §3.1의 양식·규칙은 coordinator도 `write`이므로 그쪽은
 * `requireManager`를 쓴다. **두 표가 다르니 게이트도 둘이다.**
 *
 * operator를 넣는 이유는 §8과 같다 — 시스템 소유자는 DB에 직접 닿을 수 있으므로
 * UI로 막아봐야 능력이 줄지 않는다. 막는 대신 감사 로그가 남는 경로를 준다.
 */
export async function requireOwnManager(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!scope.isManager && !scope.user.isOperator) throw notFound();
  return scope;
}

/**
 * TACP-23 v1.7.2 · RU-71 — 병합본을 고쳐 저장한 사람이 **그 부서에서 무엇인가** — 고친 기록(`reviewJson.edits`)의 `role`.
 *   head      부서장 — 그 저장이 곧 승인이다(HM-47)
 *   lead      부서담당자 — 부서장 없는 단위에서는 그 단위의 결론이다(위로 간다)
 *   operator  그 부서의 lead·head가 아닌 운영자(`requireOwnManager`가 들여보낸 §3.2 「write(자기 부서)」) — 그 부서의 결정이 아니다.
 *             부서장 없는 단위에서도 위로 가지 않는다(TACP-3 「문서는 부서가」의 자동판)
 * 역할이 겹치면 부서 역할이 이긴다 — 자기 부서의 lead인 운영자는 lead다(§2 「한 사람이 여러 모자」).
 * 라우트가 `isHead`·`isLead`를 비교하지 않게 여기 둔다 (TACP-12).
 */
export function unitEditorRole(scope: Pick<Scope, 'isHead' | 'isLead'>): 'head' | 'lead' | 'operator' {
  if (scope.isHead) return 'head';
  if (scope.isLead) return 'lead';
  return 'operator';
}

/**
 * TACP-16 · HM-47 — **병합본 승인 진입점.** head(실장·팀장·본부장…)만, 그것도 **자기 부서**만.
 * lead는 자기가 만든 문서를 승인하지 않는다 — 「검토했다」는 기록은 검토할 사람만 남긴다.
 * 대상 부서는 신원의 부서다 (TACP-6). 한 사람이 lead이면서 head일 수는 없다(역할 하나).
 */
export function isReviewer(scope: Pick<Scope, 'isHead'>): boolean {
  return scope.isHead;
}

export async function requireReviewer(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!isReviewer(scope)) throw notFound();
  return scope;
}

/** @deprecated TACP-16 — `requireManager`를 쓸 것. 이름이 head를 빠뜨린다 */
export const requireLead = requireManager;

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
  if (!canOperate(scope.user)) throw notFound();
  return scope;
}

/**
 * 운영(`/ops`)의 문 — 화면이 「← 운영」 같은 길을 그릴지도 이것으로 정한다 (TACP-9).
 * 페이지가 `user.isOperator`를 직접 읽으면 문과 길이 따로 적힌다 (TACP-12).
 */
export function canOperate(user: Pick<User, 'isOperator'>): boolean {
  return user.isOperator;
}

/**
 * TACP-20 — 주차 마감 일정을 바꿀 수 있는가 (총괄·운영자).
 *
 * 지금은 readAll과 같은 사람들이지만 **쓰기 판정으로 따로 둔다.** readAll은 「읽기」라는
 * 뜻이고(TACP-8), 거기에 쓰기를 얹으면 그 뜻이 흐려진다 — 나중에 readAll에 누가 더해지면
 * 그 사람이 전 부서의 마감까지 움직이게 된다.
 */
export function canScheduleDeadlines(user: Pick<User, 'isOperator' | 'isCoordinator'>): boolean {
  return user.isOperator || user.isCoordinator;
}

/** TACP-20 — 주차 마감 예외 쓰기 진입점. 그 외에는 404 (TACP-5) */
export async function requireScheduler(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!canScheduleDeadlines(scope.user)) throw notFound();
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
  /*
   * TACP-16 · §3.1 「남의 제출물 내용」 — lead·head 둘 다 read다. `isLead`로 적혀 있어서
   * 부서장이 [고치기]는 받는데(첨삭 게이트는 isManager) 정작 열면 404가 났다 (2026-10-07 리뷰).
   */
  const sameDivisionManager = scope.isManager && sub.divisionId === scope.division.id;

  if (own || sameDivisionManager) return sub;

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

  const open = await openingOf(sub.division.id, sub.weekSlot.id);
  // DM-20 — 열려 있으면 지우기도 열린다. 「제출할 수 있는데 못 지우는」 상태는 설명이 안 된다
  if (isSubmissionLocked(sub.weekSlot, sub.division, open)) {
    throw new HttpError(
      409,
      'slot_locked',
      '마감된 주차는 취소할 수 없습니다. 담당자에게 문의해 주세요.',
    );
  }
  return sub;
}

/**
 * TACP-22 — 제출물 **첨삭** 판정. 읽기(`findAccessibleSubmission`)·삭제(`requireDeletableSubmission`)와 별개다.
 *
 *   내 부서의 lead·head, **남의** 제출물   → 허용 (최신 판만 — 옛 판은 409)
 *   자기 제출물                          → 404. 첨삭은 마감을 보지 않으므로, 열어 두면 담당자만
 *                                          마감 뒤에 자기 것을 고치는 길이 된다 — 본인은 마감 전 재제출이다
 *   그 외(member·coordinator·타 부서·operator의 타 부서)  → 404
 *
 * operator는 따로 열지 않는다 — 자기 부서의 lead·head 역할이 있을 때만 고친다 (§3.1).
 * 마감은 보지 않는다 — 마감 뒤에 맞추는 것이 이 권한의 목적이다 (ADR-0013).
 */
export function canReviseSubmissions(scope: Pick<Scope, 'isManager'>): boolean {
  return scope.isManager;
}

/**
 * TACP-22 — **이 제출물을** 고칠 수 있나 (판 무관). 게이트와 열람 화면의 [고치기]가 같은 식을 쓴다 —
 * 둘이 따로 적히면 「버튼은 있는데 저장은 404」가 생긴다 (TACP-9·12).
 */
export function canReviseSubmission(
  scope: Pick<Scope, 'isManager' | 'user' | 'division'>,
  sub: { userId: string; divisionId: string },
): boolean {
  // TACP-6 — 쓰기는 신원의 부서에만. readAll은 읽기만이다 (TACP-8)
  return canReviseSubmissions(scope) && sub.divisionId === scope.division.id && sub.userId !== scope.user.id;
}

export async function requireRevisableSubmission(scope: Scope, submissionId: string) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { user: true, weekSlot: true, division: true },
  });
  if (!sub) throw notFound();
  if (!canReviseSubmission(scope, sub)) throw notFound();
  if (!sub.isLatest) {
    throw new HttpError(409, 'not_latest', '가장 최근 판만 고칠 수 있습니다. 최신 판을 열어 고쳐 주세요.');
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

// ── TACP-21 — 위로 올린 제출 (본부·전사 취합) ─────────────────────────────

/** RU-52 — 3단계 취합을 쓰는가. 꺼져 있으면 3단계의 문은 운영자의 설정 화면 하나뿐이다 */
async function rollupOn(): Promise<boolean> {
  return (await loadOrgSetting()).enabled;
}

/**
 * TACP-21 v1.7 · RU-80 — 「위로」 상태 카드와 **내 부서 사본의 행방**(본부 도착 · 본부장 승인 · 총괄 도착 시각)을 보는가.
 * 내 부서의 lead·head. 예전의 [제출]·취소 권한(`canSendReport`·`requireReportSender`)은 v1.7에서 없어졌다 — 승인이 곧 제출이다(TACP-23).
 * 화면(카드)과 API(`GET /api/rollup/report`의 행방)가 이 하나를 본다 (TACP-9)
 */
export function canSeeHandoff(scope: Pick<Scope, 'isManager'>): boolean {
  return scope.isManager;
}

/**
 * RU-77 · TACP-23 — **비상구 「승인 없이 올리기」**를 쓸 수 있는 사람인가 — 그 단계의 lead만. head는 승인하면 되므로 없다
 * (TACP-16의 「검토했다」는 기록을 흐리지 않는다). 시간 창·「이미 올라감」·「최종본 아님」은 게이트가 아니라 업무 규칙(409)이다.
 */
export function canUseHandoffEscape(scope: Pick<Scope, 'isLead'>): boolean {
  return scope.isLead;
}

/**
 * RU-77 — 비상구 진입점. 3단계가 켜져 있고(RU-52) — `unit`: 내 부서가 기여 단위이고 lead · `hq`: 내 부서가 본부 단계가 있는 본부이고 lead.
 * 대상은 신원의 부서다(TACP-6). 그 외 404.
 */
export async function requireHandoffEscape(headers: Headers, level: 'unit' | 'hq'): Promise<{ scope: Scope; node: RollupNode | null }> {
  const scope = await requireScope(headers);
  if (!canUseHandoffEscape(scope) || !(await rollupOn())) throw notFound();
  const tree = await loadTree();
  if (level === 'hq') {
    const node = hqNodeOf(tree, scope.division.id);
    if (!node) throw notFound();
    return { scope, node };
  }
  if (!submitTarget(tree, scope.division.id)) throw notFound();
  return { scope, node: null };
}

/**
 * TACP-21 — 본부 단계 **쓰기** 판정 (이미 인증한 scope). 내 부서가 본부 단계가 있는 본부(RU-07)이고 내가 lead·head일 때만.
 * 「어느 본부인가」는 신원의 부서가 정한다 — 요청 값이 정하지 않는다 (TACP-6).
 */
export async function hqNodeOfManager(scope: Scope): Promise<RollupNode> {
  if (!scope.isManager || !(await rollupOn())) throw notFound();
  const node = hqNodeOf(await loadTree(), scope.division.id);
  if (!node) throw notFound();
  return node;
}

/** TACP-21 — 본부 단계 **쓰기** 진입점 — 순서·쪽 나누기·자기 문서 포함, 실패 때 [다시 시도] (TACP-23) */
export async function requireHqManager(headers: Headers): Promise<{ scope: Scope; node: RollupNode }> {
  const scope = await requireScope(headers);
  return { scope, node: await hqNodeOfManager(scope) };
}

/**
 * RU-55 · TACP-23 — **본부본 승인 = 총괄로 제출** 진입점. `requireHqManager` + head(이면서 lead 아님) — HM-47과 같은 규칙:
 * 담당자는 자기가 만든 것을 승인하지 않는다. 라우트가 `isReviewer`를 따로 부르던 것을 대신한다 (TACP-12).
 */
export async function requireHqReviewer(headers: Headers): Promise<{ scope: Scope; node: RollupNode }> {
  const { scope, node } = await requireHqManager(headers);
  if (!isReviewer(scope)) throw notFound();
  return { scope, node };
}

/**
 * TACP-21 — 본부 화면 **읽기** 대상 해석. 내 본부(lead·head) 또는 readAll의 다른 본부.
 * TACP-7의 본부판이다 — 본부 화면은 이 함수가 돌려준 본부만 그린다.
 */
export async function resolveHqView(
  scope: Scope,
  slug?: string | null,
): Promise<{ node: RollupNode; canWrite: boolean }> {
  if (!(await rollupOn()) && !scope.user.isOperator) throw notFound(); // RU-52
  const tree = await loadTree();
  const own = scope.isManager ? hqNodeOf(tree, scope.division.id) : null;
  if (own && (!slug || slug === own.node.slug)) return { node: own, canWrite: true };
  if (scope.readAll) {
    const other = slug ? tree.nodes.find((n) => n.node.slug === slug && n.hasHqStep) : null;
    if (other) {
      if (other.node.id !== scope.division.id) {
        await audit(scope.user.email, 'cross_division_read', other.node.id, `hq:${other.node.slug}`);
      }
      return { node: other, canWrite: false }; // TACP-8 — readAll은 읽기만
    }
  }
  throw notFound();
}

/** TACP-21 — 전사 이어 붙이기를 할 수 있는가 (총괄·운영자 — §3.2 「전사 병합 실행」과 같은 칸) */
export function canRunOrgRollup(user: Pick<User, 'isOperator' | 'isCoordinator'>): boolean {
  return user.isOperator || user.isCoordinator;
}

/**
 * TACP-21 · RU-52 — 전사 취합의 문. `/api/rollup/org/*`·메뉴·「전사」 화면의 취합 부분(`orgPageView().desk`)이 이 하나를 본다.
 * 페이지가 `canRunOrgRollup`만 보고 스위치를 빠뜨리면, 꺼 둔 3단계가 총괄에게 그대로 열린다 — 판정을 복사하지 않는다 (TACP-12).
 */
export async function canOpenOrgDesk(scope: Scope): Promise<boolean> {
  if (!canRunOrgRollup(scope.user)) return false;
  // RU-52 — 꺼져 있을 때는 운영자만 (켜는 사람). 총괄에게는 켠 뒤에 열린다
  return scope.user.isOperator || (await rollupOn());
}

export async function requireOrgRollup(headers: Headers): Promise<Scope> {
  const scope = await requireScope(headers);
  if (!(await canOpenOrgDesk(scope))) throw notFound();
  return scope;
}

/**
 * PG-49f · PG-51e — 「전사」 화면(`/org`)에서 **이 사람에게 그릴 것**. 화면은 이 값만 보고 그린다 (TACP-9·12).
 *
 *   progress  섹션별 제출 막대·미제출 이름·감사 링크 — 전 부서를 늘어놓으므로 readAll (TACP §3.2)
 *   desk      최종본 열·파일 올리기·만들기·섹션 구성 편집·본부 취합 길·3단계 스위치 — `canOpenOrgDesk`(RU-52 스위치 포함)
 *   schedule  마감 바꾸기 (TACP-20)
 *   operate   「← 운영」 (`/ops`의 문)
 *
 * 문(`open`)은 둘 중 하나라도 있으면 열린다. 예전에는 [현황]·[취합] 두 탭이 각자 문을 가졌다(PG-49e) —
 * 한 화면이 되면서 「무엇을 그리나」로 바뀌었다. 판정을 페이지에 풀어 적지 않는다 (TACP-12).
 */
export async function orgPageView(scope: Scope): Promise<{
  open: boolean;
  progress: boolean;
  desk: boolean;
  schedule: boolean;
  operate: boolean;
}> {
  const progress = canReadAllDivisions(scope.user);
  const desk = await canOpenOrgDesk(scope);
  return {
    open: progress || desk,
    progress,
    desk,
    schedule: canScheduleDeadlines(scope.user),
    operate: canOperate(scope.user),
  };
}

/** 메뉴용 — 이 사람에게 본부 취합 화면이 있는가 (TACP-9: 할 수 없는 곳으로 가는 길은 그리지 않는다) */
export async function hasHqDesk(scope: Scope): Promise<boolean> {
  return scope.isManager && (await rollupOn()) && hqNodeOf(await loadTree(), scope.division.id) !== null;
}

/**
 * TACP-21 — **보낸 사본** 읽기 판정. 반환되면 허용된 것이다.
 *
 *   보낸 부서 (`unit`)   부서원 모두 (TACP-15와 같은 넓이 — 위로 보낸 내 부서 문서다)
 *   보낸 본부 (`hq`)     그 본부의 lead·head만 — 본부본은 「본부: write와 같음」(§TACP-21 표). 본부원(member)은 404
 *   받는 본부            그 본부의 lead·head — 산하 단위가 보낸 `unit` 사본만 + 감사
 *   readAll             전부 + 감사 (타 부서일 때)
 *   그 외               404
 */
export async function findReadableReport(scope: Scope, reportId: string) {
  const r = await prisma.reportSubmission.findUnique({
    where: { id: reportId },
    include: { division: true, weekSlot: true },
  });
  if (!r) throw notFound();
  // 내 부서가 보낸 것 — 실·팀 사본은 부서원 모두, 본부본은 본부의 lead·head만
  if (r.divisionId === scope.division.id && (r.level === 'unit' || scope.isManager)) return r;
  if (r.level === 'unit' && scope.isManager) {
    const node = hqNodeOf(await loadTree(), scope.division.id);
    if (node?.contributors.some((c) => c.id === r.divisionId)) {
      await audit(scope.user.email, 'cross_division_read', r.divisionId, `report:${r.id}`);
      return r;
    }
  }
  if (scope.readAll) {
    await audit(scope.user.email, 'cross_division_read', r.divisionId, `report:${r.id}`);
    return r;
  }
  throw notFound();
}

/** TACP-21 — 이어 붙인 결과 읽기. 본부본: 그 본부의 lead·head + readAll · 전사본: readAll */
export async function findReadableRollup(scope: Scope, runId: string) {
  const run = await prisma.rollupRun.findUnique({ where: { id: runId }, include: { weekSlot: true, division: true } });
  if (!run) throw notFound();
  if (run.level === 'hq' && run.divisionId === scope.division.id && scope.isManager) return run;
  if (scope.readAll) {
    if (run.divisionId && run.divisionId !== scope.division.id) {
      await audit(scope.user.email, 'cross_division_read', run.divisionId, `rollup:${run.id}`);
    }
    return run;
  }
  throw notFound();
}

/**
 * TACP-21 · RU-60 — 총괄이 올린 **섹션 파일** 내려받기 판정. 반환되면 허용된 것이고, 기록은 이미 남았다.
 *
 *   전사 취합의 문(`canOpenOrgDesk`)을 지나는 사람만 — 그 외 404
 *   취소한 파일          → 404. 최종본에서 빠진 파일이 id만 알면 계속 받히면 「취소」가 화면에서만 일어난 일이 된다
 *   받으면               → `download` 기록 (TACP-10 — 남의 부서 업무일지 본문이다. 본부본·사본 받기와 같다)
 *
 * 라우트가 업로드 행을 직접 조회하던 것을 여기로 옮겼다(TACP-12 — 판정 대상 조회도 판정의 일부다).
 */
export async function findReadableSectionUpload(scope: Scope, uploadId: string) {
  if (!(await canOpenOrgDesk(scope))) throw notFound();
  const u = await prisma.orgSectionUpload.findUnique({ where: { id: uploadId } });
  if (!u || u.withdrawnAt) throw notFound();
  const section = await prisma.orgSection.findUnique({ where: { id: u.sectionId }, select: { divisionId: true } });
  await audit(scope.user.email, 'download', section?.divisionId ?? null, `org-section-upload:${u.id}`);
  return u;
}

/** 메뉴에 그릴 취합 화면 — 헤더를 그리는 서버 쪽에서 한 번에 (TACP-9) */
export async function rollupNav(scope: Scope): Promise<{ hqDesk: boolean; orgDesk: boolean }> {
  return { hqDesk: await hasHqDesk(scope), orgDesk: await canOpenOrgDesk(scope) };
}

/**
 * PG-61 — 사용 안내(혼자 보기)에서 **이 사람에게 펼칠 단계**. 단계마다 「쓰는 사람」(`GuideCap`)이 붙어 있고,
 * 여기서 이 사람이 무엇을 갖는지 정한다 (TACP-9 — 할 수 없는 일의 안내를 늘어놓지 않는다 · TACP-12 — 판정은 여기 하나).
 *
 * 예전 `/guide`는 페이지 안에서 `scope.isManager`·`scope.isHead`를 직접 보고 절을 거르고 있었다 — 같은 판정이
 * 화면마다 따로 적히면 갈라진다. 이제 각 칸은 그 행동의 **게이트를 그대로 부른다**: 안내에서 보이는 단계와
 * 실제로 열리는 화면이 같은 식에서 나온다.
 *
 * 발표 모드(/guide/present)는 이것을 쓰지 않는다 — 강당에서 회사 전체에 흐름 전체를 보여 주는 것이다(PG-59).
 */
export async function guideCaps(scope: Scope): Promise<GuideCap[]> {
  const [nav, org, rollup] = await Promise.all([rollupNav(scope), orgPageView(scope), rollupOn()]);
  const caps: [GuideCap, boolean][] = [
    ['all', true],
    ['manager', scope.isManager], // 수합 관리·부서 설정의 문 (TACP-16)
    ['head', isReviewer(scope)], // 병합본 승인 (HM-47)
    ['report', canSeeHandoff(scope) && rollup], // 위로 — 「위로」 카드와 같은 식 (RU-80 · RU-52)
    ['hq', nav.hqDesk],
    ['org', org.open],
    ['orgDesk', org.desk],
    ['schedule', org.schedule],
  ];
  return caps.filter(([, on]) => on).map(([c]) => c);
}

/**
 * PG-84 · TACP v1.10 노트 — 첫 로그인 **둘러보기 카드를 띄울 사람인가** (화면 판정, 권한 아님).
 * 운영자는 뺀다(결정 Q5) — 모든 부서·모든 화면을 다루는 사람에게 「처음이시죠?」는 맞지 않는다. 메뉴로는 언제든 본다.
 * 무엇을 권할지는 `guideCaps`(체험하기와 같은 판정)가 정한다 — 컴포넌트가 역할 플래그를 비교하지 않게(TACP-12)
 */
export function tourEligible(scope: Pick<Scope, 'user'>): boolean {
  return !scope.user.isOperator;
}
