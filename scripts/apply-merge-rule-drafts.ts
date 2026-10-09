// 부서 분류 순서 초안을 넣는다 (HM-18 · HM-27 · HM-51).
//
//   DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/apply-merge-rule-drafts.ts           # 미리 보기
//   DATABASE_URL=file:/data/worklog/db/worklog.db ACTOR=<운영자 이메일> npx tsx scripts/apply-merge-rule-drafts.ts --apply
//   … --only=기획조정실[,인사관리실] [--apply]                                                            # 그 부서만 (OPS-51)
//
// 출처: 2026-10-07 전사 최종 취합본(9월 4주차) 양식 분석 — 섹션마다 줄을 어떤 순서로 놓았나.
// **초안이다.** 실제 순서는 부서 담당자가 안다. 담당자가 이미 적은 분류 순서는 덮지 않는다
// (AI홍보전략실의 「AI-홍보-시스템-도서관」은 부서가 정한 것이다).
//
// 2026-10-08 (HM-51 · ADR-0018) — 부서가 고르는 병합 설정은 분류 순서 하나다. 이 스크립트가 함께 넣던 정렬(제출자 순 /
// 일자 순)·날짜 없는 줄의 자리·자연어 지침 초안은 엔진이 더는 읽지 않으므로 지웠다 — 넣어 봐야 감사 기록만 늘고
// 「정렬은 부서 설정에서 바꿀 수 있어요」 같은 거짓말을 찍는다. 분류 초안이 있는 두 부서만 남는다.
//
// 2026-10-09 (OPS-51) — `--only`로 부서를 고른다. 부서는 하나씩 켜는데 초안은 두 부서 것이라, 10/12처럼 기획조정실만 켜는 날
// `--apply`가 꺼져 있고 담당 확인 전인 인사관리실까지 쓰게 되어 있었다(그래서 런북이 스크립트를 막았다). 초안에 없는 이름을 주면
// DB를 열기 전에 멈춘다(종료 코드 2) — 오타가 「건너뜀」 사이에 묻혀 넣었다고 믿고 지나가지 않게.
//
// 몇 번 돌려도 같다(멱등) — 두 번째부터는 「바꿀 것 없음」이다.
// 감사 로그(rule_update)를 남긴다 — 병합본 순서가 바뀐 주에 「누가 언제 바꿨나」의 답이 거기 있어야 한다.
import { PrismaClient } from '@prisma/client';
import { parseCategories } from '../src/server/merge/rules';
import { onlyNames, pickDrafts } from './lib/merge-rule-drafts';

const prisma = new PrismaClient();

/** 부서 이름 → 분류 순서 초안 (분류 안에서는 제출자 순 — HM-51) */
const DRAFTS: Record<string, string> = {
  기획조정실: '국회, 국무조정실, 재정경제부, 기획예산처, 연구회, 내부 업무',
  인사관리실: '채용 및 승진, 인사위원회 및 노사협의회, 근로 및 복무, 급여 및 4대보험, 대외 요구자료',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const actor = process.env.ACTOR ?? 'script:apply-merge-rule-drafts';

  // OPS-51 — 고르는 것을 DB보다 먼저 본다. 여기서 멈추면 아무것도 읽지도 쓰지도 않았다
  let only: string[] | null;
  try {
    only = onlyNames(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 2;
    return;
  }
  const { picked, unknown } = pickDrafts(Object.keys(DRAFTS), only);
  if (unknown.length) {
    console.error(`✗ --only: 초안이 없는 부서 — ${unknown.join(', ')} (초안: ${Object.keys(DRAFTS).join(', ')}). 아무것도 쓰지 않았습니다`);
    process.exitCode = 2;
    return;
  }

  const divisions = await prisma.division.findMany({ where: { nameKo: { in: picked } } });

  for (const [name, draft] of Object.entries(DRAFTS)) {
    if (!picked.includes(name)) {
      console.log(`- ${name}: 건너뜀 (--only 밖)`);
      continue;
    }
    const d = divisions.find((x) => x.nameKo === name);
    if (!d) {
      console.warn(`⚠ ${name}: 부서를 찾지 못함 (이름 불일치) — 건너뜀`);
      continue;
    }
    // 쉼표·가운뎃점·하이픈이 모두 구분자다 — 분류 이름 안에 그런 글자를 쓰면 쪼개진다
    const parsed = parseCategories(draft);
    if (parsed.join(', ') !== draft) throw new Error(`${name}: 분류가 다르게 읽힘 → ${parsed.join(' | ')}`);
    if (d.mergeCategories.trim()) {
      console.log(`= ${name}: 바꿀 것 없음 (분류는 부서 것 유지: ${d.mergeCategories})`);
      continue;
    }
    console.log(`• ${name}: mergeCategories`);
    if (!apply) continue;

    await prisma.division.update({ where: { id: d.id }, data: { mergeCategories: draft } });
    await prisma.auditLog.create({
      data: {
        actor,
        action: 'rule_update',
        divisionId: d.id,
        detail: JSON.stringify({ fields: ['mergeCategories'], via: 'apply-merge-rule-drafts' }),
      },
    });
  }
  console.log(apply ? '반영했습니다.' : '미리 보기입니다 — 반영하려면 --apply');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
