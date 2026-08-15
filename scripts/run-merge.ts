/**
 * 개발용 — 병합을 손으로 돌려 결과를 눈으로 확인한다.
 *
 *   npx tsx scripts/run-merge.ts [부서슬러그]
 *
 * 화면(HM-26)이 보여줄 정보를 그대로 출력한다: 묶인 행·버려진 묶음·분류·경고·미제출자.
 */
import { PrismaClient } from '@prisma/client';
import { runMergeRecorded } from '../src/server/merge/run';
import { readStoredFile } from '../src/server/storage';
import { readWorklog } from '../src/lib/hwp/reader';

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2] ?? 'AI_and_Public_Relations_Division';
  const division = await prisma.division.findFirstOrThrow({ where: { slug } });
  const slot = await prisma.weekSlot.findFirstOrThrow({ orderBy: { opensAt: 'desc' } });

  const t0 = Date.now();
  const r = await runMergeRecorded(division.id, slot.id, 'manual');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.status === 'failed' || !r.outcome) {
    console.error(`실패 (${secs}초): ${r.errorText}`);
    process.exit(1);
  }
  const o = r.outcome;

  console.log(`${division.nameKo} · ${slot.label} · ${secs}초`);
  console.log(`제출 ${o.sourceIds.length}건 → 실적 ${o.rowCounts.achievements} · 계획 ${o.rowCounts.plans} · 특이 ${o.rowCounts.notes}`);
  console.log(`모델 ${o.model.used ? `사용 (${o.model.elapsedMs}ms)` : `미사용 — ${o.model.reason}`}`);
  if (o.categories) {
    console.log(`분류 ${o.categories.used ? '적용' : `건너뜀 — ${o.categories.reason}`} [${o.categories.order.join(' → ')}]`);
  }

  if (o.mergedGroups.length) {
    console.log(`\n── 합쳐진 행 ${o.mergedGroups.length}건 (여기만 확인하면 됩니다) ──`);
    for (const g of o.mergedGroups) {
      console.log(`  ${g.authors.join(' + ')}${g.category ? ` [${g.category}]` : ''}  ${g.reason}`);
      for (const s of g.sources) console.log(`     ${s.who}: ${s.content}`);
      console.log(`     → 남긴 것: ${g.row.content}`);
    }
  } else {
    console.log('\n합쳐진 행 없음');
  }

  if (o.warnings.length) {
    console.log('\n── 경고 ──');
    for (const w of o.warnings) console.log(`  ${w}`);
  }
  if (o.missing.length) console.log(`\n미제출 ${o.missing.length}명: ${o.missing.join(', ')}`);

  // 결과 파일을 다시 읽어 눈으로 확인
  const back = readWorklog(await readStoredFile(o.outputRelPath));
  console.log(`\n── 병합본 (${(o.bytes / 1024).toFixed(1)}KB · 표 ${back.tables.map((t) => `${t.rows}x${t.cols}`).join(' ')}) ──`);
  back.worklog.achievements.forEach((row, i) => {
    console.log(`  1-${i + 1} ${row.content}${row.date ? `  (${row.date})` : ''}${row.place ? `  ${row.place}` : ''}`);
  });
  console.log(`\n저장: ${o.outputRelPath}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
