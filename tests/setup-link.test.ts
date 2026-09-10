// AU-30 — 비밀번호 **설정 링크**.
//
// 이 스위트의 중심은 하나다: **링크를 보내는 것만으로는 아무것도 바뀌지 않는다.**
// 그 성질이 없으면 「미발급 전원에게 보내기」를 누를 수 없다 — 이미 쓰고 있는 사람의
// 비밀번호가 날아갈까 봐 매번 한 명씩 골라야 하고, 그러면 이 기능을 만든 뜻이 없다.
//
// DB: prisma/test-setup.db — 이 파일 전용 (다른 스위트와 섞이지 않게).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-setup.db';

let db: typeof import('@/server/db').prisma;
let 쓰던사람 = '';
let 새사람 = '';
let 원래해시 = '';

beforeAll(async () => {
  rmSync(path.join(root, 'prisma/test-setup.db'), { force: true });
  execSync('npx prisma db push --skip-generate', { cwd: root, env: { ...process.env }, stdio: 'pipe' });
  const mod = await import('@/server/db');
  db = mod.prisma;
  const { hashPassword } = await import('@/server/password');

  const div = await db.division.create({
    data: { slug: 'S_Div', shortSlug: 'sd', nameKo: '설정부서', nameEn: 'S_Div', isActive: true },
  });
  원래해시 = await hashPassword('OriginalPass-2026');
  const a = await db.user.create({
    data: {
      email: 'inuse@test.kei.re.kr',
      name: '쓰던사람',
      divisionId: div.id,
      employeeNo: '11111',
      passwordHash: 원래해시,
      mustChangePassword: false, // 이미 첫 변경까지 마치고 잘 쓰고 있는 사람
    },
  });
  const b = await db.user.create({
    data: { email: 'newbie@test.kei.re.kr', name: '새사람', divisionId: div.id, employeeNo: '22222' },
  });
  쓰던사람 = a.id;
  새사람 = b.id;
}, 60_000);

afterAll(() => rmSync(path.join(root, 'prisma/test-setup.db'), { force: true }));

const issue = async (userId: string) => {
  const { issueSetupToken } = await import('@/server/setup-token');
  return issueSetupToken(userId, 'ops@test.kei.re.kr', new Date(), db);
};

describe('AU-30 링크 발급 — 보내도 계정은 그대로다', () => {
  it('[AU-T60] **기존 비밀번호가 바뀌지 않는다** — 이게 전원 발송을 누를 수 있는 근거다', async () => {
    await issue(쓰던사람);
    const u = await db.user.findUniqueOrThrow({ where: { id: 쓰던사람 } });
    expect(u.passwordHash).toBe(원래해시);
    expect(u.mustChangePassword).toBe(false);
  });

  it('[AU-T61] 로그인도 그대로 된다 — 링크를 받아도 쓰던 비밀번호가 살아 있다', async () => {
    const { verifyPassword } = await import('@/server/password');
    await issue(쓰던사람);
    const u = await db.user.findUniqueOrThrow({ where: { id: 쓰던사람 } });
    expect(await verifyPassword('OriginalPass-2026', u.passwordHash)).toBe(true);
  });

  it('[AU-T62] 원문 토큰은 저장되지 않는다 — DB가 새도 링크를 만들 수 없다', async () => {
    const { token } = await issue(새사람);
    const rows = await db.setupToken.findMany({ where: { userId: 새사람 } });
    expect(rows.every((r) => r.tokenHash !== token)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('[AU-T63] 새로 보내면 옛 링크는 죽는다 — 살아 있는 링크가 둘이면 회수할 수 없다', async () => {
    const { readSetupToken } = await import('@/server/setup-token');
    const 첫번째 = await issue(새사람);
    const 두번째 = await issue(새사람);
    expect((await readSetupToken(첫번째.token, new Date(), db)).ok).toBe(false);
    expect((await readSetupToken(두번째.token, new Date(), db)).ok).toBe(true);
  });
});

describe('AU-30 링크 사용', () => {
  it('[AU-T64] 한 번만 쓰인다', async () => {
    const { consumeSetupToken, readSetupToken } = await import('@/server/setup-token');
    const { token } = await issue(새사람);
    expect(await consumeSetupToken(token, new Date(), db)).toBe(true);
    expect(await consumeSetupToken(token, new Date(), db)).toBe(false);
    expect(await readSetupToken(token, new Date(), db)).toMatchObject({ ok: false, reason: 'used' });
  });

  it('[AU-T65] 기한이 지나면 못 쓴다', async () => {
    const { readSetupToken, consumeSetupToken, SETUP_TOKEN_DAYS } = await import('@/server/setup-token');
    const { token } = await issue(새사람);
    const 나중 = new Date(Date.now() + (SETUP_TOKEN_DAYS * 24 + 1) * 60 * 60_000);
    expect(await readSetupToken(token, 나중, db)).toMatchObject({ ok: false, reason: 'expired' });
    expect(await consumeSetupToken(token, 나중, db)).toBe(false);
  });

  it('[AU-T66] 왜 못 쓰는지 구분해서 말한다 — 「안 됩니다」만으로는 뭘 해야 할지 모른다', async () => {
    const { readSetupToken } = await import('@/server/setup-token');
    expect(await readSetupToken('없는토큰입니다1234567890', new Date(), db)).toMatchObject({
      ok: false,
      reason: 'unknown',
    });
  });

  it('[AU-T67] **퇴사자는 링크가 살아 있어도 못 쓴다** — 계정이 이미 닫혀 있다', async () => {
    const { readSetupToken } = await import('@/server/setup-token');
    const { token } = await issue(쓰던사람);
    await db.user.update({ where: { id: 쓰던사람 }, data: { isActive: false } });
    expect((await readSetupToken(token, new Date(), db)).ok).toBe(false);
    await db.user.update({ where: { id: 쓰던사람 }, data: { isActive: true } });
  });

  it('[AU-T68] 토큰이 누구인지 알고 있다 — 화면이 이름을 물어볼 이유가 없다', async () => {
    const { readSetupToken } = await import('@/server/setup-token');
    const { token } = await issue(새사람);
    const s = await readSetupToken(token, new Date(), db);
    expect(s.ok && s.user.name).toBe('새사람');
    expect(s.ok && s.user.email).toBe('newbie@test.kei.re.kr');
  });
});

describe('AU-30 비밀번호 정책은 그대로 적용된다', () => {
  it('[AU-T69] 짧거나 쉬운 비밀번호는 거부된다 — 본인이 정한다고 규칙이 사라지지 않는다', async () => {
    const { validatePasswordPolicy } = await import('@/lib/password-policy');
    expect(validatePasswordPolicy('짧다')).not.toBeNull();
    expect(validatePasswordPolicy('password123')).not.toBeNull();
    expect(validatePasswordPolicy('newbie12345', { email: 'newbie@test.kei.re.kr' })).not.toBeNull();
    expect(validatePasswordPolicy('한글로만든충분히긴비밀번호')).toBeNull();
  });
});
