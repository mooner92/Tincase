/**
 * RU-44 — 지난 실·팀 제출 파일을 **테스트 서버에** 「제출된 병합본」으로 적재한다.
 *
 *   DATABASE_URL=file:/data/worklog-test/db/worklog.db STORAGE_ROOT=/data/worklog-test \
 *     npx tsx scripts/import-reports.ts <폴더> --week 2026-W40 [--map 생물환경부=순환경제연구실 ...] [--yes]
 *
 * 받은 자료는 각 실·팀이 취합게시판에 올린 hwp다. 파일 이름에서 부서를 찾아(가장 긴 부서명이 이긴다)
 * 그 부서가 그 주에 [제출]한 것처럼 사본과 `ReportSubmission`(origin=import)을 만든다.
 * 그러면 본부 취합·전사 취합 화면에서 실제와 같은 입력으로 이어 붙여 볼 수 있다.
 *
 * 안전장치:
 * - **테스트 서버 DB에만 쓴다.** DATABASE_URL에 `worklog-test`가 없으면 멈춘다 — 운영에 지난 자료가 섞이면 안 된다
 * - 기본은 미리보기. `--yes`가 있어야 쓴다
 * - 부서를 못 찾은 파일은 **추측하지 않고** 건너뛴다 — `--map 조각=부서명`으로 알려 준다
 * - 한글로 못 읽는 파일(.hwpx 등)은 이유와 함께 건너뛴다
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { readUnits } from '../src/lib/hwp/rollup';
import { sha256, writeFileAtomic } from '../src/server/storage';
import { reportRelPath } from '../src/server/rollup/report';

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((v, i) => v === name && process.argv[i + 1] && out.push(process.argv[i + 1]));
  return out;
}
const squash = (s: string) => s.normalize('NFC').replace(/[\s_\-·.()[\]]/g, '');

async function main() {
  const dir = process.argv[2];
  const week = arg('--week');
  const yes = process.argv.includes('--yes');
  if (!dir || !week) {
    console.error('사용법: import-reports.ts <폴더> --week 2026-W40 [--map 조각=부서명] [--yes]');
    process.exit(2);
  }
  if (!/worklog-test/.test(process.env.DATABASE_URL ?? '')) {
    console.error('테스트 서버 DB(worklog-test)가 아닙니다. 운영 DB에는 적재하지 않습니다.');
    process.exit(2);
  }

  const slot = await prisma.weekSlot.findUnique({ where: { isoKey: week } });
  if (!slot) throw new Error(`${week} 주차가 DB에 없습니다 (그 주에 한 번이라도 화면을 열면 생깁니다).`);
  const divisions = await prisma.division.findMany();
  const operator = await prisma.user.findFirstOrThrow({ where: { isOperator: true } });

  const aliases = new Map<string, string>();
  for (const m of args('--map')) {
    const [piece, name] = m.split('=');
    if (!piece || !name || !divisions.some((d) => d.nameKo === name)) throw new Error(`--map ${m}: 부서명이 맞지 않습니다`);
    aliases.set(squash(piece), name);
  }
  const candidates = [
    ...divisions.map((d) => ({ key: squash(d.nameKo), name: d.nameKo })),
    ...[...aliases].map(([key, name]) => ({ key, name })),
  ].sort((a, b) => b.key.length - a.key.length);

  const files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  console.log(`${slot.label}(${week}) · 파일 ${files.length}개 · ${yes ? '적재' : '미리보기'}\n`);
  const seen = new Map<string, string>();
  let ok = 0;
  for (const f of files) {
    const hit = candidates.find((c) => squash(f).includes(c.key));
    if (!hit) {
      console.log(`  ✗ ${f} — 부서를 찾지 못함 (--map 조각=부서명)`);
      continue;
    }
    const div = divisions.find((d) => d.nameKo === hit.name)!;
    if (seen.has(div.id)) {
      console.log(`  ✗ ${f} — ${div.nameKo}는 이미 ${seen.get(div.id)}로 넣었습니다 (한 부서 한 파일)`);
      continue;
    }
    const bytes = readFileSync(path.join(dir, f));
    let read;
    try {
      read = readUnits(bytes, div.nameKo);
    } catch (e) {
      console.log(`  ✗ ${f} — 읽지 못함 (${(e as Error).message}). .hwpx면 한글에서 .hwp로 저장해 주세요`);
      continue;
    }
    const rows = read.units.map((u) => `${u.tables.achievements.length}/${u.tables.plans.length}/${u.tables.notes.length}`).join(' + ');
    console.log(`  ✓ ${f} → ${div.nameKo}${div.isActive ? '' : ' (꺼진 부서)'} · 단위 ${read.units.length} · 실적/계획/특이 ${rows}`);
    for (const w of read.warnings) console.log(`      ! ${w}`);
    seen.set(div.id, f);
    ok++;
    if (!yes) continue;

    const digest = sha256(bytes);
    const rel = reportRelPath(div.slug, slot, 'unit', `import_${digest.slice(0, 8)}`);
    await writeFileAtomic(rel, bytes);
    await prisma.reportSubmission.create({
      data: {
        level: 'unit',
        divisionId: div.id,
        weekSlotId: slot.id,
        filePath: rel,
        sha256: digest,
        byteSize: bytes.length,
        origin: 'import',
        submittedBy: operator.id,
      },
    });
  }
  console.log(`\n${ok}개 ${yes ? '적재함' : '적재 가능 — --yes로 실제 적재'}`);
  const inactive = [...seen.keys()].map((id) => divisions.find((d) => d.id === id)!).filter((d) => !d.isActive);
  if (inactive.length) {
    console.log(`꺼진 부서 ${inactive.length}곳은 취합에 안 보입니다 — 테스트 DB에서 켜세요: ${inactive.map((d) => d.nameKo).join(', ')}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
