/**
 * 배포했던 비밀번호로 되돌리기 — 테스트로 바꿔 놓은 계정을 원상복구한다.
 *
 *   npx tsx scripts/restore-passwords.ts <배포CSV> <이메일...> [--yes]
 *
 * 왜 새로 발급하지 않고 되돌리는가:
 * `POST /api/ops/password-reset`은 **새 임시 비밀번호**를 만든다. 그러면 이미
 * 나눠 준 안내문이 그 사람에 한해 거짓이 되고, 개인별로 다시 전달해야 한다.
 * 테스트하느라 바꾼 것뿐이라면 **배포본 값으로 되돌리는 편이** 아무 일도 없었던 게 된다.
 *
 * CSV는 `부서,이름,이메일,임시비밀번호` 형식(`scripts/passwords-*.ts` 산출물).
 * 경로를 인자로 받는다 — 비밀은 코드에 없다.
 *
 * 되돌리면 첫 로그인 시 변경 강제(AU-22)가 다시 켜지고, 실패 카운트·잠금이 풀리며,
 * 살아 있는 세션은 전부 끊긴다(AU-25). 즉 "한 번도 안 들어간 상태"가 된다.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/server/password';

const prisma = new PrismaClient();

function parseCsv(path: string): Map<string, string> {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  const iEmail = cols.findIndex((c) => /이메일|email/i.test(c));
  const iPw = cols.findIndex((c) => /비밀번호|password/i.test(c));
  if (iEmail < 0 || iPw < 0) throw new Error('CSV에 이메일·비밀번호 열이 없습니다.');
  const map = new Map<string, string>();
  for (const r of rows) {
    const f = r.split(',');
    if (f[iEmail] && f[iPw]) map.set(f[iEmail].trim().toLowerCase(), f[iPw].trim());
  }
  return map;
}

async function main() {
  const [csvPath, ...rest] = process.argv.slice(2);
  const confirmed = rest.includes('--yes');
  const emails = rest.filter((a) => a !== '--yes').map((e) => e.trim().toLowerCase());
  if (!csvPath || emails.length === 0) {
    console.error('사용법: npx tsx scripts/restore-passwords.ts <배포CSV> <이메일...> [--yes]');
    process.exit(1);
  }

  const table = parseCsv(csvPath);
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const missing = emails.filter((e) => !users.some((u) => u.email.toLowerCase() === e));
  const noPw = users.filter((u) => !table.has(u.email.toLowerCase()));

  console.log(`대상 ${users.length}명 · CSV ${table.size}행`);
  for (const u of users) {
    const has = table.has(u.email.toLowerCase());
    const sessions = await prisma.session.count({ where: { userId: u.id } });
    console.log(
      `  ${u.name} (${u.email}) — 배포본 ${has ? '있음' : '없음'} · ` +
        `현재 변경강제 ${u.mustChangePassword ? 'ON' : 'OFF'} · 세션 ${sessions}개`,
    );
  }
  if (missing.length) console.log(`  ⚠ DB에 없는 이메일: ${missing.join(', ')}`);
  if (noPw.length) console.log(`  ⚠ CSV에 없어 건너뜀: ${noPw.map((u) => u.email).join(', ')}`);

  if (!confirmed) {
    console.log('\n미리보기입니다. 실제로 되돌리려면 끝에 --yes 를 붙이세요.');
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const u of users) {
    const pw = table.get(u.email.toLowerCase());
    if (!pw) continue;
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash: await hashPassword(pw),
        mustChangePassword: true, // 첫 로그인 시 변경 강제 (AU-22)
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null, // "한 번도 안 들어간 상태"로
      },
    });
    await prisma.session.deleteMany({ where: { userId: u.id } }); // AU-25
    done++;
  }
  console.log(`\n${done}명 되돌렸습니다 — 배포본 비밀번호 · 변경강제 ON · 세션 해제.`);
  console.log('나눠 드린 안내문을 그대로 쓰시면 됩니다.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
