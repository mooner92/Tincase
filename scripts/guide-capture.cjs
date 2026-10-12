#!/usr/bin/env node
/**
 * PG-62 — 사용 안내 그림을 **가짜 데이터로** 다시 찍는다. 이 한 줄이 전부다:
 *
 *   node scripts/guide-capture.cjs
 *
 * 하는 일 (순서대로):
 *   1~4. 가짜 앱을 띄운다 — 새 임시 DB · 가짜 시드 · 표식 확인 · 이 체크아웃의 `next dev` (`scripts/lib/fake-app.cjs`).
 *        표식이 맞지 않으면(이 실행이 만든 가짜 DB가 아니면) **찍지 않는다**
 *   5. 역할별 세션으로 로그인해 단계마다 그 상태를 만들고(제출·병합·승인은 화면에서 실제로 누른다 — 위로 올리기·이어 붙이기·
 *      전사본은 승인이 일으키는 자동 진행이라 누를 것이 없다, RU-84), `data-guide` 앵커(무대의 구멍 = 누를 곳)와 카메라 사각형을
 *      재서 `public/guide/deck/<단계>.webp`와 `manifest.json`을 쓴다. 단계 순서는 「누르면 다음 화면」이다
 *   6. 서버를 끄고, `next dev`가 고쳐 쓴 CLAUDE.md·AGENTS.md·next-env.d.ts를 되돌리고, 임시 디렉터리를 지운다
 *
 * 다른 서버·다른 DB를 겨냥하는 옵션은 **일부러 없다.** 테스트 서버의 DB도 운영의 사본이라 실명이 들어 있다.
 *
 * 필요한 것:
 *   - 부서 양식 hwp — 기본 `fixtures/master-template.hwp` (공개 저장소에는 없다, 로컬에만). 다른 파일이면 GUIDE_TEMPLATE=<경로>
 *   - Playwright (chromium) — `playwright`를 찾지 못하면 PLAYWRIGHT=<.../node_modules/playwright>
 *   - 이 체크아웃에서 다른 `next dev`가 돌고 있지 않을 것 (.next를 같이 쓴다)
 *
 * 선택: GUIDE_PORT(기본 3199) · GUIDE_NOW(ISO 시각 — 가짜 시계를 그 시각으로) · GUIDE_KEEP=1(임시 디렉터리를 남긴다)
 *       GUIDE_OUT=<디렉터리>(그림을 다른 곳에 — 찍기 자체를 시험할 때. 기본 public/guide/deck)
 *
 * 그림: 1600×900 창을 배율 2로(3200×1800) → WebP, 장당 200KB 이하가 될 때까지 품질을 낮춘다.
 * 카메라 사각형(`frame`)은 단계의 `frameClip`으로, 창보다 큰 앵커의 구멍은 `focusClip`으로 줄여 manifest에 남긴다.
 * 찍기 전에 그 사각형의 가운데가 창 높이 45%에 오게 스크롤한다(찍는 동안만 바닥에 50vh를 덧댄다).
 *
 * **안전장치 (PG-81 · B7, 2026-10-08 v2)** — 사각형과 그림의 짝이 어긋나도 눈으로는 모른다. 그래서 찍을 때마다:
 *   글꼴을 기다린다(`document.fonts.ready`) → 잰다 → 찍는다 → **다시 잰다**: 0.5px 넘게 달라졌으면 한 번 다시, 또 다르면 실패 ·
 *   가림 검사 — 앵커 가운데와 안쪽 네 점의 `elementFromPoint`가 모두 앵커 안이어야 한다(머리·토스트가 덮은 채 찍지 않게) ·
 *   manifest에 그림 `sha256`(그림만 다시 찍히고 사각형이 낡은 것을 테스트가 잡는다 — PG-T143)과 앵커 둥글기 `radius`(구멍을 버튼과
 *   동심으로 — PG-81)를 남긴다
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { REPO, DAY, kst, mondayOf, log, loadPlaywright, startFakeApp, tsx } = require('./lib/fake-app.cjs');

const OUT = path.resolve(process.env.GUIDE_OUT || path.join(REPO, 'public/guide/deck'));
const PORT = Number(process.env.GUIDE_PORT || 3199);
const VIEW = { width: 1600, height: 900 };
const SCALE = 2;
const MAX_BYTES = 200 * 1024;
const QUIET =
  'nextjs-portal{display:none!important} *{caret-color:transparent!important;transition:none!important;animation:none!important}' +
  // 페이지 맨 끝의 카드도 창 가운데까지 올라올 수 있게 — 찍는 동안만. 그림에는 바닥(빈 회색)으로만 보인다
  ' body{padding-bottom:50vh!important}' +
  // 둘러보기 카드(PG-84)는 그림에 넣지 않는다 — 찍는 사람들은 처음 온 사람이라 카드가 뜬다
  ' [data-tour-offer]{display:none!important}' +
  // 스크롤바 자리(PG-80 scrollbar-gutter)는 그림에 빈 띠로 남는다 — 찍는 동안만 없앤다
  ' html{scrollbar-gutter:auto!important}';

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

/** PG-81 · B2 — 앵커의 둥글기(왼쪽 위 모서리, 그림 px). 높이 절반을 넘는 값(999px 알약)은 절반으로 */
async function radiusOf(page, id) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const v = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return Math.round(Math.min(v, r.height / 2, r.width / 2) * 10) / 10;
  }, sel(id));
}

/**
 * PG-81 · B7 — 가림 검사. 앵커 가운데와 안쪽 네 점(가장자리에서 25%)을 누르면 앵커(또는 그 안)가 잡혀야 한다 —
 * 붙어 있는 머리·토스트·다른 층이 앵커를 덮은 채 찍으면 무대의 구멍이 엉뚱한 것을 밝힌다
 */
async function assertUncovered(page, id, focus) {
  const bad = await page.evaluate(
    ([s, f]) => {
      const el = document.querySelector(s);
      if (!el) return ['앵커 없음'];
      const pts = [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ];
      const out = [];
      for (const [fx, fy] of pts) {
        const x = f.x + f.w * fx;
        const y = f.y + f.h * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${x.toFixed(0)},${y.toFixed(0)} → ${hit ? hit.tagName : '없음'}`);
      }
      return out;
    },
    [sel(id), focus],
  );
  if (bad.length) throw new Error(`앵커 ${id}가 다른 것에 가려 있습니다: ${bad.join(' · ')}`);
}

const near = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 0.5);

/**
 * 바닥색 — 그림 맨 아래 한 줄을 색 토막으로(manifest `ground`). 무대가 그림 아래를 비울 때 그 자리를 이 색으로 칠한다(CP-101).
 * 비슷한 색(채널 차 12 이하)은 한 토막, 폭 2% 미만의 토막(글자·테두리 한 획)은 왼쪽 토막에 붙인다
 */
async function groundOf(png) {
  const sharp = require(require.resolve('sharp', { paths: [REPO] }));
  const { data, info } = await sharp(png).extract({ left: 0, top: VIEW.height * SCALE - 1, width: VIEW.width * SCALE, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const nearC = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 12;
  // 토막의 색은 그 토막에서 가장 많은 색 — 첫 픽셀은 경계의 번진 색일 수 있다
  const runs = [];
  for (let i = 0; i < W; i++) {
    const c = px(i);
    const last = runs[runs.length - 1];
    if (last && nearC(last.c, c)) {
      last.n++;
      const k = c.join(',');
      last.hist.set(k, (last.hist.get(k) ?? 0) + 1);
    } else runs.push({ x: i, n: 1, c, hist: new Map([[c.join(','), 1]]) });
  }
  const kept = [];
  for (const r of runs) {
    const last = kept[kept.length - 1];
    if (last && (r.n < W * 0.02 || nearC(last.c, r.c))) {
      last.n += r.n;
      for (const [k, v] of r.hist) last.hist.set(k, (last.hist.get(k) ?? 0) + v);
    } else kept.push({ ...r, hist: new Map(r.hist) });
  }
  // 맨 왼쪽이 가는 토막(테두리 한 획)이면 오른쪽 토막에 붙인다
  if (kept.length > 1 && kept[0].n < W * 0.02) {
    for (const [k, v] of kept[0].hist) kept[1].hist.set(k, (kept[1].hist.get(k) ?? 0) + v);
    kept[1].x = 0;
    kept.shift();
  }
  for (const r of kept) r.c = [...r.hist].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return kept.map((r, i) => ({ x: i === 0 ? 0 : Math.round((r.x / W) * 10000) / 10000, color: hex(r.c) }));
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
 * 단계별 상태 만들기. 순서가 곧 이야기다 — 앞 단계에서 실제로 누른 것(제출·병합·승인)이 뒤 단계의 화면이 된다.
 * 실장·본부장의 승인 뒤에는 위로 올라감·본부본·전사본이 저절로 맞춰진다(ADR-0015) — 그 단계들은 누르지 않고 상태 줄을 찍는다.
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
      // [계획 2줄을 이번 주 실적으로]를 누른 뒤의 화면 — 지난주 계획이 실적 칸에 들어와 있다(구멍을 누르면 다음 = 그 결과)
      id: 'member-share',
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
      // 실적 첫 줄의 「공유」를 켠다 — 병합본에서 그 줄이 파랗게 나가는 것까지 이야기가 이어진다
      after: async (p) => {
        await p.locator(sel('compose-share')).first().click();
        await away(p);
        await p.waitForTimeout(300);
      },
    },
    {
      id: 'member-submit',
      role: 'memberPending',
      after: async (p, fix) => {
        await p.locator(sel('compose-submit')).click();
        await p.getByText('제출되었습니다').waitFor({ timeout: 30_000 });
        await settle(p, 1200);
        await fix();
      },
    },
    { id: 'member-done', role: 'memberPending', path: `/${ai}` },
    { id: 'member-past', role: 'memberPending', path: `/${ai}` },

    { id: 'lead-nudge', role: 'lead', path: `/${ai}/manage` },
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
    // RU-80 — 부서장 승인 전의 「위로」 상태 카드. 버튼이 아니라 상태 줄이다 — 누르지 않는다
    { id: 'lead-handoff', role: 'lead', path: `/${ai}/manage` },
    { id: 'lead-rules', role: 'lead', path: `/${ai}/manage/settings` },

    { id: 'head-open', role: 'head', path: `/${ai}/manage` },
    // 승인 단추는 저장(= 승인) 전에만 있다 — 저장보다 먼저 찍는다(이야기 순서는 deck.ts가 정한다)
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
      // RU-80 — 실장의 저장(= 승인)이 그 요청 안에서 본부로 올렸다. 담당자 화면의 「위로」 카드는 상태 줄이다 — 누르지 않는다
      id: 'head-sent',
      role: 'lead',
      path: `/${ai}/manage`,
      act: async (p) => {
        await p.locator(`${sel('report-unit')} >> text=올라감`).first().waitFor({ timeout: 30_000 });
      },
    },

    // RU-82 — 본부본은 연 순간(읽기 수리) 올라온 실·팀으로 저절로 이어 붙어 있다
    { id: 'hq-units', role: 'hqLead', path: '/hq' },
    {
      id: 'hq-run',
      role: 'hqLead',
      act: async (p, fix) => {
        await p.locator(`${sel('hq-run')} >> text=본부본 받기`).waitFor({ timeout: 60_000 });
        await fix();
      },
    },
    {
      // RU-55 — 본부장 승인 = 총괄로 제출. 누른 결과(「승인 · 총괄로 감」)가 다음 단계의 그림이다
      id: 'hq-approve',
      role: 'hqHead',
      path: '/hq',
      after: async (p, fix) => {
        await clickFor('hq-approve', '/api/rollup/hq/approve')(p);
        await p.locator(`${sel('report-hq')} >> text=승인 · 총괄로 감`).waitFor({ timeout: 30_000 });
        await fix();
      },
    },
    { id: 'hq-sent', role: 'hqLead', path: '/hq' },

    { id: 'org-board', role: 'coordinator', path: '/org' },
    {
      // RU-83 — 전사본은 본부장 승인 뒤 저절로 다시 만들어져 있다(연 순간 읽기 수리도 맞춘다)
      id: 'org-run',
      role: 'coordinator',
      act: async (p, fix) => {
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
        // WS-19l — [일정 바꾸기] 한 번에 입력칸이 열린다
        await click('schedule-open')(p);
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

/** 재고 → 찍고 → 다시 잰다. 0.5px 넘게 달라졌으면 한 번 더, 또 다르면 실패(PG-81 · B7) */
async function shootStable(p, step) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await p.evaluate(() => document.fonts.ready.then(() => true));
    await bringIntoView(p, step.anchor, step.frame, step.frameClip);
    const focus = await rectOf(p, step.anchor, step.focusClip);
    const frame = step.frame || step.frameClip ? await rectOf(p, step.frame ?? step.anchor, step.frameClip) : focus;
    await assertUncovered(p, step.anchor, focus);
    const png = await p.screenshot({ type: 'png' });
    const again = await rectOf(p, step.anchor, step.focusClip);
    const frameAgain = step.frame || step.frameClip ? await rectOf(p, step.frame ?? step.anchor, step.frameClip) : again;
    if (near(focus, again) && near(frame, frameAgain)) return { focus, frame, png, radius: await radiusOf(p, step.anchor) };
    log(`${step.id}: 찍는 동안 사각형이 움직였다 — 다시 찍는다 (${JSON.stringify(focus)} → ${JSON.stringify(again)})`);
    await p.waitForTimeout(800);
  }
  throw new Error(`${step.id}: 사각형이 가라앉지 않는다 — 찍지 않는다`);
}

async function main() {
  const { chromium } = loadPlaywright();
  const app = await startFakeApp({ port: PORT });
  try {
    const { base, sessions, slugs, week, fake, fix, cookie } = app;
    const deck = JSON.parse(
      tsx(['-e', "import('./src/lib/guide/deck.ts').then((m) => process.stdout.write(JSON.stringify(m.shotSteps())))"], app.env, '단계 목록'),
    );

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
      if (role) await ctx.addCookies([{ name: cookie, value: sessions[role], url: base }]);
      // 새로 열거나 다시 읽을 때마다 — 개발 서버 표시·깜빡이는 커서·움직임·둘러보기 카드가 그림에 섞이지 않게
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
        await p.goto(base + st.path, { waitUntil: 'networkidle', timeout: 180_000 });
        await settle(p, 300);
      }
      if (st.act) await st.act(p, fix);
      const { focus, frame, png, radius } = await shootStable(p, step);
      const { buf, q } = await toWebp(png);
      const file = `${step.id}.webp`;
      fs.writeFileSync(path.join(OUT, file), buf);
      const ground = await groundOf(png);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      shots[step.id] = { file, width: VIEW.width * SCALE, height: VIEW.height * SCALE, focus, frame, anchor: step.anchor, ground, radius, sha256 };
      log(`${step.id.padEnd(16)} ${Math.round(buf.length / 1024)}KB q${q} r${radius}`);
      if (st.after) await st.after(p, fix);
    }
    await browser.close();

    // 단계에서 빠진 옛 그림은 지운다 — 남아 있으면 아무도 안 쓰는 그림이 저장소에 쌓인다
    for (const f of fs.readdirSync(OUT)) {
      if (f.endsWith('.webp') && !Object.values(shots).some((s) => s.file === f)) fs.rmSync(path.join(OUT, f));
    }
    const stamp = new Date(app.realNow).toISOString().replace(/[-:]/g, '').slice(0, 13); // 20261008T0130
    const manifest = { version: stamp, week, viewport: VIEW, scale: SCALE, shots };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    log(`그림 ${Object.keys(shots).length}장 → ${path.relative(REPO, OUT)}`);
  } finally {
    app.stop();
  }
}

main().catch((e) => {
  console.error('[guide]', e.message ?? e);
  process.exit(1);
});
