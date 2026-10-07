#!/usr/bin/env node
/**
 * PG-62 — 사용 안내 그림을 **가짜 데이터로** 다시 찍는다. 이 한 줄이 전부다:
 *
 *   node scripts/guide-capture.cjs
 *
 * 하는 일 (순서대로):
 *   1. 새 임시 디렉터리(os.tmpdir()/tincase-guide-*)에 빈 SQLite DB를 만든다      — 실제 DB를 가리킬 길이 없다
 *   2. `scripts/guide-seed.ts`로 가짜 부서·사람·업무일지를 넣고 표식(nonce)을 남긴다  — 사람이 있는 DB에는 시드하지 않는다
 *   3. `--verify`로 표식을 확인한다. 틀리면 찍지 않는다
 *   4. 이 체크아웃에서 `next dev`를 띄운다 (그 DB · 웹 작성만 · 알림·스케줄러·모델 끔)
 *   5. 역할별 세션으로 로그인해 단계마다 그 상태를 만들고(승인·제출·이어 붙이기는 화면에서 실제로 누른다),
 *      `data-guide` 앵커의 사각형을 재서 `public/guide/deck/<단계>.webp`와 `manifest.json`을 쓴다
 *   6. 서버를 끄고, `next dev`가 고쳐 쓴 CLAUDE.md·AGENTS.md·next-env.d.ts를 되돌리고, 임시 디렉터리를 지운다
 *
 * 다른 서버·다른 DB를 겨냥하는 옵션은 **일부러 없다.** 테스트 서버의 DB도 운영의 사본이라 실명이 들어 있다 —
 * 그런 화면이 한 장이라도 찍히면 공개 저장소와 강당 화면에 남는다.
 *
 * 필요한 것:
 *   - 부서 양식 hwp — 기본 `fixtures/master-template.hwp` (공개 저장소에는 없다, 로컬에만). 다른 파일이면 GUIDE_TEMPLATE=<경로>
 *   - Playwright (chromium) — `playwright`를 찾지 못하면 PLAYWRIGHT=<.../node_modules/playwright>
 *   - 이 체크아웃에서 다른 `next dev`가 돌고 있지 않을 것 (.next를 같이 쓴다)
 *
 * 선택: GUIDE_PORT(기본 3199) · GUIDE_NOW(ISO 시각 — 가짜 시계를 그 시각으로) · GUIDE_KEEP=1(임시 디렉터리를 남긴다)
 *       GUIDE_OUT=<디렉터리>(그림을 다른 곳에 — 찍기 자체를 시험할 때. 기본 public/guide/deck)
 *
 * **시계.** 언제 찍어도 같은 그림이 나오게, 서버와 시드를 「이번 주 수요일 15:00」(마감 전날 오후)으로 옮겨 놓고 찍는다
 * (GUIDE_CLOCK_SHIFT_MS). 마감(목 14:00)이 지난 뒤에 진짜 시각으로 찍으면 부서원 화면에 [작성하기]가 없고(마감 후 잠김),
 * 새벽에 찍으면 「제출 01:32」 같은 시각이 강당 화면에 뜬다. 월간 주(그 달 말일이 든 주)면 그 전 주로 간다.
 * Prisma가 스스로 채우는 시각(`@default(now())`)은 엔진이 진짜 시각으로 넣으므로 단계마다 `--fix-clock`으로 맞춘다.
 *
 * 그림: 1600×900 창을 배율 2로(3200×1800) → WebP, 장당 200KB 이하가 될 때까지 품질을 낮춘다.
 * 배율 2인 이유: 발표 무대(1920px)에서 카메라가 버튼 둘레로 2.2배까지 다가간다 — 1.5배로 찍으면 그림을 늘려 그려 글자가
 * 번졌다(2026-10-08 검토). 무대는 찍은 배율의 1.15배까지만 키운다(camera.ts OVERZOOM).
 *
 * 카메라 사각형(`frame`)은 단계의 `frameClip`으로, 창보다 큰 앵커의 스포트라이트는 `focusClip`으로 줄여 manifest에 남긴다 — 카드 하나를 통째로 담으면 덜 다가가 글자가
 * 작다. 찍기 전에 그 사각형의 가운데가 창 높이 45%에 오게 스크롤한다(페이지 맨 끝의 카드도 올라오도록 찍는 동안만
 * 바닥에 50vh를 덧댄다). 아래쪽에 붙은 채로 찍으면 강당에서 버튼이 화면 맨 아래 — 앞사람 머리 높이 — 에 놓인다.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.GUIDE_OUT || path.join(REPO, 'public/guide/deck'));
const PORT = Number(process.env.GUIDE_PORT || 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEW = { width: 1600, height: 900 };
const SCALE = 2;
const MAX_BYTES = 200 * 1024;
const COOKIE = 'repman_session';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'next-env.d.ts'];
const QUIET =
  'nextjs-portal{display:none!important} *{caret-color:transparent!important;transition:none!important;animation:none!important}' +
  // 페이지 맨 끝의 카드도 창 가운데까지 올라올 수 있게 — 찍는 동안만. 그림에는 바닥(빈 회색)으로만 보인다
  ' body{padding-bottom:50vh!important}';

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

// ── 찍기 ─────────────────────────────────────────────────────────────────────
const sel = (id) => `[data-guide="${id}"]`;

/** 앵커 사각형에 `frameClip`을 적용한다 (deck.ts FrameClip — 앵커 왼쪽 위 기준, `right`면 오른쪽 끝 기준) */
function clipRect(r, clip) {
  if (!clip) return r;
  let { x, y, width, height } = r;
  if (clip.y) {
    y += clip.y;
    height -= clip.y;
  }
  if (clip.h && clip.h < height) height = clip.h;
  if (clip.w && clip.w < width) {
    if (clip.right) x += width - clip.w;
    width = clip.w;
  }
  return { x, y, width, height };
}

/**
 * 앵커(·카메라 사각형)가 창 안에 들어오게 스크롤 — 드로어 안쪽 스크롤도 함께. 그다음 카메라 사각형의 가운데를
 * 창 높이 45%로 옮긴다: 무대의 카메라는 사각형을 46% 높이에 놓는데(camera.ts AIM_Y), 그림 아래쪽에 붙은 사각형은
 * 그림 끝에 막혀 그 자리까지 못 올라온다. 사각형 위끝과 앵커는 붙어 있는 머리(64px) 밑으로 숨기지 않는다.
 */
async function bringIntoView(page, anchor, frame, clip) {
  await page.evaluate(
    ([a, f, c]) => {
      // 위 clipRect와 같은 규칙 — 브라우저 쪽에서 다시 적는다(함수를 넘길 수 없다)
      const clipRect = (r, k) => {
        if (!k) return r;
        let { x, y, width, height } = r;
        if (k.y) {
          y += k.y;
          height -= k.y;
        }
        if (k.h && k.h < height) height = k.h;
        if (k.w && k.w < width) {
          if (k.right) x += width - k.w;
          width = k.w;
        }
        return { x, y, width, height };
      };
      const A = document.querySelector(a);
      if (!A) return;
      const F = (f && document.querySelector(f)) || A;
      const frameRect = () => {
        const r = F.getBoundingClientRect();
        const k = clipRect({ x: r.left, y: r.top, width: r.width, height: r.height }, c);
        return { top: k.y, bottom: k.y + k.height, height: k.height };
      };
      const top = 80; // 머리(64px) + 여유
      const bottom = window.innerHeight - 8;
      const avail = bottom - top;
      const fits = (r) => r.top >= top && r.bottom <= bottom;
      let ar = A.getBoundingClientRect();
      const needs = ar.height <= avail ? !fits(ar) : ar.top < top || ar.top > window.innerHeight * 0.5;
      if (needs) {
        A.scrollIntoView({ block: ar.height <= avail ? 'nearest' : 'start' });
        ar = A.getBoundingClientRect();
        if (ar.top < top) window.scrollBy(0, ar.top - top - 8); // 붙어 있는 머리 밑으로 숨지 않게
      }
      ar = A.getBoundingClientRect();
      let fr = frameRect();
      if (fr.height <= avail && !fits(fr)) {
        let dy = fr.top < top ? fr.top - top : fr.bottom - bottom;
        if (ar.top - dy < top) dy = ar.top - top;
        if (ar.bottom - dy > bottom) dy = ar.bottom - bottom;
        window.scrollBy(0, dy);
      }
      // 카메라 사각형 가운데를 창 높이 45%로 — 위끝·앵커가 머리 밑으로 들어가지 않는 만큼만
      ar = A.getBoundingClientRect();
      fr = frameRect();
      let dy = (fr.top + fr.bottom) / 2 - window.innerHeight * 0.45;
      dy = Math.min(dy, fr.top - top, ar.top - top);
      if (ar.height <= avail) dy = Math.max(dy, ar.bottom - bottom); // 창보다 큰 앵커(전사 표)는 위끝만 지킨다
      if (Math.abs(dy) >= 1) window.scrollBy(0, dy);
    },
    [sel(anchor), frame ? sel(frame) : null, clip ?? null],
  );
  await page.waitForTimeout(250);
}

async function rectOf(page, id, clip) {
  const loc = page.locator(sel(id)).first();
  await loc.waitFor({ state: 'visible', timeout: 30_000 });
  const raw = await loc.boundingBox();
  if (!raw) throw new Error(`앵커 ${id}의 사각형이 없습니다`);
  const b = clipRect(raw, clip);
  // 창 밖으로 나간 부분은 잘라 낸다 — 사각형은 그림 안이어야 한다 (PG-T84)
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  const w = Math.min(VIEW.width, b.x + b.width) - x;
  const h = Math.min(VIEW.height, b.y + b.height) - y;
  if (w <= 4 || h <= 4) throw new Error(`앵커 ${id}가 창 밖에 있습니다 (${JSON.stringify(b)})`);
  const r = (v) => Math.round(v * 10) / 10;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

async function toWebp(png) {
  const sharp = require(require.resolve('sharp', { paths: [REPO] }));
  for (let q = 82; ; q -= 6) {
    const buf = await sharp(png).webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer();
    if (buf.length <= MAX_BYTES || q <= 46) return { buf, q };
  }
}

/** 화면이 가라앉을 때까지 — 버튼을 누른 뒤의 router.refresh()까지 */
async function settle(page, extra = 600) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes('불러오는 중'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

/**
 * 단계별 상태 만들기. 순서가 곧 이야기다 — 앞 단계에서 실제로 누른 것(제출·승인·이어 붙이기)이 뒤 단계의 화면이 된다.
 *   path   새로 연다 (없으면 그 역할의 지금 화면 그대로)
 *   act    찍기 전에 할 일
 *   after  찍은 뒤에 실제로 누르는 것 — 다음 단계의 상태를 만든다
 */
function plan(ai, notice) {
  // 누른 뒤 마우스는 구석으로 — 버튼에 hover 색이 남은 채 찍히지 않게
  const away = (p) => p.mouse.move(2, VIEW.height - 2);
  const click = (id) => async (p) => {
    await p.locator(sel(id)).first().click();
    await away(p);
    await settle(p);
  };
  /**
   * 누르고 그 요청의 응답까지 기다린다. `networkidle`은 페이지를 처음 읽을 때 한 번 지나가면 끝이라
   * 버튼이 보낸 fetch를 기다려 주지 않는다 — 기다리지 않으면 병합이 끝나기 전의 화면이 찍힌다
   */
  const clickFor = (id, path) => async (p) => {
    const done = p.waitForResponse((r) => r.url().includes(path) && r.request().method() !== 'GET', { timeout: 120_000 });
    await p.locator(sel(id)).first().click();
    await away(p);
    const r = await done;
    if (!r.ok()) throw new Error(`${id}: ${path} → HTTP ${r.status()}`);
    await settle(p, 1500); // router.refresh()가 새 화면을 받아 그릴 때까지
  };
  return [
    { id: 'member-login', role: null, path: '/login' },
    { id: 'member-week', role: 'memberPending', path: `/${ai}` },
    {
      id: 'member-compose',
      role: 'memberPending',
      act: async (p) => {
        await click('compose-open')(p);
        await p.locator(sel('previous-to-achievements')).waitFor();
      },
    },
    { id: 'member-previous', role: 'memberPending' },
    {
      id: 'member-submit',
      role: 'memberPending',
      act: async (p) => {
        await click('previous-to-achievements')(p);
        const plan1 = p.getByLabel('주요 업무계획 1번째 줄 업무 내용');
        await plan1.fill('홍보 영상 촬영 일정 조율');
        await p.getByLabel('주요 업무계획 2번째 줄 업무 내용').fill('연구정보시스템 개편 요구사항 정리');
        await p.getByLabel('주요 업무계획 1번째 줄 일자').fill('10/14');
        await away(p);
        await p.waitForTimeout(900); // 「계획 N줄을 실적에 넣었습니다」가 사라질 때까지
      },
      after: async (p, fix) => {
        await p.locator(sel('compose-submit')).click();
        await p.getByText('제출되었습니다').waitFor({ timeout: 30_000 });
        await settle(p, 1200);
        await fix();
      },
    },
    { id: 'member-done', role: 'memberPending', path: `/${ai}` },
    { id: 'member-history', role: 'memberPending', path: `/${ai}/history` },

    { id: 'lead-status', role: 'lead', path: `/${ai}/manage` },
    { id: 'lead-nudge', role: 'lead' },
    {
      id: 'lead-merge',
      role: 'lead',
      // 남시우가 방금 냈다 — 늦게 낸 사람이 있으면 [다시 병합]. 누른 결과를 찍는다
      act: async (p, fix) => {
        await clickFor('merge-run', '/api/division/merge')(p);
        await fix();
        await p.reload();
        await settle(p);
      },
    },
    { id: 'lead-merged', role: 'lead', act: click('merged-open') },
    { id: 'lead-rules', role: 'lead', path: `/${ai}/manage/settings` },

    { id: 'head-open', role: 'head', path: `/${ai}/manage` },
    { id: 'head-approve', role: 'head' },
    {
      id: 'head-save',
      role: 'head',
      act: async (p) => {
        await click('merged-open')(p);
        const cell = p.locator(`${sel('merged-body')} textarea`).first();
        await cell.click();
        await cell.press('End');
        await cell.type(' (보완)');
        await away(p);
        await p.waitForTimeout(300);
      },
      after: async (p, fix) => {
        await clickFor('merged-save', '/api/division/merged/content')(p);
        await fix();
      },
    },
    {
      id: 'head-report',
      role: 'lead',
      path: `/${ai}/manage`,
      after: async (p, fix) => {
        await p.locator(sel('report-unit-submit')).click();
        await p.locator(`${sel('report-unit')} >> text=제출함`).waitFor({ timeout: 30_000 });
        await fix();
      },
    },

    { id: 'hq-status', role: 'hqLead', path: '/hq' },
    {
      id: 'hq-run',
      role: 'hqLead',
      after: async (p, fix) => {
        await p.locator(sel('hq-run-button')).click();
        await p.locator(`${sel('hq-run')} >> text=본부본 받기`).waitFor({ timeout: 60_000 });
        await fix();
      },
    },
    {
      id: 'hq-approve',
      role: 'hqHead',
      path: '/hq',
      after: async (p, fix) => {
        await p.locator(sel('hq-approve')).click();
        await p.locator(`${sel('hq-run')} >> text=승인 완료`).waitFor({ timeout: 30_000 });
        await fix();
      },
    },
    {
      id: 'hq-submit',
      role: 'hqLead',
      path: '/hq',
      after: async (p, fix) => {
        await p.locator(sel('report-hq-submit')).click();
        await p.locator(`${sel('report-hq')} >> text=제출함`).waitFor({ timeout: 30_000 });
        await fix();
      },
    },

    { id: 'org-board', role: 'coordinator', path: '/org' },
    { id: 'org-final', role: 'coordinator' },
    {
      id: 'org-run',
      role: 'coordinator',
      after: async (p, fix) => {
        await p.locator(sel('org-run-button')).click();
        await p.locator(sel('org-download')).waitFor({ timeout: 90_000 });
        await fix();
      },
    },
    { id: 'org-download', role: 'coordinator', path: '/org' },
    {
      id: 'org-schedule',
      role: 'coordinator',
      path: '/org',
      act: async (p) => {
        await click('schedule-open')(p);
        await click('deadline-edit')(p);
        await p.locator(sel('deadline-paste')).fill(notice);
        await away(p);
      },
    },
    {
      id: 'org-preview',
      role: 'coordinator',
      act: async (p) => {
        await p.locator(sel('deadline-preview')).click();
        await p.locator(sel('deadline-plan')).waitFor({ timeout: 30_000 });
        await settle(p, 400);
      },
    },
  ];
}

/** 다음 주 수요일 15:00 대외 마감 공지 — 「연휴로 마감 당기기」의 예 (WS-19) */
function noticeFor(nowMs) {
  const wed = kst(mondayOf(nowMs) + 9 * DAY);
  return `★ 다음 주 주간업무 제출 기한은 ${wed.getUTCMonth() + 1}월 ${String(wed.getUTCDate()).padStart(2, '0')}(수) 오후 3시입니다. ★\n(연휴 일정으로 인한 마감 기한이니 양해 부탁드립니다.)`;
}

async function main() {
  const { chromium } = loadPlaywright();
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
    SUBMIT_HWP_UPLOAD: 'off', // WA-32 — 안내는 웹 작성만
    MERGE_MODEL: '',
    MERGE_SCHEDULER: 'off',
    MERGE_PAUSE_UNTIL: '',
    MESSENGER_URL: '', // 알림이 어디로도 나가지 않는다
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

  const saved = Object.fromEntries(
    AGENT_FILES.map((f) => [f, fs.existsSync(path.join(REPO, f)) ? fs.readFileSync(path.join(REPO, f)) : null]),
  );
  let server = null;
  const restore = () => {
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
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  try {
    run(process.execPath, [require.resolve('prisma/build/index.js', { paths: [REPO] }), 'db', 'push', '--skip-generate'], env, 'prisma db push');
    log(tsx(['scripts/guide-seed.ts'], env, '시드').trim());
    log(tsx(['scripts/guide-seed.ts', '--verify'], env, '표식 확인').trim());
    const { sessions, slugs, week } = JSON.parse(fs.readFileSync(path.join(work, 'sessions.json'), 'utf8'));
    const deck = JSON.parse(
      tsx(['-e', "import('./src/lib/guide/deck.ts').then((m) => process.stdout.write(JSON.stringify(m.shotSteps())))"], env, '단계 목록'),
    );

    const logFile = path.join(work, 'next-dev.log');
    const fd = fs.openSync(logFile, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [REPO] }), 'dev', '-p', String(PORT), '-H', '127.0.0.1'], {
      cwd: REPO,
      env,
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    log(`next dev → ${BASE} (로그 ${logFile})`);
    await waitFor(`${BASE}/login`, 180_000);

    // 겨눈 서버가 이 시드의 DB인가 — 이 실행에서 만든 세션으로만 들어가진다
    const probe = await fetch(`${BASE}/${slugs.ai}`, { headers: { cookie: `${COOKIE}=${sessions.memberPending}` }, redirect: 'manual' });
    if (probe.status !== 200) throw new Error(`시드 세션으로 들어가지지 않습니다 (HTTP ${probe.status}) — 다른 서버가 ${PORT}를 쓰고 있지 않은지 확인하세요`);

    const fix = () => (shift ? Promise.resolve(tsx(['scripts/guide-seed.ts', '--fix-clock'], env, '시각 맞추기')) : Promise.resolve());
    const browser = await chromium.launch();
    const pages = new Map();
    const pageFor = async (role) => {
      const key = role ?? 'anon';
      if (pages.has(key)) return pages.get(key);
      const ctx = await browser.newContext({
        viewport: VIEW,
        deviceScaleFactor: SCALE,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        reducedMotion: 'reduce',
      });
      if (role) await ctx.addCookies([{ name: COOKIE, value: sessions[role], url: BASE }]);
      // 새로 열거나 다시 읽을 때마다 — 개발 서버 표시·깜빡이는 커서·움직임이 그림에 섞이지 않게
      await ctx.addInitScript((css) => {
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = css;
          document.head.appendChild(s);
        });
      }, QUIET);
      const p = await ctx.newPage();
      p.on('dialog', (d) => d.dismiss().catch(() => {}));
      pages.set(key, p);
      return p;
    };

    const steps = plan(slugs.ai, noticeFor(fake));
    const byId = new Map(deck.map((s) => [s.id, s]));
    const missing = deck.filter((s) => !steps.some((p) => p.id === s.id)).map((s) => s.id);
    const extra = steps.filter((p) => !byId.has(p.id)).map((p) => p.id);
    if (missing.length || extra.length) throw new Error(`단계 목록과 찍기 계획이 다릅니다 — 계획 없음: ${missing.join(', ') || '-'} · 단계 없음: ${extra.join(', ') || '-'}`);

    fs.mkdirSync(OUT, { recursive: true });
    const shots = {};
    for (const st of steps) {
      const step = byId.get(st.id);
      const p = await pageFor(st.role);
      if (st.path) {
        await p.goto(BASE + st.path, { waitUntil: 'networkidle', timeout: 180_000 });
        await settle(p, 300);
      }
      if (st.act) await st.act(p, fix);
      await bringIntoView(p, step.anchor, step.frame, step.frameClip);
      const focus = await rectOf(p, step.anchor, step.focusClip);
      const frame = step.frame || step.frameClip ? await rectOf(p, step.frame ?? step.anchor, step.frameClip) : focus;
      const png = await p.screenshot({ type: 'png' });
      const { buf, q } = await toWebp(png);
      const file = `${step.id}.webp`;
      fs.writeFileSync(path.join(OUT, file), buf);
      shots[step.id] = { file, width: VIEW.width * SCALE, height: VIEW.height * SCALE, focus, frame, anchor: step.anchor };
      log(`${step.id.padEnd(16)} ${Math.round(buf.length / 1024)}KB q${q}`);
      if (st.after) await st.after(p, fix);
    }
    await browser.close();

    // 단계에서 빠진 옛 그림은 지운다 — 남아 있으면 아무도 안 쓰는 그림이 저장소에 쌓인다
    for (const f of fs.readdirSync(OUT)) {
      if (f.endsWith('.webp') && !Object.values(shots).some((s) => s.file === f)) fs.rmSync(path.join(OUT, f));
    }
    const stamp = new Date(realNow).toISOString().replace(/[-:]/g, '').slice(0, 13); // 20261008T0130
    const manifest = { version: stamp, week, viewport: VIEW, scale: SCALE, shots };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    log(`그림 ${Object.keys(shots).length}장 → ${path.relative(REPO, OUT)}`);
  } finally {
    restore();
    if (!process.env.GUIDE_KEEP) fs.rmSync(work, { recursive: true, force: true });
    else log(`임시 디렉터리를 남겼습니다: ${work}`);
  }
}

main().catch((e) => {
  console.error('[guide]', e.message ?? e);
  process.exit(1);
});
