// AU-31 — **퇴사 처리**. 계정을 닫을 때 같이 정리해야 하는 것들.
//
// ── 왜 한 함수인가 ─────────────────────────────────────────
// 계정을 닫는 길이 둘이다: ERP 엑셀 최신화(자동)와 운영 화면의 [비활성화](수동).
// 두 곳에 같은 절차를 적으면 **반드시 갈라진다** — 이 저장소는 그걸 이미 겪었다
// (TACP-12, 2026-08-26: 병합본 수정 판정이 두 라우트에 복사돼 있다가 갈라졌다).
// 그래서 절차를 하나만 두고 양쪽이 부른다.
//
// ── 무엇을 지우고 무엇을 남기는가 ★ ────────────────────────
// **지운다** — 다시 들어올 수 있게 하는 것들:
//   비밀번호 해시   접근 경로 그 자체
//   세션            남아 있으면 «로그인된 창»이 그대로다
//   미사용 설정 링크 살아 있는 링크는 비밀번호를 새로 정할 수 있는 열쇠다
//
// **남긴다** — 지우면 과거가 틀려지는 것들:
//   제출물·병합 이력  그 사람이 낸 일은 있었던 일이다. 지우면 지난 주 병합본이 거짓이 된다
//   이름·이메일·사번  병합본의 작성자 표시(TACP-17)와 감사 로그가 이것을 가리킨다
//   감사 로그        «누가 언제 무엇을 했나»는 사람이 나가도 남아야 한다
//
// 계정 행 자체를 지우지 않는 이유도 같다. `isActive=false`가 곧 «닫힘»이고,
// 모든 요청은 그 앞에서 막힌다 (authz).
//
// ── 되돌릴 수 있는가 ───────────────────────────────────────
// 비밀번호는 해시라 되돌릴 수 없다. 그래서 **오탐이 위험**한데, 그건 이미 막고 있다:
// 한 번에 10명 넘게 사라지면 엑셀 최신화 자체가 멈춘다 (RS-11).
// 잘못 닫았으면 다시 켜고 **설정 링크 한 번**이면 복구된다 — 화면에 「미발급」으로 뜬다.
import type { Prisma, PrismaClient } from '@prisma/client';

/** 트랜잭션 안에서도 밖에서도 쓸 수 있게 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface OffboardResult {
  sessions: number;
  setupTokens: number;
  hadPassword: boolean;
}

/**
 * AU-31 — 계정을 닫는다. **여기가 유일한 절차다.**
 *
 * `isActive`를 끄는 것까지 이 함수가 한다 — 호출자가 따로 끄게 두면
 * 「끄기만 하고 정리는 잊는」 경로가 생긴다.
 */
export async function offboardUser(db: Db, userId: string): Promise<OffboardResult> {
  const before = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

  const [sessions, tokens] = await Promise.all([
    db.session.deleteMany({ where: { userId } }),
    // 이미 쓴 링크 기록은 남긴다 — 「언제 비밀번호를 정했나」는 감사에 필요하다
    db.setupToken.deleteMany({ where: { userId, usedAt: null } }),
  ]);

  await db.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      passwordHash: null,
      // 다시 켜면 「미발급」으로 보이게 — 링크를 보내야 한다는 신호다
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  return {
    sessions: sessions.count,
    setupTokens: tokens.count,
    hadPassword: !!before?.passwordHash,
  };
}
