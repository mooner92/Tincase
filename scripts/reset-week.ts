/**
 * 모의 테스트 정리 — 한 부서·한 주차의 제출물과 병합 기록을 지운다.
 *
 *   npx tsx scripts/reset-week.ts <부서슬러그> [--week 2026-W33] [--yes]
 *
 * 기본은 **미리보기**다. `--yes` 없이는 무엇을 지울지 보여주기만 한다 —
 * 지우는 명령이 손에 익으면 언젠가 실수한다.
 *
 * 지우는 것: Submission 행 + 저장된 파일 + MergeRun 기록 + 병합본 파일.
 * 건드리지 않는 것: 사용자·비밀번호·부서 설정·양식·감사 로그.
 *   감사 로그를 남기는 이유 — "테스트를 언제 했는지"도 기록이다. 지울 이유가 없다.
 */
import { unlink } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { resolveInRoot } from '../src/server/storage';

const prisma = new PrismaClient();

async function removeQuietly(rel: string): Promise<boolean> {
  try {
    await unlink(resolveInRoot(rel));
    return true;
  } catch {
    return false; // 이미 없으면 그만 — 정리가 목적이지 완벽한 기록이 목적이 아니다
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('사용법: npx tsx scripts/reset-week.ts <부서슬러그> [--week 2026-W33] [--yes]');
    process.exit(1);
  }
  const wi = process.argv.indexOf('--week');
  const isoKey = wi > 0 ? process.argv[wi + 1] : undefined;
  const confirmed = process.argv.includes('--yes');

  const division = await prisma.division.findFirstOrThrow({ where: { slug } });
  const slot = isoKey
    ? await prisma.weekSlot.findUniqueOrThrow({ where: { isoKey } })
    : await prisma.weekSlot.findFirstOrThrow({ orderBy: { opensAt: 'desc' } });

  const subs = await prisma.submission.findMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
    include: { user: { select: { name: true } } },
    orderBy: { uploadedAt: 'asc' },
  });
  const runs = await prisma.mergeRun.findMany({ where: { divisionId: division.id, weekSlotId: slot.id } });

  console.log(`${division.nameKo} · ${slot.label} (${slot.isoKey})`);
  console.log(`  제출물 ${subs.length}건 (버전 포함) · 병합 기록 ${runs.length}건`);
  if (subs.length) {
    const byUser = new Map<string, number>();
    for (const s of subs) byUser.set(s.user.name, (byUser.get(s.user.name) ?? 0) + 1);
    console.log(`  제출자: ${[...byUser].map(([n, c]) => (c > 1 ? `${n}(v${c})` : n)).join(', ')}`);
  }

  if (!confirmed) {
    console.log('\n미리보기입니다. 실제로 지우려면 끝에 --yes 를 붙이세요.');
    await prisma.$disconnect();
    return;
  }

  let files = 0;
  for (const s of subs) if (await removeQuietly(s.filePath)) files++;
  for (const r of runs) if (r.outputPath && (await removeQuietly(r.outputPath))) files++;

  const { count: delSubs } = await prisma.submission.deleteMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
  });
  const { count: delRuns } = await prisma.mergeRun.deleteMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
  });

  console.log(`\n지웠습니다 — 제출물 ${delSubs}건 · 병합 기록 ${delRuns}건 · 파일 ${files}개`);
  console.log('사용자·비밀번호·부서 설정·양식·감사 로그는 그대로입니다.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
