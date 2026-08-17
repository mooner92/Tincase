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

/**
 * 이미 없으면 성공(`gone`), 정말 못 지웠으면 실패(`failed`)로 **구분**한다.
 *
 * 처음에는 둘 다 조용히 false를 돌려줬다. 그래서 운영 서버에서 이 스크립트가
 * "파일 0개"라고 보고했는데 실제로는 5개가 그대로 남아 있었다 —
 * 컨테이너가 uid 10001로 파일을 만들고 디렉터리에 group write가 없어서
 * 호스트 계정이 unlink에 실패했고, 그 EACCES를 catch가 삼켰다.
 * **정리했다고 보고하고 정리가 안 되는 것**이 이 스크립트의 최악의 실패다.
 */
async function removeFile(rel: string): Promise<'removed' | 'gone' | 'failed'> {
  try {
    await unlink(resolveInRoot(rel));
    return 'removed';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'gone';
    console.error(`  ✗ 파일 삭제 실패: ${rel} — ${(e as Error).message}`);
    return 'failed';
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
  let failed = 0;
  const tally = (r: 'removed' | 'gone' | 'failed') => {
    if (r === 'removed') files++;
    else if (r === 'failed') failed++;
  };
  for (const s of subs) tally(await removeFile(s.filePath));
  for (const r of runs) if (r.outputPath) tally(await removeFile(r.outputPath));

  const { count: delSubs } = await prisma.submission.deleteMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
  });
  const { count: delRuns } = await prisma.mergeRun.deleteMany({
    where: { divisionId: division.id, weekSlotId: slot.id },
  });

  console.log(`\n지웠습니다 — 제출물 ${delSubs}건 · 병합 기록 ${delRuns}건 · 파일 ${files}개`);
  console.log('사용자·비밀번호·부서 설정·양식·감사 로그는 그대로입니다.');

  if (failed > 0) {
    // 조용히 넘어가면 "정리됐다"고 믿게 된다. DB는 이미 지워졌으므로 고아 파일이다
    console.error(`\n⚠ 파일 ${failed}개를 지우지 못했습니다 (DB 행은 지워져 고아 파일입니다).`);
    console.error('  운영 서버라면 컨테이너 안에서 실행하거나 root 권한으로 지우세요:');
    console.error('    sudo find "$STORAGE_ROOT/divisions" -name "*.hwp" -newermt <날짜>');
    await prisma.$disconnect();
    process.exit(1); // 실패는 종료 코드로도 드러나야 한다
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
