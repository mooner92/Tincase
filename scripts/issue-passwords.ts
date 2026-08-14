// AU-22 — 초기 비밀번호 발급. 운영자가 배포용 목록을 뽑는 도구.
//
//   npx tsx scripts/issue-passwords.ts --division AI홍보전략실        # 미발급자만
//   npx tsx scripts/issue-passwords.ts --division AI홍보전략실 --reset 홍길동
//   npx tsx scripts/issue-passwords.ts --all                          # 활성 부서 전체
//   ... --bom      → Excel용 UTF-8 BOM 부착 (없으면 엑셀이 CP949로 읽어 한글이 깨진다)
//   ... --messages → 개인별 안내문 텍스트로 출력 (그대로 복사해 전달)
//
// ⚠ 출력에 평문이 남으므로 배포 후 즉시 폐기할 것.
// 비밀번호는 해시로만 저장되므로 이 출력을 놓치면 재발급밖에 방법이 없다 (설계상 의도).
//
// 팁: 파이프로 자르지 말 것 (`| head` 는 SIGPIPE로 스크립트를 중단시켜
//     일부만 발급되고 출력은 유실된다). 파일로 리다이렉트한 뒤 읽어라.
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

  const asMessages = has('messages');
  if (!asMessages) {
    if (has('bom')) process.stdout.write('\uFEFF'); // Excel이 UTF-8로 인식하게
    console.log('부서,이름,이메일,임시비밀번호');
  }
  // 실제 주소는 공개 저장소에 두지 않는다 — docs/private/infrastructure.md 참조.
  // 기본값을 두면 안내문에 틀린 주소가 박힌 채 배포될 수 있어 없으면 그냥 실패시킨다.
  const base = process.env.PUBLIC_BASE_URL;
  if (asMessages && !base) {
    console.error('PUBLIC_BASE_URL 이 필요합니다 (예: PUBLIC_BASE_URL=http://<서버-내부-IP>:11111 npx tsx ...)');
    process.exit(1);
  }
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
    if (asMessages) {
      console.log(`───────── ${u.name} 님 ─────────
[주간업무 시스템 계정]
주소: ${base}
아이디: ${u.email}
임시 비밀번호: ${pw}
첫 로그인 후 비밀번호를 변경해 주세요.
`);
    } else {
      console.log(`${u.division.nameKo},${u.name},${u.email},${pw}`);
    }
  }
  console.error(`\n[발급] ${targets.length}명. 배포 후 이 출력은 반드시 폐기하세요.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
