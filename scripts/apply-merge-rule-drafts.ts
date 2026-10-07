// 부서 병합 규칙 초안을 대상 13개 부서에 넣는다 (HM-18 · HM-48).
//
//   DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/apply-merge-rule-drafts.ts           # 미리 보기
//   DATABASE_URL=file:/data/worklog/db/worklog.db ACTOR=<운영자 이메일> npx tsx scripts/apply-merge-rule-drafts.ts --apply
//
// 출처: 2026-10-07 전사 최종 취합본(9월 4주차) 양식 분석 — 섹션마다 줄을 어떤 순서로 놓았나.
// **초안이다.** 실제 순서는 부서 담당자가 안다. 그래서 지침 맨 앞에 「고쳐 쓰세요」를 붙이고,
// 담당자가 이미 쓴 것은 덮지 않는다:
//   - 분류 순서가 이미 있으면 그대로 둔다 (AI홍보전략실의 「AI-홍보-시스템-도서관」은 부서가 정한 것이다)
//   - 지침이 이미 있으면 초안을 **뒤에 덧붙인다** — 한 번 넣은 초안은 다시 넣지 않는다 (MARK로 판별)
//   - 정렬(제출자 순 / 일자 순)은 초안 값으로 맞춘다 — 이 값이 생긴 것이 오늘(HM-48)이라 고른 사람이 없다
//
// 감사 로그(rule_update)를 남긴다 — 병합본 순서가 바뀐 주에 「누가 언제 바꿨나」의 답이 거기 있어야 한다.
import { PrismaClient } from '@prisma/client';
import { parseCategories } from '../src/server/merge/rules';

const prisma = new PrismaClient();

const MARK = '[초안 2026-10-07 — 9월 4주차 전사 취합본 분석 기준. 담당자가 보고 고쳐 쓰세요]';

/** 본부·센터 섹션은 같은 꼴로 정리돼 있었다 — 본부 직할 → 실, 과제 유형 순, 번호 연속 */
const HQ_TEXT = [
  '본부 직할 업무를 먼저, 그 다음 실 조직 순서로 놓는다.',
  '과제는 유형 순서(기본 → 일반 → 수시 → 연적금 → 정부지원 → 수탁 → 역무대행)로 놓는다.',
  '구분 번호는 표 전체에서 이어서 매긴다.',
  '특이사항(3번)은 일자 순.',
].join('\n');

interface Draft {
  categories?: string;
  sort: 'input' | 'date';
  undated: 'last' | 'first';
  text: string;
}

const DRAFTS: Record<string, Draft> = {
  임원실: { sort: 'date', undated: 'last', text: '일자 오름차순, 같은 날은 시간 순. 일자는 M/D(요일) 꼴로 적는다.' },
  글로벌대외협력단: { sort: 'date', undated: 'last', text: '날짜가 있는 항목을 일자 오름차순으로 먼저, 날짜 없이 이어지는 업무는 뒤에 둔다.' },
  기획조정실: {
    categories: '국회, 국무조정실, 재정경제부, 기획예산처, 연구회, 내부 업무',
    sort: 'date',
    undated: 'last',
    text: '대상 기관별로 묶고(국회 · 국무조정실 · 재정경제부 · 기획예산처 · 연구회 · 내부 업무), 묶음 안에서는 일자 순.\n기관 사이의 순서는 담당자 확인이 필요하다.',
  },
  연구관리실: { sort: 'date', undated: 'last', text: '일자 순. 건수를 세는 집계성 항목(예: 계약 n건)은 맨 뒤에 둔다.' },
  AI홍보전략실: { sort: 'date', undated: 'last', text: '분류 안에서는 일자 순. 상시 업무는 일자를 비운다.' },
  인사관리실: {
    categories: '채용 및 승진, 인사위원회 및 노사협의회, 근로 및 복무, 급여 및 4대보험, 대외 요구자료',
    sort: 'date',
    undated: 'last',
    text: '업무 분야별로 묶고 분야 안에서는 일자 순 (분야는 추정 — 담당자 확인 필요).',
  },
  경영지원실: { sort: 'date', undated: 'last', text: '실적은 일자 순. 날짜 없는 항목은 뒤에 모은다.' },
  국가지속가능발전연구센터: { sort: 'date', undated: 'last', text: '일자 순.' },
  탄소중립에너지연구실: { sort: 'date', undated: 'last', text: HQ_TEXT },
  순환경제연구실: { sort: 'date', undated: 'last', text: HQ_TEXT },
  국토환경연구본부: { sort: 'date', undated: 'last', text: HQ_TEXT },
  국가기후위기적응센터: { sort: 'date', undated: 'last', text: HQ_TEXT },
  환경평가본부: { sort: 'date', undated: 'last', text: '일자 오름차순 목록.' },
};

async function main() {
  const apply = process.argv.includes('--apply');
  const actor = process.env.ACTOR ?? 'script:apply-merge-rule-drafts';
  const divisions = await prisma.division.findMany({ where: { nameKo: { in: Object.keys(DRAFTS) } } });

  for (const [name, draft] of Object.entries(DRAFTS)) {
    const d = divisions.find((x) => x.nameKo === name);
    if (!d) {
      console.warn(`⚠ ${name}: 부서를 찾지 못함 (이름 불일치) — 건너뜀`);
      continue;
    }
    const data: Record<string, string> = {};
    if (draft.categories && !d.mergeCategories.trim()) {
      // 쉼표·가운뎃점·하이픈이 모두 구분자다 — 분류 이름 안에 그런 글자를 쓰면 쪼개진다
      const parsed = parseCategories(draft.categories);
      if (parsed.join(', ') !== draft.categories) throw new Error(`${name}: 분류가 다르게 읽힘 → ${parsed.join(' | ')}`);
      data.mergeCategories = draft.categories;
    }
    if (!d.mergeRuleText.includes(MARK)) {
      const body = `${MARK}\n${draft.text}`;
      data.mergeRuleText = d.mergeRuleText.trim() ? `${d.mergeRuleText.trimEnd()}\n\n${body}` : body;
    }
    if (d.mergeSort !== draft.sort) data.mergeSort = draft.sort;
    if (d.mergeUndated !== draft.undated) data.mergeUndated = draft.undated;

    const kept = draft.categories && d.mergeCategories.trim() ? ` (분류는 부서 것 유지: ${d.mergeCategories})` : '';
    console.log(`${Object.keys(data).length ? '•' : '='} ${name}: ${Object.keys(data).join(', ') || '바꿀 것 없음'}${kept}`);
    if (!apply || Object.keys(data).length === 0) continue;

    await prisma.division.update({ where: { id: d.id }, data });
    await prisma.auditLog.create({
      data: {
        actor,
        action: 'rule_update',
        divisionId: d.id,
        detail: JSON.stringify({ fields: Object.keys(data), sort: draft.sort, undated: draft.undated, via: 'apply-merge-rule-drafts' }),
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
