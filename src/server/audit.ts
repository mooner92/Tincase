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
  | 'roster_sync';

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
