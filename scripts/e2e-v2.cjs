#!/usr/bin/env node
/**
 * OPS-50 — **v2 브라우저 e2e 스모크.** 운영과 같은 빌드(next build → standalone server.js)를 가짜 사람만 있는 임시 저장소에 띄우고,
 * 역할마다 실제 화면을 **누르고 쳐서** 한 주를 끝까지 간다. 사람이 하는 일에는 API를 부르지 않는다 — 준비(마감을 몇 분 뒤로 옮기기)만 API다.
 *
 *   node scripts/e2e-v2.cjs                       새 임시 작업 디렉터리 — 이 체크아웃을 복사해 빌드 · 저장소 · 가짜 모델 · 서버 · 브라우저
 *   node scripts/e2e-v2.cjs --app=<dir> --no-build   빌드해 둔 복사본을 다시 쓴다(복사·빌드 건너뜀 — 같은 커밋일 때만)
 *   --work=<dir>        작업 디렉터리(기본 os.tmpdir()/tincase-e2e-*) — 저장소·로그·실패 화면·보고서가 여기에
 *   --port=3460         서버 포트(11111·11112·11113은 받지 않는다)
 *   --deadline-in=9     부서 마감을 지금 + N분으로(8~10이면 「10분 전」 알림까지 본다)
 *   --model-delay-ms=2500  가짜 병합 모델의 응답 지연 — 줄에 선 모습(「줄 n번째」)이 화면에 보일 만큼
 *   --keep              끝나도 작업 디렉터리를 남긴다(실패하면 늘 남긴다)
 *   --headed            브라우저 창을 띄운다
 *   --scope=launch      출시 범위(OPS-50h — 2026-10-13 운영 전환 그대로): 켠 부서 둘(기획조정실 · AI홍보전략실) · 3단계 끔 · 부서 알림은 그 둘만.
 *                       기본 `full`은 리허설 저장소 그대로(13개 단위 · 3단계 켬). 범위의 모양은 scripts/e2e-plan.ts
 *   PLAYWRIGHT=<.../node_modules/playwright>  (기본: 이 체크아웃 → /home/mhchoi/kei-dev-0703/web/node_modules/playwright)
 *
 * 흐름 (각 단계는 화면이 보이는 것을 확인한다 — 실패하면 그 화면을 찍어 둔다):
 *   부서원   첫 로그인 카드 [괜찮아요] · [작성하기] → 칸 입력·공유 → [제출] → 「제출 완료」 · [열기] → 한 칸 → [제출] = v2 ·
 *            제출 취소(확인 창) · 다시 제출 · 지난 주차 접힌 달 펼치기 · 지난 주 병합본 · (마감 뒤) 이번 주 병합본
 *   담당     수합 관리 → 미제출 이름 복사(평문 HTTP 대체 경로 — 클립보드 글자까지) · 마감 뒤 스케줄러 병합(줄 → 준비됨) ·
 *            [다시 병합] → 줄 자리 · 병합본 칸 고쳐 [수정 저장] · 부서원 제출물 [고치기] · 부서 설정 → 분류 순서 저장
 *   실장     병합본 고쳐 저장 = 승인 → 「위로」 카드 「올라감」 · 담당이 고친 뒤 다시 승인
 *   본부장   /hq 저절로 이어 붙은 본부본 → [검토 완료 · 승인] → 총괄로
 *   총괄     /org 전사본 준비 → [전사본 받기](hwp 머리 바이트) · [일정 바꾸기] 한 번 → 다음 주 마감 바꾸기 → [평소대로]
 *   운영자   로그인 화면 · /ops 병합 줄 · 알림 수신함의 종류 · 감사 로그의 행동
 *   안내     /guide/present PageDown ×5 · B 검은 화면 · 발표자 창 동기화 · 체험하기 주소(#lead-3)
 *   400px    부서원 홈 · 작성 화면 · 수합 관리 — 가로로 넘치지 않는다
 *
 * 출시 범위(--scope=launch)는 본부장·안내 흐름을 빼고 이것을 본다: 승인이 위로 가지 않는다(「위로」 카드 · 「올라갔어요」가 어디에도 없다) ·
 * 담당은 [받기]·[제목 복사]로 취합게시판에 올린다 · 부서장 없는 기획조정실 · 총괄은 현황판만(최종본 열 없음 · /hq 404) ·
 * 운영자 「알림」(범위 밖 켬 한 줄을 화면에서 끈다) · 「병합 점검」은 운영자와 기획조정실 담당 · **꺼진 부서 사람에게 간 쪽지 0**(수신함 파일을 읽는다).
 *
 * 안전: 서버는 이 스크립트가 만든 임시 저장소(@example.invalid 사람만 — rehearsal.ts prepare)에만 붙는다. 알림은 같은 서버의 가짜 수신함으로만
 * 간다(TINCASE_ENV=demo · MESSENGER_SINK=on — 다른 주소면 서버가 뜨지 않는다, OPS-46). 셸의 환경변수는 넘기지 않는다(.env*도 복사하지 않는다).
 * 브라우저는 `http://tincase.e2e:<포트>`로 들어간다 — 사내망처럼 **보안 컨텍스트가 아닌** 주소라 클립보드 대체 경로(CP-65)를 그대로 탄다.
 *
 * 결과: 표(흐름 × 단계 PASS/FAIL)와 `<work>/e2e-report.txt`·`.json`. 종료 코드 0 = 모두 통과 · 1 = 실패 있음 · 2 = 준비 실패. 절차는 docs/REHEARSAL.md.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const COOKIE = 'repman_e2e_session';
const HOST = 'tincase.e2e';
const UI = 15_000; // 화면 상태 하나를 기다리는 기본 한도

// ── 명령줄 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}
const num = (name, dflt) => {
  const v = arg(name);
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) die(`--${name}는 양수입니다 (받은 값: ${v})`);
  return n;
};
const PORT = num('port', 3460);
const DEADLINE_IN = num('deadline-in', 9);
const MODEL_DELAY = num('model-delay-ms', 2500);
const KEEP = arg('keep') !== undefined;
/** OPS-50h — 범위. scripts/e2e-plan.ts의 E2E_SCOPES와 같은 목록이다(이 파일은 TS를 불러오지 못한다 — 시드도 같은 값을 다시 본다) */
const SCOPES = ['full', 'launch'];
const SCOPE = arg('scope') ?? 'full';

function die(why, code = 2) {
  console.error(`e2e: 멈춤 — ${why}`);
  process.exit(code);
}
const kstIso = (ms) => new Date(ms + 9 * HOUR).toISOString();
const hms = (ms) => kstIso(ms).slice(11, 19);
const log = (s) => console.log(`[${hms(Date.now())}] ${s}`);
/** KST 그 주 월요일 00:00 (UTC ms) */
function mondayOf(ms) {
  const k = new Date(ms + 9 * HOUR);
  const dow = (k.getUTCDay() + 6) % 7;
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow) - 9 * HOUR;
}

/** 운영 · 테스트 · 시연 서버의 포트 — 이 스크립트는 그 서버를 겨누지 않는다(자기가 띄운 서버만 본다) */
const FORBIDDEN_PORTS = [11111, 11112, 11113];
if (require.main === module && FORBIDDEN_PORTS.includes(PORT)) die(`포트 ${PORT}는 운영·테스트·시연 서버의 것입니다 — 다른 포트를 주세요`);
// 빌드(1~2분) 전에 — 모르는 범위로 반쯤 돌고 나서야 알면 그만큼 버린다
if (require.main === module && !SCOPES.includes(SCOPE)) die(`--scope는 ${SCOPES.join(' | ')} 중 하나입니다 (받은 값: ${SCOPE || '없음'})`);

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT, 'playwright', '/home/mhchoi/kei-dev-0703/web/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      /* 다음 후보 */
    }
  }
  return die('Playwright를 찾지 못했습니다. PLAYWRIGHT=<.../node_modules/playwright>로 알려 주세요');
}

// ── 하위 프로세스 ────────────────────────────────────────────────────────────
/** 셸의 환경을 넘기지 않는다 — DATABASE_URL·MESSENGER_URL 같은 것이 딸려 가지 않게. 경로·홈·언어만 */
function cleanEnv(extra) {
  const keep = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']) if (process.env[k]) keep[k] = process.env[k];
  return { ...keep, TZ: 'Asia/Seoul', NEXT_TELEMETRY_DISABLED: '1', ...extra };
}
function run(cmd, args, opts, what) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => l && !l.startsWith('{"level"'))
    .join('\n');
  if (r.status !== 0) throw new Error(`${what} 실패 (종료 ${r.status})\n${out.slice(-4000)}`);
  return out;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
function portBusy(port) {
  return new Promise((resolve) => {
    const c = net.connect(port, '127.0.0.1');
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}
async function waitHttp(url, ms, ok = (r) => r.status === 200) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (ok(r)) return r;
    } catch {
      /* 아직 안 떴다 */
    }
    if (Date.now() > until) throw new Error(`${ms / 1000}초 안에 응답이 없습니다: ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── 결과 ────────────────────────────────────────────────────────────────────
const results = [];
const okOf = new Map();
let shotsDir = null;
let shotN = 0;
const pageErrors = [];

/**
 * 한 단계. `fn`이 던지면 실패 — 그 화면을 찍어 둔다. `needs`의 단계가 실패했으면 돌리지 않고 「건너뜀」으로 남긴다
 * (뒤 단계의 실패가 앞 실패의 그림자로 읽히지 않게).
 */
async function step(flow, name, page, fn, needs = []) {
  const key = `${flow}/${name}`;
  const missing = needs.filter((n) => !okOf.get(n));
  if (missing.length) {
    results.push({ flow, name, ok: false, skipped: true, ms: 0, detail: `건너뜀 — 앞 단계 실패: ${missing.join(', ')}` });
    okOf.set(key, false);
    log(`SKIP ${flow} · ${name}`);
    return false;
  }
  const t0 = Date.now();
  try {
    const detail = (await fn()) ?? '';
    results.push({ flow, name, ok: true, ms: Date.now() - t0, detail: String(detail) });
    okOf.set(key, true);
    log(`ok   ${flow} · ${name}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (e) {
    let shot = '';
    if (page && shotsDir) {
      shot = path.join(shotsDir, `${String(++shotN).padStart(2, '0')}-${flow}-${name}.png`.replace(/[\s/·:()[\]]+/g, '_'));
      await page.screenshot({ path: shot, fullPage: true }).catch(() => (shot = ''));
    }
    const msg = String(e && e.message ? e.message : e).split('\n').filter(Boolean).slice(0, 3).join(' / ');
    results.push({ flow, name, ok: false, ms: Date.now() - t0, detail: `${msg}${shot ? ` [화면 ${path.basename(shot)}]` : ''}` });
    okOf.set(key, false);
    log(`FAIL ${flow} · ${name} — ${msg}`);
    return false;
  }
}
const need = (cond, why) => {
  if (!cond) throw new Error(why);
};

/** 터미널 칸 — 한글은 두 칸 */
const width = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
const pad = (s, cols) => s + ' '.repeat(Math.max(1, cols - width(s)));

function table() {
  const lines = [];
  const w1 = Math.max(...results.map((r) => width(r.flow)), 4) + 2;
  const w2 = Math.max(...results.map((r) => width(r.name)), 4) + 2;
  lines.push(`${pad('흐름', w1)}${pad('단계', w2)}${pad('결과', 7)}${pad('초', 6)}내용`);
  lines.push('-'.repeat(w1 + w2 + 13 + 40));
  for (const r of results) {
    const res = r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL';
    lines.push(`${pad(r.flow, w1)}${pad(r.name, w2)}${pad(res, 7)}${pad((r.ms / 1000).toFixed(1), 6)}${r.detail}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok && !r.skipped).length;
  const skip = results.filter((r) => r.skipped).length;
  lines.push('');
  lines.push(`PASS ${pass} · FAIL ${fail} · SKIP ${skip} → ${fail + skip === 0 ? '통과' : '실패'}`);
  return { text: lines.join('\n'), ok: fail + skip === 0 };
}

// ── 빌드 ────────────────────────────────────────────────────────────────────
/**
 * 이 체크아웃을 작업 디렉터리에 복사해(node_modules는 하드링크) `next build` → standalone을 Dockerfile과 같은 모양으로 맞춘다.
 * 체크아웃 자체에는 아무것도 쓰지 않는다(.next도 next-env.d.ts도) — 운영 배포 체크아웃에서 돌려도 그 빌드를 건드리지 않는다.
 * .env*·docs/private·DB 파일은 복사하지 않는다.
 */
function buildApp(app, work) {
  fs.mkdirSync(app, { recursive: true });
  log(`복사 ${REPO} → ${app}`);
  run(
    'rsync',
    ['-a', '--delete', '--exclude', 'node_modules', '--exclude', '.next', '--exclude', '.git', '--exclude', '.env*', '--exclude', 'docs/private',
      '--exclude', 'prisma/*.db', '--exclude', 'prisma/*.db-journal', '--exclude', 'tsconfig.tsbuildinfo', `${REPO}/`, `${app}/`],
    {},
    '복사(rsync)',
  );
  if (!fs.existsSync(path.join(app, 'node_modules'))) run('cp', ['-al', path.join(REPO, 'node_modules'), path.join(app, 'node_modules')], {}, 'node_modules 하드링크');
  log('next build … (1~3분)');
  const out = run(process.execPath, [require.resolve('next/dist/bin/next', { paths: [app] }), 'build'], {
    cwd: app,
    env: cleanEnv({ DATABASE_URL: `file:${path.join(work, 'build.db')}`, STORAGE_ROOT: work, CF_ACCESS_TEAM: 'build' }),
  }, 'next build');
  fs.writeFileSync(path.join(work, 'build.log'), out);
  assemble(app);
}
/** Dockerfile의 run 단계와 같다 — standalone + .next/static + public */
function assemble(app) {
  const sa = path.join(app, '.next', 'standalone');
  if (!fs.existsSync(path.join(sa, 'server.js'))) throw new Error(`standalone 출력이 없습니다: ${sa} (next.config output: 'standalone')`);
  fs.rmSync(path.join(sa, '.next', 'static'), { recursive: true, force: true });
  fs.rmSync(path.join(sa, 'public'), { recursive: true, force: true });
  fs.cpSync(path.join(app, '.next', 'static'), path.join(sa, '.next', 'static'), { recursive: true });
  fs.cpSync(path.join(app, 'public'), path.join(sa, 'public'), { recursive: true });
}

// ── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  const { chromium } = loadPlaywright();
  const work = path.resolve(arg('work') || fs.mkdtempSync(path.join(os.tmpdir(), 'tincase-e2e-')));
  fs.mkdirSync(work, { recursive: true });
  shotsDir = path.join(work, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const app = path.resolve(arg('app') || path.join(work, 'app'));
  const store = path.join(work, 'store');
  log(`작업 디렉터리 ${work}`);

  const procs = [];
  let browser = null;
  const stop = () => {
    for (const p of procs) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        /* 이미 꺼졌다 */
      }
    }
    procs.length = 0;
  };
  // 어떤 길로 끝나든(준비 중의 die() 포함) 띄운 서버·모델을 남기지 않는다 — 떼어 띄운(detached) 프로세스라 그냥 두면 남는다
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  let setupOk = false;
  let report = null;
  // 빌드(1~2분) 전에 — 늦게 알면 그만큼 버린다
  if (fs.existsSync(store)) die(`저장소가 이미 있습니다: ${store} — 새 --work를 주세요 (한 번 쓴 저장소는 다시 쓰지 않는다)`);
  if (await portBusy(PORT)) die(`포트 ${PORT}를 다른 것이 쓰고 있습니다 — --port=`);
  try {
    // ── 1. 빌드 ──
    if (arg('no-build') !== undefined && fs.existsSync(path.join(app, '.next', 'standalone', 'server.js'))) {
      log(`빌드 건너뜀 — ${app}`);
      assemble(app);
    } else buildApp(app, work);

    // ── 2. 가짜 저장소 ── 리허설 저장소(13개 단위 · 가짜 사람 · 이번 주 제출 · 알림 켬) + 지난 주차 · 역할 세션
    fs.mkdirSync(store, { recursive: true });
    const tsx = require.resolve('tsx/cli', { paths: [app] });
    const tool = (args, what) => run(process.execPath, [tsx, ...args], { cwd: app, env: cleanEnv({}) }, what);
    log(tool(['scripts/rehearsal.ts', 'prepare', `--root=${store}`], 'rehearsal prepare').split('\n').find((l) => l.startsWith('rehearsal prepare')) ?? '');
    log(tool(['scripts/e2e-seed.ts', `--root=${store}`, `--scope=${SCOPE}`], 'e2e-seed').trim().split('\n').pop());
    const seed = JSON.parse(fs.readFileSync(path.join(store, 'e2e', 'seed.json'), 'utf8'));

    // ── 3. 가짜 병합 모델 · 서버 ──
    if (await portBusy(PORT)) die(`포트 ${PORT}를 그새 다른 것이 쓰기 시작했습니다 — --port=`);
    const modelPort = await freePort();
    const mlog = fs.openSync(path.join(work, 'fake-model.log'), 'w');
    procs.push(spawn(process.execPath, [tsx, 'scripts/rehearsal.ts', 'fake-model', `--port=${modelPort}`, `--delay-ms=${MODEL_DELAY}`], { cwd: app, env: cleanEnv({}), stdio: ['ignore', mlog, mlog], detached: true }));
    await waitHttp(`http://127.0.0.1:${modelPort}/api/tags`, 30_000, () => true);

    const local = `http://127.0.0.1:${PORT}`;
    const slog = fs.openSync(path.join(work, 'server.log'), 'w');
    const serverEnv = cleanEnv({
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: `file:${path.join(store, 'db', 'worklog.db')}`,
      STORAGE_ROOT: store,
      // 운영 빌드는 AUD가 필수다(AU-02) — 어떤 Cloudflare 앱에도 없는 값으로(테스트 서버와 같은 까닭). 로그인은 세션 · 비밀번호로만
      CF_ACCESS_TEAM: 'tincase-e2e-disabled',
      CF_ACCESS_AUD: crypto.randomBytes(32).toString('hex'),
      TINCASE_ENV: 'demo',
      SESSION_COOKIE_NAME: COOKIE,
      MESSENGER_URL: `${local}/api/dev/messenger-sink`,
      MESSENGER_SINK: 'on',
      MESSENGER_ALLOWLIST: '*',
      MESSENGER_LINK_BASE: '',
      MERGE_SCHEDULER: 'on',
      MERGE_PAUSE_UNTIL: '',
      SUBMIT_HWP_UPLOAD: 'off',
      MERGE_MODEL: 'fake-model',
      MERGE_MODEL_URL: `http://127.0.0.1:${modelPort}`,
      LOG_LEVEL: 'warn',
    });
    procs.push(spawn(process.execPath, ['server.js'], { cwd: path.join(app, '.next', 'standalone'), env: serverEnv, stdio: ['ignore', slog, slog], detached: true }));
    await waitHttp(`${local}/api/health`, 90_000);
    // 겨눈 서버가 이 저장소인가 — 이 실행에서 만든 세션으로만 들어가진다
    const probe = await fetch(`${local}/${seed.aiSlug}`, { headers: { cookie: `${COOKIE}=${seed.tokens.memberPending}` }, redirect: 'manual' });
    if (probe.status !== 200) die(`시드 세션으로 들어가지지 않습니다 (HTTP ${probe.status}) — 다른 서버가 ${PORT}를 쓰고 있지 않은지`);
    const sink = await fetch(`${local}/api/dev/messenger-sink`);
    if (sink.status !== 200) die('가짜 알림 수신함이 닫혀 있습니다');
    log(`서버 ${local} (production · standalone) · 가짜 모델 :${modelPort} 지연 ${MODEL_DELAY}ms`);

    // ── 4. 준비: 마감을 지금 + N분으로 (총괄의 [일정 바꾸기]와 같은 API — 사람의 흐름이 아니라 준비다) ──
    const deadline = Math.ceil((Date.now() + DEADLINE_IN * MIN) / MIN) * MIN;
    const external = kstIso(deadline + HOUR).slice(0, 16);
    const moved = await fetch(`${local}/api/schedule/deadline`, {
      method: 'POST',
      headers: { cookie: `${COOKIE}=${seed.tokens.coordinator}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'apply', external }),
    });
    const mj = await moved.json().catch(() => ({}));
    if (moved.status !== 200 || new Date(mj.plan?.department).getTime() !== deadline) die(`마감을 옮기지 못했습니다: HTTP ${moved.status} ${JSON.stringify(mj).slice(0, 200)}`);
    log(`부서 마감 ${hms(deadline)} (지금 + ${((deadline - Date.now()) / MIN).toFixed(1)}분) · ${mj.plan.weekLabel} · 범위 ${SCOPE}`);
    setupOk = true;

    // ── 5. 브라우저 ──
    browser = await chromium.launch({ headless: arg('headed') === undefined, args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
    const base = `http://${HOST}:${PORT}`;
    const ctx = await makeContexts(browser, base, local, seed);
    const env = { base, local, seed, deadline, store, work, ctx };

    if (SCOPE === 'launch') await launchFlows(env);
    else await fullFlows(env);
    for (const c of Object.values(ctx.all)) await c.close().catch(() => {});
  } catch (e) {
    if (!setupOk) {
      console.error(`e2e: 준비 실패 — ${e && e.stack ? e.stack : e}`);
      console.error(`작업 디렉터리를 남깁니다: ${work}`);
      stop();
      if (browser) await browser.close().catch(() => {});
      process.exit(2);
    }
    results.push({ flow: '실행', name: '예기치 않은 오류', ok: false, ms: 0, detail: String(e && e.message ? e.message : e).split('\n')[0] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    stop();
  }

  report = table();
  if (pageErrors.length) {
    report.text += `\n\n브라우저 페이지 오류 ${pageErrors.length}건:\n${pageErrors.map((x) => `  ${x}`).join('\n')}`;
  }
  console.log(`\n${report.text}\n`);
  fs.writeFileSync(path.join(work, 'e2e-report.txt'), report.text + '\n');
  fs.writeFileSync(path.join(work, 'e2e-report.json'), JSON.stringify({ ok: report.ok, results, pageErrors }, null, 1));
  if (report.ok && !KEEP) {
    // 빌드 복사본은 --app으로 받은 것이면 남긴다(다시 쓰려고 준 것이다)
    for (const d of ['store', 'shots', ...(arg('app') ? [] : ['app'])]) fs.rmSync(path.join(work, d), { recursive: true, force: true });
    log(`보고서 ${path.join(work, 'e2e-report.txt')} (${arg('app') ? '저장소는' : '저장소·빌드 복사본은'} 지웠다 — 남기려면 --keep)`);
  } else log(`작업 디렉터리를 남깁니다: ${work} (서버 로그 server.log · 실패 화면 shots/ · 보고서 e2e-report.txt)`);
  process.exit(report.ok ? 0 : 1);
}

// ── 브라우저 맥락 ────────────────────────────────────────────────────────────
async function makeContexts(browser, base, local, seed) {
  const all = {};
  const make = async (name, token, opts = {}) => {
    const c = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
    if (token) await c.addCookies([{ name: COOKIE, value: token, url: base }]);
    // 클립보드는 보안 컨텍스트(127.0.0.1) 페이지에서 읽는다 — 앱 페이지(tincase.e2e)는 평문 HTTP라 navigator.clipboard가 없다(CP-65)
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: local });
    c.on('page', (p) => p.on('pageerror', (e) => pageErrors.push(`${name} ${p.url().replace(base, '')}: ${String(e.message).split('\n')[0]}`)));
    all[name] = c;
    return c;
  };
  const t = seed.tokens;
  return {
    all,
    member: await make('부서원', t.memberPending),
    member400: await make('부서원400', t.memberPending, { viewport: { width: 400, height: 860 }, hasTouch: false }),
    lead: await make('담당', t.lead),
    lead400: await make('담당400', t.lead, { viewport: { width: 400, height: 860 } }),
    head: await make('실장', t.head),
    hqHead: await make('본부장', t.hqHead),
    coord: await make('총괄', t.coordinator),
    ops: await make('운영자', null),
    guide: await make('안내', t.lead, { viewport: { width: 1600, height: 900 } }),
    // OPS-50h — 출시 범위에서만: 부서장 없는 기획조정실의 담당
    ...(t.pcLead ? { pcLead: await make('기획조정실담당', t.pcLead) } : {}),
  };
}

/** 첫 화면의 둘러보기 카드(PG-84) — 있으면 [괜찮아요]. 서버가 기록해 다음부터는 안 뜬다. 부서원 흐름은 따로 확인한다 */
async function dismissTour(page) {
  const offer = page.getByRole('region', { name: '화면 둘러보기 제안' });
  try {
    await offer.waitFor({ state: 'visible', timeout: 4000 });
    // 기록이 서버에 닿을 때까지 — 곧바로 다른 화면(다른 레이아웃)으로 가면 그 화면이 기록 전에 계산되어 카드가 또 뜰 수 있다
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/me/tour') && r.request().method() === 'POST', { timeout: UI }),
      offer.getByRole('button', { name: '괜찮아요' }).click(),
    ]);
    await offer.waitFor({ state: 'detached', timeout: UI });
  } catch {
    /* 카드가 없는 사람·화면 */
  }
}
/** 보이는 상단 메뉴 링크 — 넓은 화면은 위 줄, 좁은 화면은 아랫줄(같은 링크가 둘 있다) */
const navLink = (page, name) => page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name, exact: true }).filter({ visible: true }).first();
/** 가로로 넘치나 — 문서(와 주면 그 요소)의 scrollWidth가 보이는 폭보다 넓으면 넘친다 */
async function overflowOf(page, sel) {
  return page.evaluate((s) => {
    const doc = document.documentElement;
    const out = { doc: doc.scrollWidth - doc.clientWidth, el: 0, wide: [] };
    if (s) {
      const el = document.querySelector(s);
      if (el) out.el = el.scrollWidth - el.clientWidth;
    }
    // 넘친 원인을 찾기 쉽게 — 창보다 오른쪽으로 나간 요소(가로 스크롤 상자 안은 뺀다)
    if (out.doc > 0 || out.el > 0) {
      const vw = doc.clientWidth;
      for (const e of document.querySelectorAll('body *')) {
        const r = e.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0) {
          let p = e.parentElement;
          let clipped = false;
          while (p) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
              clipped = true;
              break;
            }
            p = p.parentElement;
          }
          if (!clipped) out.wide.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')} →${Math.round(r.right)}`);
        }
        if (out.wide.length >= 3) break;
      }
    }
    return out;
  }, sel ?? null);
}

// ── 흐름: 부서원 (마감 전) ────────────────────────────────────────────────────
const RUN_TAG = crypto.randomBytes(2).toString('hex');
const T = {
  a1: `E2E 부서원 실적 하나 ${RUN_TAG}`,
  a2: `E2E 부서원 실적 둘 ${RUN_TAG}`,
  a2b: `E2E 부서원 실적 둘 고침 ${RUN_TAG}`,
  p1: `E2E 부서원 계획 하나 ${RUN_TAG}`,
};

async function memberBeforeDeadline({ base, ctx }) {
  const F = '부서원';
  const p = await ctx.member.newPage();
  const card = p.locator('section[data-guide="week-card"]');
  const chip = card.locator('span.chip').filter({ hasText: /제출 완료|미제출/ }).first();
  const composer = p.getByRole('dialog').filter({ has: p.locator('#composer-title') });
  const ach = composer.locator('section[data-guide="compose-table"]');
  const plans = composer.locator('section').filter({ has: p.getByRole('heading', { name: '2. 주요 업무계획' }) });

  await step(F, '첫 로그인 카드 [괜찮아요]', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await card.waitFor({ state: 'visible', timeout: UI });
    const offer = p.getByRole('region', { name: '화면 둘러보기 제안' });
    await offer.waitFor({ state: 'visible', timeout: 8000 });
    const title = (await offer.locator('p').first().innerText()).trim();
    // 낸 적이 있는 사람(지난 주차가 있다)은 「화면이 바뀌었어요」 — 운영을 v2로 덮은 월요일의 부서원이 보는 것(tour.ts)
    need(title === '화면이 바뀌었어요', `카드 제목: ${title}`);
    // 기록(POST /api/me/tour — keepalive)이 서버에 닿은 뒤에 다시 연다. 누르자마자 다시 열면 그 GET이 기록보다 먼저 계산될 수 있다
    const [rec] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith('/api/me/tour') && r.request().method() === 'POST', { timeout: UI }),
      offer.getByRole('button', { name: '괜찮아요' }).click(),
    ]);
    need(rec.ok(), `둘러보기 기록 HTTP ${rec.status()}`);
    await offer.waitFor({ state: 'detached', timeout: UI });
    // 다시 열어도 저절로 뜨지 않는다(서버 기록 — DM-25). 카드는 1.2초 뒤에 뜨므로 3초를 지켜본다
    await p.reload({ waitUntil: 'domcontentloaded' });
    await card.waitFor({ state: 'visible', timeout: UI });
    const back = await offer.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    need(!back, '다시 열었더니 카드가 또 떴다');
    return `「${title}」 → 닫힘 · 다시 열어도 안 뜸`;
  });

  await step(F, '[작성하기] → 입력 → [제출] → 제출 완료', p, async () => {
    need((await chip.innerText()).includes('미제출'), `처음 상태가 미제출이 아니다: ${await chip.innerText()}`);
    await card.getByRole('button', { name: '작성하기' }).click();
    await composer.waitFor({ state: 'visible', timeout: UI });
    await ach.getByLabel('주요 업무실적 1번째 줄 업무 내용').fill(T.a1);
    await ach.getByLabel('주요 업무실적 1번째 줄 일자').fill('10/6');
    await ach.getByLabel('주요 업무실적 1번째 줄 장소').fill('본원 중회의실');
    await ach.getByLabel('주요 업무실적 1번째 줄 참석자').fill('원장 외 3명');
    const share = ach.getByRole('button', { name: '1번째 줄 공유 표시' });
    await share.click();
    need((await share.getAttribute('aria-pressed')) === 'true', '공유 표시가 켜지지 않았다');
    // 첫 줄을 채우면 빈 줄이 하나 생긴다(WA — 이어 적을 줄)
    await ach.getByLabel('주요 업무실적 2번째 줄 업무 내용').fill(T.a2);
    await plans.getByLabel('주요 업무계획 1번째 줄 업무 내용').fill(T.p1);
    need((await ach.innerText()).includes('2줄'), '실적 표의 줄 수가 2가 아니다');
    await composer.getByRole('button', { name: '제출', exact: true }).click();
    await composer.getByText('제출되었습니다 (v1).').waitFor({ timeout: UI });
    await composer.waitFor({ state: 'detached', timeout: UI });
    await chip.filter({ hasText: '제출 완료' }).waitFor({ timeout: UI });
    const at = await card.getByText(/\d\d-\d\d \d\d:\d\d 제출/).innerText();
    await card.getByRole('button', { name: '열기' }).waitFor({ timeout: UI });
    return `v1 · ${at.trim()} · 공유 1줄`;
  });

  await step(F, '[열기] → 한 칸 고쳐 [제출] = v2', p, async () => {
    await card.getByRole('button', { name: '열기' }).click();
    await composer.waitFor({ state: 'visible', timeout: UI });
    const first = ach.getByLabel('주요 업무실적 1번째 줄 업무 내용');
    await p.waitForFunction((t) => [...document.querySelectorAll('input')].some((i) => i.value === t), T.a1, { timeout: UI });
    need((await first.inputValue()) === T.a1, `낸 판으로 채워지지 않았다: ${await first.inputValue()}`);
    need((await ach.getByRole('button', { name: '1번째 줄 공유 표시' }).getAttribute('aria-pressed')) === 'true', '공유 표시가 낸 판에서 빠졌다');
    const submit = composer.getByRole('button', { name: '제출', exact: true });
    need(await submit.isDisabled(), '바꾸기 전인데 [제출]이 켜져 있다(WA-37)');
    await ach.getByLabel('주요 업무실적 2번째 줄 업무 내용').fill(T.a2b);
    await p.waitForFunction(() => {
      const b = [...document.querySelectorAll('[data-guide="compose-submit"]')][0];
      return b && !b.disabled;
    }, null, { timeout: UI });
    await submit.click();
    await composer.getByText('제출되었습니다 (v2).').waitFor({ timeout: UI });
    await composer.waitFor({ state: 'detached', timeout: UI });
    await chip.filter({ hasText: '제출 완료' }).waitFor({ timeout: UI });
    return 'v2 제출 · [제출]은 바꾸기 전 꺼짐';
  }, [`${F}/[작성하기] → 입력 → [제출] → 제출 완료`]);

  await step(F, '제출 취소(확인 창) → 미제출', p, async () => {
    let message = '';
    p.once('dialog', async (d) => {
      message = d.message();
      await d.accept();
    });
    await card.getByRole('button', { name: '제출 취소' }).click();
    await chip.filter({ hasText: '미제출' }).waitFor({ timeout: UI });
    await card.getByRole('button', { name: '작성하기' }).waitFor({ timeout: UI });
    need(message.includes('2개 버전(v1~v2)'), `확인 창이 무엇이 사라지는지 말하지 않는다: ${message.replace(/\n/g, ' ')}`);
    return `확인 창 「${message.split('\n')[1]}」 → 미제출 · [작성하기]`;
  }, [`${F}/[열기] → 한 칸 고쳐 [제출] = v2`]);

  await p.close();
}

/** 부서원 (마감 전, 둘째 부분) — 담당이 미제출 이름을 복사한 뒤 다시 낸다. 지난 주차 */
async function memberResubmit({ base, ctx }) {
  const F = '부서원';
  const p = await ctx.member.newPage();
  const card = p.locator('section[data-guide="week-card"]');
  const chip = card.locator('span.chip').filter({ hasText: /제출 완료|미제출/ }).first();
  const composer = p.getByRole('dialog').filter({ has: p.locator('#composer-title') });
  const ach = composer.locator('section[data-guide="compose-table"]');
  const plans = composer.locator('section').filter({ has: p.getByRole('heading', { name: '2. 주요 업무계획' }) });
  await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await card.waitFor({ state: 'visible', timeout: UI });

  await step(F, '다시 작성 → [제출] (병합본에 들어갈 판)', p, async () => {
    await card.getByRole('button', { name: '작성하기' }).click();
    await composer.waitFor({ state: 'visible', timeout: UI });
    // 취소한 판은 남지 않는다 — 빈 표에서 시작한다
    need((await ach.getByLabel('주요 업무실적 1번째 줄 업무 내용').inputValue()) === '', '취소했는데 옛 판이 채워져 있다');
    await ach.getByLabel('주요 업무실적 1번째 줄 업무 내용').fill(T.a1);
    await ach.getByRole('button', { name: '1번째 줄 공유 표시' }).click();
    await plans.getByLabel('주요 업무계획 1번째 줄 업무 내용').fill(T.p1);
    await composer.getByRole('button', { name: '제출', exact: true }).click();
    await composer.getByText('제출되었습니다 (v1).').waitFor({ timeout: UI });
    await composer.waitFor({ state: 'detached', timeout: UI });
    await chip.filter({ hasText: '제출 완료' }).waitFor({ timeout: UI });
    return 'v1 다시 제출 · 공유 1줄';
  }, [`${F}/제출 취소(확인 창) → 미제출`]);

  await step(F, '지난 주차 — 접힌 달 펼치기', p, async () => {
    const past = p.locator('section[data-guide="past-weeks"]');
    await past.waitFor({ state: 'visible', timeout: UI });
    const months = past.locator(':scope > ol > li > details');
    const n = await months.count();
    const states = [];
    for (let i = 0; i < n; i++) states.push(await months.nth(i).evaluate((d) => d.open));
    const k = states.indexOf(false);
    need(n >= 3 && k >= 0, `달 묶음 ${n}개 · 접힌 달 없음 (${states.join(',')})`);
    const fold = months.nth(k);
    const label = ((await fold.locator('summary').textContent()) ?? '').replace(/\s+/g, ' ').match(/\d{4}년 \d+월/)?.[0] ?? '?';
    const rows = fold.locator('ol > li');
    need(!(await rows.first().isVisible()), '접힌 달의 주가 보인다');
    await fold.locator('summary').click();
    await p.waitForFunction((el) => el.open, await fold.elementHandle(), { timeout: UI });
    await rows.first().waitFor({ state: 'visible', timeout: UI });
    const week = (await rows.first().innerText()).split('\n')[0].trim();
    need(await rows.first().getByRole('button', { name: /내 일지 열기/ }).isVisible(), '펼친 달에 [내 일지]가 없다');
    return `달 ${n}개 중 처음 접힌 「${label}」 펼침 → ${week}`;
  });

  await step(F, '지난 주 [병합본] 열기', p, async () => {
    const past = p.locator('section[data-guide="past-weeks"]');
    const btn = past.getByRole('button', { name: /병합본 열기/ }).filter({ visible: true }).first();
    const which = await btn.getAttribute('aria-label');
    // WS-14 — 그 주가 월간이면 줄에 「월간」 칩, 병합본 제목은 「n월 연구운영회의 월간업무」(주차 번호 없음). 둘이 같은 말을 하는지 본다
    const monthly = (await btn.locator('xpath=ancestor::li[1]').locator('span.chip').filter({ hasText: /^월간$/ }).count()) > 0;
    await btn.click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.waitFor({ state: 'visible', timeout: UI });
    await d.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: UI });
    const title = (await d.locator('h2').innerText()).trim();
    const rows = await d.locator('table tbody tr').count();
    need(!(await d.locator('textarea').count()), '부서원 병합본이 고칠 수 있게 열렸다(CP-114 view)');
    need(monthly === /^\d+월 연구운영회의 월간업무\(/.test(title), `줄의 월간 칩(${monthly ? '있음' : '없음'})과 병합본 제목이 다르다: ${title}`);
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    return `${which?.replace(' 열기', '')}${monthly ? '(월간)' : ''} → 「${title}」 ${rows}행 · 읽기 전용`;
  });
  await p.close();
}

// ── 흐름: 담당 (마감 전) ─────────────────────────────────────────────────────
async function leadBeforeDeadline({ base, local, ctx }) {
  const F = '담당';
  const p = await ctx.lead.newPage();
  await step(F, '수합 관리 → 미제출 이름 복사', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '수합 관리').click();
    await p.waitForURL(/\/manage$/, { timeout: UI });
    const status = p.locator('section[data-guide="status-card"]');
    await status.waitFor({ timeout: UI });
    // 표에서 「미제출」인 사람 — 화면이 보여 주는 대로(표 순서)
    const rows = p.locator('table.table tbody tr');
    await rows.first().waitFor({ timeout: UI });
    const names = [];
    for (let i = 0; i < (await rows.count()); i++) {
      const tds = rows.nth(i).locator('td');
      if ((await tds.nth(1).innerText()).includes('미제출')) names.push((await tds.nth(0).innerText()).trim());
    }
    const btn = status.getByRole('button', { name: /이름 복사|복사됨|복사하지/ });
    const label = (await btn.innerText()).trim();
    need(label === `미제출 ${names.length}명 이름 복사`, `버튼 「${label}」 · 표의 미제출 ${names.length}명`);
    await btn.click();
    await status.getByRole('button', { name: '복사됨 ✓' }).waitFor({ timeout: UI });
    need(await p.evaluate(() => !window.isSecureContext && !navigator.clipboard), '앱 페이지가 보안 컨텍스트다 — 대체 경로를 타지 않았다');
    const q = await ctx.lead.newPage();
    await q.goto(`${local}/api/health`);
    const clip = await q.evaluate(() => navigator.clipboard.readText());
    await q.close();
    need(clip === names.join(', '), `클립보드 「${clip}」 ≠ 「${names.join(', ')}」`);
    return `「${label}」 → 복사됨 ✓ · 클립보드 「${clip}」 (execCommand 대체 경로)`;
  });
  await p.close();
}

// ── 흐름: 400px (마감 전 — 작성 화면은 마감 전에만 열린다) ──────────────────────
async function narrowBeforeDeadline({ base, ctx }) {
  const F = '400px';
  const p = await ctx.member400.newPage();
  await step(F, '부서원 홈', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await p.locator('section[data-guide="week-card"]').waitFor({ timeout: UI });
    await p.locator('section[data-guide="past-weeks"]').waitFor({ timeout: UI });
    const o = await overflowOf(p);
    need(o.doc <= 0, `가로로 ${o.doc}px 넘침 ${o.wide.join(' ')}`);
    return `scrollWidth = 창 폭 (${await p.evaluate(() => document.documentElement.clientWidth)}px)`;
  });
  await step(F, '작성 화면', p, async () => {
    await p.locator('section[data-guide="week-card"]').getByRole('button', { name: /열기|작성하기/ }).click();
    const d = p.getByRole('dialog').filter({ has: p.locator('#composer-title') });
    await d.waitFor({ state: 'visible', timeout: UI });
    await p.waitForFunction((t) => [...document.querySelectorAll('input')].some((i) => i.value === t), T.a1, { timeout: UI });
    const o = await overflowOf(p, '[role="dialog"] .overflow-y-auto');
    need(o.doc <= 0 && o.el <= 0, `가로로 넘침 — 문서 ${o.doc}px · 본문 ${o.el}px ${o.wide.join(' ')}`);
    const box = await d.boundingBox();
    need(box && box.width <= 400.5, `작성 화면 폭 ${box?.width}`);
    await p.keyboard.press('Escape');
    await d.waitFor({ state: 'detached', timeout: UI });
    return `작성 화면 폭 ${Math.round(box.width)}px · 넘침 없음`;
  });
  await p.close();
}

// ── 흐름: 사용 안내 ──────────────────────────────────────────────────────────
async function guide({ base, ctx }) {
  const F = '안내';
  const p = await ctx.guide.newPage();
  let notes = null;
  const hash = () => p.evaluate(() => location.hash);
  const presenterIndex = async () => (await notes.locator('header p.ml-auto span.font-semibold').first().innerText()).trim();
  await step(F, '발표 모드 PageDown ×5', p, async () => {
    await p.goto(`${base}/guide/present`, { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: '전체 화면 없이 보기' }).click();
    await p.getByRole('button', { name: '발표 시작' }).waitFor({ state: 'detached', timeout: UI });
    await p.waitForFunction(() => location.hash.length > 1, null, { timeout: UI });
    const seen = [await hash()];
    for (let i = 0; i < 5; i++) {
      await p.keyboard.press('PageDown');
      await p.waitForFunction((h) => location.hash !== h, seen[seen.length - 1], { timeout: UI });
      seen.push(await hash());
    }
    need(new Set(seen).size === 6, `같은 장이 두 번: ${seen.join(' ')}`);
    await p.waitForFunction((h) => document.querySelector('[data-present] [data-stage]')?.getAttribute('data-step') === h.slice(1), seen[5], { timeout: UI });
    return seen.join(' → ');
  });
  await step(F, '발표자 창 — 같은 장 · 넘기면 같이', p, async () => {
    await p.mouse.move(200, 200);
    await p.mouse.move(400, 300);
    const [popup] = await Promise.all([ctx.guide.waitForEvent('page'), p.getByRole('button', { name: '발표자 창' }).click()]);
    notes = popup;
    await notes.waitForLoadState('domcontentloaded');
    await notes.getByRole('button', { name: '다음 →' }).waitFor({ timeout: UI });
    const here = await hash();
    // 새 창은 지금 어디인지 물어서 맞춘다(hello) — 6번째 장
    await notes.waitForFunction(() => document.querySelector('header p.ml-auto span.font-semibold')?.textContent?.trim() === '6', null, { timeout: UI });
    // 발표자 창에서 넘기면 강당 화면도 넘어간다
    await notes.getByRole('button', { name: '다음 →' }).click();
    await p.waitForFunction((h) => location.hash !== h, here, { timeout: UI });
    await notes.waitForFunction(() => document.querySelector('header p.ml-auto span.font-semibold')?.textContent?.trim() === '7', null, { timeout: UI });
    // 강당 화면에서 넘기면 발표자 창도
    const at7 = await hash();
    await p.keyboard.press('PageUp');
    await p.waitForFunction((h) => location.hash !== h, at7, { timeout: UI });
    await notes.waitForFunction(() => document.querySelector('header p.ml-auto span.font-semibold')?.textContent?.trim() === '6', null, { timeout: UI });
    const total = (await notes.locator('header p.ml-auto').innerText()).match(/\/\s*(\d+)/)?.[1];
    return `발표자 창이 6/${total}에서 열림 · 발표자 [다음 →] → 강당 7 · 강당 PageUp → 발표자 6`;
  }, [`${F}/발표 모드 PageDown ×5`]);
  await step(F, 'B 검은 화면 (두 창)', p, async () => {
    const at = await hash();
    await p.keyboard.press('b');
    await p.locator('[aria-label="검은 화면"]').waitFor({ state: 'visible', timeout: UI });
    await notes.getByText('검은 화면 중').waitFor({ timeout: UI });
    // 아무 넘기기 키나 누르면 같은 장으로 돌아온다 — 넘기지 않는다
    await p.keyboard.press('PageDown');
    await p.locator('[aria-label="검은 화면"]').waitFor({ state: 'detached', timeout: UI });
    await notes.getByText('검은 화면 중').waitFor({ state: 'detached', timeout: UI });
    need((await hash()) === at, `검은 화면을 걷으며 장이 넘어갔다 ${at} → ${await hash()}`);
    return `B → 검은 화면(발표자 창 「검은 화면 중」) → PageDown → 같은 장 ${at}`;
  }, [`${F}/발표자 창 — 같은 장 · 넘기면 같이`]);
  if (notes) await notes.close();
  await step(F, '체험하기 주소 #lead-3', p, async () => {
    await p.goto(`${base}/guide#lead-3`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    const stage = p.locator('section[aria-label="안내 단계"] [data-stage]');
    await p.waitForFunction(() => document.querySelector('section[aria-label="안내 단계"] [data-stage]')?.getAttribute('data-step') === 'lead-3', null, { timeout: UI });
    await p.waitForFunction(() => document.querySelector('section[aria-label="안내 단계"] [data-stage]')?.getAttribute('data-settled') === '1', null, { timeout: UI });
    const count = (await p.locator('section[aria-label="안내 단계"] [data-dock="count"]').first().innerText()).trim();
    need(await stage.isVisible(), '무대가 안 보인다');
    return `무대 lead-3 · 도크 「${count}」`;
  });
  await p.close();
}

// ── 흐름: 운영자 로그인 (마감 전 — 기다리는 동안) ───────────────────────────────
async function operatorLogin({ base, seed, ctx }) {
  const F = '운영자';
  const p = await ctx.ops.newPage();
  await step(F, '로그인 화면', p, async () => {
    await p.goto(`${base}/ops`, { waitUntil: 'domcontentloaded' });
    await p.waitForURL(/\/login/, { timeout: UI });
    await p.locator('#email').fill(seed.ops.email);
    await p.locator('#password').fill(seed.ops.password);
    await p.getByRole('button', { name: '로그인', exact: true }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: UI });
    await navLink(p, '운영').waitFor({ timeout: UI });
    await dismissTour(p);
    return `${seed.ops.email} → ${new URL(p.url()).pathname}`;
  });
  await p.close();
}

async function waitForDeadline({ deadline }) {
  // 시계를 기다린다 — 이것만은 화면 상태가 아니라 시각이다. 부서 마감 + 몇 초(서버가 같은 시계로 잠근다)
  const left = deadline + 3000 - Date.now();
  if (left > 0) {
    log(`부서 마감 ${hms(deadline)}까지 기다림 (${Math.ceil(left / 1000)}초)`);
    await new Promise((r) => setTimeout(r, left));
  }
}

// ── 흐름: 담당 (마감 뒤) ─────────────────────────────────────────────────────
const MERGE_WAIT = 8 * MIN;
async function openManage(page, base) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await navLink(page, '수합 관리').click();
  await page.waitForURL(/\/manage$/, { timeout: UI });
  await page.locator('section[data-guide="merge-card"]').waitFor({ timeout: UI });
}
const mergeChip = (page) => page.locator('section[data-guide="merge-card"] .card-head > span.chip').first();
const handoffChip = (page) => page.locator('section[data-guide="report-unit"] .card-head > span.chip').first();

async function leadAfterDeadline({ base, ctx }) {
  const F = '담당';
  const p = await ctx.lead.newPage();
  const card = p.locator('section[data-guide="merge-card"]');
  const runBtn = card.locator('[data-guide="merge-run"]');

  await step(F, '마감 뒤 스케줄러 병합 (줄 → 준비됨)', p, async () => {
    await openManage(p, base);
    const seen = [];
    const until = Date.now() + MERGE_WAIT;
    // 줄에 서기 전에는 화면이 저절로 다시 그리지 않는다 — 줄이 보일 때까지 새로 고친다. 줄이 보이면 카드가 스스로 묻는다(CP-130)
    for (;;) {
      const chip = (await mergeChip(p).innerText()).trim();
      if (!seen.includes(chip)) seen.push(chip);
      if (/대기 중|병합 중/.test(chip)) {
        const label = (await runBtn.innerText()).trim();
        seen.push(`[${label}]`);
        need(/^줄 \d+번째|^병합 중…$/.test(label), `줄 자리 글이 아니다: ${label}`);
        break;
      }
      if (/준비됨/.test(chip)) break;
      need(Date.now() < until, `${MERGE_WAIT / MIN}분 안에 병합이 줄에 서지 않았다 (본 상태: ${seen.join(' → ')})`);
      await p.waitForTimeout(1500); // 새로 고침 간격 — 서버가 줄에 넣기를 기다린다
      await p.reload({ waitUntil: 'domcontentloaded' });
      await card.waitFor({ timeout: UI });
    }
    await mergeChip(p).filter({ hasText: '준비됨' }).waitFor({ timeout: MERGE_WAIT });
    const ready = (await mergeChip(p).innerText()).trim();
    seen.push(ready);
    need(seen.some((s) => /대기 중|병합 중/.test(s)), `줄에 선 모습을 못 봤다: ${seen.join(' → ')}`);
    await runBtn.filter({ hasText: '다시 병합' }).waitFor({ timeout: UI });
    return seen.join(' → ');
  });
  const merged = `${F}/마감 뒤 스케줄러 병합 (줄 → 준비됨)`;

  await step(F, '[다시 병합] → 줄 자리 → 준비됨', p, async () => {
    const before = (await mergeChip(p).innerText()).trim();
    // 버튼 글이 바뀌는 차례를 화면에서 적는다 — 「줄 1번째」는 다음 물음(2초)까지만 보일 수 있어 한 번 잰 값으로는 놓친다
    await runBtn.evaluate((b) => {
      window.__e2eLabels = [b.textContent];
      new MutationObserver(() => {
        const t = b.textContent;
        if (window.__e2eLabels[window.__e2eLabels.length - 1] !== t) window.__e2eLabels.push(t);
      }).observe(b, { childList: true, characterData: true, subtree: true });
    });
    const [res] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith('/api/division/merge') && r.request().method() === 'POST', { timeout: UI }),
      runBtn.click(),
    ]);
    const job = await res.json().catch(() => ({}));
    need(res.status() === 202 && job.jobId, `줄에 넣지 못했다: HTTP ${res.status()} ${JSON.stringify(job).slice(0, 120)}`);
    // 버튼이 서버가 알려 준 자리로 바뀐다(「줄 n번째」 → 「병합 중…」) — 끝날 때까지 눌리지 않는다
    await runBtn.filter({ hasText: /줄 \d+번째|병합 중…/ }).waitFor({ timeout: UI });
    need(await runBtn.isDisabled(), '줄에 선 동안 버튼이 눌린다');
    await runBtn.filter({ hasText: '다시 병합' }).waitFor({ timeout: 3 * MIN });
    await mergeChip(p).filter({ hasText: '준비됨' }).waitFor({ timeout: UI });
    const labels = (await p.evaluate(() => window.__e2eLabels)).map((t) => `[${t}]`);
    const want = job.status === 'queued' ? `[줄 ${job.position}번째` : '[병합 중…]';
    need(labels.some((l) => l.startsWith(want)), `서버가 준 자리(${job.status} ${job.position ?? ''})가 버튼에 안 보였다: ${labels.join(' → ')}`);
    return `${before} → 202 ${job.status} ${job.position ?? ''}번째 · 버튼 ${labels.join(' → ')} → ${(await mergeChip(p).innerText()).trim()}`;
  }, [merged]);

  await step(F, '병합본 칸 고쳐 [수정 저장]', p, async () => {
    await card.getByRole('button', { name: '내용 보기' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.locator('textarea').first().waitFor({ timeout: UI });
    const cell = await pickCell(d);
    const before = await cell.inputValue();
    await cell.fill(`${before} · E2E담당`);
    const save = d.getByRole('button', { name: '수정 저장' });
    await save.waitFor({ timeout: UI });
    need(await save.isEnabled(), '고쳤는데 [수정 저장]이 꺼져 있다');
    await save.click();
    await d.locator('[data-guide="merged-head"] .text-success').filter({ hasText: /^저장$/ }).waitFor({ timeout: UI });
    await p.waitForFunction((t) => [...document.querySelectorAll('[role="dialog"] textarea')].some((x) => x.value.includes(t)), '· E2E담당', { timeout: UI });
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    return `「${before.slice(0, 24)}…」 + 「· E2E담당」 → 저장 (다시 읽어도 남음)`;
  }, [merged]);

  await step(F, '부서원 제출물 [고치기]', p, async () => {
    // 남의 제출물만 고칠 수 있다(TACP-22) — 머리의 사용자 메뉴가 내 이름이다
    const me = (await p.locator('header button[aria-haspopup="menu"]').getAttribute('aria-label')) ?? '';
    const row = p.locator('table.table tbody tr').filter({ has: p.getByText('제출', { exact: true }) }).filter({ hasNotText: me }).first();
    const name = (await row.locator('td').first().innerText()).trim();
    const ver = (await row.locator('td').nth(2).innerText()).trim();
    await row.getByRole('button', { name: `${name} 제출물 열기` }).click();
    const d = p.getByRole('dialog', { name: '제출물 열람' });
    await d.getByRole('button', { name: '고치기' }).click();
    const first = d.getByLabel('주요 업무실적 1 내용');
    await first.waitFor({ timeout: UI });
    const before = await first.inputValue();
    await first.fill(`${before} (E2E 담당 첨삭)`);
    const next = Number(ver.replace('v', '')) + 1;
    await d.getByRole('button', { name: `고쳐서 저장 (v${next})` }).click();
    await d.getByText(`v${next}로 저장 · 병합본엔 [다시 병합]`).waitFor({ timeout: UI });
    await d.locator('h2').filter({ hasText: `v${next}` }).waitFor({ timeout: UI });
    const head = (await d.locator('h2').innerText()).replace(/\s+/g, ' ').trim();
    need(/고침/.test(head), `머리에 고친 사람이 없다: ${head}`);
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    await p.locator('table.table tbody tr').filter({ hasText: name }).locator('td').nth(2).filter({ hasText: `v${next}` }).waitFor({ timeout: UI });
    return `${name} ${ver} → v${next} · 「${head}」`;
  });

  await step(F, '부서 설정 → 분류 순서 저장', p, async () => {
    await p.getByRole('link', { name: '부서 설정' }).click();
    await p.waitForURL(/\/manage\/settings$/, { timeout: UI });
    const input = p.getByRole('textbox', { name: '분류 순서' });
    await input.waitFor({ timeout: UI });
    const before = await input.inputValue();
    const parts = before.split(/[,·\-–—/|]/).map((s) => s.trim()).filter(Boolean);
    need(parts.length >= 2, `분류가 둘 미만: ${before}`);
    const after = [...parts.slice(0, -2), parts[parts.length - 1], parts[parts.length - 2]].join('-');
    await input.fill(after);
    const card2 = p.locator('section[data-guide="merge-settings"]');
    await card2.getByText('저장 안 됨').waitFor({ timeout: UI });
    const chips = (await card2.locator('[data-guide="merge-categories"] .chip').allInnerTexts()).map((s) => s.trim());
    need(chips.join('-') === `${after}-기타`, `미리보기 칩 ${chips.join('-')}`);
    await card2.getByRole('button', { name: '저장', exact: true }).click();
    const msg = card2.locator('p[aria-live="polite"]');
    await msg.filter({ hasText: /^저장되었습니다/ }).waitFor({ timeout: UI });
    const said = (await msg.innerText()).trim();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await input.waitFor({ timeout: UI });
    need((await input.inputValue()) === after, `다시 열었더니 ${await input.inputValue()}`);
    return `${before} → ${after} · 「${said}」`;
  });
  await p.close();
}

/** 병합본 드로어에서 고칠 칸 — 부서원이 낸 줄(T.a1)이 아닌 첫 내용 칸. 부서원의 [병합본] 확인이 그 줄을 찾는다 */
async function pickCell(d) {
  const cells = d.locator('table tbody tr td:nth-child(3) textarea');
  const n = await cells.count();
  for (let i = 0; i < n; i++) {
    const v = await cells.nth(i).inputValue();
    if (v.trim() && !v.includes(RUN_TAG)) return cells.nth(i);
  }
  throw new Error('고칠 내용 칸이 없다');
}

// ── 흐름: 실장 ───────────────────────────────────────────────────────────────
async function headApprove({ base, ctx }) {
  const F = '실장';
  const p = await ctx.head.newPage();
  await step(F, '병합본 고쳐 저장 = 승인 → 「올라감」', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '수합 관리').click();
    await p.waitForURL(/\/manage$/, { timeout: UI });
    await handoffChip(p).waitFor({ timeout: UI });
    const chip0 = (await handoffChip(p).innerText()).trim();
    need(chip0 === '부서장 승인 전', `「위로」 카드가 ${chip0}`);
    await p.locator('section[data-guide="merge-card"]').getByRole('button', { name: '내용 보기' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.getByText(/승인 전 · 고쳐 저장하면 승인 — 바로 .+에 올라감/).waitFor({ timeout: UI });
    const cell = await pickCell(d);
    await cell.fill(`${await cell.inputValue()} · E2E실장`);
    await d.getByRole('button', { name: '수정 저장' }).click();
    const note = d.locator('[data-guide="merged-head"] .text-success').filter({ hasText: /저장 · 승인했어요 — .+에 올라갔어요/ });
    await note.waitFor({ timeout: UI });
    const said = (await note.innerText()).trim();
    await d.getByText('승인 완료').waitFor({ timeout: UI });
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    await handoffChip(p).filter({ hasText: /^올라감$/ }).waitFor({ timeout: UI });
    const line = (await p.locator('section[data-guide="report-unit"] [data-guide="report-unit-submit"]').innerText()).trim();
    need(/에 올라감 \d\d-\d\d \d\d:\d\d/.test(line), `「위로」 줄: ${line}`);
    return `「${said}」 · 위로 카드 ${chip0} → 올라감 (${line})`;
  }, ['담당/마감 뒤 스케줄러 병합 (줄 → 준비됨)']);
  await p.close();
}

async function leadReedit({ base, ctx }) {
  const F = '담당';
  const p = await ctx.lead.newPage();
  await step(F, '승인 뒤 고쳐 저장 → 「승인 뒤 바뀜」', p, async () => {
    await openManage(p, base);
    await p.locator('section[data-guide="merge-card"]').getByRole('button', { name: '내용 보기' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.getByText(/고쳐 저장하면 부서장이 다시 승인해야 .+에 올라갑니다/).waitFor({ timeout: UI });
    const cell = await pickCell(d);
    await cell.fill(`${await cell.inputValue()} · E2E담당2`);
    await d.getByRole('button', { name: '수정 저장' }).click();
    await d.locator('[data-guide="merged-head"] .text-success').filter({ hasText: '저장 — 부서장이 다시 승인해야 올라갑니다' }).waitFor({ timeout: UI });
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    await handoffChip(p).filter({ hasText: '승인 뒤 바뀜' }).waitFor({ timeout: UI });
    const line = (await p.locator('section[data-guide="report-unit"] [data-guide="report-unit-submit"]').innerText()).trim();
    return `위로 카드 「승인 뒤 바뀜」 · ${line}`;
  }, ['실장/병합본 고쳐 저장 = 승인 → 「올라감」']);
  await p.close();
}

async function headReapprove({ base, ctx }) {
  const F = '실장';
  const p = await ctx.head.newPage();
  await step(F, '담당이 고친 뒤 다시 승인 → 「올라감」', p, async () => {
    await openManage(p, base);
    const card = p.locator('section[data-guide="merge-card"]');
    await card.getByText('승인 뒤 바뀜').first().waitFor({ timeout: UI });
    await card.getByRole('button', { name: '고칠 것 없음 · 승인' }).click();
    const note = card.getByText(/승인했어요 — .+에 올라갔어요/);
    await note.waitFor({ timeout: UI });
    const said = (await note.innerText()).trim();
    await handoffChip(p).filter({ hasText: /^올라감$/ }).waitFor({ timeout: UI });
    await card.getByText('승인 완료').first().waitFor({ timeout: UI });
    return `「${said}」 · 위로 카드 올라감`;
  }, ['담당/승인 뒤 고쳐 저장 → 「승인 뒤 바뀜」']);
  await p.close();
}

// ── 흐름: 본부장 ─────────────────────────────────────────────────────────────
async function hqApprove({ base, ctx }) {
  const F = '본부장';
  const p = await ctx.hqHead.newPage();
  await step(F, '/hq 본부본 → [승인] → 총괄로', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '본부 취합').click();
    await p.waitForURL(/\/hq/, { timeout: UI });
    const run = p.locator('section[data-guide="hq-run"]');
    await run.waitFor({ timeout: UI });
    const sub = (await p.locator('.page-sub').first().innerText()).trim();
    need(/\d+곳 올라옴/.test(sub), `머리: ${sub}`);
    const desc = (await run.locator('[data-guide="hq-run-button"]').innerText()).trim();
    const btn = p.getByRole('button', { name: '검토 완료 · 승인' });
    await btn.waitFor({ timeout: UI });
    await btn.click();
    await p.getByText('승인했어요 — 총괄로 갔어요').waitFor({ timeout: UI });
    await p.locator('[data-guide="report-hq-submit"] .chip').filter({ hasText: '승인 · 총괄로 감' }).waitFor({ timeout: UI });
    await p.locator('[data-guide="hq-approval"] .chip').filter({ hasText: '승인 완료' }).waitFor({ timeout: UI });
    return `${sub} · 본부본 「${desc}」 → 승인 · 총괄로 감`;
  }, ['실장/담당이 고친 뒤 다시 승인 → 「올라감」']);
  await p.close();
}

// ── 흐름: 총괄 ───────────────────────────────────────────────────────────────
async function coordinator({ base, ctx, deadline }) {
  const F = '총괄';
  const p = await ctx.coord.newPage();
  await step(F, '/org 전사본 준비 → [전사본 받기] hwp', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '전사').click();
    await p.waitForURL(/\/org/, { timeout: UI });
    const card = p.locator('section[data-guide="org-run"]');
    // 전사본은 출처가 바뀌면 다시 만들어진다(RU-83) — 「준비됨」이 될 때까지 새로 고친다(본부장 승인 직후면 「섹션이 바뀜」일 수 있다)
    const until = Date.now() + 2 * MIN;
    for (;;) {
      await card.waitFor({ timeout: UI });
      const chip = (await card.locator('.card-head > span.chip').innerText()).trim();
      if (chip === '준비됨') break;
      need(Date.now() < until, `전사본이 준비되지 않았다: ${chip} · ${(await card.locator('[data-guide="org-run-button"]').innerText()).trim()}`);
      await p.waitForTimeout(1500);
      await p.reload({ waitUntil: 'domcontentloaded' });
    }
    const desc = (await card.locator('[data-guide="org-run-button"]').innerText()).trim();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: UI }), card.getByRole('link', { name: '전사본 받기' }).click()]);
    const file = await dl.path();
    const buf = fs.readFileSync(file);
    const magic = buf.subarray(0, 8).toString('hex');
    need(magic === 'd0cf11e0a1b11ae1', `OLE 머리가 아니다: ${magic}`);
    need(buf.includes(Buffer.from('HWP Document File')), 'HWP FileHeader 서명이 없다');
    need(/\.hwp$/i.test(dl.suggestedFilename()), `파일 이름: ${dl.suggestedFilename()}`);
    return `「${desc}」 → ${dl.suggestedFilename()} ${Math.round(buf.length / 1024)}KB · d0cf11e0 · HWP Document File`;
  });

  await step(F, '[일정 바꾸기] → 다음 주 마감 → [평소대로]', p, async () => {
    const open = p.getByRole('button', { name: '일정 바꾸기' });
    await open.click();
    const box = p.getByRole('region', { name: '일정 바꾸기' });
    await box.waitFor({ timeout: UI });
    await box.getByRole('button', { name: '직접 입력' }).click();
    // 다음 주 수요일 대외 16:00 → 부서 15:00
    const ext = kstIso(mondayOf(deadline) + 7 * DAY + 2 * DAY + 16 * HOUR).slice(0, 16);
    await box.locator('#external-at').fill(ext);
    await box.getByRole('button', { name: '미리보기' }).click();
    const plan = box.locator('[data-guide="deadline-plan"]');
    await plan.waitFor({ timeout: UI });
    const week = (await plan.locator('span.font-semibold').first().innerText()).trim();
    const dept = (await plan.locator('strong.text-error').first().innerText()).trim();
    await plan.getByRole('button', { name: '이대로 적용' }).click();
    await p.getByText(`${week} 마감 → ${dept}`).waitFor({ timeout: UI });
    const row = p.locator('ul li').filter({ hasText: week }).filter({ has: p.locator('strong') }).first();
    await row.locator('strong.text-error').filter({ hasText: dept }).waitFor({ timeout: UI });
    await row.getByRole('button', { name: '평소대로' }).click();
    await row.getByText('평소 마감으로 되돌릴까요?').waitFor({ timeout: UI });
    await row.getByRole('button', { name: '되돌리기' }).click();
    const done = p.getByText(new RegExp(`^${week} 마감 → `)).filter({ hasNotText: dept });
    await done.waitFor({ timeout: UI });
    await row.getByRole('button', { name: '평소대로' }).waitFor({ state: 'detached', timeout: UI });
    need(!(await row.locator('strong.text-error').count()), '되돌렸는데 마감이 아직 붉다');
    return `${week}: ${dept} 적용 → 평소대로 「${(await done.innerText()).trim()}」`;
  });
  await p.close();
}

// ── 흐름: 부서원 (마감 뒤) ────────────────────────────────────────────────────
async function memberAfterDeadline({ base, ctx }) {
  const F = '부서원';
  const p = await ctx.member.newPage();
  await step(F, '마감 뒤 이번 주 [병합본] — 내 줄 · 공유', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const card = p.locator('section[data-guide="week-card"]');
    await card.getByText('마감됨').waitFor({ timeout: UI });
    need(!(await card.getByRole('button', { name: '작성하기' }).count()), '마감 뒤인데 [작성하기]가 있다');
    await card.getByRole('button', { name: '병합본' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.locator('table tbody tr').first().waitFor({ timeout: UI });
    const mine = d.locator('table tbody tr').filter({ hasText: T.a1 });
    await mine.first().waitFor({ timeout: UI });
    need((await mine.first().locator('td').last().innerText()).trim() === '공유', '내 줄에 「공유」 표시가 없다');
    const rows = await d.locator('table tbody tr').count();
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    return `「${(await card.locator('h1').innerText()).trim()}」 병합본 ${rows}행 · 내 줄(공유) 들어감`;
  }, ['담당/마감 뒤 스케줄러 병합 (줄 → 준비됨)', '부서원/다시 작성 → [제출] (병합본에 들어갈 판)']);
  await p.close();
}

async function narrowAfterDeadline({ base, ctx }) {
  const F = '400px';
  const p = await ctx.lead400.newPage();
  await step(F, '수합 관리', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await navLink(p, '수합 관리').click();
    await p.waitForURL(/\/manage$/, { timeout: UI });
    await p.locator('section[data-guide="merge-card"]').waitFor({ timeout: UI });
    // 「위로」 카드는 3단계가 켜졌을 때만 있다 — 출시 범위(3단계 끔)에는 없어야 한다(OPS-50h)
    if (SCOPE === 'launch') need(!(await p.locator('section[data-guide="report-unit"]').count()), '3단계가 꺼졌는데 「위로」 카드가 있다');
    else await p.locator('section[data-guide="report-unit"]').waitFor({ timeout: UI });
    const o = await overflowOf(p);
    need(o.doc <= 0, `가로로 ${o.doc}px 넘침 ${o.wide.join(' ')}`);
    return `제출 현황 · 병합본 · ${SCOPE === 'launch' ? '(위로 없음)' : '위로'} · 부서원 목록 — 넘침 없음`;
  });
  await p.close();
}

// ── 흐름: 운영자 ─────────────────────────────────────────────────────────────
async function operator({ ctx }) {
  const F = '운영자';
  const p = await ctx.ops.newPage();
  const base = `http://${HOST}:${PORT}`;
  await step(F, '/ops 병합 줄', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await navLink(p, '운영').click();
    await p.waitForURL(/\/ops$/, { timeout: UI });
    const q = p.locator('section[aria-labelledby="merge-queue"]');
    await q.waitFor({ timeout: UI });
    const head = (await q.locator('h2 + span').innerText()).trim();
    const m = head.match(/(\d+)\/(\d+) 끝/);
    need(m && m[1] === m[2] && Number(m[2]) >= 10, `줄 요약: ${head}`);
    const ai = q.locator('tbody tr').filter({ hasText: 'AI홍보전략실' });
    await ai.waitFor({ timeout: UI });
    const aiText = (await ai.innerText()).replace(/\s+/g, ' ');
    need(/수동/.test(aiText) && /끝/.test(aiText), `AI홍보전략실 줄: ${aiText}`);
    return `「${head}」 · AI홍보전략실 수동 · 끝`;
  }, ['운영자/로그인 화면']);

  await step(F, '알림 수신함 — 종류', p, async () => {
    await p.getByRole('link', { name: '알림 수신함' }).click();
    await p.waitForURL(/\/ops\/notify-sink$/, { timeout: UI });
    const tabs = p.getByRole('navigation', { name: '종류별' }).getByRole('link');
    await tabs.first().waitFor({ timeout: UI });
    const got = (await tabs.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    const labels = got.map((s) => s.replace(/\s*\d+$/, ''));
    const want = ['병합 점검', '승인 완료', '다시 승인', ...(DEADLINE_IN >= 8 && DEADLINE_IN <= 10 ? ['10분 전'] : [])];
    const lack = want.filter((w) => !labels.includes(w));
    need(!lack.length, `없는 종류: ${lack.join(', ')} (있는 것: ${got.join(' · ')})`);
    // 「승인 완료」는 담당에게, 「다시 승인」은 실장에게
    for (const [kind, who] of [['승인 완료', 'lead@example.invalid'], ['다시 승인', 'head@example.invalid']]) {
      const tab = tabs.filter({ hasText: new RegExp(`^${kind}\\s*\\d+$`) });
      const href = await tab.getAttribute('href');
      await tab.click();
      await p.waitForURL((u) => `${u.pathname}${u.search}` === href, { timeout: UI });
      await p.locator('table tbody tr td:nth-child(3) .chip').first().filter({ hasText: kind }).waitFor({ timeout: UI });
      const cell = p.locator('table tbody tr td:nth-child(2)');
      await cell.first().waitFor({ timeout: UI });
      const to = (await cell.allInnerTexts()).join(' ');
      need(to.includes(who), `「${kind}」 받는 사람: ${to.replace(/\s+/g, ' ')}`);
    }
    return got.join(' · ');
  }, ['운영자/로그인 화면']);

  await step(F, '감사 로그 — 행동', p, async () => {
    await p.goto(`${base}/ops`, { waitUntil: 'domcontentloaded' });
    await p.getByRole('link', { name: '감사 로그' }).first().click();
    await p.waitForURL(/\/ops\/audit/, { timeout: UI });
    const tabs = p.getByRole('navigation', { name: '행동별 필터' }).getByRole('link');
    await tabs.first().waitFor({ timeout: UI });
    const got = (await tabs.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    const labels = got.map((s) => s.replace(/\s*\d+$/, ''));
    const want = ['제출', '제출물 삭제', '제출물 고침', '병합 실행', '설정 변경', '마감 변경', '위로 제출', '본부본·전사본', '내려받기'];
    const lack = want.filter((w) => !labels.includes(w));
    need(!lack.length, `없는 행동: ${lack.join(', ')} (있는 것: ${got.join(' · ')})`);
    for (const [label, who] of [['제출물 고침', 'lead@example.invalid'], ['제출물 삭제', 'member2@example.invalid'], ['마감 변경', 'coord@example.invalid']]) {
      const tab = tabs.filter({ hasText: new RegExp(`^${label}\\s*\\d+$`) });
      const href = await tab.getAttribute('href');
      await tab.click();
      await p.waitForURL((u) => `${u.pathname}${u.search}` === href, { timeout: UI });
      await p.locator('table tbody tr td:nth-child(3) .chip').first().filter({ hasText: label }).waitFor({ timeout: UI });
      const actors = (await p.locator('table tbody tr td:nth-child(2)').allInnerTexts()).join(' ');
      need(actors.includes(who), `「${label}」 한 사람: ${actors.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
    return `${want.length}가지 모두 · 고침=담당 · 삭제=부서원 · 마감 변경=총괄`;
  }, ['운영자/로그인 화면']);
  await p.close();
}

// ── 흐름 묶음 ────────────────────────────────────────────────────────────────
/** 리허설 저장소 그대로(13개 단위 · 3단계 켬) — 화면 흐름을 넓게 본다 */
async function fullFlows(env) {
  await memberBeforeDeadline(env);
  await leadBeforeDeadline(env); // 부서원이 취소한 사이 — 미제출이 둘이라 「, 」로 잇는 것까지 본다
  await memberResubmit(env);
  await narrowBeforeDeadline(env);
  await guide(env);
  await operatorLogin(env);
  await waitForDeadline(env);
  await leadAfterDeadline(env);
  await headApprove(env);
  await leadReedit(env);
  await headReapprove(env);
  await hqApprove(env);
  await coordinator(env);
  await memberAfterDeadline(env);
  await narrowAfterDeadline(env);
  await operator(env);
  await serverLog(env);
}

/**
 * OPS-50h — 출시 범위(2026-10-13 운영 전환 그대로 — LAUNCH-v2 「범위」). 부서원·담당의 흐름은 `full`과 같은 함수다(3단계에 기대지 않는다).
 * 다른 것은 「위로」가 없는 화면 · 부서장 없는 부서 · 총괄의 현황판 · 운영자 「알림」 · 수신함 판정이다.
 */
async function launchFlows(env) {
  await memberBeforeDeadline(env);
  await leadBeforeDeadline(env);
  await memberResubmit(env);
  await narrowBeforeDeadline(env);
  await operatorLogin(env);
  await launchOperatorBefore(env);
  await waitForDeadline(env);
  await leadAfterDeadline(env);
  await launchLeadBoard(env);
  await launchHeadApprove(env);
  await launchLeadReedit(env);
  await launchHeadReapprove(env);
  await launchPcLead(env);
  await launchCoordinator(env);
  await memberAfterDeadline(env);
  await narrowAfterDeadline(env);
  await launchOperatorAfter(env);
  await launchSink(env);
  await serverLog(env);
}

// ── 출시 범위 (--scope=launch · OPS-50h) ─────────────────────────────────────
const sameSet = (a, b) => [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|');
const MERGED = '담당/마감 뒤 스케줄러 병합 (줄 → 준비됨)';
const L_APPROVE = '실장/고쳐 저장 = 승인 → 담당에게 알림 (위로 없음)';
const L_REEDIT = '담당/승인 뒤 고쳐 저장 → 「승인 뒤 바뀜」 (다시 승인하라는 말 없음)';
const L_REAPPROVE = '실장/[고칠 것 없음 · 승인] → 담당에게 알림';
const noHandoff = async (p, where) => need(!(await p.locator('section[data-guide="report-unit"]').count()), `3단계가 꺼졌는데 ${where}에 「위로」 카드가 있다`);

/** `/ops` 부서 표 — 분류 둘을 돌며 이름 → { 분류 · 상태 · 알림 } (줄은 불러온 뒤에 생긴다 — PG-64) */
async function opsDivisionTable(p) {
  const sec = p.locator('section[aria-labelledby="divisions"]');
  const out = {};
  for (const tab of ['제출 확인', '이력 없음']) {
    await sec.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await p.waitForFunction(() => {
      const t = document.querySelector('section[aria-labelledby="divisions"] tbody');
      return !!t && !t.textContent.includes('불러오는 중');
    }, null, { timeout: UI });
    const rows = sec.locator('tbody tr');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const tds = rows.nth(i).locator('td');
      if ((await tds.count()) < 8) continue; // 「이 분류에 해당하는 부서가 없습니다」
      const name = (await tds.nth(0).locator('span').first().innerText()).trim();
      out[name] = { tab, active: (await tds.nth(5).innerText()).trim(), notify: (await tds.nth(6).innerText()).trim() };
    }
  }
  return out;
}
const divisionRow = (p, name) => p.locator('section[aria-labelledby="divisions"] tbody tr').filter({ has: p.getByText(name, { exact: true }) });

/** 운영자 (마감 전) — 범위 확인(LAUNCH-v2 9-7)과 「알림」 스위치(9-5의 2 — 범위 밖 켬 한 줄을 화면에서 끈다) */
async function launchOperatorBefore({ base, seed, ctx }) {
  const F = '운영자';
  const L = seed.launch;
  const p = await ctx.ops.newPage();
  const act = (t) => Object.keys(t).filter((k) => t[k].active === '활성');
  const on = (t) => Object.keys(t).filter((k) => t[k].notify === '켬');
  await step(F, '/ops 「알림」 — 범위 밖 켬 한 줄 끄기 → 두 부서만', p, async () => {
    await p.goto(`${base}/ops`, { waitUntil: 'domcontentloaded' });
    const before = await opsDivisionTable(p);
    need(Object.keys(before).length >= 10, `부서 표가 ${Object.keys(before).length}줄`);
    need(sameSet(act(before), L.active), `활성: ${act(before).join(', ')}`);
    need(sameSet(on(before), [...L.active, L.leftover]), `알림 켬(처음): ${on(before).join(', ')}`);
    await p.locator('section[aria-labelledby="divisions"]').getByRole('tab', { name: new RegExp(`^${before[L.leftover].tab}`) }).click();
    const row = divisionRow(p, L.leftover);
    await row.getByRole('button', { name: '편집' }).click();
    const [res] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith('/api/ops/divisions') && r.request().method() === 'PUT', { timeout: UI }),
      p.getByRole('button', { name: `${L.leftover} 알림 켬 · 끄기` }).click(),
    ]);
    need(res.ok(), `알림 저장 HTTP ${res.status()}`);
    await p.getByRole('button', { name: `${L.leftover} 알림 끔 · 켜기` }).waitFor({ timeout: UI });
    await row.getByRole('button', { name: '완료' }).click();
    await row.locator('span.chip').filter({ hasText: /^끔$/ }).waitFor({ timeout: UI });
    // 다시 열어도 그대로 — 화면만 바뀐 것이 아니다
    await p.reload({ waitUntil: 'domcontentloaded' });
    const after = await opsDivisionTable(p);
    need(sameSet(on(after), L.active), `알림 켬(끈 뒤): ${on(after).join(', ')}`);
    need(sameSet(act(after), L.active), `활성(끈 뒤): ${act(after).join(', ')}`);
    return `활성 ${act(after).join('·')} · 알림 켬 ${on(before).length}줄 → ${on(after).join('·')} (${L.leftover} 끔 · 다시 열어도)`;
  }, ['운영자/로그인 화면']);
  await step(F, '/ops 병합 줄 — 마감 전에는 비어 있다', p, async () => {
    const q = p.locator('section[aria-labelledby="merge-queue"]');
    await q.waitFor({ timeout: UI });
    await q.getByText('이번 주 병합 없음').waitFor({ timeout: UI });
    return '「이번 주 병합 없음」';
  }, ['운영자/로그인 화면']);
  await p.close();
}

/** 담당 (마감 뒤) — 3단계가 꺼졌으니 지금처럼 받아서 취합게시판에 올린다: [받기]의 파일 이름 · [제목 복사]의 글 */
async function launchLeadBoard({ base, local, ctx }) {
  const F = '담당';
  const p = await ctx.lead.newPage();
  await step(F, '[받기] hwp · [제목 복사] — 취합게시판에 올릴 것', p, async () => {
    await openManage(p, base);
    await noHandoff(p, '수합 관리');
    const card = p.locator('section[data-guide="merge-card"]');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: UI }), card.getByRole('link', { name: '받기' }).click()]);
    const name = dl.suggestedFilename();
    const m = name.match(/^\d{4}_\d+월_\d+주차_AI홍보전략실_(주간|월간)업무\.hwp$/);
    need(m, `파일 이름: ${name}`);
    const buf = fs.readFileSync(await dl.path());
    need(buf.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1' && buf.includes(Buffer.from('HWP Document File')), '받은 파일이 hwp가 아니다');
    await card.getByRole('button', { name: '제목 복사' }).click();
    await card.getByRole('button', { name: '복사됨 ✓' }).waitFor({ timeout: UI });
    const q = await ctx.lead.newPage();
    await q.goto(`${local}/api/health`);
    const clip = await q.evaluate(() => navigator.clipboard.readText());
    await q.close();
    // 게시판 답변 제목 규격(docname.ts boardTitle) — 주간은 「10월1주차」, 월간은 「10월」. 파일 이름과 같은 종류여야 한다
    need(new RegExp(`^\\d+월(\\d+주차)? 연구운영회의 ${m[1]}업무\\(AI홍보전략실\\)$`).test(clip), `클립보드 「${clip}」`);
    return `${name} ${Math.round(buf.length / 1024)}KB · 제목 「${clip}」`;
  }, [MERGED]);
  await p.close();
}

/** 실장 (AI홍보전략실) — 고쳐 저장이 곧 승인. 3단계가 꺼졌으니 위로 가지 않고 담당에게 알린다(NT-46 — 끝 줄 「취합게시판에 올려」) */
async function launchHeadApprove({ base, ctx }) {
  const F = '실장';
  const p = await ctx.head.newPage();
  await step(F, L_APPROVE.split('/')[1], p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '수합 관리').click();
    await p.waitForURL(/\/manage$/, { timeout: UI });
    const card = p.locator('section[data-guide="merge-card"]');
    await card.getByText('부서장 승인 전').waitFor({ timeout: UI });
    await noHandoff(p, '실장의 수합 관리');
    await card.getByRole('button', { name: '내용 보기' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    const band = d.getByText(/^승인 전 · 고쳐 저장하면 승인/);
    await band.waitFor({ timeout: UI });
    const bandText = (await band.innerText()).trim();
    need(bandText === '승인 전 · 고쳐 저장하면 승인', `승인 줄이 위로 가는 것을 말한다: ${bandText}`);
    const cell = await pickCell(d);
    await cell.fill(`${await cell.inputValue()} · E2E실장`);
    await d.getByRole('button', { name: '수정 저장' }).click();
    const note = d.locator('[data-guide="merged-head"] .text-success').filter({ hasText: /^저장 · 승인/ });
    await note.waitFor({ timeout: UI });
    const said = (await note.innerText()).trim();
    need(said === '저장 · 승인 완료 — 담당자에게 알렸습니다', `저장 뒤 한 마디: ${said}`);
    await d.locator('span.chip').filter({ hasText: /^승인 완료$/ }).waitFor({ timeout: UI });
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    await card.locator('span.chip').filter({ hasText: /^승인 완료$/ }).waitFor({ timeout: UI });
    await noHandoff(p, '승인 뒤 수합 관리');
    return `「${bandText}」 → 「${said}」 · 위로 카드 없음`;
  }, [MERGED]);
  await p.close();
}

async function launchLeadReedit({ base, ctx }) {
  const F = '담당';
  const p = await ctx.lead.newPage();
  await step(F, L_REEDIT.split('/')[1], p, async () => {
    await openManage(p, base);
    const card = p.locator('section[data-guide="merge-card"]');
    await card.locator('span.chip').filter({ hasText: /^승인 완료$/ }).waitFor({ timeout: UI });
    await card.getByRole('button', { name: '내용 보기' }).click();
    const d = p.getByRole('dialog', { name: '병합본 보기' });
    await d.locator('textarea').first().waitFor({ timeout: UI });
    // 3단계가 꺼졌으면 담당의 저장이 위에 무엇을 남기지 않는다 — 「다시 승인해야 올라갑니다」는 3단계의 말이다(RU-80)
    need(!(await d.getByText(/다시 승인해야/).count()), '3단계가 꺼졌는데 「다시 승인해야 … 올라갑니다」가 있다');
    const cell = await pickCell(d);
    await cell.fill(`${await cell.inputValue()} · E2E담당2`);
    await d.getByRole('button', { name: '수정 저장' }).click();
    await d.locator('[data-guide="merged-head"] .text-success').filter({ hasText: /^저장$/ }).waitFor({ timeout: UI });
    await d.getByRole('button', { name: '닫기' }).click();
    await d.waitFor({ state: 'detached', timeout: UI });
    await card.locator('span.chip').filter({ hasText: '승인 뒤 바뀜' }).waitFor({ timeout: UI });
    await noHandoff(p, '수합 관리');
    return '「저장」 · 병합 카드 「승인 뒤 바뀜」';
  }, [L_APPROVE]);
  await p.close();
}

async function launchHeadReapprove({ base, ctx }) {
  const F = '실장';
  const p = await ctx.head.newPage();
  await step(F, L_REAPPROVE.split('/')[1], p, async () => {
    await openManage(p, base);
    const card = p.locator('section[data-guide="merge-card"]');
    await card.getByText('승인 뒤 바뀜').first().waitFor({ timeout: UI });
    await card.getByRole('button', { name: '고칠 것 없음 · 승인' }).click();
    const note = card.locator('p.text-success').filter({ hasText: /승인/ });
    await note.waitFor({ timeout: UI });
    const said = (await note.innerText()).trim();
    need(said === '승인 완료 — 담당자에게 알렸습니다', `승인 뒤 한 마디: ${said}`);
    await card.locator('span.chip').filter({ hasText: /^승인 완료$/ }).waitFor({ timeout: UI });
    await noHandoff(p, '수합 관리');
    return `「${said}」`;
  }, [L_REEDIT]);
  await p.close();
}

/** 기획조정실 담당 — 부서장을 두지 않은 부서(LAUNCH-v2 9-4 「아니오」). 담당이 확인한 병합본이 최종이다: 승인 줄도 위로 카드도 없다 */
async function launchPcLead({ base, ctx }) {
  const F = '담당(기획조정실)';
  const p = await ctx.pcLead.newPage();
  await step(F, '부서장 없는 부서 — 병합본 준비됨 · 승인 줄 없음 · [제목 복사]', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    await navLink(p, '수합 관리').click();
    await p.waitForURL(/\/manage$/, { timeout: UI });
    const card = p.locator('section[data-guide="merge-card"]');
    await card.waitFor({ timeout: UI });
    // 기획조정실은 줄의 앞(제출이 적은 부서부터 — HM-59c)이라 AI홍보전략실이 끝났으면 이미 끝났다. 혹시 몰라 잠깐 새로 고친다
    const until = Date.now() + 2 * MIN;
    while (!/준비됨/.test((await mergeChip(p).innerText()).trim())) {
      need(Date.now() < until, `병합본이 준비되지 않았다: ${(await mergeChip(p).innerText()).trim()}`);
      await p.waitForTimeout(1500);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await card.waitFor({ timeout: UI });
    }
    need(!(await card.getByText(/부서장 승인 전|승인 완료|승인 뒤 바뀜/).count()), '부서장이 없는데 승인 줄이 있다');
    await noHandoff(p, '기획조정실 수합 관리');
    await card.getByRole('button', { name: '제목 복사' }).waitFor({ timeout: UI });
    return '준비됨 · 승인 줄 없음 · 위로 카드 없음 · [받기]·[제목 복사]';
  }, [MERGED]);
  await p.close();
}

/** 총괄 — readAll이라 「전사」 현황판은 보지만, 3단계가 꺼졌으니 취합 쪽(최종본 열 · 전사본 · 본부 취합)은 없다(RU-52 · PG-51e) */
async function launchCoordinator({ base, seed, ctx }) {
  const F = '총괄';
  const p = await ctx.coord.newPage();
  await step(F, '/org — 제출 현황판만 (최종본 열 없음)', p, async () => {
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await dismissTour(p);
    need(!(await navLink(p, '본부 취합').count()), '3단계가 꺼졌는데 「본부 취합」 메뉴가 있다');
    await navLink(p, '전사').click();
    await p.waitForURL(/\/org/, { timeout: UI });
    const board = p.locator('section[data-guide="org-board"]');
    await board.waitFor({ timeout: UI });
    const text = await board.innerText();
    need(/제출/.test(text) && !/최종본/.test(text), '현황판 머리에 최종본 열이 있다');
    need(!(await p.locator('section[data-guide="org-run"]').count()), '전사본 카드가 있다');
    need(!(await p.getByRole('link', { name: '섹션 구성 편집' }).count()), '「섹션 구성 편집」이 있다');
    const bars = await board.getByRole('button', { name: /제출 \d+\/\d+ —/ }).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? ''));
    need(bars.length === seed.launch.active.length && seed.launch.active.every((d) => bars.some((b) => b.includes(d))), `제출 막대: ${bars.join(' · ')}`);
    return `제출 막대 ${bars.length}줄(${bars.map((b) => b.split(' 제출 ')[0]).join(' · ')}) · 최종본 열·전사본 카드 없음`;
  });
  await step(F, '/hq → 404 (3단계 꺼짐)', p, async () => {
    const hq = await p.goto(`${base}/hq`, { waitUntil: 'domcontentloaded' });
    need(hq && hq.status() === 404, `/hq HTTP ${hq && hq.status()}`);
    const node = await p.goto(`${base}/hq?node=${encodeURIComponent(seed.launch.slugs['기획경영본부'])}`, { waitUntil: 'domcontentloaded' });
    need(node && node.status() === 404, `/hq?node= HTTP ${node && node.status()}`);
    return '/hq 404 · /hq?node=기획경영본부 404';
  });
  await step(F, '타 부서 수합 관리(읽기) — 위로 카드 없음', p, async () => {
    await p.goto(`${base}/${seed.aiSlug}/manage`, { waitUntil: 'domcontentloaded' });
    await p.locator('section[data-guide="merge-card"]').waitFor({ timeout: UI });
    await noHandoff(p, '총괄이 연 AI홍보전략실 수합 관리');
    return `/${seed.aiSlug}/manage — 병합 카드 · 위로 카드 없음`;
  });
  await p.close();
}

/** 운영자 (마감 뒤) — 병합 줄은 켠 두 부서만 · 수신함 화면의 종류와 받는 사람 · 감사 로그에 「위로 제출」이 없다 */
async function launchOperatorAfter({ base, seed, ctx }) {
  const F = '운영자';
  const L = seed.launch;
  const p = await ctx.ops.newPage();
  await step(F, '/ops 병합 줄 — 켠 두 부서만 · n/n 끝', p, async () => {
    await p.goto(`${base}/ops`, { waitUntil: 'domcontentloaded' });
    const q = p.locator('section[aria-labelledby="merge-queue"]');
    await q.waitFor({ timeout: UI });
    const head = (await q.locator('h2 + span').innerText()).trim();
    const m = head.match(/(\d+)\/(\d+) 끝/);
    need(m && m[1] === m[2] && Number(m[2]) === L.active.length, `줄 요약: ${head}`);
    const names = (await q.locator('tbody tr td:nth-child(2) span.font-medium').allInnerTexts()).map((s) => s.trim());
    need(sameSet(names, L.active), `줄에 선 부서: ${names.join(', ')}`);
    const ai = (await q.locator('tbody tr').filter({ hasText: 'AI홍보전략실' }).innerText()).replace(/\s+/g, ' ');
    need(/수동/.test(ai) && /끝/.test(ai), `AI홍보전략실 줄: ${ai}`);
    return `「${head}」 · ${names.join('·')}`;
  }, ['운영자/로그인 화면']);

  await step(F, '알림 수신함 — 승인 완료 → 담당 · 병합 점검 → 운영자·기획조정실 담당', p, async () => {
    await p.getByRole('link', { name: '알림 수신함' }).click();
    await p.waitForURL(/\/ops\/notify-sink$/, { timeout: UI });
    const tabs = p.getByRole('navigation', { name: '종류별' }).getByRole('link');
    await tabs.first().waitFor({ timeout: UI });
    const got = (await tabs.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    const labels = got.map((s) => s.replace(/\s*\d+$/, ''));
    const want = ['병합 점검', '승인 완료', ...(DEADLINE_IN >= 8 && DEADLINE_IN <= 10 ? ['10분 전'] : [])];
    const lack = want.filter((w) => !labels.includes(w));
    need(!lack.length, `없는 종류: ${lack.join(', ')} (있는 것: ${got.join(' · ')})`);
    // 「다시 승인」은 3단계의 쪽지다(NT-52) — 담당이 승인 뒤 고쳤어도 꺼져 있으면 가지 않는다
    need(!labels.includes('다시 승인'), `3단계가 꺼졌는데 「다시 승인」이 있다 (${got.join(' · ')})`);
    for (const [kind, who] of [['승인 완료', [L.aiLead]], ['병합 점검', L.batch]]) {
      const tab = tabs.filter({ hasText: new RegExp(`^${kind}\\s*\\d+$`) });
      const href = await tab.getAttribute('href');
      await tab.click();
      await p.waitForURL((u) => `${u.pathname}${u.search}` === href, { timeout: UI });
      await p.locator('table tbody tr td:nth-child(3) .chip').first().filter({ hasText: kind }).waitFor({ timeout: UI });
      const to = (await p.locator('table tbody tr td:nth-child(2)').allInnerTexts()).join(' ');
      const emails = [...new Set(to.match(/[\w.+-]+@example\.invalid/g) ?? [])];
      need(sameSet(emails, who), `「${kind}」 받는 사람 ${emails.join(', ')} ≠ ${who.join(', ')}`);
    }
    return `${got.join(' · ')} · 승인 완료 → ${L.aiLead} · 병합 점검 → ${L.batch.join(', ')}`;
  }, ['운영자/로그인 화면']);

  await step(F, '감사 로그 — 행동 · 「위로 제출」·「본부본·전사본」 없음', p, async () => {
    await p.goto(`${base}/ops`, { waitUntil: 'domcontentloaded' });
    await p.getByRole('link', { name: '감사 로그' }).first().click();
    await p.waitForURL(/\/ops\/audit/, { timeout: UI });
    const tabs = p.getByRole('navigation', { name: '행동별 필터' }).getByRole('link');
    await tabs.first().waitFor({ timeout: UI });
    const got = (await tabs.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
    const labels = got.map((s) => s.replace(/\s*\d+$/, ''));
    const want = ['제출', '제출물 삭제', '제출물 고침', '병합 실행', '설정 변경', '마감 변경'];
    const lack = want.filter((w) => !labels.includes(w));
    need(!lack.length, `없는 행동: ${lack.join(', ')} (있는 것: ${got.join(' · ')})`);
    const up = ['위로 제출', '본부본·전사본'].filter((w) => labels.includes(w));
    need(!up.length, `3단계가 꺼졌는데 ${up.join(' · ')} 기록이 있다`);
    // 「설정 변경」에 운영자의 「알림」(마감 전 흐름) — 화면으로 바꾸면 감사가 남는다(NT-61)
    const tab = tabs.filter({ hasText: /^설정 변경\s*\d+$/ });
    const href = await tab.getAttribute('href');
    await tab.click();
    await p.waitForURL((u) => `${u.pathname}${u.search}` === href, { timeout: UI });
    await p.locator('table tbody tr td:nth-child(3) .chip').first().filter({ hasText: '설정 변경' }).waitFor({ timeout: UI });
    const actors = (await p.locator('table tbody tr td:nth-child(2)').allInnerTexts()).join(' ');
    need(actors.includes(seed.ops.email), `「설정 변경」에 운영자가 없다: ${actors.replace(/\s+/g, ' ').slice(0, 120)}`);
    return `${want.length}가지 · 위로 제출·본부본 없음 · 설정 변경에 운영자`;
  }, ['운영자/로그인 화면']);
  await p.close();
}

/**
 * OPS-50h — 수신함 기록(가짜 알림 수신함 NT-56b의 `dev/messenger-sink.jsonl`)을 출시 범위의 사실(seed.json)로 판정한다. 순수 함수 — 시험이 부른다.
 * 앱 코드를 불러 쓰지 않는다(리허설 OPS-47b와 같은 까닭). 사람 → 부서 → 켜짐은 시드가 DB에서 적어 둔 사실이다.
 */
function judgeLaunchSink(entries, L) {
  const counts = {};
  const leaks = [];
  const unknown = [];
  const unlabeled = [];
  const stage3 = [];
  for (const e of entries) {
    const base = String(e.kind ?? '').split(':')[0];
    counts[base || '(종류 없음)'] = (counts[base || '(종류 없음)'] ?? 0) + 1;
    if (!base) unlabeled.push(e.subject ?? '');
    // 3단계 쪽지(RU-53~57b의 ru_* · NT-52 merge_reapprove)는 스위치가 꺼지면 하나도 없다
    if (/^ru_/.test(base) || base === 'merge_reapprove') stage3.push(base);
    for (const r of e.recipients ?? []) {
      const who = L.people[r.email];
      if (!who) unknown.push(`${base} → ${r.employeeNo || '?'}`);
      else if (!who.active) leaks.push(`${base} → ${r.email} (${who.div})`);
    }
  }
  const to = (prefix) => entries.filter((e) => String(e.kind ?? '').startsWith(prefix)).flatMap((e) => (e.recipients ?? []).map((r) => r.email));
  return {
    counts,
    leaks,
    unknown,
    unlabeled,
    stage3,
    batchTo: [...new Set(to('merge_batch:'))].sort(),
    approved: entries.filter((e) => String(e.kind ?? '').startsWith('merge_approved:')),
  };
}

async function launchSink({ store, seed }) {
  const L = seed.launch;
  const read = () => {
    const file = path.join(store, 'dev', 'messenger-sink.jsonl');
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    return lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  };
  await step('수신함', '꺼진 부서 사람에게 0통 · 3단계 쪽지 0 · 종류 없는 쪽지 0', null, async () => {
    const entries = read();
    need(entries.length > 0, '수신함이 비어 있다 — 알림이 하나도 안 나갔다');
    const j = judgeLaunchSink(entries, L);
    need(!j.leaks.length, `꺼진 부서로 간 쪽지 ${j.leaks.length}건: ${j.leaks.slice(0, 3).join(' · ')}`);
    need(!j.unknown.length, `모르는 사번으로 간 쪽지: ${j.unknown.slice(0, 3).join(' · ')}`);
    need(!j.stage3.length, `3단계 쪽지: ${[...new Set(j.stage3)].join(', ')}`);
    need(!j.unlabeled.length, `종류 없는 쪽지 ${j.unlabeled.length}통(NT-56c)`);
    return `${entries.length}통 — ${Object.entries(j.counts).map(([k, n]) => `${k} ${n}`).join(' · ')}`;
  });
  await step('수신함', '병합 점검 → 운영자·기획조정실 담당(총괄 아님) · 승인 완료 → 담당 두 통', null, async () => {
    const j = judgeLaunchSink(read(), L);
    need(sameSet(j.batchTo, L.batch), `「병합 점검」 받은 사람 ${j.batchTo.join(', ') || '없음'} ≠ ${L.batch.join(', ')}`);
    need(!j.batchTo.includes(L.coordinator), `총괄(${L.coordinator})이 총괄이라서 「병합 점검」을 받았다(TACP-30)`);
    need(j.approved.length === 2, `「승인 완료」 ${j.approved.length}통 (고쳐 저장 · 고칠 것 없음 — 두 통이어야 한다)`);
    for (const e of j.approved) {
      need(e.recipients.length === 1 && e.recipients[0].email === L.aiLead, `「승인 완료」 받는 사람: ${e.recipients.map((r) => r.email).join(', ')}`);
      // 3단계가 꺼졌으면 끝 줄이 v1.39 그대로다(NOTIFICATIONS-v2 §3.3) — 담당이 받아서 올린다
      need(e.contents.includes('취합게시판에 올려주세요') && !/자동으로 올라갔어요/.test(e.contents), `「승인 완료」 끝 줄: ${e.contents.split('\n').pop()}`);
    }
    return `병합 점검 → ${j.batchTo.join(', ')} · 승인 완료 2통 → ${L.aiLead} (끝 줄 「취합게시판에 올려주세요」)`;
  }, [MERGED, L_APPROVE, L_REAPPROVE]);
}

// ── 서버 로그 ────────────────────────────────────────────────────────────────
async function serverLog({ work, seed }) {
  const lines = () => fs.readFileSync(path.join(work, 'server.log'), 'utf8').split('\n');
  await step('서버', '로그에 오류 없음', null, async () => {
    const all = lines();
    const bad = all.filter((l) => /오류|Error|FATAL|Unhandled|⨯/.test(l) && !/"level":(30|40)/.test(l));
    need(!bad.length, `${bad.length}줄 — ${bad.slice(0, 2).join(' / ').slice(0, 300)}`);
    const merges = all.filter((l) => l.includes('[merge] 자동 병합')).length;
    return `오류 0 · 자동 병합 줄 넣음 ${merges}번`;
  });
  if (SCOPE !== 'launch') return;
  // NT-32 — 기동 로그의 「발송 부서」는 켜짐 그리고 알림만 센다. 기동 때는 범위 밖 한 줄(꺼진 부서)이 아직 알림 켬이다 — 운영자가 끄기 전이다.
  // 예전 줄은 그 부서까지 「발송」으로 셌다(「발송 부서 3/14개」) — 운영자가 LAUNCH-v2 ⑦에서 보는 수가 실제와 달랐다
  await step('서버', '기동 로그 「발송 부서」 — 켠 두 부서만 · 알림만 켠 꺼진 부서는 따로 (NT-32)', null, async () => {
    const L = seed.launch;
    const line = lines().find((l) => l.startsWith('[알림] 켜짐'));
    need(line, '기동 로그에 「[알림] 켜짐」 줄이 없다');
    const m = line.match(/발송 부서 (\d+)\/(\d+)개: (.*?)(?: · 알림만 켠 꺼진 부서 (\d+)개: (.*))?$/);
    need(m, `기동 로그: ${line}`);
    const sending = m[3].split(', ');
    const parked = m[5] ? m[5].split(', ') : [];
    need(Number(m[1]) === L.active.length && sameSet(sending, L.active), `발송 부서: ${m[1]}개 ${m[3]}`);
    need(sameSet(parked, [L.leftover]), `알림만 켠 꺼진 부서: ${m[5] ?? '없음'}`);
    return line.replace(/^\[알림\] /, '');
  });
}

// 직접 돌릴 때만 — 시험(tests/e2e-script.test.ts)은 지키는 부품만 불러 본다
if (require.main === module) {
  main().catch((e) => {
    console.error('e2e: 실패 —', e && e.stack ? e.stack : e);
    process.exit(2);
  });
}
module.exports = { cleanEnv, FORBIDDEN_PORTS, SCOPES, mondayOf, kstIso, judgeLaunchSink };
