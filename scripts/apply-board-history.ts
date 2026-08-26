// 취합게시판 제출 이력을 부서에 반영 (DM-15) + 기본 마감을 목요일 14:00으로 정렬.
//
//   DATABASE_URL=file:/data/worklog/db/worklog.db npx tsx scripts/apply-board-history.ts [--deadline]
//
// 출처: ~/MWreports/manual/취합게시판_주간업무_작성_및_제출_매뉴얼.md (2026-08-13 화면 캡처 기준)
// 관찰된 사실이므로 나중에 갱신될 수 있다. 운영자가 /ops에서 수정 가능.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 실제 제출일이 확인된 부서 */
const CONFIRMED: Record<string, string> = {
  AI홍보전략실: '2026-08-13 제출 (최명헌)',
  국가기후위기적응센터: '2026-08-13 제출 (박OO)',
  국토환경연구본부: '2026-08-13 제출 (정OO)',
  연구관리실: '2026-08-13·08-12 제출 (2명)',
  인사관리실: '2026-08-12 제출 (송OO)',
  임원실: '2026-08-13 제출 (이OO)',
  탄소중립에너지연구실: '2026-08-13 제출 (정OO) — 다만 제목은 기후대기전략연구본부 명의',
  환경평가본부: '2026-08-13 제출 (강OO)',
  글로벌대외협력단: '2026-08-12 제출 (신OO)',
  순환경제연구실: '2026-08-12 제출 (고OO)',
  기획조정실: '2026-08-10 제출 (김민하) · 답변작성자 4명',
};

/*
 * 「확인 필요(`unclear`)」는 폐기했다 (2026-08-26, DM-15).
 *
 * 게시판만 보고 판단하던 시기에는 «담당자는 있는데 제출은 못 봤다»는 중간 상태가 필요했다.
 * 운영자가 답변일자로 실제 담당자 11명을 확정하면서 모호함이 사라졌다 —
 * 나머지는 **연구부서라 업무일지를 아예 쓰지 않는다.**
 *
 * 여기 있던 두 부서의 판정:
 *   기후대기전략연구본부 → `none`. 본부 명의 보고의 실제 작성자는 하위 탄소중립에너지연구실이고,
 *                          그 실이 이미 `confirmed`다. 본부는 따로 내지 않는다
 *   기획경영본부         → 운영자 확인 대기 (답변작성자만 있고 답변일자가 없다)
 */

async function main() {
  const setDeadline = process.argv.includes('--deadline');
  const divisions = await prisma.division.findMany();
  let confirmed = 0;
  let none = 0;

  for (const d of divisions) {
    const status = CONFIRMED[d.nameKo] ? 'confirmed' : 'none';
    const note = CONFIRMED[d.nameKo] ?? '';
    await prisma.division.update({
      where: { id: d.id },
      data: {
        boardStatus: status,
        boardNote: note,
        // 기본 마감 목 14:00 (전사 마감 목 15:00보다 1시간 앞)
        ...(setDeadline ? { deadlineDow: 4, deadlineTime: '14:00' } : {}),
      },
    });
    if (status === 'confirmed') confirmed++;
    else none++;
  }

  console.log(`제출 확인 ${confirmed} · 이력 없음 ${none} (총 ${divisions.length})`);
  if (setDeadline) console.log('전 부서 마감을 목요일 14:00으로 설정했습니다.');

  const missing = Object.keys(CONFIRMED).filter(
    (n) => !divisions.some((d) => d.nameKo === n),
  );
  if (missing.length) console.warn('⚠ 부서명 불일치 (반영 안 됨):', missing.join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
