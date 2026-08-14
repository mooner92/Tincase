// 전 부서 초기 비밀번호 일괄 발급 (AU-22).
// 부서별로 파일을 나눠 저장한다 — 배포는 부서 단위로 이뤄지므로.
//
//   DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/issue-all-divisions.ts <출력디렉터리>
//
// 기존 발급자는 건너뛴다(덮어쓰지 않음). 재발급은 /ops 초기화 버튼 또는 issue-passwords --reset.
// ⚠ 출력 파일은 평문이다. 배포 후 반드시 폐기할 것.
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateInitialPassword, hashPassword } from '../src/server/password';

const prisma = new PrismaClient();
const BASE = process.env.PUBLIC_BASE_URL ?? 'http://192.168.1.104:11111';

/** 파일명용 ASCII 슬러그 — Windows scp에서 한글이 깨지므로 (실제로 겪음) */
const fileSafe = (slug: string) => slug.replace(/[^A-Za-z0-9_]/g, '');

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('사용법: npx tsx scripts/issue-all-divisions.ts <출력디렉터리>');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true, mode: 0o700 });

  const divisions = await prisma.division.findMany({ orderBy: { nameKo: 'asc' } });
  const summary: string[] = [];
  let issuedTotal = 0;

  for (const d of divisions) {
    const users = await prisma.user.findMany({
      where: { divisionId: d.id, isActive: true, passwordHash: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (users.length === 0) {
      summary.push(`${d.nameKo}: 신규 0명 (이미 발급 완료)`);
      continue;
    }

    const csv: string[] = ['부서,이름,이메일,임시비밀번호'];
    const msgs: string[] = [];

    for (const u of users) {
      const pw = generateInitialPassword();
      await prisma.user.update({
        where: { id: u.id },
        data: { passwordHash: await hashPassword(pw), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await prisma.session.deleteMany({ where: { userId: u.id } });
      csv.push(`${d.nameKo},${u.name},${u.email},${pw}`);
      msgs.push(
        `───────── ${u.name} 님 ─────────\n` +
          `[주간업무 시스템 계정]\n주소: ${BASE}\n아이디: ${u.email}\n임시 비밀번호: ${pw}\n` +
          `첫 로그인 후 비밀번호를 변경해 주세요.\n`,
      );
      issuedTotal++;
    }

    const stem = path.join(outDir, fileSafe(d.slug));
    // Excel이 UTF-8을 CP949로 읽어 한글이 깨지므로 BOM 부착
    writeFileSync(`${stem}.csv`, '﻿' + csv.join('\n') + '\n', { mode: 0o600 });
    writeFileSync(`${stem}.txt`, msgs.join('\n'), { mode: 0o600 });
    summary.push(`${d.nameKo}: ${users.length}명 → ${fileSafe(d.slug)}.csv/.txt`);
  }

  console.log(summary.join('\n'));
  console.log(`\n[발급] 총 ${issuedTotal}명. 출력: ${outDir}`);
  console.log('⚠ 평문입니다. 부서별로 전달한 뒤 반드시 폐기하세요.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
