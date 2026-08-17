/**
 * 사용 안내용 GIF 녹화 — Playwright로 화면을 몰아가며 프레임을 찍는다.
 *
 *   node scripts/guide-record.cjs [클립이름...]
 *
 * 왜 `recordVideo`(WebM)가 아니라 프레임을 직접 찍는가:
 *
 * 1. **커서가 안 나온다.** Playwright의 영상에는 마우스 포인터가 렌더되지 않는다.
 *    포인터 없이 화면만 바뀌면 안내 자료로서 무슨 일이 일어났는지 알 수 없다.
 *    그래서 커서를 DOM으로 직접 그려 넣는다 — 어차피 그릴 거면 프레임 제어가 낫다.
 * 2. **타이밍을 손으로 잡을 수 있다.** "여기서 1.2초 머문다"가 안내에서는 중요한데
 *    영상 → GIF 변환에는 그 개념이 없다. 프레임별 지속시간을 직접 준다.
 * 3. ffmpeg가 없어도 된다. 프레임 → GIF 조립은 Pillow가 한다 (guide-gif.py).
 *
 * 데모 DB로 띄운 서버를 대상으로만 돌린다 — 실명이 든 화면을 찍어 저장소에 넣지 않는다.
 */
const { chromium } = require('/home/mhchoi/kei-dev-0703/web/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.GUIDE_BASE ?? 'http://127.0.0.1:3000';
const SLUG = process.env.GUIDE_SLUG ?? 'Demo_Division';
const OUT = process.env.GUIDE_OUT ?? '/tmp/guide-frames';
const VIEW = { width: 1180, height: 760 };

/** 커서 그리기 + 클릭 파문. 화면 안의 요소이므로 스크린샷에 그대로 찍힌다 */
const CURSOR_JS = `
(() => {
  if (document.getElementById('__cur')) return;
  const s = document.createElement('style');
  s.textContent = \`
    nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}
    #__cur{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;
      margin:-2px 0 0 -2px;transition:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
    #__ring{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;
      border-radius:50%;border:2.5px solid #0a3711;opacity:0;transform:scale(.4)}
    #__ring.go{animation:__r .5s ease-out}
    @keyframes __r{0%{opacity:.85;transform:scale(.4)}100%{opacity:0;transform:scale(1.5)}}\`;
  document.head.appendChild(s);
  const c = document.createElement('div');
  c.id = '__cur';
  c.innerHTML = '<svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M2 1.5 L2 17 L6.2 13.2 L8.9 19.4 L11.9 18.1 L9.2 12 L14.6 11.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  const r = document.createElement('div');
  r.id = '__ring';
  document.body.appendChild(r);
  window.__moveCur = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
                                 r.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  window.__ping = (x, y) => { r.style.left = x + 'px'; r.style.top = y + 'px';
    r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); };
})();`;

function mkClip(name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return { dir, n: 0, timings: [] };
}

/** 한 컷 = 프레임 1장 + 그 장이 화면에 머무는 시간(ms) */
async function shot(page, clip, holdMs = 80) {
  const f = path.join(clip.dir, String(clip.n++).padStart(4, '0') + '.png');
  await page.screenshot({ path: f });
  clip.timings.push(holdMs);
}

/** 자막 — 안내 자료는 "지금 뭘 하는 중인지"가 보여야 한다 */
async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText =
        'position:fixed;z-index:2147483645;left:50%;bottom:22px;transform:translateX(-50%);' +
        'background:rgba(17,17,17,.9);color:#fff;font:600 15px/1.4 Pretendard,sans-serif;' +
        'padding:9px 18px;border-radius:999px;pointer-events:none;white-space:nowrap';
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.display = t ? 'block' : 'none';
  }, text);
}

/** 대상이 화면 밖이면 스크롤해서 보여준다 — 프레임에도 남으므로 안내가 자연스러워진다 */
async function scrollTo(page, selector, clip, steps = 6) {
  const el = page.locator(selector).first();
  const need = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const target = r.top + window.scrollY - (window.innerHeight - r.height) / 2;
    return Math.round(target - window.scrollY);
  });
  if (Math.abs(need) < 40) return;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), Math.round(need / steps));
    await shot(page, clip, 60);
  }
  await page.waitForTimeout(150);
}

/** 사람처럼 움직인다 — 순간이동하면 어디서 어디로 갔는지 안 보인다 */
async function moveTo(page, target, clip, steps = 9) {
  const box = typeof target === 'string' ? await page.locator(target).first().boundingBox() : target;
  if (!box) throw new Error('대상을 찾지 못함: ' + target);
  const to = box.width ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : box;
  const from = clip.pos ?? { x: VIEW.width / 2, y: VIEW.height - 40 };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = 1 - Math.pow(1 - t, 3); // ease-out — 끝에서 감속
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e;
    await page.evaluate(([x, y]) => window.__moveCur?.(x, y), [x, y]);
    await page.mouse.move(x, y);
    await shot(page, clip, 55);
  }
  clip.pos = to;
  return to;
}

async function clickAt(page, clip, { settle = 700, holdBefore = 420 } = {}) {
  const { x, y } = clip.pos;
  await shot(page, clip, holdBefore); // 누르기 직전에 잠깐 멈춘다 — 어디를 누르는지 읽을 시간
  await page.evaluate(([x, y]) => window.__ping?.(x, y), [x, y]);
  await shot(page, clip, 90);
  await page.mouse.click(x, y);
  await page.waitForTimeout(settle);
  await page.evaluate(CURSOR_JS); // 화면 전환으로 커서가 날아갔으면 다시 그린다
  await page.evaluate(([x, y]) => window.__moveCur?.(x, y), [x, y]);
}

/** 결과를 보여주는 정지 컷 */
async function hold(page, clip, ms = 1300) {
  await shot(page, clip, ms);
}

// ── 클립 정의 ────────────────────────────────────────────────
const CLIPS = {
  /** ① 파일로 제출 */
  async submit(page, clip) {
    await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'networkidle' });
    await page.evaluate(CURSOR_JS);
    await caption(page, '① 빈 양식을 받아 작성한 뒤 올립니다');
    await hold(page, clip, 1200);

    await moveTo(page, 'text=양식 다운로드', clip);
    await clickAt(page, clip, { settle: 900 });
    await caption(page, '파일명에 이번 주차가 자동으로 들어갑니다');
    await hold(page, clip, 1400);

    await caption(page, '작성한 hwp 파일을 여기에 끌어다 놓으면 제출됩니다');
    await moveTo(page, 'text=클릭해서 선택', clip);
    await hold(page, clip, 1600);
  },

  /** ② 웹에서 작성 — 한글 표 붙여넣기 */
  async compose(page, clip) {
    await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'networkidle' });
    await page.evaluate(CURSOR_JS);
    await caption(page, '② 한글 없이 웹에서 바로 작성할 수도 있습니다');
    await hold(page, clip, 1200);

    await moveTo(page, 'button:has-text("웹에서 작성")', clip);
    await clickAt(page, clip, { settle: 600 });
    const cta = page.getByRole('button', { name: /웹에서 (다시 )?작성/ }).last();
    await moveTo(page, await cta.boundingBox(), clip);
    await clickAt(page, clip, { settle: 1000 });
    await caption(page, '한글에서 표를 복사해 첫 칸에 붙여넣으면 자동으로 채워집니다');
    await hold(page, clip, 1200);

    const first = 'input[placeholder*="붙여넣으세요"]';
    await moveTo(page, first, clip);
    await clickAt(page, clip, { settle: 250 });
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData(
        'text/html',
        '<table>' +
          '<tr><td>1-1</td><td>주간 회의 자료 준비</td><td>8/18</td><td>중회의실</td><td>김가온</td></tr>' +
          '<tr><td>1-2</td><td>홍보 콘텐츠 초안 검토</td><td></td><td>온라인</td><td>한서린</td></tr>' +
          '<tr><td>1-3</td><td>시스템 점검 결과 정리</td><td>8/19</td><td>-</td><td>유단비</td></tr>' +
          '</table>',
      );
      dt.setData('text/plain', 'x');
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(300);
    await caption(page, '표 3줄이 한 번에 들어왔습니다');
    await hold(page, clip, 1800);
  },

  /** ③ 잘못 낸 것 되돌리기 */
  async cancel(page, clip) {
    await page.goto(`${BASE}/${SLUG}`, { waitUntil: 'networkidle' });
    await page.evaluate(CURSOR_JS);
    await caption(page, '③ 잘못 냈다면 마감 전까지 취소할 수 있습니다');
    await hold(page, clip, 1300);

    page.once('dialog', (d) => d.accept());
    await moveTo(page, 'button:has-text("제출 취소")', clip);
    await clickAt(page, clip, { settle: 1800 });
    await caption(page, '미제출 상태로 돌아갑니다 — 다시 올리면 됩니다');
    await hold(page, clip, 1800);
  },

  /** ④ 담당자 — 현황 보고 병합하기 */
  async merge(page, clip) {
    await page.goto(`${BASE}/${SLUG}/manage`, { waitUntil: 'networkidle' });
    await page.evaluate(CURSOR_JS);
    await caption(page, '④ 담당자 화면 — 누가 냈는지 한눈에 보입니다');
    await hold(page, clip, 1700);

    // 첫 행이 미제출이면 '열기'가 없다. 버튼이 있는 첫 행을 고른다
    await moveTo(page, 'button:has-text("열기")', clip);
    await clickAt(page, clip, { settle: 1700 });
    await caption(page, '파일을 받지 않고 내용을 바로 확인합니다');
    await hold(page, clip, 2000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.evaluate(CURSOR_JS);

    await caption(page, '아래로 내리면 병합 영역이 있습니다');
    await scrollTo(page, 'button:has-text("병합")', clip);
    await caption(page, '[지금 병합]을 누르면 모인 문서가 하나로 합쳐집니다');
    await moveTo(page, 'button:has-text("병합")', clip);
    await clickAt(page, clip, { settle: 900 });

    // 병합은 수십 초 걸린다. 기다리는 동안 몇 컷만 남기고 **끝나면** 결과를 보여준다
    await caption(page, '중복은 모델이 판단해 정리합니다 · 잠시 기다립니다');
    const deadline = Date.now() + 90_000;
    let done = false;
    while (Date.now() < deadline) {
      const body = await page.locator('body').innerText();
      if (body.includes('병합본 준비됨')) { done = true; break; }
      await hold(page, clip, 700);
      await page.waitForTimeout(2500);
    }
    await page.evaluate(CURSOR_JS);
    await caption(page, done ? '완성된 병합본을 내려받아 그대로 제출하면 끝입니다'
                            : '병합이 끝나면 여기에서 내려받습니다');
    await hold(page, clip, 2400);
  },
};

(async () => {
  const want = process.argv.slice(2);
  // 순서가 곧 상태다 — cancel이 제출을 지워야 submit·compose가 '미제출' 화면으로 시작한다
  const ORDER = ['cancel', 'submit', 'compose', 'merge'];
  const names = want.length ? want : ORDER;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });

  fs.mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    if (!CLIPS[name]) {
      console.error(`  ? 없는 클립: ${name}`);
      continue;
    }
    const clip = mkClip(name);
    try {
      await CLIPS[name](page, clip);
    } catch (e) {
      console.error(`  ✗ ${name} — ${e.message}`);
      await browser.close();
      process.exit(1);
    }
    fs.writeFileSync(path.join(clip.dir, 'timings.json'), JSON.stringify(clip.timings));
    const total = clip.timings.reduce((a, b) => a + b, 0);
    console.log(`  ✓ ${name.padEnd(9)} ${String(clip.n).padStart(3)}프레임 · ${(total / 1000).toFixed(1)}초`);
  }
  await browser.close();
})();
