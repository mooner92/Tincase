// AU-09 — 감사 로그. actor는 항상 검증된 신원의 이메일.
import { prisma } from './db';
import { logger } from './logger';

export type AuditAction =
  | 'upload'
  | 'delete'
  | 'download'
  | 'download_zip'
  | 'preview'
  | 'merge'
  | 'rule_update'
  | 'template_update'
  | 'reject'
  | 'cross_division_read'
  | 'password_reset'
  | 'notify_pref'
  /** RS-13 — ERP 엑셀로 인원을 최신화했다. 누가·언제·몇 명을 바꿨는지 남는다 */
  | 'roster_sync'
  /** DM-20 — 담당자가 마감을 잠시 열었다·닫았다. **예외에는 언제나 이름이 붙는다** */
  | 'deadline_open'
  | 'deadline_close'
  /** AU-30 — 비밀번호 설정 링크를 보냈다. **비밀번호는 바뀌지 않는다** (쓸 때 바뀐다) */
  | 'setup_link'
  /** AU-30 — 본인이 링크로 비밀번호를 설정했다 */
  | 'setup_done'
  /** TACP-20 · WS-19 — 총괄·운영자가 주차 마감 예외를 설정·해제했다. 전·후와 이유가 남는다 */
  | 'deadline_override'
  /** TACP-22 — 담당자가 부서원 제출물을 새 판으로 고쳤다. 누구의 몇 판을 고쳤는지 남는다 */
  | 'submission_revise';

export async function audit(
  actor: string,
  action: AuditAction,
  divisionId: string | null,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor,
        action,
        divisionId,
        target: target ?? null,
        detail: detail ? JSON.stringify(detail) : null,
      },
    });
  } catch (e) {
    // 감사 로그 실패가 본 동작을 막으면 안 되지만, 조용히 삼키지도 않는다
    logger.error({ err: String(e), action, actor }, 'audit log write failed');
  }
}
