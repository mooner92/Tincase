/**
 * 기본 양식 배포 — 한 부서의 양식을 **전사 표준**으로 등록하고, 양식이 없는 부서에 복사한다.
 *
 *   npx tsx scripts/seed-templates.ts [원본부서슬러그] [--yes]
 *
 * 왜 필요한가: 양식이 없는 부서는 아무것도 못 한다 — 부서원은 빈 양식을 못 받고,
 * 담당자는 병합을 못 돌린다. 부서가 온보딩될 때마다 담당자가 양식을 구해 올리게 하면
 * 그 한 단계에서 멈춘다. 기본값을 미리 넣어두면 **바로 쓸 수 있는 상태**로 시작한다.
 *
 * 안전장치:
 * - **이미 양식이 있는 부서는 건드리지 않는다.** 부서가 자기 양식을 등록했다면 그게 정본이다
 * - 기본은 미리보기. `--yes` 가 있어야 실제로 쓴다
 */
import { PrismaClient } from '@prisma/client';
import { readStoredFile, writeFileAtomic, templateRelPath, sha256 } from '../src/server/storage';
import { validateHwpUpload } from '../src/lib/hwp/reader';

const prisma = new PrismaClient();

/** 전사 표준 양식이 놓이는 자리 — 부서 양식과 섞이지 않게 별도 경로 */
const STANDARD_REL = 'standard/active.hwp';

async function main() {
  const sourceSlug = process.argv[2] ?? 'AI_and_Public_Relations_Division';
  const confirmed = process.argv.includes('--yes');

  const source = await prisma.division.findFirstOrThrow({ where: { slug: sourceSlug } });
  const sourceTemplate = await prisma.template.findFirst({
    where: { divisionId: source.id, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!sourceTemplate) throw new Error(`${source.nameKo}에 활성 양식이 없습니다.`);

  const bytes = await readStoredFile(sourceTemplate.filePath);
  // 배포하기 전에 우리 파서로 읽힌다는 것부터 확인한다 — 깨진 걸 30곳에 뿌리면 30배로 번진다
  const parsed = validateHwpUpload(bytes);
  const digest = sha256(bytes);

  const operator = await prisma.user.findFirstOrThrow({ where: { isOperator: true } });
  const divisions = await prisma.division.findMany({
    orderBy: [{ parentKo: 'asc' }, { nameKo: 'asc' }],
    include: { templates: { where: { isActive: true }, select: { id: true } } },
  });
  const missing = divisions.filter((d) => d.templates.length === 0);
  const hasStandard = await prisma.standardTemplate.findFirst({ where: { isActive: true } });

  console.log(`원본: ${source.nameKo} v${sourceTemplate.version} · ${(bytes.length / 1024).toFixed(1)}KB`);
  console.log(`  표 ${parsed.tables.map((t) => `${t.rows}x${t.cols}`).join(' ')} · HWP ${parsed.version}`);
  console.log(`전사 표준 양식: ${hasStandard ? '이미 있음 (건너뜀)' : '등록 예정'}`);
  console.log(`양식 없는 부서 ${missing.length}개 / 전체 ${divisions.length}개`);
  if (missing.length) console.log(`  ${missing.map((d) => d.nameKo).join(', ')}`);

  if (!confirmed) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --yes 를 붙이세요.');
    await prisma.$disconnect();
    return;
  }

  if (!hasStandard) {
    await writeFileAtomic(STANDARD_REL, bytes);
    await prisma.standardTemplate.create({
      data: {
        filePath: STANDARD_REL,
        sha256: digest,
        version: 1,
        note: `${source.nameKo} 양식을 전사 기본값으로 등록 (${new Date().toISOString().slice(0, 10)})`,
        uploadedBy: operator.id,
      },
    });
    console.log('\n전사 표준 양식 등록 완료');
  }

  let n = 0;
  for (const d of missing) {
    // 부서별 사본을 둔다 — 나중에 부서가 자기 양식으로 바꿔도 다른 부서에 영향이 없어야 한다
    const rel = templateRelPath(d.slug, 1, true);
    await writeFileAtomic(rel, bytes);
    await writeFileAtomic(templateRelPath(d.slug, 1, false), bytes);
    await prisma.template.create({
      data: { divisionId: d.id, filePath: rel, sha256: digest, version: 1, isActive: true, uploadedBy: operator.id },
    });
    n++;
  }
  console.log(`부서 양식 ${n}개 배포 완료 (기존 보유 부서는 그대로)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
