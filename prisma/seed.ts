// DM-02 — 시드. docs/private/seed.json(git 제외)에서 부서·사용자 upsert.
// 멱등: 몇 번을 돌려도 안전. 기존 사용자의 onRoster·역할은 덮어쓰지 않는다 (운영자 소관 — DM-04).
//
// 실행:  npm run db:seed
// 옵션:  SEED_TEMPLATE=1  → fixtures/master-template.hwp를 파일럿 부서 양식으로 등록
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

const PILOT_KO = 'AI홍보전략실';
const SEED_PATH = path.resolve(__dirname, '../docs/private/seed.json');

// 파일럿 부서 작성 안내 (CP-21) — 원 스펙 §3의 관례. 부서 데이터이므로 시드 값으로 넣는다.
const PILOT_GUIDE = [
  '항목 순서: AI → 홍보(정간물 포함) → 시스템 → 도서관',
  '상시 반복 업무는 일자를 공란으로 둡니다',
  '특정 일자가 있는 업무만 날짜를 적습니다',
].join('\n');

interface SeedMember {
  name: string;
  email: string | null;
  grade: string | null;
  title: string | null;
  duty: string | null;
  divisionRole: 'member' | 'lead';
  isCoordinator: boolean;
  isOperator: boolean;
  onRoster: boolean;
}
interface SeedDivision {
  nameKo: string;
  parentKo: string | null;
  slug: string | null;
  shortSlug: string | null;
  members: SeedMember[];
}

async function main() {
  if (!existsSync(SEED_PATH)) {
    console.error(`[seed] ${SEED_PATH} 없음.`);
    console.error('       tools/extract-seed.py <인사자료.xlsx> > docs/private/seed.json 으로 생성하세요.');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { divisions: SeedDivision[] };

  let dCount = 0;
  let uCount = 0;
  let skipped = 0;

  for (const d of data.divisions) {
    if (!d.slug) {
      console.warn(`[seed] slug 없는 부서 건너뜀: ${d.nameKo}`);
      continue;
    }
    const isPilot = d.nameKo === PILOT_KO;
    const division = await prisma.division.upsert({
      where: { slug: d.slug },
      // 재실행 시 이름·별칭만 동기화. isActive·마감정책·규칙은 운영 값 보존
      update: { nameKo: d.nameKo, shortSlug: d.shortSlug },
      create: {
        slug: d.slug,
        shortSlug: d.shortSlug,
        nameKo: d.nameKo,
        nameEn: d.slug.replace(/_/g, ' '),
        isActive: isPilot, // 파일럿만 활성 (DM-02)
        guideText: isPilot ? PILOT_GUIDE : '',
        // 마감 기본값은 스키마(목 14:00). 제출 이력은 apply-board-history.ts로 별도 반영 (DM-15)
      },
    });
    dCount++;

    let sort = 10;
    for (const m of d.members) {
      if (!m.email) {
        console.warn(`[seed] 이메일 없는 인원 건너뜀: ${d.nameKo}/${m.name}`);
        skipped++;
        continue;
      }
      await prisma.user.upsert({
        where: { email: m.email.toLowerCase() },
        // 재실행 시 이름·부서만 동기화. 역할·onRoster·sortOrder는 운영자 소관 (DM-04)
        update: { name: m.name, divisionId: division.id },
        create: {
          email: m.email.toLowerCase(),
          name: m.name,
          divisionId: division.id,
          divisionRole: m.divisionRole,
          isOperator: m.isOperator,
          isCoordinator: m.isCoordinator,
          onRoster: m.onRoster,
          sortOrder: sort,
        },
      });
      sort += 10;
      uCount++;
    }
  }

  console.log(`[seed] 부서 ${dCount} · 사용자 ${uCount} upsert (건너뜀 ${skipped})`);

  // ── 파일럿 양식 시드 (DM-14, SEED_TEMPLATE=1일 때) ──
  if (process.env.SEED_TEMPLATE === '1') {
    const pilot = await prisma.division.findFirst({ where: { nameKo: PILOT_KO } });
    const operator = await prisma.user.findFirst({ where: { isOperator: true } });
    const src = path.resolve(__dirname, '../fixtures/master-template.hwp');
    if (!pilot || !operator) throw new Error('파일럿 부서/운영자 없음');
    if (!existsSync(src)) throw new Error(`양식 원본 없음: ${src}`);

    const root = path.resolve(process.env.STORAGE_ROOT ?? './storage');
    const dir = path.join(root, 'divisions', pilot.slug, 'template');
    mkdirSync(dir, { recursive: true });

    const bytes = readFileSync(src);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.template.findFirst({ where: { divisionId: pilot.id, isActive: true } });
    if (existing?.sha256 === hash) {
      console.log('[seed] 양식 이미 최신 — 건너뜀');
    } else {
      const last = await prisma.template.findFirst({
        where: { divisionId: pilot.id },
        orderBy: { version: 'desc' },
      });
      const version = (last?.version ?? 0) + 1;
      const rel = path.join('divisions', pilot.slug, 'template', 'active.hwp');
      copyFileSync(src, path.join(dir, `v${version}.hwp`)); // 이력 보관 (ST-19)
      copyFileSync(src, path.join(root, rel));
      await prisma.template.updateMany({
        where: { divisionId: pilot.id, isActive: true },
        data: { isActive: false },
      });
      await prisma.template.create({
        data: {
          divisionId: pilot.id,
          filePath: rel,
          sha256: hash,
          version,
          isActive: true,
          uploadedBy: operator.id,
        },
      });
      console.log(`[seed] 파일럿 양식 v${version} 등록`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
