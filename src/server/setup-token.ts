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
//    아무도 모르고, 그건 회수할 수 없는 상태다.
// 5. **원문은 저장하지 않는다.** 세션 토큰과 같이 해시만 둔다 — DB가 새도 링크는 못 만든다.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { prisma } from './db';

/** 링크 수명. 3일 — 휴가로 하루이틀 자리를 비워도 살아 있어야 한다 */
export const SETUP_TOKEN_DAYS = 3;

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
    // 4 — 새로 보내면 옛 것은 죽는다. 「지금 받은 링크가 유효한 링크」가 되게
    db.setupToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now, expiresAt: now },
    }),
    db.setupToken.create({
      data: { userId, tokenHash: hash(token), expiresAt, createdBy, createdAt: now },
    }),
  ]);

  return { token, expiresAt };
}

export type TokenState =
  | { ok: true; user: Pick<User, 'id' | 'name' | 'email'> }
  | { ok: false; reason: 'unknown' | 'used' | 'expired' };

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
    where: { tokenHash: hash(token), usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return r.count === 1;
}

/** 두 토큰이 같은가 — 길이가 같을 때만 상수 시간 비교 (테스트·유틸용) */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
