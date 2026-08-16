/**
 * 모의 테스트용 hwp 만들기 — 부서원 각자가 올릴 파일을 미리 뽑아둔다.
 *
 *   npx tsx scripts/make-test-files.ts [부서슬러그] [출력디렉터리]
 *
 * 왜 필요한가: 실제 업무일지는 개인정보라 테스트에 못 쓴다. 그렇다고 빈 파일을 올리면
 * 병합이 아무것도 안 하므로 확인이 안 된다. **사람마다 다른 내용**이 들어 있어야
 * 누구 것이 어디로 갔는지 눈으로 따라갈 수 있고, **일부러 겹치는 업무**가 있어야
 * 중복 묶기가 실제로 작동하는지 보인다.
 *
 * 이 스크립트는 DB를 건드리지 않는다 — 파일만 만든다. 올리는 것은 사람이 화면에서 한다
 * (그래야 업로드 경로 전체가 실제로 검증된다).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { openHwp } from '../src/lib/hwp/ole';
import { parseRecords, serializeRecords } from '../src/lib/hwp/record';
import { fillTable, packHwp } from '../src/lib/hwp/writer';
import { readStoredFile } from '../src/server/storage';

const prisma = new PrismaClient();

// 일부러 겹치게 둔 업무 — 중복 묶기 확인용. 여러 사람에게 같은 문구가 들어간다
const SHARED = [
  '부서 전체회의 참석',
  '2026년 하반기 업무계획 수립 회의',
  '주간업무 시스템(Tincase) 시범 운영 점검',
];

const TOPICS = [
  'AI 기반 환경데이터 분석 모델 개선',
  '보도자료 배포 및 언론 대응',
  '정기간행물 발간 진행',
  '온라인 홍보 콘텐츠 제작',
  '연구정보시스템 운영 지원',
  '내부망 백업 정책 점검',
  '전자저널 구독 갱신 협의',
  '홈페이지 콘텐츠 개편',
  '데이터 품질 점검 및 정비',
  '외부 기관 협력 실무 협의',
];

const PLACES = ['', '', '본원 중회의실', '본원 소회의실', '세종청사', '온라인'];

/** 같은 씨앗이면 같은 결과 — 다시 뽑아도 파일이 달라지지 않아야 비교가 된다 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  const slug = process.argv[2] ?? 'AI_and_Public_Relations_Division';
  const outDir = process.argv[3] ?? path.join(process.env.HOME ?? '.', 'tincase-test-files');

  const division = await prisma.division.findFirstOrThrow({ where: { slug } });
  const slot = await prisma.weekSlot.findFirstOrThrow({ orderBy: { opensAt: 'desc' } });
  const template = await prisma.template.findFirstOrThrow({ where: { divisionId: division.id, isActive: true } });
  const users = await prisma.user.findMany({
    where: { divisionId: division.id, isActive: true, onRoster: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  const base = await readStoredFile(template.filePath);

  mkdirSync(outDir, { recursive: true });
  console.log(`${division.nameKo} · ${slot.label} · ${users.length}명 · → ${outDir}\n`);

  for (const [i, u] of users.entries()) {
    const rand = rng(i * 7919 + 31);
    const pick = <T,>(arr: T[], n: number) => [...arr].sort(() => rand() - 0.5).slice(0, n);

    const own = pick(TOPICS, 2 + Math.floor(rand() * 3)).map((t) => `${t} (${u.name})`);
    const shared = pick(SHARED, i % 3 === 0 ? 2 : 1); // 3명 중 1명은 공용 업무 2건
    const items = [...own, ...shared];

    const ach = items.map((c, k) => [
      `1-${k + 1}`,
      c,
      rand() < 0.5 ? `8/${17 + Math.floor(rand() * 4)}` : '',
      PLACES[Math.floor(rand() * PLACES.length)],
      '',
    ]);
    const plans = pick(TOPICS, 2).map((c, k) => [`2-${k + 1}`, `${c} (계속)`, '', '', '']);
    const notes = i === 0 ? [['3-1', '모의 테스트용 파일입니다', '', '', '']] : [];

    const recs = parseRecords(openHwp(base).sections[0]);
    fillTable(recs, 0, ach);
    fillTable(recs, 1, plans);
    if (notes.length) fillTable(recs, 2, notes);

    // 파일명은 실제 제출 관례대로. 사람이 자기 것을 찾을 수 있어야 한다
    const name = `${slot.label.replace(/ /g, '_')}_${division.nameKo}_${u.name}.hwp`;
    writeFileSync(path.join(outDir, name), packHwp(base, [serializeRecords(recs)]));
    console.log(`  ${u.name.padEnd(5)} 실적 ${ach.length} · 계획 ${plans.length}  ${name}`);
  }

  console.log(`\n완료. 화면에서 각자 올리면 됩니다.`);
  console.log(`정리: npx tsx scripts/reset-week.ts ${slug} --yes`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
