// OPS-06 — 기동 시 환경변수 검증. 누락·오류면 무엇이 잘못됐는지 출력하고 즉시 종료.
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  STORAGE_ROOT: z.string().min(1),
  CF_ACCESS_TEAM: z.string().min(1),
  // AUD는 Access 앱 생성 후에야 존재. 개발(DEV_IDENTITY)에서는 비워둘 수 있다.
  CF_ACCESS_AUD: z.string().default(''),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  // HM-24 — 병합 보조 모델. 비워두면 결정론 병합만 수행한다 (모델은 얹는 것이지 의존 대상이 아니다).
  MERGE_MODEL: z.string().default(''),

  // ── 사내 메신저 알림 (NT-01~06) ────────────────────────────
  /** 비어 있으면 알림 기능 전체가 꺼진다. 주소를 코드에 적지 않는다 (공개 저장소) */
  MESSENGER_URL: z.string().default(''),
  /**
   * **실제로 발송되는 API다.** 이 목록에 있는 사번에게만 나간다.
   * 비어 있으면 아무에게도 안 간다 — 실수로 337명에게 가는 일이 없도록
   * 「열려 있음」이 아니라 「닫혀 있음」을 기본값으로 둔다 (NT-03).
   *   MESSENGER_ALLOWLIST="21963"        테스트
   *   MESSENGER_ALLOWLIST="*"            전원 발송 (의도적으로만)
   */
  MESSENGER_ALLOWLIST: z.string().default(''),
  MESSENGER_SYSTEM_NAME: z.string().default('Tincase'),
  MESSENGER_SENDER_ID: z.string().default('TINCASE'),
  MESSENGER_SENDER_NAME: z.string().default('업무일지 수합'),
  /** 알림에서 눌렀을 때 열리는 주소. 사내망 주소라 환경변수로 받는다 */
  MESSENGER_LINK_BASE: z.string().default(''),
  MERGE_MODEL_URL: z.string().default('http://127.0.0.1:11434'),
  MERGE_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MERGE_MODEL_MAX_ROWS: z.coerce.number().int().positive().default(400),
  DEV_IDENTITY: z.string().email().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[env] 환경변수 검증 실패:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const env = parsed.data;

  // 가드는 런타임 기동에만 적용. 빌드(페이지 데이터 수집)는 실제 서빙이 아니다
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  // OPS-06: production에서 DEV_IDENTITY가 있으면 기동 거부 (AU-03 사고 방지)
  if (!isBuildPhase && env.NODE_ENV === 'production' && env.DEV_IDENTITY) {
    console.error('[env] production에서 DEV_IDENTITY가 설정되어 있습니다. 제거 후 재기동하세요.');
    process.exit(1);
  }
  // production에서 AUD 없이 뜨는 것도 금지 — Access 검증이 무력화되므로 (AU-02)
  if (!isBuildPhase && env.NODE_ENV === 'production' && !env.CF_ACCESS_AUD) {
    console.error('[env] production에는 CF_ACCESS_AUD가 필수입니다 (AU-02).');
    process.exit(1);
  }
  return env;
}

export const env = load();
export type Env = typeof env;
