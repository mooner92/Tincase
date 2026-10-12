// OPS-49 — DB가 가리키는 파일을 **이 판의 hwp 읽기로** 모두 열어 본다. **숫자만** 찍는다(이름·경로·내용 없음). **읽기 전용.**
//
//   cd ~/repman && DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog npx tsx scripts/check-files.ts [--all-templates]
//
// `--all-templates` — 꺼진 부서의 양식도 웹 작성 길로 채워 본다(있는지만 보지 않고). 부서를 켜기 **전에**(전환 전 일요일) 그 부서 양식이
// 쓸 만한지 미리 볼 때. 그 무리는 숫자만 보이고 종료 코드에 넣지 않는다.
//
// sudo 없이 돌린다 — mhchoi는 그룹으로 읽는다(DEPLOY §1). 종료 코드: 0 모두 읽힘 · 1 문제 있음(위 숫자를 본다) · 2 실행 오류.
//
// 왜 (2026-10-09 v2 전환 점검 — 이행 리허설 보고 3): 리허설은 지어낸 사람의 DB로 돌아서 **8~9월에 한글에서 올린 실제 파일과
// 옛 엔진이 쓴 병합본**을 보지 못했다. v2는 그 파일들을 새 읽기로 연다 — 부서원 홈의 「내 일지」·「병합본」(PG-70). 켠 부서의 양식은
// 웹 작성이 그대로 채운다(WA-04) — 그래서 양식은 읽기만이 아니라 **웹 작성과 같은 길(`buildWorklogHwp`)로 한 줄씩 채워 본다**(메모리에서만).
//
// DB는 `sqlite3 -readonly`로 읽는다 — Prisma 클라이언트를 쓰지 않으니 호스트 클라이언트가 옛 스키마여도 같고(`--skip-generate`),
// 운영 DB에 쓰기를 열지 않는다. 파일은 앱과 같은 `readStoredFile`(저장소 밖 경로 거절 — ST-03)로 읽기만 한다.
import { execFileSync } from 'node:child_process';
import { sqliteFileOf, tally, verdict, type Tally } from './lib/file-tally';

const ALL_TEMPLATES = process.argv.includes('--all-templates');
/** 꺼진 부서의 양식 — 숫자만 보이고 종료 코드에 넣지 않는다 (verdict) */
const OFF_TEMPLATES = ALL_TEMPLATES ? 'template(꺼진 부서 · 웹 작성으로 채워 봄)' : 'template(꺼진 부서 · 있는지만)';
const OPTIONAL = [OFF_TEMPLATES];

function rows(db: string, sql: string): Record<string, unknown>[] {
  const out = execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  return out ? (JSON.parse(out) as Record<string, unknown>[]) : [];
}
const paths = (db: string, sql: string) => rows(db, sql).map((r) => (typeof r.p === 'string' ? r.p : null));
/** 양식 무리 — 경로와 부서 이름(꼬리표). 부서 이름만 출력에 나간다 (file-tally 머리 주석) */
const templates = (db: string, active: 0 | 1) => {
  const rs = rows(db, `SELECT t.filePath AS p, d.nameKo AS n FROM Template t JOIN Division d ON d.id = t.divisionId WHERE t.isActive = 1 AND d.isActive = ${active}`);
  return { paths: rs.map((r) => (typeof r.p === 'string' ? r.p : null)), labels: rs.map((r) => String(r.n ?? '')) };
};

async function main(): Promise<number> {
  const db = sqliteFileOf(process.env.DATABASE_URL);
  if (!db || !process.env.STORAGE_ROOT) {
    console.error('DATABASE_URL=file:/절대/경로 와 STORAGE_ROOT가 필요합니다 — 예: DATABASE_URL=file:/data/worklog/db/worklog.db STORAGE_ROOT=/data/worklog');
    return 2;
  }
  // 웹 작성 길(worklog-doc → authz → env)이 env를 검사한다. 이 점검은 인증을 쓰지 않는다 — 비어 있을 때만 채운다
  process.env.CF_ACCESS_TEAM ||= 'check-files';
  const { readStoredFile } = await import('../src/server/storage');
  const { readWorklog } = await import('../src/lib/hwp/reader');
  const { buildWorklogHwp } = await import('../src/server/worklog-doc');

  const read = (rel: string) => readStoredFile(rel);
  const parse = (buf: Buffer) => readWorklog(buf);
  // 한 줄씩 — 표 셋을 모두 채우고 다시 읽어 맞는지까지 본다(WA-05). 강조 한 줄은 서식 만들기(HM-37)까지 지나게 한다
  const compose = (buf: Buffer) =>
    buildWorklogHwp(buf, {
      achievements: [{ content: '점검', date: '10.12.', emphasis: true }],
      plans: [{ content: '점검' }],
      notes: [{ content: '점검' }],
    });

  const groups: Record<string, Tally> = {};
  groups['submission(최신)'] = await tally(paths(db, 'SELECT filePath AS p FROM Submission WHERE isLatest = 1'), read, parse);
  groups['submission(옛 판)'] = await tally(paths(db, 'SELECT filePath AS p FROM Submission WHERE isLatest = 0'), read, parse);
  groups['mergeRun(성공)'] = await tally(paths(db, "SELECT outputPath AS p FROM MergeRun WHERE status = 'succeeded'"), read, parse);
  const on = templates(db, 1);
  groups['template(켠 부서 · 웹 작성으로 채워 봄)'] = await tally(on.paths, read, compose, on.labels);
  const off = templates(db, 0);
  // 꺼진 부서는 --all-templates일 때만 이름을 붙인다 — 「파일 없음」 열일곱 곳을 매번 늘어놓지 않게
  groups[OFF_TEMPLATES] = await tally(off.paths, read, ALL_TEMPLATES ? compose : null, ALL_TEMPLATES ? off.labels : undefined);

  for (const [name, t] of Object.entries(groups)) {
    const errs = Object.entries(t.errors).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(`${name}: ${t.rows}행 · 읽힘 ${t.ok} · 파일 없음 ${t.missing} · 실패 ${t.failed}${errs ? ` (${errs})` : ''}`);
    if (t.problems?.length) console.log(`  └ 부서: ${t.problems.join(' · ')}`);
  }
  const rc = verdict(groups, OPTIONAL);
  console.log(rc === 0 ? '끝: 모두 읽혔다 (꺼진 부서 양식 줄은 숫자만 — 종료 코드에 넣지 않는다)' : '끝: 문제 있음 — 위 줄의 「파일 없음」·「실패」를 본다 (꺼진 부서 양식 줄은 빼고)');
  return rc;
}

main().then(
  (rc) => process.exit(rc),
  (e) => {
    // 오류 문구에 경로가 섞일 수 있다 — 종류만
    console.error(`실행 오류: ${(e as Error)?.name ?? 'Error'}`);
    process.exit(2);
  },
);
