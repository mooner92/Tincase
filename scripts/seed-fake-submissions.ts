/**
 * 개발용 — 부서 양식에 가짜 내용을 채워 실제 업로드 경로로 제출한다.
 *
 * 병합을 손으로 확인하려면 제출물이 있어야 하는데, 실제 업무일지는 개인정보이고
 * 운영 DB에 가짜를 넣으면 실제 인원 이름으로 기록이 남는다. 그래서 **개발 DB에만** 넣는다.
 *
 *   npx tsx scripts/seed-fake-submissions.ts <부서슬러그> [인원수]
 *
 * 안전장치: DATABASE_URL이 /data(운영)를 가리키면 즉시 중단한다.
 */
import { PrismaClient } from '@prisma/client';
import { openHwp } from '../src/lib/hwp/ole';
import { parseRecords, serializeRecords } from '../src/lib/hwp/record';
import { fillTable, packHwp } from '../src/lib/hwp/writer';
import { uploadSubmission } from '../src/server/worklog';
import { readStoredFile } from '../src/server/storage';

const prisma = new PrismaClient();

// 실제 업무일지 어휘를 흉내 낸 가짜 문구. 일부러 **겹치는 업무**를 섞어 두었다 —
// 중복 묶기가 실제로 동작하는지 보려면 중복이 있어야 한다.
const SHARED = [
  '제3차 환경정책 실무협의회 참석',
  '2026년 하반기 부서 워크숍 준비',
  '주간업무 수합 시스템 시범 운영 회의',
];
const POOL: Record<string, string[]> = {
  AI: [
    'AI 기반 환경데이터 분석 모델 성능 개선',
    'LLM 기반 문서 검색 시범 서비스 점검',
    '연구용 GPU 서버 자원 배분 조정',
    'AI 윤리 가이드라인 내부 검토',
    '환경 이슈 자동 요약 파이프라인 시험',
  ],
  홍보: [
    '보도자료 배포(3건)',
    '온라인 홍보 콘텐츠 제작 및 등록',
    '정기간행물 발간 진행(8건)',
    '언론 모니터링 및 일일 브리핑 발송',
    '연구성과 인포그래픽 제작',
    '홈페이지 주요 공지 개편',
    '유튜브 채널 신규 영상 기획',
  ],
  시스템: [
    '업무포털 인증 모듈 점검',
    '내부망 백업 정책 재정비',
    '연구정보시스템 장애 대응',
    '조직개편에 따른 계정 권한 정리',
    '문서관리시스템 저장소 용량 확장',
  ],
  도서관: ['전자저널 구독 갱신 협의', '신착 자료 정리 및 등록', '도서관 이용 통계 집계'],
};
const PLACES = ['', '', '본원 중회의실', '본원 소회의실', '세종청사', '온라인'];
const PEOPLE_TAG = ['', '', '실장, 팀원 전원', '연구진 4명', '원장, 부원장'];

/** 결정론적 의사난수 — 같은 씨앗이면 같은 결과 (재현 가능해야 비교할 수 있다) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function buildHwp(template: Buffer, ach: string[][], plan: string[][], note: string[][]): Buffer {
  const recs = parseRecords(openHwp(template).sections[0]);
  fillTable(recs, 0, ach);
  fillTable(recs, 1, plan);
  if (note.length > 0) fillTable(recs, 2, note);
  return packHwp(template, [serializeRecords(recs)]);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (dbUrl.includes('/data/')) {
    console.error(`거부: 운영 DB로 보입니다 (${dbUrl}). 가짜 제출물은 개발 DB에만 넣습니다.`);
    process.exit(1);
  }

  const slug = process.argv[2] ?? 'AI_and_Public_Relations_Division';
  const limit = Number(process.argv[3] ?? 13);

  const division = await prisma.division.findFirstOrThrow({ where: { slug } });
  const slot = await prisma.weekSlot.findFirstOrThrow({ orderBy: { opensAt: 'desc' } });
  const template = await prisma.template.findFirstOrThrow({ where: { divisionId: division.id, isActive: true } });
  const users = await prisma.user.findMany({
    where: { divisionId: division.id, isActive: true, onRoster: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: limit,
  });
  const bytes = await readStoredFile(template.filePath);

  // 마감이 지난 주차에도 넣을 수 있어야 한다 (개발용) — 슬롯이 열린 다음 날로 시각을 고정.
  // 마감 판정은 서버가 하므로(API-11) 실제 경로를 그대로 타되 시각만 바꾼다.
  const asOf = new Date(slot.opensAt.getTime() + 26 * 3600_000);

  console.log(
    `${division.nameKo} · ${slot.label} · ${users.length}명 · 양식 v${template.version} · 제출 시각 ${asOf.toISOString().slice(0, 16)}`,
  );

  const cats = Object.keys(POOL);
  for (const [i, u] of users.entries()) {
    const rand = rng(i * 7919 + 13);
    const mine = cats[i % cats.length];
    const pick = (arr: string[], n: number) => [...arr].sort(() => rand() - 0.5).slice(0, n);

    // 각자 자기 분야 3~5건 + 공용 업무 0~2건 (겹치는 부분이 중복 묶기 대상)
    const own = pick(POOL[mine], 3 + Math.floor(rand() * 3));
    const shared = i % 3 === 0 ? pick(SHARED, 1 + Math.floor(rand() * 2)) : [];
    const items = [...own, ...shared];

    const ach = items.map((c, k) => [
      `1-${k + 1}`,
      c,
      rand() < 0.4 ? `8/${11 + Math.floor(rand() * 4)}` : '',
      PLACES[Math.floor(rand() * PLACES.length)],
      PEOPLE_TAG[Math.floor(rand() * PEOPLE_TAG.length)],
    ]);
    const plans = pick(POOL[mine], 2).map((c, k) => [`2-${k + 1}`, `${c} (계속)`, '', '', '']);
    const notes = i === 0 ? [['3-1', '차주 부서 워크숍으로 수요일 오후 부재', '', '', '']] : [];

    const file = buildHwp(bytes, ach, plans, notes);
    const res = await uploadSubmission({
      user: u,
      division,
      fileName: `${slot.label.replace(/ /g, '_')}_${u.name}.hwp`,
      bytes: file,
    }, asOf);
    console.log(
      `  ${u.name.padEnd(5)} 실적 ${ach.length} · 계획 ${plans.length}${notes.length ? ' · 특이 1' : ''}  v${res.submission.version}`,
    );
  }
  console.log('\n완료. 병합: npx tsx scripts/run-merge.ts ' + slug);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
