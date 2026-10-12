// AU-30 — 비밀번호 **설정 링크**. 평문 비밀번호를 만들지 않는 길이다.
//
// ── 왜 ─────────────────────────────────────────────────────
// 예전에는 운영자가 임시 비밀번호를 화면에서 보고 사람마다 메신저로 옮겨 적었다.
// 그러면 **「남의 비밀번호를 아는 사람」이 생긴다.** 100명이면 100번 옮겨야 하고,
// 그 사이에 화면 캡처·클립보드·오발송이 끼어들 여지가 매번 있다.
//
// 링크 방식에서는 평문이 **어디에도 존재하지 않는다** — 운영자 화면에도, 메신저에도.
// 본인이 자기 손으로 정하고, 서버는 해시만 갖는다.
//
// ── 안전 성질 (이 파일이 지키는 것) ────────────────────────
// 1. **보내는 것만으로는 아무것도 안 바뀐다.** 기존 비밀번호는 링크를 *쓸 때*만 바뀐다 —
//    그래서 이미 잘 쓰고 있는 사람에게 잘못 보내도 그 사람은 아무 영향을 받지 않는다.
// 2. **한 번만 쓰인다.** 쓰는 순간 죽는다.
// 3. **오래 살지 않는다.** 휴가·출장을 감안해 3일.
// 4. **새로 보내면 옛 링크는 죽는다.** 살아 있는 링크가 둘이면 어느 것이 유효한지
//    아무도 모르고, 그건 회수할 수 없는 상태다. 죽은 이유는 **따로 적는다**(`supersededAt` — AU-30a) —
//    「쓴 시각」에 적으면 밀린 링크가 「비밀번호가 이미 설정되었습니다」로 보인다(2026-10-10 점검, ADR-0020).
// 5. **원문은 저장하지 않는다.** 세션 토큰과 같이 해시만 둔다 — DB가 새도 링크는 못 만든다.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { prisma } from './db';
import { formatDeadlineKo } from '@/lib/week';

/** 링크 수명. 3일 — 휴가로 하루이틀 자리를 비워도 살아 있어야 한다 */
export const SETUP_TOKEN_DAYS = 3;

/**
 * AU-32b — 비밀번호 찾기 한도. **보내는 쪽이 고르는 값(요청 머리)에 기대지 않는다** — IP 한도는 거들 뿐이다.
 *   전체      10분에 30번 — 누가 보냈든. 머리를 바꿔 가며 백 명의 주소를 돌려도 여기서 멈춘다
 *   사람      24시간에 3통 — DB에 남은 그 사람의 본인 요청 링크로 센다(재시작해도 그대로). 넘으면 같은 응답, 보내지 않음
 * 전체 한도가 차면 그동안은 누구의 비밀번호 찾기도 429다 — 막힌 사람에게는 운영자가 설정 링크를 보낸다(그 길은 이 한도 밖, ADR-0020)
 */
export const FORGOT_GLOBAL_LIMIT = 30;
export const FORGOT_WINDOW_MS = 10 * 60_000;
export const SELF_LINKS_PER_DAY = 3;

/** AU-32b — 본인 요청(`self:`)으로 만든 링크 수. 쓴 것·밀린 것·만료된 것도 센다 — 한도는 「몇 통 보냈나」다 */
export async function selfLinksSince(userId: string, since: Date, db: PrismaClient = prisma): Promise<number> {
  return db.setupToken.count({ where: { userId, createdBy: { startsWith: 'self:' }, createdAt: { gte: since } } });
}

/** 토큰 길이(바이트). 32바이트면 무작위 추측이 현실적으로 불가능하다 */
const TOKEN_BYTES = 32;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export interface IssuedLink {
  user: Pick<User, 'id' | 'name' | 'email' | 'employeeNo'>;
  /** 원문 토큰 — **이 순간 이후로는 어디에서도 다시 얻을 수 없다** */
  token: string;
  expiresAt: Date;
}

/**
 * 한 사람에게 새 링크를 발급한다. 그 사람의 **쓰지 않은 옛 링크는 전부 죽인다.**
 * 비밀번호는 건드리지 않는다 — 이 함수는 계정 상태를 바꾸지 않는다.
 */
export async function issueSetupToken(
  userId: string,
  createdBy: string,
  now = new Date(),
  db: PrismaClient = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + SETUP_TOKEN_DAYS * 24 * 60 * 60_000);

  await db.$transaction([
    /*
     * 4 — 새로 보내면 옛 것은 죽는다. 「지금 받은 링크가 유효한 링크」가 되게.
     * 죽은 이유는 `supersededAt`에 적는다 — `usedAt`은 **쓴** 링크에만 남긴다(AU-30a). 만료도 지금으로 당겨 둔다:
     * 이 열을 모르는 옛 앱(롤백)이 같은 DB를 읽어도 「기한 지남」으로 보고 쓰지 못하게.
     */
    db.setupToken.updateMany({
      where: { userId, usedAt: null, supersededAt: null },
      data: { supersededAt: now, expiresAt: now },
    }),
    db.setupToken.create({
      data: { userId, tokenHash: hash(token), expiresAt, createdBy, createdAt: now },
    }),
  ]);

  return { token, expiresAt };
}

export type TokenState =
  | { ok: true; user: Pick<User, 'id' | 'name' | 'email'> }
  | { ok: false; reason: 'unknown' | 'superseded' | 'used' | 'expired' };

/**
 * 링크가 지금 쓸 수 있는가. **왜 못 쓰는지는 구분해서 돌려준다** —
 * 「안 됩니다」만 보여주면 받은 사람이 다시 요청해야 하는지 기다려야 하는지 모른다.
 *
 * 토큰이 32바이트 난수라 존재 여부를 알려 줘도 추측에 도움이 되지 않는다.
 * 여기서 모호하게 구는 것은 보안이 아니라 불친절이다.
 */
export async function readSetupToken(
  token: string,
  now = new Date(),
  db: PrismaClient = prisma,
): Promise<TokenState> {
  if (!token || token.length < 16) return { ok: false, reason: 'unknown' };

  const row = await db.setupToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!row) return { ok: false, reason: 'unknown' };
  // 퇴사자는 링크가 살아 있어도 못 쓴다 — 계정이 이미 닫혀 있다
  if (!row.user.isActive) return { ok: false, reason: 'unknown' };
  /*
   * AU-30a — 밀린 링크는 「쓴 링크」보다 먼저 본다. 이 열이 생기기 전(2026-10-10)에 밀린 링크는 「쓴 시각」과 「만료」가 **같은 순간**으로
   * 적혔다 — 쓴 링크는 만료 전에만 쓰이므로(`consumeSetupToken`) 둘이 같을 수 없다. 그 모양도 밀린 것으로 읽는다
   */
  const legacySuperseded = !!row.usedAt && row.usedAt.getTime() === row.expiresAt.getTime();
  if (row.supersededAt || legacySuperseded) return { ok: false, reason: 'superseded' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, user: { id: row.user.id, name: row.user.name, email: row.user.email } };
}

/**
 * 토큰을 **쓴 것으로 표시한다.** 이미 쓰였으면 false —
 * 같은 링크로 두 번 설정하는 경합을 여기서 막는다 (`updateMany` + `usedAt: null` 조건).
 */
export async function consumeSetupToken(
  token: string,
  now = new Date(),
  db: PrismaClient = prisma,
): Promise<boolean> {
  const r = await db.setupToken.updateMany({
    // 밀린 링크(AU-30a)는 만료도 당겨져 있지만, 그 열을 직접 본다 — 한쪽만 고쳐지는 날이 와도 밀린 링크가 쓰이지 않게
    where: { tokenHash: hash(token), usedAt: null, supersededAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return r.count === 1;
}

/**
 * AU-30 · AU-32 — 설정 링크 쪽지. 운영자가 보내는 것(`setup_link`)과 본인이 요청한 것(`forgot`)이 같은 꼴을 쓴다.
 *
 * **링크를 `URL` 필드에도 싣는다** (2026-10-09 v2 전환 점검). 메신저 본문의 주소는 눌리지 않는다(messenger.md §7 — 2026-08-26 실측).
 * 본문에만 두면 처음 쓰는 사람(10/13 전환 날 두 부서)이 주소를 손으로 옮겨야 한다. `URL` 필드는 제목에 걸려 알림·제목을 누르면 열린다 —
 * 다른 알림이 다 쓰는 길이다. 본문의 주소는 그대로 둔다: 알림이 브라우저를 못 여는 PC에서 복사해 붙일 길이다.
 *
 * **기한은 날짜·시각으로** 적는다(2026-10-10 알림 점검). 「3일 안에」는 언제 받았는지 기억해야 셀 수 있다 — 쪽지가 쌓이면 모른다.
 */
const OPEN_HINT = '제목을 누르면 설정 화면이 열립니다(안 열리면 아래 주소를 복사해 브라우저 주소창에 붙여 넣으세요).';
const until = (expiresAt: Date) => `${formatDeadlineKo(expiresAt)}까지(${SETUP_TOKEN_DAYS}일)`;

export function setupLinkMessage(name: string, url: string, expiresAt: Date) {
  return {
    subject: '[Tincase] 비밀번호를 설정해 주세요',
    contents: [
      `${name}님, Tincase 비밀번호를 직접 정해 주세요.`,
      '',
      OPEN_HINT,
      url,
      '',
      `${until(expiresAt)} 설정해 주세요. 한 번 쓰면 이 링크는 사라집니다.`,
      '설정한 뒤에는 이 쪽지를 지워 주세요.',
    ].join('\n'),
    url,
  };
}

/**
 * AU-32 — 본인이 「비밀번호를 잊으셨나요?」로 요청한 링크. `first`면 아직 비밀번호가 없는 사람.
 * 「지금 비밀번호는 그대로입니다」는 **비밀번호가 있는 사람에게만** — 없는 사람에게는 사실이 아니다(2026-10-10 알림 점검).
 */
export function forgotMessage(name: string, url: string, first: boolean, expiresAt: Date) {
  return {
    subject: `[Tincase] 비밀번호 ${first ? '설정' : '재설정'} 링크입니다`,
    contents: [
      `${name}님, 비밀번호를 ${first ? '설정' : '새로 정'}해 주세요.`,
      '',
      OPEN_HINT,
      url,
      '',
      `${until(expiresAt)} 눌러 주세요. 한 번 쓰면 이 링크는 사라집니다.`,
      // 본인이 요청하지 않았는데 왔다면 알아야 한다 — 링크는 아직 아무것도 바꾸지 않았다
      first ? '요청하지 않으셨다면 이 쪽지를 지워 주세요.' : '요청하지 않으셨다면 이 쪽지를 지워 주세요. 지금 비밀번호는 그대로입니다.',
    ].join('\n'),
    url,
  };
}

/** 두 토큰이 같은가 — 길이가 같을 때만 상수 시간 비교 (테스트·유틸용) */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
