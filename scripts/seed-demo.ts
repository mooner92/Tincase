/**
 * 안내용 데모 데이터 — **가짜 인원**으로 채운 별도 DB를 만든다.
 *
 *   DATABASE_URL=file:/tmp/demo.db STORAGE_ROOT=/tmp/demo npx tsx scripts/seed-demo.ts
 *
 * 왜 실제 DB로 녹화하지 않는가: 이 저장소는 public이다. 화면에는 부서원 실명이
 * 그대로 나오므로, 실제 데이터로 GIF를 찍어 커밋하면 개인정보가 저장소에 박힌다.
 * 안내 자료는 **한 번 만들고 오래 쓰는 것**이라 지우기도 어렵다.
 *
 * 그래서 이름·부서·업무 내용이 전부 가공인 데모 DB를 따로 만들어 거기서 녹화한다.
 * 부수 효과로 화면이 항상 같은 상태에서 시작하므로 다시 찍어도 결과가 같다.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/server/password';
import { currentWeek } from '../src/lib/week';

const prisma = new PrismaClient();

const DIVISION = { slug: 'Demo_Division', shortSlug: 'demo', nameKo: '가온부서', nameEn: 'Demo Division' };

// 전부 가공 인물이다. 실존 인물과 무관하도록 흔치 않은 조합으로 골랐다
const PEOPLE = [
  { name: '한서린', email: 'demo-lead@example.invalid', role: 'lead' },
  { name: '유단비', email: 'demo-01@example.invalid' },
  { name: '남시우', email: 'demo-02@example.invalid' },
  { name: '표하람', email: 'demo-03@example.invalid' },
  { name: '설이든', email: 'demo-04@example.invalid' },
  { name: '천보라', email: 'demo-05@example.invalid' },
  { name: '마준서', email: 'demo-06@example.invalid' },
];

/** 녹화 주인공 — 운영자 겸 담당자. 모든 화면을 한 신원으로 보여줄 수 있다 */
const STAR = { name: '김가온', email: 'demo@example.invalid' };

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/demo/i.test(url)) {
    console.error(`DATABASE_URL이 데모용이 아닙니다: ${url}`);
    console.error('실수로 운영·개발 DB를 덮어쓰지 않도록 경로에 "demo"가 들어가야 합니다.');
    process.exit(1);
  }

  const division = await prisma.division.upsert({
    where: { slug: DIVISION.slug },
    update: { isActive: true },
    create: {
      ...DIVISION,
      isActive: true,
      guideText: '항목 순서: AI → 홍보(정간물 포함) → 시스템 → 도서관\n상시 반복 업무는 일자를 공란으로 둡니다\n특정 일자가 있는 업무만 날짜를 적습니다',
    },
  });

  /*
   * 비밀번호를 코드에 적지 않는다 — 공개 저장소이고, 비밀 탐지기가 «하드코딩된 비밀번호»로
   * 잡는다(실제로 GitGuardian 경고가 왔다). 값 자체는 데모용이라 위험하지 않지만,
   * **저장소에 비밀번호 모양의 문자열을 두지 않는 습관**이 규칙을 지키는 유일한 방법이다.
   *
   * 데모 DB는 DEV_IDENTITY로 로그인하므로 비밀번호를 쓸 일이 사실상 없다.
   * 그래도 계정에는 해시가 있어야 하니 실행할 때마다 임의로 만든다.
   */
  const pw = await hashPassword(randomBytes(24).toString('base64url'));
  const mkUser = (name: string, email: string, extra: object = {}) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, divisionId: division.id, passwordHash: pw, mustChangePassword: false, onRoster: true, ...extra },
    });

  await mkUser(STAR.name, STAR.email, { divisionRole: 'lead', isOperator: true, sortOrder: 0 });
  for (const [i, p] of PEOPLE.entries()) {
    await mkUser(p.name, p.email, { divisionRole: p.role ?? 'member', sortOrder: i + 1 });
  }

  const w = currentWeek(new Date());
  await prisma.weekSlot.upsert({
    where: { isoKey: w.isoKey },
    update: {},
    create: { isoKey: w.isoKey, label: w.label, year: w.year, month: w.month, weekOfMonth: w.weekOfMonth, opensAt: w.opensAt },
  });

  const n = await prisma.user.count({ where: { divisionId: division.id } });
  console.log(`데모 준비 완료 — ${division.nameKo} · ${n}명 · ${w.label}`);
  console.log(`  DB      ${url}`);
  console.log(`  로그인   ${STAR.email} (담당자 겸 관리자)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
