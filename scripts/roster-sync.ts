/**
 * ERP 인원 현황(xlsx) → Tincase 인원 최신화. **기본은 미리보기다.**
 *
 *   npx tsx scripts/roster-sync.ts <파일.xlsx>          # 무엇이 바뀌는지만 보여준다
 *   npx tsx scripts/roster-sync.ts <파일.xlsx> --apply  # 실제로 반영
 *
 * 운영자는 보통 화면(`/ops` → 인원 최신화)에서 한다. 이 스크립트는 화면이 막혔을 때의
 * 우회로이자, 같은 코드가 도는지 확인하는 수단이다 — 두 경로가 갈라지면 안 되므로
 * 계획·적용 함수는 `src/server/roster/sync.ts` 하나를 함께 쓴다.
 */
import { readFileSync } from 'node:fs';
import { readTable } from '../src/lib/xlsx';
import { prisma } from '../src/server/db';
import { planRosterSync, applyRosterSync, toErpPerson, REQUIRED_COLUMNS } from '../src/server/roster/sync';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: npx tsx scripts/roster-sync.ts <파일.xlsx> [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');

  const erp = readTable(readFileSync(file), [...REQUIRED_COLUMNS])
    .map(toErpPerson)
    .filter((x): x is NonNullable<typeof x> => !!x);
  const users = await prisma.user.findMany({ include: { division: true } });
  const divisions = await prisma.division.findMany({ select: { nameKo: true } });
  const plan = planRosterSync(
    users.map((u) => ({ ...u, divisionKo: u.division.nameKo })),
    erp,
    divisions.map((d) => d.nameKo),
  );

  console.log(
    `엑셀 ${plan.totalRows}명 · 변경 ${plan.changes.length}건` +
      (plan.backfills.length ? ` · 직책 기록 ${plan.backfills.length}건` : '') +
      ` · 그대로 ${plan.unchanged}명`,
  );
  const byKind: Record<string, number> = {};
  plan.changes.forEach((c) => (byKind[c.kind] = (byKind[c.kind] ?? 0) + 1));
  if (plan.changes.length) console.log('  ' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' · '));
  plan.changes.forEach((c) => console.log(`  [${c.kind}] ${c.name} — ${c.detail}`));
  if (plan.newDivisions.length) console.log('새 부서:', plan.newDivisions.map((d) => d.nameKo).join(', '));
  plan.conflicts.forEach((c) => console.log('충돌:', c));
  plan.leadWarnings.forEach((w) => console.log('⚠', w));
  plan.blockers.forEach((b) => console.log('✋ 차단:', b));

  if (!apply) {
    console.log('\n미리보기입니다. 반영하려면 --apply 를 붙이세요.');
    return;
  }
  if (plan.changes.length + plan.backfills.length === 0) {
    console.log('\n반영할 것이 없습니다.');
    return;
  }
  const r = await applyRosterSync(prisma, plan);
  console.log(`\n반영 — 신규 ${r.created} · 수정 ${r.updated} · 비활성 ${r.deactivated} · 새 부서 ${r.divisionsCreated}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
