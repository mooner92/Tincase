#!/usr/bin/env node
/**
 * PG-T140 · PG-T141 · PG-T153 — 사용 안내를 **실제 브라우저로** 잰다. 가짜 앱(`scripts/lib/fake-app.cjs`)에서만 돈다 —
 * 다른 서버를 겨누는 옵션은 일부러 없다(PG-62와 같은 이유).
 *
 *   node scripts/guide-check.cjs                 셋 다
 *   node scripts/guide-check.cjs --dock          넘기기 단추는 모든 단계에서 같은 상자인가 (PG-80)
 *   node scripts/guide-check.cjs --cutout        그려진 구멍 − 여백 = 그림 속 앵커 ± 2px, 고리 = 구멍, 가장자리에 회색 실선 없음 (PG-81)
 *   node scripts/guide-check.cjs --tour          첫 로그인 둘러보기 — 카드·실제 동작 없음·Esc·건너뛰기·도크 (PG-84)
 *   --shots <디렉터리>                            검토용 화면도 찍는다(발표 표지·장 카드·단계·발표자 창·체험하기 1280/400·카드·둘러보기)
 *   --legacy-ring                                 (검출기 시험) 예전 고리로 그려 --cutout이 **실패하는지** 본다
 *
 * 왜 Playwright인가: 셋 다 「그려진 결과」의 성질이다. 순수 함수 시험(tests/guide-deck.test.ts)은 계산이 맞는지를 보지만,
 * 단추가 실제로 움직이는지(글 양·스크롤바·창 크기), 그늘과 고리가 같은 자리에 그려지는지(안티앨리어싱·배율), 둘러보기가
 * 정말 아무것도 누르지 않는지는 그려 봐야 안다. 결과는 표로 찍고, 하나라도 어긋나면 종료 코드 1.
 *
 * 선택: GUIDE_PORT(기본 3198) · PLAYWRIGHT=<.../node_modules/playwright> · GUIDE_CHECK_JSON=<결과 json 경로>
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { REPO, log, loadPlaywright, startFakeApp, tsx } = require('./lib/fake-app.cjs');

const PORT = Number(process.env.GUIDE_PORT || 3198);
const args = process.argv.slice(2);
// `--shots <디렉터리> --no-checks`면 검토용 화면만 찍는다
const want = (f) => !args.includes('--no-checks') && (args.includes(f) || !args.some((a) => ['--dock', '--cutout', '--tour'].includes(a)));
const shotsDir = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const DOCK_KEYS = ['prev', 'count', 'next'];
/** 도크 단추 상자들 — `root` 안의 `[data-dock]` (보이는 첫 것) */
async function dockBoxes(page, root, keys = DOCK_KEYS) {
  return page.evaluate(
    ([r, ks]) => {
      const out = {};
      const scope = document.querySelector(r);
      if (!scope) return null;
      for (const k of ks) {
        const el = [...scope.querySelectorAll(`[data-dock="${k}"]`)].find((e) => e.getBoundingClientRect().width > 0);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        out[k] = { x: b.x, y: b.y, w: b.width, h: b.height };
      }
      return out;
    },
    [root, keys],
  );
}
function diffBoxes(a, b) {
  let worst = 0;
  for (const k of Object.keys(a)) for (const p of ['x', 'y', 'w', 'h']) worst = Math.max(worst, Math.abs(a[k][p] - b[k][p]));
  return worst;
}
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** 무대가 자리를 잡을 때까지 — 카메라 도착 + 말풍선 다시 잼 (data-settled, PG-81) */
async function settled(page, root, key, timeout = 8000) {
  await page.waitForFunction(
    ([r, k]) => {
      const s = document.querySelector(`${r} [data-stage]`);
      return !!s && s.getAttribute('data-settled') === '1' && (!k || s.getAttribute('data-step') === k);
    },
    [root, key ?? null],
    { timeout },
  );
}

/**
 * PG-T140 — **같은 좌표를 계속 누른다.** 단추가 1px이라도 움직였으면 결국 다른 것을 누르게 되고 주소가 안 바뀌어 실패한다.
 * 매 단계 단추 상자가 0.5px 안에서 같고, 페이지가 스크롤되지 않고, 단추가 창 안이어야 한다
 */
async function walkDock(page, { name, root, stageRoot, total, next = 'next', changed, keys = DOCK_KEYS, extra }) {
  await settled(page, stageRoot);
  const box0 = await dockBoxes(page, root, keys);
  if (!box0) return check(name, false, '도크를 찾지 못함');
  const at = center(box0[next]);
  const y0 = await page.evaluate(() => scrollY);
  const vh = await page.evaluate(() => innerHeight);
  let worst = 0;
  let steps = 0;
  for (let i = 1; i < total; i++) {
    const before = await changed.read(page);
    await page.mouse.click(at.x, at.y);
    try {
      await page.waitForFunction(changed.test, before, { timeout: 5000 });
    } catch {
      return check(name, false, `${i}번째 누르기에서 넘어가지 않았다 (같은 좌표 ${at.x.toFixed(1)},${at.y.toFixed(1)}의 단추가 바뀌었거나 움직였다)`);
    }
    await settled(page, stageRoot).catch(() => {});
    if (extra) await extra(page, i);
    const b = await dockBoxes(page, root, keys);
    if (!b) return check(name, false, `${i}번째 단계에서 도크가 사라짐`);
    worst = Math.max(worst, diffBoxes(box0, b));
    const y = await page.evaluate(() => scrollY);
    if (Math.abs(y - y0) > 0.5) return check(name, false, `${i}번째 단계에서 페이지가 스크롤됨 (${y0} → ${y})`);
    if (b[next].y + b[next].h > vh + 0.5) return check(name, false, `${i}번째 단계에서 [다음]이 창 밖 (${(b[next].y + b[next].h).toFixed(1)} > ${vh})`);
    steps++;
  }
  check(name, worst <= 0.5, `${steps}번 넘김 · 단추 상자 최대 차이 ${worst.toFixed(2)}px`);
}

const hashChanged = { read: (p) => p.evaluate(() => location.hash), test: (h) => location.hash !== h };

async function main() {
  const { chromium } = loadPlaywright();
  const app = await startFakeApp({ port: PORT });
  const browser = await chromium.launch();
  try {
    const { base, sessions, slugs, cookie } = app;
    const ctxFor = async (role, opts = {}) => {
      const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opts });
      if (role) await ctx.addCookies([{ name: cookie, value: sessions[role], url: base }]);
      // 개발 서버 표시는 재는 데 끼지 않게. `--legacy-ring`이면 예전 고리(상자 바깥 그림자)로 되돌려 그린다 —
      // 실선 검출기가 예전 모양에서 **실패하는지** 먼저 본다(검출기가 아무것도 못 잡으면 초록불은 장식이다)
      await ctx.addInitScript((legacy) => {
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent =
            'nextjs-portal{display:none!important}' +
            (legacy ? '.coach-ring{outline:none!important;box-shadow:0 0 0 0.17cqw var(--color-canvas)!important}' : '');
          document.head.appendChild(s);
        });
      }, args.includes('--legacy-ring'));
      return ctx;
    };
    const deck = JSON.parse(
      tsx(
        [
          '-e',
          "import('./src/lib/guide/deck.ts').then((m) => process.stdout.write(JSON.stringify({ present: m.presentSlides().map((s) => ({ key: s.key, id: s.step?.id ?? null, kind: s.step?.kind ?? 'chapter' })), all: m.DECK.flatMap((c) => c.steps.map((s, i) => ({ key: c.id + '-' + (i + 1), id: s.id, kind: s.kind }))), shots: m.shotSteps().map((s) => s.id) })))",
        ],
        app.env,
        '단계 목록',
      ),
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'public/guide/deck/manifest.json'), 'utf8'));
    const presentTotal = deck.present.length;

    // 처음 열면 무대 그림·글꼴을 받느라 느리다 — 한 번 데워 둔다(next dev는 페이지를 처음 열 때 컴파일한다)
    {
      const ctx = await ctxFor('coordinator');
      const p = await ctx.newPage();
      for (const u of ['/guide', '/guide/present', '/hq', '/org', `/${slugs.ai}`, `/${slugs.ai}/manage`]) {
        await p.goto(base + u, { waitUntil: 'networkidle', timeout: 180_000 }).catch(() => {});
      }
      await ctx.close();
    }

    // ── PG-T140 도크 ─────────────────────────────────────────────────────────
    if (want('--dock')) {
      for (const [role, vp] of [
        ['memberPending', { width: 1280, height: 900 }],
        ['lead', { width: 1280, height: 900 }],
        ['coordinator', { width: 1280, height: 900 }],
        ['lead', { width: 1024, height: 768 }],
        ['coordinator', { width: 1920, height: 1080 }],
      ]) {
        const ctx = await ctxFor(role, { viewport: vp });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide`, { waitUntil: 'networkidle' });
        // 장마다 단계 수를 목차에서 더한다(장 머리의 숫자)
        const steps = await p.evaluate(() =>
          [...document.querySelectorAll('nav[aria-label="안내 목차"] > ol > li span.tabular-nums')].reduce((a, s) => a + Number(s.textContent), 0),
        );
        const root = 'section[aria-label="안내 단계"]';
        await walkDock(p, {
          name: `PG-T140 체험하기 ${role} ${vp.width}×${vp.height} (${steps}단계)`,
          root,
          stageRoot: root,
          total: steps || 2,
          changed: hashChanged,
          // 「자세히」를 펼쳐도 도크는 그대로 — 펼친 채로 다음 단계를 잰다
          extra: async (page) => {
            const s = await page.$(`${root} details.disclosure summary`);
            if (s) await s.click();
          },
        });
        await ctx.close();
      }

      // 크게 보기
      for (const vp of [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
      ]) {
        const ctx = await ctxFor('coordinator', { viewport: vp });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide`, { waitUntil: 'networkidle' });
        const steps = await p.evaluate(() =>
          [...document.querySelectorAll('nav[aria-label="안내 목차"] > ol > li span.tabular-nums')].reduce((a, s) => a + Number(s.textContent), 0),
        );
        await p.getByRole('button', { name: '크게 보기' }).click();
        const root = '[role="dialog"][aria-label="크게 보기"]';
        await p.waitForSelector(root);
        await walkDock(p, { name: `PG-T140 크게 보기 ${vp.width}×${vp.height}`, root, stageRoot: root, total: steps, changed: hashChanged });
        // 무대 상자는 덮개 안, 도크는 창 안
        const inside = await p.evaluate((r) => {
          const o = document.querySelector(r).getBoundingClientRect();
          const s = document.querySelector(`${r} [data-stage]`).getBoundingClientRect();
          const d = document.querySelector(`${r} .coach-dock`).getBoundingClientRect();
          return s.left >= o.left - 0.5 && s.right <= o.right + 0.5 && s.bottom <= d.top + 0.5 && d.bottom <= innerHeight + 0.5;
        }, root);
        check(`PG-T140 크게 보기 ${vp.width}×${vp.height} — 무대는 덮개 안, 도크와 겹치지 않음`, inside);
        await ctx.close();
      }

      // 발표 화면 — 마우스 묶음 [→]
      for (const vp of [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
      ]) {
        const ctx = await ctxFor('lead', { viewport: vp });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide/present`, { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: '전체 화면 없이 보기' }).click();
        await p.mouse.move(vp.width / 2, vp.height / 2);
        const root = '[data-present]';
        await p.waitForSelector(`${root} [data-dock="next"]`);
        await walkDock(p, {
          name: `PG-T140 발표 ${vp.width}×${vp.height} (${presentTotal}장)`,
          root,
          stageRoot: root,
          total: presentTotal,
          keys: ['prev', 'next'],
          changed: hashChanged,
        });
        // 검은 화면을 켜고 끈 뒤에도 같은 자리
        const before = await dockBoxes(p, root, ['prev', 'next']);
        await p.keyboard.press('b');
        await p.keyboard.press('b');
        await p.mouse.move(vp.width / 2 + 3, vp.height / 2 + 3);
        await p.waitForSelector(`${root} [data-dock="next"]`);
        const after = await dockBoxes(p, root, ['prev', 'next']);
        check(`PG-T140 발표 ${vp.width}×${vp.height} — 검은 화면 뒤에도 같은 상자`, !!after && diffBoxes(before, after) <= 0.5);
        await ctx.close();
      }

      // 발표자 창
      for (const vp of [
        { width: 1280, height: 800 },
        { width: 1600, height: 1000 },
      ]) {
        const ctx = await ctxFor('lead', { viewport: vp });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide/present?view=notes`, { waitUntil: 'networkidle' });
        const root = '[data-present]';
        await walkDock(p, {
          name: `PG-T140 발표자 창 ${vp.width}×${vp.height}`,
          root: `${root} footer`,
          stageRoot: `${root} section[aria-label="지금 장"]`,
          total: presentTotal,
          keys: ['prev', 'next'],
          changed: hashChanged,
        });
        const noScroll = await p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 0.5);
        check(`PG-T140 발표자 창 ${vp.width}×${vp.height} — 페이지가 스크롤되지 않는다(메모는 제 칸에서)`, noScroll);
        await ctx.close();
      }
    }

    // ── PG-T141 구멍 ─────────────────────────────────────────────────────────
    if (want('--cutout')) {
      const sharp = require(require.resolve('sharp', { paths: [REPO] }));
      const W = manifest.viewport.width;
      const HOLE_PAD = 0.5;
      const measure = (page, root, focus) =>
        page.evaluate(
          ([r, f, w, padCqw]) => {
            const stage = document.querySelector(`${r} [data-stage]`);
            const sr = stage.getBoundingClientRect();
            const pad = (padCqw * sr.width) / 100;
            const ringEl = stage.querySelector('.coach-ring');
            const ring = ringEl?.getBoundingClientRect();
            const radius = ringEl ? parseFloat(getComputedStyle(ringEl).borderTopLeftRadius) || 0 : 0;
            const top = [...stage.querySelectorAll('.guide-layer')].at(-1);
            const rect = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
            if (f) {
              const ir = top.querySelector('img').getBoundingClientRect(); // 실제로 그려진 그림 — 계획 계산과 무관하다
              const k = ir.width / w;
              const dim = top.querySelector('.coach-dim').getBoundingClientRect();
              return {
                anchor: { x: ir.x + f.x * k, y: ir.y + f.y * k, w: f.w * k, h: f.h * k },
                cut: { x: dim.x + pad, y: dim.y + pad, w: dim.width - 2 * pad, h: dim.height - 2 * pad },
                dim: rect(dim),
                ring: ring ? rect(ring) : null,
                hand: (() => {
                  const h = stage.querySelector('.coach-hand');
                  return h ? rect(h.getBoundingClientRect()) : null;
                })(),
                stage: rect(sr),
                radius,
              };
            }
            // 알림 카드 — 카드의 DOM 상자가 앵커
            const dimEl = stage.querySelector('.coach-dim');
            const card = dimEl.nextElementSibling;
            const dim = dimEl.getBoundingClientRect();
            return {
              anchor: rect(card.getBoundingClientRect()),
              cut: { x: dim.x + pad, y: dim.y + pad, w: dim.width - 2 * pad, h: dim.height - 2 * pad },
              dim: rect(dim),
              ring: ring ? rect(ring) : null,
              hand: null,
              stage: rect(sr),
              radius,
            };
          },
          [root, focus, W, HOLE_PAD],
        );
      const edges = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - (b.x + b.w)), Math.abs(a.y + a.h - (b.y + b.h)));

      /**
       * 가장자리 실선 검출 (R1) — 예전 코드(고리 = 상자 **바깥** 그림자)에서는 구멍 가장자리를 그늘(판 안)과 고리(무대)가 따로
       * 안티앨리어싱해, 띠와 구멍 사이에 그늘의 반투명 가장자리 픽셀이 회색 실선으로 남았다. 그 픽셀은 가장자리 **바로 안쪽**(−1 ~ 0px)에 있다.
       * 그래서 네 변의 곧은 부분(둥근 모서리 밖)의 25·50·75% 지점에서 변에 수직인 한 줄을 뽑아, 가장자리 −1 ~ 0px 창 안에
       * 「안쪽 화면(띠 너머)과 띠 중 어두운 쪽」보다 12 넘게 어두운 픽셀이 있으면 실선이다. 바깥쪽은 보지 않는다: Chrome은 outline 굵기를
       * 장치 픽셀로 내려 잡아 띠의 바깥 끝이 +0.6~1px에 오고, 그 끝의 안티앨리어싱(DPR 1.5에서 +0.3 장치 픽셀에 216)은 실선이 아니다.
       * 화면 전체를 찍어 절대 좌표로 읽는다(잘라 찍기는 장치 픽셀로 반올림돼 한 픽셀씩 밀렸다). `--legacy-ring`으로 예전 고리를
       * 그리면 이 검사가 **실패해야** 한다(검출기 시험)
       */
      async function seam(page, r, dpr) {
        const png = await page.screenshot();
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const lumAt = (cx, cy) => {
          const x = Math.floor(cx * dpr);
          const y = Math.floor(cy * dpr);
          if (x < 0 || y < 0 || x >= info.width || y >= info.height) return 255;
          const i = (y * info.width + x) * 3;
          return Math.min(data[i], data[i + 1], data[i + 2]);
        };
        const cu = r.stage.w / 100;
        const inBand = Math.max(2, 0.12 * cu); // 띠가 구멍 안으로 들어오는 폭 (globals.css --ring-in)
        const bad = [];
        const step = 1 / dpr;
        const skip = (x, y) => r.hand && x > r.hand.x - 6 && x < r.hand.x + r.hand.w + 6 && y > r.hand.y - 6 && y < r.hand.y + r.hand.h + 6;
        const rad = r.radius ?? 0;
        const sides = [
          ['left', r.dim.h, (u) => [r.dim.x, r.dim.y + u], [1, 0]],
          ['right', r.dim.h, (u) => [r.dim.x + r.dim.w, r.dim.y + u], [-1, 0]],
          ['top', r.dim.w, (u) => [r.dim.x + u, r.dim.y], [0, 1]],
          ['bottom', r.dim.w, (u) => [r.dim.x + u, r.dim.y + r.dim.h], [0, -1]],
        ];
        let samples = 0;
        for (const [side, len, at, [ix, iy]] of sides) {
          const straight = len - 2 * (rad + 1);
          if (straight < 6) continue; // 알약의 둥근 끝 — 곧은 부분이 없다
          for (const t of [0.25, 0.5, 0.75]) {
            const [ex, ey] = at(rad + 1 + straight * t);
            if (skip(ex, ey)) continue;
            // 안쪽 화면(띠 너머 2px) — 그 값과 흰 띠 중 어두운 쪽이 기준
            const inside = lumAt(ex + ix * (inBand + 2), ey + iy * (inBand + 2));
            const ref = Math.min(inside, 250);
            samples++;
            for (let d = -1; d <= 1e-9; d += step) {
              // d < 0 = 구멍 안쪽 (ix·iy는 안쪽 방향)
              const v = lumAt(ex - ix * d, ey - iy * d);
              if (v < ref - 12) {
                bad.push(`${side}@${t} d=${d.toFixed(1)} → ${v} (기준 ${ref})`);
                break;
              }
            }
          }
        }
        return { bad, samples };
      }

      const shotIds = deck.shots;
      const runs = [
        { name: '발표 1920×1080', vp: { width: 1920, height: 1080 }, dpr: 1, mode: 'present', role: 'lead' },
        { name: '발표 1366×768', vp: { width: 1366, height: 768 }, dpr: 1, mode: 'present', role: 'lead' },
        { name: '발표 1280×720', vp: { width: 1280, height: 720 }, dpr: 1, mode: 'present', role: 'lead' },
        { name: '체험하기 1280×900 @1', vp: { width: 1280, height: 900 }, dpr: 1, mode: 'self' },
        { name: '체험하기 1280×900 @1.25', vp: { width: 1280, height: 900 }, dpr: 1.25, mode: 'self' },
        { name: '체험하기 1280×900 @1.5', vp: { width: 1280, height: 900 }, dpr: 1.5, mode: 'self' },
        { name: '크게 보기 1920×1080', vp: { width: 1920, height: 1080 }, dpr: 1, mode: 'big' },
      ];
      // 체험하기는 사람마다 보이는 단계가 다르다 — 세 사람이면 모든 그림 단계가 한 번씩 나온다
      const selfRoles = ['coordinator', 'head', 'hqHead'];
      // 검출기 시험(--legacy-ring)은 두 무대만 — 발표 1080p · 체험하기 @1.25
      const legacy = args.includes('--legacy-ring');
      for (const run of legacy ? [runs[0], runs[4]] : runs) {
        let worstCut = 0;
        let worstRing = 0;
        let seamSamples = 0;
        let n = 0;
        const fails = [];
        const roles = run.mode === 'present' ? [run.role] : run.mode === 'big' ? ['coordinator'] : selfRoles;
        const seen = new Set();
        for (const role of roles) {
          const ctx = await ctxFor(role, { viewport: run.vp, deviceScaleFactor: run.dpr, reducedMotion: 'reduce' });
          const p = await ctx.newPage();
          const url = run.mode === 'present' ? '/guide/present' : '/guide';
          await p.goto(base + url, { waitUntil: 'networkidle' });
          let root = run.mode === 'present' ? '[data-present]' : 'section[aria-label="안내 단계"]';
          if (run.mode === 'present') await p.getByRole('button', { name: '전체 화면 없이 보기' }).click();
          // 목차를 펼치는 클릭은 하이드레이션 뒤에만 먹는다 — 무대가 자리를 잡을 때까지 기다린다(먼저 누르면 첫 장만 펼쳐진 채 남았다)
          await settled(p, run.mode === 'present' ? '[data-present]' : 'section[aria-label="안내 단계"]', null, 20_000);
          if (run.mode === 'big') {
            await p.getByRole('button', { name: '크게 보기' }).click();
            root = '[role="dialog"][aria-label="크게 보기"]';
          }
          // 이 화면에 있는 단계 열쇠 — 발표는 전부, 체험하기는 목차의 링크(장 머리를 다 펼친 뒤)
          let list = deck.present.filter((s) => s.kind === 'shot' || s.kind === 'message').map((s) => s.key);
          if (run.mode !== 'present') {
            await p.evaluate(() => {
              for (const b of document.querySelectorAll('nav[aria-label="안내 목차"] button[aria-expanded="false"]')) b.click();
            });
            await p.waitForFunction(() => !document.querySelector('nav[aria-label="안내 목차"] button[aria-expanded="false"]'), null, { timeout: 5000 });
            list = await p.evaluate(() => [...document.querySelectorAll('nav[aria-label="안내 목차"] ol ol a')].map((a) => a.getAttribute('href').slice(1)));
          }
          for (const key of list) {
            if (seen.has(key)) continue;
            await p.evaluate((k) => {
              location.hash = k;
            }, key);
            try {
              await settled(p, root, key, 10_000);
            } catch {
              fails.push(`${key}: 자리를 잡지 않음`);
              continue;
            }
            const info = deck.all.find((s) => s.key === key);
            const shotId = info && info.kind === 'shot' && manifest.shots[info.id] ? info.id : null;
            const focus = shotId ? manifest.shots[shotId].focus : null;
            await p.waitForSelector(`${root} [data-stage] .coach-ring`, { timeout: 5000 }).catch(() => {});
            const r = await measure(p, root, focus);
            if (!r.ring) {
              fails.push(`${key}: 고리 없음`);
              continue;
            }
            const dc = edges(r.cut, r.anchor);
            const dr = edges(r.ring, r.dim);
            worstCut = Math.max(worstCut, dc);
            worstRing = Math.max(worstRing, dr);
            if (dc > 2) fails.push(`${key}: 구멍−여백과 앵커 ${dc.toFixed(2)}px`);
            if (dr > 0.5) fails.push(`${key}: 고리와 구멍 ${dr.toFixed(2)}px`);
            const sm = await seam(p, r, run.dpr);
            seamSamples += sm.samples;
            if (sm.bad.length) fails.push(`${key}: 가장자리 실선 ${sm.bad.slice(0, 2).join(' · ')}`);
            seen.add(key);
            n++;
          }
          await ctx.close();
        }
        // 발표는 발표의 그림·알림 단계 전부, 체험하기는 세 사람(총괄 담당·부서장·본부장)으로 모든 그림·알림 단계(셋의 합집합)
        const expected = run.mode === 'present' ? deck.present.filter((x) => x.kind === 'shot' || x.kind === 'message').length : run.mode === 'big' ? n : deck.all.filter((x) => (x.kind === 'shot' || x.kind === 'message') && x.id !== 'member-login').length;
        check(
          `PG-T141 ${run.name} — ${n}/${expected}단계${legacy ? ' (예전 고리 — 실패해야 한다)' : ''}`,
          fails.length === 0 && n > 0 && n === expected,
          `구멍−여백 ↔ 앵커 최대 ${worstCut.toFixed(2)}px · 고리 ↔ 구멍 최대 ${worstRing.toFixed(2)}px · 가장자리 표본 ${seamSamples}곳${fails.length ? ` · ${fails.slice(0, 4).join(' / ')}` : ''}`,
        );
      }

      // 창 크기 변화 — 전체 화면에 들어가는 순간(1920×969 → 1920×1080) 판만 600ms 미끄러지던 것(R4). 50ms 뒤에 고리와 구멍이 같은 자리
      {
        const ctx = await ctxFor('lead', { viewport: { width: 1920, height: 969 } });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide/present#lead-3`, { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: '전체 화면 없이 보기' }).click();
        await settled(p, '[data-present]', 'lead-3');
        await p.setViewportSize({ width: 1920, height: 1080 });
        await p.waitForTimeout(50);
        const r = await measure(p, '[data-present]', manifest.shots['lead-merged'].focus);
        const d = edges(r.ring, r.dim);
        check('PG-T141 창 크기 변화 50ms 뒤 고리 = 구멍 (1920×969 → 1080)', d <= 0.5, `${d.toFixed(2)}px`);
        await ctx.close();
      }
    }

    // ── PG-T153 둘러보기 ──────────────────────────────────────────────────────
    if (want('--tour')) {
      const watch = (p) => {
        const posts = [];
        p.on('request', (r) => {
          if (r.method() !== 'GET') posts.push({ url: r.url().replace(base, ''), method: r.method(), body: r.postData() });
        });
        return posts;
      };
      const inertState = (p) =>
        p.evaluate(() => ({
          inert: [...document.body.children].filter((e) => e.inert).length,
          overflow: document.documentElement.style.overflow,
          overlay: !!document.querySelector('[data-tour]'),
        }));

      // 1. 처음 온 부서원 — 카드가 뜨고, 초점을 가져가지 않고, [괜찮아요] 뒤에는 새로 고쳐도·다른 페이지에도 없다
      {
        const ctx = await ctxFor('memberPending', { viewport: { width: 1280, height: 800 } });
        const p = await ctx.newPage();
        const posts = watch(p);
        await p.goto(`${base}/${slugs.ai}`, { waitUntil: 'networkidle' });
        const card = await p.waitForSelector('[data-tour-offer]', { timeout: 4000 }).catch(() => null);
        const text = card ? await card.innerText() : '';
        const focusOnBody = await p.evaluate(() => document.activeElement === document.body || !document.activeElement?.closest('[data-tour-offer]'));
        check('PG-T153 처음 온 부서원 — 카드가 뜬다 (초점은 그대로)', !!card && focusOnBody && /30초 둘러보기/.test(text), text.replace(/\n/g, ' '));
        if (shotsDir && card) await p.screenshot({ path: path.join(shotsDir, 'tour-card-member-1280.png') });
        if (card) {
          const saved = p.waitForResponse((res) => res.url().includes('/api/me/tour'), { timeout: 10_000 }).catch(() => null);
          await p.getByRole('button', { name: '괜찮아요' }).click();
          const res = await saved;
          check('PG-T153 [괜찮아요] — 기록 200', res?.status() === 200, `${res?.status()}`);
          await p.reload({ waitUntil: 'networkidle' });
          await p.waitForTimeout(2000);
          const again = await p.$('[data-tour-offer]');
          await p.goto(`${base}/guide`, { waitUntil: 'networkidle' });
          await p.waitForTimeout(2000);
          const onGuide = await p.$('[data-tour-offer]');
          const rec = posts.filter((x) => x.url === '/api/me/tour');
          check(
            'PG-T153 [괜찮아요] 뒤 — 새로 고쳐도·다른 페이지에도 카드 없음 · 기록은 dismissed',
            !again && !onGuide && rec.length === 1 && /"dismissed"/.test(rec[0].body ?? ''),
            rec.map((r) => r.body).join(' '),
          );
        }
        await ctx.close();
      }

      // 2. 담당자 [시작] — 홈의 부서원 장 → [다음 장 →]으로 수합 관리의 부서담당자 장 → [끝]. 같은 좌표로 계속 누른다
      {
        const ctx = await ctxFor('lead', { viewport: { width: 1280, height: 800 } });
        const p = await ctx.newPage();
        const posts = watch(p);
        await p.goto(`${base}/${slugs.ai}`, { waitUntil: 'networkidle' });
        await p.waitForSelector('[data-tour-offer]', { timeout: 4000 });
        if (shotsDir) await p.screenshot({ path: path.join(shotsDir, 'tour-card-lead-home-1280.png') });
        await p.getByRole('button', { name: '시작' }).click();
        await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 8000 });
        if (shotsDir) await p.screenshot({ path: path.join(shotsDir, 'tour-step-lead-home-1280.png') });
        const st = await inertState(p);
        check('PG-T153 [시작] — 덮개 · 나머지 body는 inert · 스크롤 잠금', st.overlay && st.inert > 0 && st.overflow === 'hidden', JSON.stringify(st));

        // 구멍을 누르고 Enter·Space·Tab — 실제 화면에는 아무 일도 없다
        const hole = await p.evaluate(() => {
          const r = document.querySelector('[data-tour] .coach-ring').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const urlBefore = p.url();
        await p.mouse.click(hole.x, hole.y);
        await p.keyboard.press('Tab');
        const focusInside = await p.evaluate(() => !!document.activeElement?.closest('[data-tour]'));
        // [건너뛰기]에서 [다음]으로 돌아와 Space·Enter — 도크 단추만 눌린다(한 단계 넘어갈 뿐 실제 화면에는 닿지 않는다)
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Space');
        await p.keyboard.press('Enter');
        await p.waitForTimeout(400);
        const drawer = await p.$('[aria-modal="true"]:not([data-tour])');
        check(
          'PG-T153 구멍·Tab·Space — 실제 화면에 닿지 않는다 (드로어 없음 · 주소 그대로 · 초점은 덮개 안)',
          !drawer && p.url() === urlBefore && focusInside,
          `drawer=${!!drawer} focusInside=${focusInside}`,
        );
        // Space가 도크 단추를 눌러 한 단계 넘어갔을 수 있다 — 첫 단계로 돌아가서 같은 좌표로 끝까지
        for (let i = 0; i < 6; i++) {
          const prevBtn = await p.$('[data-tour] [data-dock="prev"]:not([disabled])');
          if (!prevBtn) break;
          await prevBtn.click();
        }
        await p.waitForSelector('[data-tour][data-settled="1"]');
        const box0 = await dockBoxes(p, '[data-tour]', ['prev', 'count', 'next', 'skip']);
        const at = center(box0.next);
        let worst = 0;
        let clicks = 0;
        let collisions = 0;
        const seenSteps = [];
        for (let i = 0; i < 20; i++) {
          const step = await p.evaluate(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step') ?? null);
          if (!step) break;
          seenSteps.push(step);
          const lay = await p.evaluate(() => {
            const q = (s) => document.querySelector(`[data-tour] ${s}`)?.getBoundingClientRect();
            const b = q('.coach-bubble');
            const r = q('.coach-ring');
            const d = q('.coach-dock');
            const hit = (a, c) => a && c && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
            return { overlap: hit(b, d) || hit(r, d) || hit(b, r) };
          });
          if (lay.overlap) collisions++;
          const b = await dockBoxes(p, '[data-tour]', ['prev', 'count', 'next', 'skip']);
          if (b) worst = Math.max(worst, diffBoxes(box0, b));
          await p.mouse.click(at.x, at.y);
          clicks++;
          await p
            .waitForFunction((s) => (document.querySelector('[data-tour]')?.getAttribute('data-tour-step') ?? 'end') !== s, step, { timeout: 15_000 })
            .catch(() => {});
          // 장이 바뀌어 다른 페이지로 갔으면 그 페이지의 덮개를 기다린다
          await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 15_000 }).catch(() => {});
        }
        const end = await inertState(p);
        const other = posts.filter((x) => x.url !== '/api/me/tour');
        const recs = posts.filter((x) => x.url === '/api/me/tour').map((x) => JSON.parse(x.body).outcome);
        check(
          'PG-T153 담당자 — 홈(부서원) → 수합 관리(부서담당자) → 끝, 같은 좌표로 넘김 · 도크 상자 같음 · 말풍선·고리가 도크와 겹치지 않음',
          worst <= 0.5 && collisions === 0 && seenSteps.some((s) => s.startsWith('member')) && seenSteps.some((s) => s.startsWith('lead')) && !end.overlay,
          `${seenSteps.join(' ')} · 도크 최대 차이 ${worst.toFixed(2)}px · 겹침 ${collisions}`,
        );
        check(
          'PG-T153 GET이 아닌 요청은 /api/me/tour뿐 · 끝나면 inert·스크롤 잠금이 풀린다',
          other.length === 0 && end.inert === 0 && end.overflow === '',
          `기록 ${recs.join(',')} · 다른 요청 ${other.map((o) => `${o.method} ${o.url}`).join(', ') || '없음'} · ${JSON.stringify(end)}`,
        );
        await ctx.close();
      }

      // 3. 본부 담당자 — 사용자 메뉴 「화면 둘러보기」로 /hq의 본부 장 · 본부장 단추가 없는 사람은 그 단계를 건너뛴다 · Esc
      {
        const ctx = await ctxFor('hqLead', { viewport: { width: 1280, height: 800 } });
        const p = await ctx.newPage();
        const posts = watch(p);
        await p.goto(`${base}/hq`, { waitUntil: 'networkidle' });
        // 카드는 괜찮아요로 닫아 둔다 — 메뉴로 다시 보는 길을 잰다
        const card = await p.waitForSelector('[data-tour-offer]', { timeout: 4000 }).catch(() => null);
        if (card) await p.getByRole('button', { name: '괜찮아요' }).click();
        await p.getByRole('button', { name: /어진솔|hq/ }).first().click().catch(async () => {
          await p.locator('header [aria-haspopup="menu"]').click();
        });
        await p.getByRole('menuitem', { name: '화면 둘러보기' }).click();
        await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 8000 });
        const count = await p.evaluate(() => document.querySelector('[data-tour] [data-dock="count"]')?.textContent);
        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);
        const st = await inertState(p);
        const rec = posts.filter((x) => x.url === '/api/me/tour').map((x) => x.body);
        check(
          'PG-T153 메뉴 「화면 둘러보기」 → 본부 장 · 없는 앵커는 건너뜀 · Esc로 끝 (inert·잠금 풀림, skipped)',
          count === '본부 1/2' && !st.overlay && st.inert === 0 && st.overflow === '' && rec.some((b) => /skipped/.test(b)),
          `${count} · ${JSON.stringify(st)} · ${rec.join(' ')}`,
        );
        await ctx.close();
      }

      // 4. 사용 안내 목차 「화면에서」 → 그 장의 둘러보기 (기록과 상관없이)
      {
        const ctx = await ctxFor('coordinator', { viewport: { width: 1280, height: 900 } });
        const p = await ctx.newPage();
        await p.goto(`${base}/guide`, { waitUntil: 'networkidle' });
        await p.getByRole('link', { name: '총괄 — 실제 화면에서 둘러보기' }).click();
        await p.waitForURL(/\/org/, { timeout: 30_000 });
        const ok = await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 15_000 }).then(() => true, () => false);
        const step = await p.evaluate(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step'));
        const clean = await p.evaluate(() => !location.search.includes('tour='));
        check('PG-T153 사용 안내 「화면에서」 → /org의 총괄 장 (주소의 ?tour는 지운다)', ok && step === 'org:1' && clean, `${step}`);
        await ctx.close();
      }

      // 5. 400×800 — 카드·말풍선·도크가 창 안
      {
        const ctx = await ctxFor('member', { viewport: { width: 400, height: 800 }, isMobile: false });
        const p = await ctx.newPage();
        await p.goto(`${base}/${slugs.ai}`, { waitUntil: 'networkidle' });
        const card = await p.waitForSelector('[data-tour-offer]', { timeout: 4000 }).catch(() => null);
        const cardIn = card ? await card.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }) : false;
        if (shotsDir && card) await p.screenshot({ path: path.join(shotsDir, 'tour-card-member-400.png') });
        await p.getByRole('button', { name: '시작' }).click();
        let allIn = true;
        let worst = 0;
        await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 8000 });
        const box0 = await dockBoxes(p, '[data-tour]', ['prev', 'count', 'next', 'skip']);
        for (let i = 0; i < 6; i++) {
          const step = await p.evaluate(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step') ?? null);
          if (!step || !step.startsWith('member')) break;
          const inside = await p.evaluate(() => {
            const ok = (s) => {
              const e = document.querySelector(`[data-tour] ${s}`);
              if (!e) return true;
              const r = e.getBoundingClientRect();
              return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5;
            };
            return ok('.coach-bubble') && ok('.coach-dock');
          });
          allIn &&= inside;
          if (shotsDir && i === 1) await p.screenshot({ path: path.join(shotsDir, 'tour-step-member-400.png') });
          const b = await dockBoxes(p, '[data-tour]', ['prev', 'count', 'next', 'skip']);
          if (b) worst = Math.max(worst, diffBoxes(box0, b));
          const at = center(b.next);
          await p.mouse.click(at.x, at.y);
          await p.waitForFunction((s) => (document.querySelector('[data-tour]')?.getAttribute('data-tour-step') ?? 'end') !== s, step, { timeout: 8000 }).catch(() => {});
          await p.waitForSelector('[data-tour][data-settled="1"]', { timeout: 8000 }).catch(() => {});
        }
        check('PG-T153 400×800 — 카드·말풍선·도크가 창 안 · 도크 상자 같음', cardIn && allIn && worst <= 0.5, `도크 최대 차이 ${worst.toFixed(2)}px`);
        await ctx.close();
      }
    }

    // ── 검토용 화면 ───────────────────────────────────────────────────────────
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true });
      const ctx = await ctxFor('lead', { viewport: { width: 1920, height: 1080 } });
      const p = await ctx.newPage();
      const shoot = async (hash, file) => {
        await p.evaluate((h) => {
          location.hash = h;
        }, hash);
        await settled(p, '[data-present]', hash).catch(() => {});
        await p.mouse.move(1919, 1079); // 마우스 묶음은 2초 뒤 사라진다
        await p.waitForTimeout(2600);
        await p.screenshot({ path: path.join(shotsDir, file) });
      };
      await p.goto(`${base}/guide/present`, { waitUntil: 'networkidle' });
      await p.screenshot({ path: path.join(shotsDir, 'present-start-1920.png') });
      await p.getByRole('button', { name: '전체 화면 없이 보기' }).click();
      const pick = (id) => deck.present.find((s) => s.id === id)?.key;
      await shoot(deck.present[0].key, 'present-cover-1920.png');
      await shoot('member', 'present-chapter-member-1920.png');
      await shoot('lead', 'present-chapter-lead-1920.png');
      for (const id of ['member-week', 'member-compose', 'member-previous', 'member-submit', 'lead-merge', 'lead-handoff', 'head-notice', 'head-approve', 'hq-approve', 'org-board', 'org-download']) {
        if (pick(id)) await shoot(pick(id), `present-${id}-1920.png`);
      }
      await shoot(pick('outro-summary'), 'present-outro-1920.png');
      // 마우스 묶음이 보이는 한 장
      await p.mouse.move(960, 540);
      await p.waitForTimeout(200);
      await p.screenshot({ path: path.join(shotsDir, 'present-controls-1920.png') });
      await ctx.close();

      const nctx = await ctxFor('lead', { viewport: { width: 1280, height: 800 } });
      const n = await nctx.newPage();
      await n.goto(`${base}/guide/present?view=notes#${pick('lead-merge')}`, { waitUntil: 'networkidle' });
      await settled(n, '[data-present] section[aria-label="지금 장"]').catch(() => {});
      await n.waitForTimeout(800);
      await n.screenshot({ path: path.join(shotsDir, 'presenter-1280x800.png') });
      await nctx.close();

      for (const [role, vp, file, hash] of [
        ['coordinator', { width: 1280, height: 900 }, 'self-1280-coordinator.png', 'lead-2'],
        ['memberPending', { width: 1280, height: 900 }, 'self-1280-member-first.png', ''],
        ['coordinator', { width: 400, height: 860 }, 'self-400-coordinator.png', ''],
      ]) {
        const c = await ctxFor(role, { viewport: vp });
        const q = await c.newPage();
        await q.goto(`${base}/guide${hash ? `#${hash}` : ''}`, { waitUntil: 'networkidle' });
        if (vp.width > 640) await settled(q, 'section[aria-label="안내 단계"]').catch(() => {});
        await q.waitForTimeout(900);
        // 휴대폰 목록은 첫 화면만 — 전체를 찍으면 아래쪽 그림은 lazy라 아직 안 받은 회색 상자로 찍힌다
        await q.screenshot({ path: path.join(shotsDir, file) });
        await c.close();
      }
      // 둘러보기 — 부서원 홈에서 사용자 메뉴로(카드는 위 검사에서 이미 골랐다) · 처음 온 부서장의 카드(「처음이시죠?」 — 낸 적이 없다)
      {
        const c = await ctxFor('memberPending', { viewport: { width: 1280, height: 800 } });
        const q = await c.newPage();
        await q.goto(`${base}/${slugs.ai}`, { waitUntil: 'networkidle' });
        await q.locator('header [aria-haspopup="menu"]').click();
        await q.getByRole('menuitem', { name: '화면 둘러보기' }).click();
        await q.waitForSelector('[data-tour][data-settled="1"]', { timeout: 10_000 }).catch(() => {});
        await q.waitForTimeout(400);
        await q.screenshot({ path: path.join(shotsDir, 'tour-step1-member-home-1280.png') });
        await q.locator('[data-tour] [data-dock="next"]').click();
        await q.waitForFunction(() => document.querySelector('[data-tour]')?.getAttribute('data-tour-step') === 'member:2');
        await q.waitForSelector('[data-tour][data-settled="1"]', { timeout: 10_000 }).catch(() => {});
        await q.waitForTimeout(400);
        await q.screenshot({ path: path.join(shotsDir, 'tour-step2-member-home-1280.png') });
        await c.close();
        const h = await ctxFor('head', { viewport: { width: 1280, height: 800 } });
        const hq = await h.newPage();
        await hq.goto(`${base}/${slugs.ai}/manage`, { waitUntil: 'networkidle' });
        await hq.waitForSelector('[data-tour-offer]', { timeout: 6000 }).catch(() => {});
        await hq.screenshot({ path: path.join(shotsDir, 'tour-card-head-first-1280.png') });
        await h.close();
      }
      const bctx = await ctxFor('coordinator', { viewport: { width: 1920, height: 1080 } });
      const b = await bctx.newPage();
      await b.goto(`${base}/guide#org-3`, { waitUntil: 'networkidle' });
      await b.getByRole('button', { name: '크게 보기' }).click();
      await settled(b, '[role="dialog"][aria-label="크게 보기"]').catch(() => {});
      await b.waitForTimeout(900);
      await b.screenshot({ path: path.join(shotsDir, 'self-big-1920.png') });
      await bctx.close();
      log(`검토용 화면 → ${shotsDir}`);
    }
  } finally {
    await browser.close().catch(() => {});
    app.stop();
  }
  const failed = results.filter((r) => !r.ok);
  if (process.env.GUIDE_CHECK_JSON) fs.writeFileSync(process.env.GUIDE_CHECK_JSON, `${JSON.stringify(results, null, 2)}\n`);
  log(`${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('[guide]', e.stack ?? e.message ?? e);
  process.exit(1);
});
