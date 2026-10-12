'use strict';
/**
 * PG-62 · PG-80~84 — **가짜 데이터로만 도는 앱 하나.** 사용 안내 그림 찍기(`guide-capture.cjs`)와 안내 검사(`guide-check.cjs`)가 같이 쓴다.
 *
 *   1. 새 임시 디렉터리(os.tmpdir()/tincase-guide-*)에 빈 SQLite DB를 만든다      — 실제 DB를 가리킬 길이 없다
 *   2. `scripts/guide-seed.ts`로 가짜 부서·사람·업무일지를 넣고 표식(nonce)을 남긴다  — 사람이 있는 DB에는 시드하지 않는다
 *   3. `--verify`로 표식을 확인한다. 틀리면 멈춘다
 *   4. 이 체크아웃에서 `next dev`를 띄운다 (그 DB · 웹 작성만 · **알림은 어디로도 나가지 않는다** · 스케줄러·모델 끔)
 *   5. 끝나면 서버를 끄고, `next dev`가 고쳐 쓴 CLAUDE.md·AGENTS.md·next-env.d.ts를 되돌리고, 임시 디렉터리를 지운다
 *
 * 다른 서버·다른 DB를 겨냥하는 옵션은 **일부러 없다.** 테스트 서버의 DB도 운영의 사본이라 실명이 들어 있다 —
 * 그런 화면이 한 장이라도 찍히면 공개 저장소와 강당 화면에 남는다. 검사도 같은 이유로 가짜 앱에서만 돈다.
 *
 * **시계.** 언제 돌려도 같은 화면이 나오게, 서버와 시드를 「이번 주 수요일 15:00」(마감 전날 오후)으로 옮겨 놓는다
 * (GUIDE_CLOCK_SHIFT_MS). 마감(목 14:00)이 지난 뒤에 진짜 시각으로 찍으면 부서원 화면에 [작성하기]가 없고(마감 후 잠김),
 * 새벽에 찍으면 「제출 01:32」 같은 시각이 강당 화면에 뜬다. 월간 주(그 달 말일이 든 주)면 그 전 주로 간다.
 * Prisma가 스스로 채우는 시각(`@default(now())`)은 엔진이 진짜 시각으로 넣으므로 `fix()`(= 시드 `--fix-clock`)로 맞춘다.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const COOKIE = 'repman_session';
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'next-env.d.ts'];

function log(...a) {
  console.log('[guide]', ...a);
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT, 'playwright'].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      /* 다음 후보 */
    }
  }
  console.error('[guide] Playwright를 찾지 못했습니다. PLAYWRIGHT=<.../node_modules/playwright>로 알려 주세요.');
  process.exit(2);
}

// ── 시계 ────────────────────────────────────────────────────────────────────
/** KST 달력 — UTC 게터로 읽는다 (이 기계의 TZ와 무관하게) */
const kst = (ms) => new Date(ms + 9 * HOUR);
/** 그 시각이 든 주의 월요일 00:00 KST (UTC ms) */
function mondayOf(ms) {
  const k = kst(ms);
  const dow = (k.getUTCDay() + 6) % 7; // 월=0
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow) - 9 * HOUR;
}
/** WS-14 — 그 주에 어느 달의 말일이 들어 있으면 월간 주다 */
function isMonthly(monday) {
  for (let d = 0; d < 7; d++) {
    const a = kst(monday + d * DAY);
    const b = kst(monday + (d + 1) * DAY);
    if (a.getUTCMonth() !== b.getUTCMonth()) return true;
  }
  return false;
}
function pickClock(realNow) {
  if (process.env.GUIDE_NOW) {
    const t = Date.parse(process.env.GUIDE_NOW);
    if (Number.isNaN(t)) throw new Error(`GUIDE_NOW를 읽지 못했습니다: ${process.env.GUIDE_NOW}`);
    return t;
  }
  // 이번 주(월간 주면 그 전의 평범한 주) 수요일 15:00 — 마감 전날 오후. 업무 시간의 시각이 찍히고, 제출은 열려 있다
  let m = mondayOf(realNow);
  while (isMonthly(m)) m -= 7 * DAY;
  return m + 2 * DAY + 15 * HOUR;
}

/** 시계 심 — 서버·시드 프로세스의 `Date`만 옮긴다. 하위 클래스(TZDate)도 그대로 동작하게 new.target을 넘긴다 */
const CLOCK_SHIM = `'use strict';
const shift = Number(process.env.GUIDE_CLOCK_SHIFT_MS || 0);
if (shift) {
  const R = Date;
  function D(...a) {
    if (!new.target) return new R(R.now() + shift).toString();
    return Reflect.construct(R, a.length ? a : [R.now() + shift], new.target);
  }
  Object.setPrototypeOf(D, R);
  D.prototype = R.prototype;
  // 정적 메서드는 **자기 속성으로** 둔다 — Next 16 dev는 Date를 감싸면서 자기 속성만 옮겨 담아, 물려받은 UTC·parse가 사라졌다
  D.UTC = R.UTC;
  D.parse = R.parse;
  D.now = () => R.now() + shift;
  globalThis.Date = D;
}
`;

// ── 하위 프로세스 ────────────────────────────────────────────────────────────
function run(cmd, args, env, what) {
  const r = spawnSync(cmd, args, { cwd: REPO, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => l && !l.startsWith('{"level"'))
    .join('\n');
  if (r.status !== 0) throw new Error(`${what} 실패 (종료 ${r.status})\n${out}`);
  return out;
}
const tsx = (args, env, what) => run(process.execPath, [require.resolve('tsx/cli', { paths: [REPO] }), ...args], env, what);

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      /* 아직 안 떴다 */
    }
    if (Date.now() > until) throw new Error(`서버가 ${ms / 1000}초 안에 뜨지 않았습니다: ${url}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * 가짜 앱을 띄운다. 돌려주는 것: `{ base, sessions, slugs, week, fake, env, fix, tsx, stop }`.
 * `stop()`은 꼭 부른다(finally) — 서버·임시 디렉터리·next dev가 고친 파일을 되돌린다.
 */
async function startFakeApp({ port }) {
  const BASE = `http://127.0.0.1:${port}`;
  const realNow = Date.now();
  const fake = pickClock(realNow);
  let shift = fake - realNow;
  if (Math.abs(shift) < 60_000) shift = 0; // 1분 안쪽이면 옮길 것이 없다

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tincase-guide-'));
  const nonce = crypto.randomBytes(12).toString('base64url');
  const clock = path.join(work, 'clock.cjs');
  fs.writeFileSync(clock, CLOCK_SHIM);
  const db = path.join(work, 'guide.db');
  const env = {
    ...process.env,
    DATABASE_URL: `file:${db}`,
    STORAGE_ROOT: path.join(work, 'storage'),
    CF_ACCESS_TEAM: 'guide-capture',
    CF_ACCESS_AUD: '',
    SUBMIT_HWP_UPLOAD: 'off', // RU-60a — 「전사」 [올리기]를 닫는다. 부서원 업로드 길은 코드째 없다(WA-39)
    MERGE_MODEL: '',
    MERGE_SCHEDULER: 'off',
    MERGE_PAUSE_UNTIL: '',
    // 알림이 어디로도 나가지 않는다 — 실제 사람에게 닿을 길이 없다(가짜 사람은 사번도 없다)
    MESSENGER_URL: '',
    MESSENGER_LINK_BASE: '',
    TINCASE_ENV: '',
    SESSION_COOKIE_NAME: COOKIE,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    LOG_LEVEL: 'warn',
    GUIDE_WORK: work,
    GUIDE_NONCE: nonce,
    GUIDE_CLOCK_SHIFT_MS: String(shift),
    GUIDE_REAL_START: String(realNow),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, shift ? `--require ${clock}` : ''].filter(Boolean).join(' '),
  };
  delete env.DEV_IDENTITY; // 세션으로만 들어간다
  log(`작업 디렉터리 ${work}`);
  log(shift ? `가짜 시계: ${new Date(fake).toISOString()} (진짜보다 ${Math.round(shift / HOUR)}시간)` : '시계: 지금 그대로');

  const saved = Object.fromEntries(AGENT_FILES.map((f) => [f, fs.existsSync(path.join(REPO, f)) ? fs.readFileSync(path.join(REPO, f)) : null]));
  let server = null;
  const stop = () => {
    if (server) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* 이미 꺼졌다 */
      }
      server = null;
    }
    for (const [f, buf] of Object.entries(saved)) {
      const p = path.join(REPO, f);
      if (buf === null) {
        if (fs.existsSync(p)) fs.rmSync(p);
      } else if (!fs.existsSync(p) || !fs.readFileSync(p).equals(buf)) {
        fs.writeFileSync(p, buf);
      }
    }
    if (!process.env.GUIDE_KEEP) fs.rmSync(work, { recursive: true, force: true });
    else log(`임시 디렉터리를 남겼습니다: ${work}`);
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    run(process.execPath, [require.resolve('prisma/build/index.js', { paths: [REPO] }), 'db', 'push', '--skip-generate'], env, 'prisma db push');
    log(tsx(['scripts/guide-seed.ts'], env, '시드').trim());
    log(tsx(['scripts/guide-seed.ts', '--verify'], env, '표식 확인').trim());
    const { sessions, slugs, week } = JSON.parse(fs.readFileSync(path.join(work, 'sessions.json'), 'utf8'));

    const logFile = path.join(work, 'next-dev.log');
    const fd = fs.openSync(logFile, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [REPO] }), 'dev', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: REPO,
      env,
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    log(`next dev → ${BASE} (로그 ${logFile})`);
    await waitFor(`${BASE}/login`, 180_000);

    // 겨눈 서버가 이 시드의 DB인가 — 이 실행에서 만든 세션으로만 들어가진다
    const probe = await fetch(`${BASE}/${slugs.ai}`, { headers: { cookie: `${COOKIE}=${sessions.memberPending}` }, redirect: 'manual' });
    if (probe.status !== 200) throw new Error(`시드 세션으로 들어가지지 않습니다 (HTTP ${probe.status}) — 다른 서버가 ${port}를 쓰고 있지 않은지 확인하세요`);

    const fix = () => (shift ? Promise.resolve(tsx(['scripts/guide-seed.ts', '--fix-clock'], env, '시각 맞추기')) : Promise.resolve());
    return { base: BASE, sessions, slugs, week, fake, realNow, env, fix, tsx: (args, what) => tsx(args, env, what), stop, cookie: COOKIE };
  } catch (e) {
    stop();
    throw e;
  }
}

module.exports = { REPO, COOKIE, HOUR, DAY, log, loadPlaywright, kst, mondayOf, startFakeApp, tsx, run };
