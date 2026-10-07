'use client';
// CP-101 — 사용 안내의 무대. 발표 모드와 혼자 보기가 **같은 무대**를 쓴다 — 두 곳의 그림이 갈라지지 않게.
//
// 그림 단계: 실제 화면 한 장(정지) + 카메라가 담는 곳 밖을 어둡게 + 누를 곳의 테두리 + 그 자리로 다가가는 카메라(PG-58).
// 움직임은 「어디를 보라」를 말하는 데만 쓴다. 예전 GIF처럼 화면이 저 혼자 흘러가면 보는 사람이 속도를 못 정한다.
//
// 넘길 때 두 판(이전·새)을 겹쳐 둔다:
//   같은 화면의 다음 단계  둘 다 새 카메라로 **같이** 옮겨 가며 겹쳐 바뀐다(320ms) — 화면이 그대로인 채 카메라만 움직이는 것처럼
//   다른 화면            새 판이 「어느 화면인가」가 보이는 카메라로 나타난 뒤(200ms) 다가간다
//   여러 장 건너뛰기      겹치지 않고 바로 바꾼다 — 목차·번호로 뛰는 중간 화면은 볼 이유가 없고, 겹치면 두 화면이 한 장에 보인다
// 새 그림이 다 받아진 뒤에 바꾼다. 빈 무대가 한 번이라도 비치면 프로젝터에서는 번쩍임이 된다.
// 누를 곳의 테두리는 카메라가 도착한 뒤에 나타나고, 떠나는 판의 테두리는 바로 사라진다(globals.css .guide-spot).
//
// 글자 슬라이드(표지·왜·장 제목·알림·정리·주소)도 여기서 그린다. 글자 크기는 무대 폭에 비례(cqw) —
// 1080p 프로젝터든 발표자 창의 작은 그림이든 같은 비율로 보인다. 왼쪽 여백은 어디서나 5cqw(1920px에서 96px) —
// 프로젝터가 화면 가장자리를 5%쯤 먹어도(오버스캔) 글자가 잘리지 않는 폭이다.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { roleChapters, type Slide } from '@/lib/guide/deck';
import { APP_HEADER, cameraFor, cropFor, fitCamera, overviewCamera, union, type Camera, type Rect, type Size } from '@/lib/guide/camera';
import { MANIFEST, fillWeek, shotOf } from '@/lib/guide/manifest';

export type StageTheme = 'dark' | 'light';

/** 판이 나타나는 방식 — 겹쳐 바뀌는 시간이 다르다 (globals.css `.guide-layer[data-swap]`) */
type Swap = 'same' | 'screen' | 'cut' | 'none';

interface Layer {
  /** 판 열쇠 — 단계마다 새 판 */
  id: number;
  slide: Slide;
  /** 정해 둔 카메라 (나타나기 전의 시작 자리). null이면 `aim` 단계의 카메라를 따라간다 */
  cam: Camera | null;
  /** 이 판이 겨누는 단계 — 같은 화면을 넘길 때 밑판은 새 단계를 겨눈다 */
  aim: Slide | null;
  opacity: number;
  /** 누를 곳의 테두리가 켜졌나 — 떠나는 판은 끄고, 새 판은 카메라가 움직이기 시작할 때 켠다(CSS가 도착 뒤로 미룬다) */
  ring: boolean;
  swap: Swap;
}

const IMAGE: Size = { w: MANIFEST.viewport.width, h: MANIFEST.viewport.height };
const CAMERA_OPTS = { captureScale: MANIFEST.scale, header: APP_HEADER };
/** 어둡게 하지 않고 남기는 곳 — 카메라 사각형 둘레 8px (그림 좌표) */
const FRAME_PAD = 8;

/** 이 단계의 카메라 — 카메라 사각형과 스포트라이트를 둘 다 담는다 */
function targetCamera(slide: Slide, view: Size, zoom: boolean): Camera | null {
  const step = slide.step;
  if (!step || step.kind !== 'shot') return null;
  const shot = shotOf(step.id);
  if (!shot) return fitCamera(view, IMAGE);
  return zoom ? cameraFor(view, IMAGE, union(shot.frame, shot.focus), CAMERA_OPTS) : fitCamera(view, IMAGE);
}

/** 밝게 남길 곳 — 카메라 사각형 + 스포트라이트, 둘레 여백, 그림 안으로 */
function litRect(frame: Rect, focus: Rect, image: Size = IMAGE): Rect {
  const u = union(frame, focus);
  const x = Math.max(0, u.x - FRAME_PAD);
  const y = Math.max(0, u.y - FRAME_PAD);
  return { x, y, w: Math.min(image.w, u.x + u.w + FRAME_PAD) - x, h: Math.min(image.h, u.y + u.h + FRAME_PAD) - y };
}

const sameScreen = (a: Slide, b: Slide) =>
  a.step?.kind === 'shot' && b.step?.kind === 'shot' && !!a.step.screen && a.step.screen === b.step.screen;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function GuideStage({
  slide,
  index,
  theme,
  zoom = true,
  still = false,
  className = '',
}: {
  slide: Slide;
  /** 부모 목록에서의 번호 — 둘 이상 건너뛰면 겹치지 않고 바로 바꾼다 */
  index?: number;
  theme: StageTheme;
  /** false면 줌 없이 전체 그림 */
  zoom?: boolean;
  /** 움직임 없이 바로 그 자리 (발표자 창의 다음 장 그림) */
  still?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  const seq = useRef(0);
  const lastIndex = useRef(index);
  const revealed = useRef(new Set<number>());
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, slide, cam: null, aim: slide, opacity: 1, ring: true, swap: 'none' }]);

  // 창 크기 — 발표 무대는 글자 슬라이드와 그림 슬라이드 사이에 창 높이가 바뀐다.
  // 카메라는 상태로 들고 있지 않고 그릴 때마다 창 크기에서 계산한다 — 창이 바뀌면 저절로 따라간다
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const camOf = (l: Layer): Camera | null => l.cam ?? (l.aim ? targetCamera(l.aim, view, zoom) : null);

  // 단계가 바뀌면 새 판을 겹친다
  const top = layers[layers.length - 1];
  useLayoutEffect(() => {
    if (top.slide.key === slide.key) return;
    const id = ++seq.current;
    const jump = index !== undefined && lastIndex.current !== undefined && Math.abs(index - lastIndex.current) > 1;
    lastIndex.current = index;
    if (still || reducedMotion()) {
      setLayers([{ id, slide, cam: null, aim: slide, opacity: 1, ring: true, swap: 'none' }]);
      return;
    }
    setLayers((ls) => {
      // 밑판은 **보이고 있는** 판이다. 빠르게 연달아 넘기면 맨 위가 아직 나타나기 전(투명)일 수 있다 —
      // 그걸 밑판으로 삼으면 두 판이 다 투명해 무대가 한 번 비어 보인다
      const base = [...ls].reverse().find((l) => l.opacity === 1) ?? ls[ls.length - 1];
      if (jump) {
        // 건너뛰기 — 새 판을 제자리에 투명하게 두고, 그림이 준비되면 한 번에 바꾼다(reveal)
        return [{ ...base, ring: false }, { id, slide, cam: null, aim: slide, opacity: 0, ring: false, swap: 'cut' }];
      }
      const same = sameScreen(base.slide, slide);
      const here = base.cam ?? (base.aim ? targetCamera(base.aim, view, zoom) : null);
      const start = same && here ? here : overviewCamera(view, IMAGE);
      // 같은 화면이면 밑판도 새 단계를 겨눈다 — 겹쳐 바뀌는 동안 두 그림이 같이 움직여 어긋나지 않는다
      return [
        { ...base, cam: null, aim: same ? slide : base.aim, ring: false },
        { id, slide, cam: start, aim: null, opacity: 0, ring: false, swap: same ? 'same' : 'screen' },
      ];
    });
  }, [slide, index, still, top, view, zoom]);

  /** 새 판이 준비되면(그림을 다 받았으면) 다가가고, 이전 판은 걷어 낸다 */
  const reveal = useCallback((id: number) => {
    if (revealed.current.has(id)) return;
    revealed.current.add(id);
    // 두 번 그린 뒤에 바꿔야 시작 카메라가 화면에 한 번 찍히고 거기서부터 움직인다
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setLayers((ls) => {
          const me = ls.find((l) => l.id === id);
          if (!me) return ls;
          const shown = { ...me, cam: null, aim: me.slide, opacity: 1, ring: true };
          return me.swap === 'cut' ? [shown] : ls.map((l) => (l.id === id ? shown : l));
        });
        window.setTimeout(() => setLayers((ls) => (ls[ls.length - 1]?.id === id ? ls.filter((l) => l.id === id) : ls)), 650);
      }),
    );
  }, []);

  const dark = theme === 'dark';
  return (
    <div
      ref={boxRef}
      className={`@container relative overflow-hidden ${dark ? 'bg-stage text-canvas' : 'bg-surface-strong text-ink'} ${className}`}
      style={
        {
          '--frame-dim': dark ? 0.62 : 0.45,
          '--guide-ground': dark ? 'var(--color-stage)' : 'var(--color-surface-strong)',
        } as React.CSSProperties
      }
    >
      {view.w > 0 &&
        layers.map((l) => (
          <LayerView key={l.id} layer={l} cam={camOf(l)} view={view} theme={theme} pending={l.opacity === 0} onReady={reveal} />
        ))}
    </div>
  );
}

function LayerView({
  layer,
  cam,
  view,
  theme,
  pending,
  onReady,
}: {
  layer: Layer;
  cam: Camera | null;
  view: Size;
  theme: StageTheme;
  /** 아직 나타나기 전 — 준비되면 `onReady(id)` */
  pending: boolean;
  onReady: (id: number) => void;
}) {
  const { slide, opacity, id, ring, swap } = layer;
  const step = slide.step;
  const shot = step?.kind === 'shot' ? shotOf(step.id) : null;
  const isShot = !!shot;

  // 글자 슬라이드는 받을 것이 없다 — 바로 나타난다
  useEffect(() => {
    if (pending && !isShot) onReady(id);
  }, [pending, isShot, onReady, id]);

  if (shot && cam) {
    const lit = litRect(shot.frame, shot.focus);
    // 카메라가 그림 아래를 비우면(BOTTOM_SLACK) 그림 끝을 바탕색으로 24px 흐린다 — 잘린 끝이 선으로 보이지 않게
    const overscan = cam.y + IMAGE.h * cam.scale < view.h - 0.5;
    const fade = 24 / cam.scale;
    return (
      <div
        className="guide-layer"
        data-swap={swap}
        style={
          {
            width: IMAGE.w,
            height: IMAGE.h,
            opacity,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
            '--cam-scale': cam.scale,
          } as React.CSSProperties
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 정적 webp, 크기는 판이 정한다 */}
        <img
          src={shot.src}
          alt={step?.caption ?? ''}
          width={IMAGE.w}
          height={IMAGE.h}
          draggable={false}
          className="block h-full w-full select-none"
          ref={(img) => {
            // 캐시에 있던 그림은 onLoad가 붙기 전에 끝나 있을 수 있다
            if (pending && img?.complete && img.naturalWidth > 0) onReady(id);
          }}
          onLoad={() => pending && onReady(id)}
          onError={() => pending && onReady(id)}
        />
        <span aria-hidden className="guide-frame" style={{ left: lit.x, top: lit.y, width: lit.w, height: lit.h }} />
        <span
          aria-hidden
          className="guide-spot"
          data-on={ring}
          style={{ left: shot.focus.x, top: shot.focus.y, width: shot.focus.w, height: shot.focus.h }}
        />
        {overscan && <span aria-hidden className="guide-fade-bottom" style={{ top: IMAGE.h - fade, height: fade }} />}
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 motion-reduce:transition-none ${swap === 'cut' ? '' : 'transition-opacity duration-200 ease-out'} ${
        theme === 'light' ? 'bg-surface-soft' : 'bg-stage'
      }`}
      style={{ opacity }}
    >
      <TextSlide slide={slide} theme={theme} />
    </div>
  );
}

/**
 * 움직이지 않는 한 장 — 좁은 화면과 인쇄용(PG-61). **자바스크립트로 재지 않는다**: 인쇄는 화면을 다시 배치한 뒤
 * 곧바로 찍으므로, 크기를 재서 그리는 무대는 인쇄물에서 빈 상자가 된다. 그림·스포트라이트 모두 비율(%)로 놓는다.
 *
 * `crop`이면 카메라 사각형 둘레만 4:3으로 잘라 보인다(휴대폰) — 1600px 그림 전체를 360px 폭에 그리면 버튼 글자가
 * 3–4px이다. 그림 단계가 아니면 아무것도 그리지 않는다 — 글자 단계는 부르는 쪽이 글자로 그린다.
 */
export function StaticSlide({ slide, crop = false }: { slide: Slide; crop?: boolean }) {
  const step = slide.step;
  const shot = step?.kind === 'shot' ? shotOf(step.id) : null;
  if (!shot) return null;
  const box: Rect = crop ? cropFor(IMAGE, union(shot.frame, shot.focus)) : { x: 0, y: 0, w: IMAGE.w, h: IMAGE.h };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const place = (r: Rect) => ({
    left: pct(r.x - box.x, box.w),
    top: pct(r.y - box.y, box.h),
    width: pct(r.w, box.w),
    height: pct(r.h, box.h),
  });
  return (
    <div
      className="guide-static relative w-full overflow-hidden bg-surface-strong [print-color-adjust:exact]"
      style={{ aspectRatio: `${box.w} / ${box.h}`, '--frame-dim': 0.45 } as React.CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 정적 webp */}
      <img
        src={shot.src}
        alt={step?.caption ?? ''}
        loading="lazy"
        className="absolute block max-w-none"
        style={{ width: pct(IMAGE.w, box.w), left: pct(-box.x, box.w), top: pct(-box.y, box.h) }}
      />
      <span aria-hidden className="guide-frame" style={place(litRect(shot.frame, shot.focus))} />
      <span aria-hidden className="guide-spot" data-on style={place(shot.focus)} />
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 글자 슬라이드 — 무대 폭 기준 크기(cqw). 1920px 무대에서 1cqw = 19.2px */
function TextSlide({ slide, theme }: { slide: Slide; theme: StageTheme }) {
  const dark = theme === 'dark';
  // 무대 위 흐린 글자는 굵기 500 — 프로젝터에서 가는 글자는 바탕에 번져 사라진다
  const muted = dark ? 'text-stage-muted font-medium' : 'text-muted';
  const accent = dark ? 'text-brand-tint' : 'text-brand';
  const panel = dark ? 'bg-stage-soft' : 'bg-canvas border border-hairline';
  const line = dark ? 'border-stage-line' : 'border-hairline';
  const { chapter, step } = slide;

  // 장 제목 — 「01 / 05」 · 제목 · 한 줄 + 맨 아래 「지금 여기」 줄(다섯 역할 중 어디인가)
  if (!step) {
    const roles = roleChapters();
    const at = roles.findIndex((c) => c.id === chapter.id);
    return (
      <div className="relative h-full">
        <div className="absolute top-[30%] right-[5cqw] left-[5cqw]">
          <p className={`text-[1.8cqw] font-semibold tabular-nums ${accent}`}>
            {pad2(at + 1)} / {pad2(roles.length)}
          </p>
          <h2 className="mt-[0.8cqw] text-[6cqw] leading-[1.1] font-bold tracking-[-0.02em]">{chapter.title}</h2>
          {chapter.lede && <p className={`mt-[1.6cqw] text-[2.6cqw] leading-snug ${muted}`}>{chapter.lede}</p>}
        </div>
        <ol aria-label="한 주의 흐름" className="absolute right-[5cqw] bottom-[7cqw] left-[5cqw] flex gap-[0.8cqw]">
          {roles.map((c, i) => (
            <li
              key={c.id}
              aria-current={i === at ? 'step' : undefined}
              className={`flex h-[5.2cqw] min-w-0 flex-1 items-center justify-center rounded-[1cqw] text-[1.8cqw] ${
                i < at
                  ? dark
                    ? 'bg-stage-soft text-stage-muted'
                    : 'bg-surface-soft text-muted'
                  : i === at
                    ? dark
                      ? 'bg-stage-soft font-semibold text-canvas'
                      : 'bg-canvas font-semibold text-ink'
                    : `border ${line} ${dark ? 'text-stage-muted/60' : 'text-muted/60'}`
              }`}
              style={i === at ? { outline: '0.25cqw solid var(--color-brand-tint)' } : undefined}
            >
              {c.title}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (step.kind === 'cover') {
    return (
      <div className="relative flex h-full flex-col items-center justify-center px-[5cqw] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG (public/brand/README.md — 최대 64px 높이) */}
        <img
          src={dark ? '/brand/tincase-lockup-inverse.svg' : '/brand/tincase-lockup.svg'}
          alt="Tincase"
          className="h-[3.4cqw] w-auto"
        />
        <h2 className="mt-[3.4cqw] text-[4.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.caption}</h2>
        <p className={`mt-[1.6cqw] text-[2cqw] ${muted}`}>{step.body[0]}</p>
        <p className={`absolute right-0 bottom-[4cqw] left-0 text-[1.3cqw] ${muted}`}>{step.body[1]}</p>
      </div>
    );
  }

  if (step.kind === 'points') {
    return (
      <div className="flex h-full flex-col justify-center px-[5cqw]">
        <h2 className="text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.caption}</h2>
        <ul className="mt-[3cqw] space-y-[1.4cqw]">
          {step.points.map((p) => (
            <li key={p} className="flex items-baseline gap-[1.4cqw] text-[2.4cqw] leading-snug">
              <span aria-hidden className={`relative -top-[0.3cqw] inline-block h-[0.8cqw] w-[0.8cqw] shrink-0 rounded-full bg-current ${accent}`} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (step.kind === 'flow') {
    // 다섯 칸에 강조색을 두지 않는다 — 장 제목의 「지금 여기」 줄에서 초록 테두리가 「지금」을 뜻한다
    return (
      <div className="flex h-full flex-col justify-center px-[4cqw]">
        <h2 className="text-center text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.caption}</h2>
        <ol className="mt-[4cqw] flex items-stretch justify-center gap-[0.6cqw]">
          {step.flow.map((f, i) => (
            <li key={f.who} className="flex items-stretch gap-[0.6cqw]">
              {i > 0 && (
                <span aria-hidden className={`self-center text-[1.6cqw] ${muted}`}>
                  →
                </span>
              )}
              <span className={`flex w-[15.5cqw] flex-col items-center rounded-[1.2cqw] px-[1cqw] py-[1.8cqw] text-center ${panel}`}>
                <span className="text-[2.6cqw] leading-tight font-semibold whitespace-nowrap">{f.who}</span>
                <span className={`mt-[0.6cqw] text-[1.8cqw] leading-snug ${muted}`}>{f.what}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className={`mt-[4cqw] text-center text-[2cqw] ${muted}`}>{step.body[0]}</p>
      </div>
    );
  }

  if (step.kind === 'buttons') {
    // 역할 | 버튼 — 버튼은 화면과 같은 테두리 알약(대괄호 없이). 「[작성하기] → [제출]」을 글자로 쓰면 버튼으로 안 읽힌다
    return (
      <div className="flex h-full flex-col justify-center px-[5cqw]">
        <h2 className="text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.caption}</h2>
        <dl className="mt-[3cqw] grid grid-cols-[12cqw_minmax(0,1fr)] items-center gap-y-[1.6cqw]">
          {step.rows.map((r) => (
            <Fragment key={r.who}>
              <dt className={`text-[2.2cqw] font-semibold whitespace-nowrap ${dark ? 'text-stage-muted' : 'text-muted'}`}>{r.who}</dt>
              <dd className="flex flex-wrap items-center gap-[1cqw]">
                {r.buttons.map((b, i) => (
                  <Fragment key={b}>
                    {i > 0 && (
                      <span aria-hidden={!r.or} className={`text-[1.6cqw] ${muted}`}>
                        {r.or ? '또는' : '→'}
                      </span>
                    )}
                    <span className={`rounded-[0.7cqw] border-[0.12cqw] ${line} px-[1cqw] py-[0.35cqw] text-[2.1cqw] leading-snug`}>{b}</span>
                  </Fragment>
                ))}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
    );
  }

  if (step.kind === 'message') {
    return (
      <div className="flex h-full flex-col justify-center px-[5cqw]">
        <h2 className="text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.caption}</h2>
        {/* 사내 메신저 알림함의 한 건 — 실제 문구(NT-44)에서 이름·사번을 뺀 모양 */}
        <div className={`mt-[3cqw] max-w-[66cqw] rounded-[1.4cqw] px-[2.6cqw] py-[2.2cqw] ${panel}`}>
          <p className="flex items-center gap-[1cqw] text-[1.5cqw]">
            {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG */}
            <img
              src={dark ? '/brand/tincase-icon-sm-tint.svg' : '/brand/tincase-icon-sm.svg'}
              alt=""
              className="h-[2cqw] w-[2cqw]"
            />
            <span className={muted}>사내 메신저 · {step.message.from}</span>
          </p>
          <p className="mt-[1.2cqw] text-[2.4cqw] leading-snug font-semibold">{fillWeek(step.message.subject)}</p>
          {step.message.lines.map((l) => (
            <p key={l} className={`mt-[0.6cqw] text-[1.9cqw] leading-snug ${muted}`}>
              {fillWeek(l)}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (step.kind === 'address') return <AddressSlide caption={step.caption} line={step.body[0]} muted={muted} accent={accent} />;

  return null;
}

/**
 * PG-59 — 주소는 실행할 때 읽는다. 코드에 적으면 공개 저장소에 내부 주소가 남는다.
 * `https://`는 빼고 호스트만 — 강당에서 받아 적을 글자가 줄고, 브라우저가 알아서 붙인다
 */
function AddressSlide({ caption, line, muted, accent }: { caption: string; line: string; muted: string; accent: string }) {
  // 서버에서는 빈 칸, 브라우저에서는 지금 연 주소 — 바뀌지 않는 값이라 구독할 것이 없다
  const host = useSyncExternalStore(
    () => () => {},
    () => window.location.host,
    () => '',
  );
  return (
    <div className="flex h-full flex-col items-center justify-center px-[5cqw] text-center">
      <h2 className={`text-[2.6cqw] font-semibold ${muted}`}>{caption}</h2>
      <p className="mt-[2.4cqw] text-[5cqw] leading-tight font-bold tracking-[-0.01em] break-all">
        {host}
        <span className={accent}>/guide</span>
      </p>
      <p className={`mt-[2.4cqw] text-[2cqw] ${muted}`}>{line}</p>
    </div>
  );
}
