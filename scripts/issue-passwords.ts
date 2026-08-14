// AU-22 — 초기 비밀번호 발급. 운영자가 배포용 목록을 뽑는 도구.
//
//   npx tsx scripts/issue-passwords.ts --division AI홍보전략실        # 미발급자만
//   npx tsx scripts/issue-passwords.ts --division AI홍보전략실 --reset 홍길동
//   npx tsx scripts/issue-passwords.ts --all                          # 활성 부서 전체
//
// 출력은 CSV(이름,이메일,임시비밀번호). ⚠ 화면·파일에 평문이 남으므로 배포 후 즉시 폐기할 것.
// 비밀번호는 해시로만 저장되므로 이 출력을 놓치면 재발급밖에 방법이 없다 (설계상 의도).
import { PrismaClient } from '@prisma/client';
import { generateInitialPassword, hashPassword } from '../src/server/password';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const divisionName = arg('division');
  const resetName = arg('reset');
  const all = has('all');

  if (!divisionName && !all) {
    console.error('사용법: --division <부서명> [--reset <이름>] | --all');
    process.exit(1);
  }

  const where = all
    ? { isActive: true, division: { isActive: true } }
    : { isActive: true, division: { nameKo: divisionName } };

  const users = await prisma.user.findMany({
    where,
    include: { division: true },
    orderBy: [{ division: { nameKo: 'asc' } }, { sortOrder: 'asc' }],
  });
  if (users.length === 0) {
    console.error('대상 사용자가 없습니다. 부서명을 확인하세요.');
    process.exit(1);
  }

  const targets = resetName
    ? users.filter((u) => u.name === resetName)
    : users.filter((u) => !u.passwordHash); // 기본: 미발급자만 (기존 비밀번호를 덮지 않는다)

  if (targets.length === 0) {
    console.error(
      resetName
        ? `'${resetName}' 을(를) 찾지 못했습니다.`
        : '이미 전원 발급 완료입니다. 특정인 재발급은 --reset <이름>.',
    );
    process.exit(1);
  }

  console.log('부서,이름,이메일,임시비밀번호');
  for (const u of targets) {
    const pw = generateInitialPassword();
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash: await hashPassword(pw),
        mustChangePassword: true, // 첫 로그인 시 변경 강제
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // 재발급이면 기존 세션 무효화 (AU-25)
    await prisma.session.deleteMany({ where: { userId: u.id } });
    console.log(`${u.division.nameKo},${u.name},${u.email},${pw}`);
  }
  console.error(`\n[발급] ${targets.length}명. 배포 후 이 출력은 반드시 폐기하세요.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
