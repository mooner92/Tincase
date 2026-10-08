'use client';
// CP-101 — 사용 안내의 무대. 발표 모드와 혼자 보기가 **같은 무대**를 쓴다 — 두 곳의 그림이 갈라지지 않게.
//
// 2026-10-08 — **게임 튜토리얼식 코치 마크**로 바꿨다. 사용자: 「거창한 설명보다, 게임처럼 누를 버튼만 빼고 검은 필터를
// 씌우고 옆에 팝업처럼 『인벤토리: 습득한 아이템은 여기서 확인할 수 있어요』」. 예전 판(위에 검은 제목 띠 + 한 문장,
// 초록 테두리, 크게 다가가는 카메라)은 「발표 자료」처럼 읽혔다. 이제 그림 단계 하나는:
//   실제 화면 한 장(정지) → 누를 곳만 둥글게 뚫고 나머지는 검정 그늘(발표 78% · 혼자 보기 70%) → 구멍 둘레에 퍼지는 흰 고리 →
//   버튼 모서리를 세 번 두드리고 멈추는 손 → 구멍 옆 말풍선 「제출: 다 적었으면 여기를 눌러요」 + 「버튼을 눌러 계속」 [다음]
// 말풍선 자리·카메라·손은 순수 함수 `coachPlan`(src/lib/guide/coach.ts)이 정한다 — 테스트가 모든 단계를 잰다(PG-T89).
//
// 누르기(PG-T90): 구멍을 누르면 **눌린 모양**(구멍이 살짝 들어가고 누른 자리에 흰 물결, 160ms)을 보인 뒤 다음 단계
// (= 그 버튼을 누른 뒤의 화면 — 흉내일 뿐 실제로는 아무것도 안 바뀐다), 말풍선의 [다음]은 바로 다음, 어두운 곳을 누르면
// 넘기지 않고 고리·손을 다시 움직인다(`hint`가 바뀌면 처음부터). 프레젠터·키로 넘길 때는 부모가 `press`를 올려 같은 눌린
// 모양을 200ms 보인 뒤 넘긴다 — 눌린 모양 없이 화면이 바뀌면 「버튼을 눌러서 이렇게 됐다」가 안 보인다(2026-10-08 검토).
// 무엇을 할지는 부모가 정한다(`onClick` — 발표는 리듀서 `deckNav`, 혼자 보기는 `stageClick`). `onClick`이 없으면
// (발표자 창의 다음 장 그림) 누를 것을 그리지 않는다.
//
// 넘길 때 두 판(이전·새)을 겹쳐 둔다:
//   같은 화면의 다음 단계  둘 다 새 카메라로 **같이** 옮겨 가며 겹쳐 바뀐다(320ms) — 구멍이 다음 버튼으로 미끄러지는 것처럼
//   다른 화면            새 판이 「어느 화면인가」가 보이는 카메라로 나타난 뒤(200ms) 다가간다
//   여러 장 건너뛰기      겹치지 않고 바로 바꾼다 — 목차·번호로 뛰는 중간 화면은 볼 이유가 없고, 겹치면 두 화면이 한 장에 보인다
// 새 그림이 다 받아진 뒤에 바꾼다. 빈 무대가 한 번이라도 비치면 프로젝터에서는 번쩍임이 된다.
// 고리·손·말풍선은 카메라가 도착한 뒤에 나타난다(globals.css .coach-over) — 움직이는 동안 같이 미끄러지면 눈이 그것을 쫓는다.
//
// 글자 슬라이드(표지·왜·장 카드·알림·정리·주소)도 여기서 그린다. 글자 크기는 무대 폭에 비례(cqw) —
// 1080p 프로젝터든 발표자 창의 작은 그림이든 같은 비율로 보인다. 설명은 줄였다: 큰 줄 하나 + 한 줄.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { chapterHeadline, roleChapters, type GuideChapter, type GuideStep, type Slide } from '@/lib/guide/deck';
import { APP_HEADER, cropAround, fitCamera, overviewCamera, union, type Camera, type Rect, type Size } from '@/lib/guide/camera';
import {
  coachLayout,
  coachPlan,
  estimateBubble,
  footOf,
  HAND,
  HOLE_PAD,
  labelOwnLine,
  NEXT_LABEL,
  pillRect,
  type CoachLayout,
  type CoachPlan,
  type CoachTarget,
  type HandBox,
} from '@/lib/guide/coach';
import { clickPressMs, KEY_PRESS_MS, type StageTarget } from '@/lib/guide/nav';
import { MANIFEST, fillWeek, groundAt, groundCss, shotOf } from '@/lib/guide/manifest';

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
  swap: Swap;
}

const IMAGE: Size = { w: MANIFEST.viewport.width, h: MANIFEST.viewport.height };
const CAMERA_OPTS = { captureScale: MANIFEST.scale, header: APP_HEADER };
/** 카메라가 움직이는 동안 고리·손·말풍선을 기다리게 하는 시간 — 카메라 600ms가 거의 끝날 때 나타난다 */
const ARRIVE_MS = 480;

/** 구석 알약 「부서원 3/8」 — 역할 장의 단계에만 (표지·왜·마무리·장 카드에는 없다: 장 카드가 그 말을 한다) */
export function pillOf(slide: Slide): string | null {
  return slide.step && slide.chapter.lede ? `${slide.chapter.title} ${slide.n}/${slide.of}` : null;
}

/** 구멍이 무엇인가 — 그림 단계는 단계의 `target`, 알림 카드는 보기만 하는 것 */
export function targetOf(step: GuideStep | null): CoachTarget {
  return step?.kind === 'shot' ? step.target : 'area';
}

/** 키·프레젠터로 넘길 때 눌린 모양을 보일 단계인가 — 누르는 버튼이 구멍인 그림 단계 */
export function pressable(slide: Slide | undefined): boolean {
  return slide?.step?.kind === 'shot' && slide.step.target === 'button' && !!shotOf(slide.step.id);
}

/** 장의 첫 그림 — 장 카드와 알림 카드의 흐린 배경(다음에 나올 화면으로 이어지게). 발표에서 빼는 단계는 건너뛴다 */
function chapterShot(chapter: GuideChapter) {
  const step = chapter.steps.find((s) => s.kind === 'shot' && !s.selfOnly);
  return step ? shotOf(step.id) : null;
}

/** 그림 단계의 카메라 + 구멍 + 말풍선 자리 (말풍선 크기는 어림 — 그린 뒤 높이를 다시 재서 놓는다) */
function planOf(slide: Slide, view: Size, k: number, withPill: boolean): (CoachPlan & { bubbleW: number; avoid: Rect[] }) | null {
  const step = slide.step;
  if (!step || step.kind !== 'shot' || view.w <= 0) return null;
  const shot = shotOf(step.id);
  if (!shot) return null;
  const pill = withPill ? pillOf(slide) : null;
  const avoid = pill ? [pillRect(view, pill, k)] : [];
  const foot = footOf(step.target);
  const plan = coachPlan(view, IMAGE, shot, (maxW) => estimateBubble(step.label, step.say, foot, view, k, maxW), {
    ...CAMERA_OPTS,
    avoid,
    hand: step.target === 'button',
  });
  return { ...plan, bubbleW: plan.bubble.w, avoid };
}

const sameScreen = (a: Slide, b: Slide) =>
  a.step?.kind === 'shot' && b.step?.kind === 'shot' && !!a.step.screen && a.step.screen === b.step.screen;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 눌린 모양 — 무대 좌표의 한 점에 흰 물결. `n`이 바뀌면 물결을 처음부터 */
interface Press {
  key: string;
  x: number;
  y: number;
  n: number;
}

export function GuideStage({
  slide,
  index,
  theme,
  still = false,
  k = 1,
  hint = 0,
  press = 0,
  pill = true,
  onClick,
  className = 'relative',
}: {
  slide: Slide;
  /** 부모 목록에서의 번호 — 둘 이상 건너뛰면 겹치지 않고 바로 바꾼다 */
  index?: number;
  theme: StageTheme;
  /** 움직임 없이 바로 그 자리 (발표자 창의 다음 장 그림) */
  still?: boolean;
  /** 말풍선 배율 — 혼자 보기는 `SELF_K` (coach.ts) */
  k?: number;
  /** 「여기를 누르세요」를 다시 보인 횟수 — 바뀌면 고리·손·말풍선이 처음부터 다시 움직인다 */
  hint?: number;
  /** 키·프레젠터로 넘기기 직전에 올린다 — 바뀌면 손이 누르고 손끝에 물결이 인다(KEY_PRESS_MS) */
  press?: number;
  /** 구석 알약 「부서원 3/8」 — 발표 무대에만. 혼자 보기는 목차·진행 막대가 자리를 말하고, 알약이 앱 머리를 덮었다 */
  pill?: boolean;
  /** 무대를 누른 곳 — 없으면 누를 것을 그리지 않는다 */
  onClick?: (target: StageTarget) => void;
  /** 자리 잡기(relative·absolute)와 크기 — 무대 상자는 부모가 정한다 */
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  const seq = useRef(0);
  const lastIndex = useRef(index);
  const revealed = useRef(new Set<number>());
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, slide, cam: null, aim: slide, opacity: 1, swap: 'none' }]);

  // 창 크기 — 카메라는 상태로 들고 있지 않고 그릴 때마다 창 크기에서 계산한다 — 창이 바뀌면 저절로 따라간다
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const camOf = useCallback(
    (l: Layer): Camera | null => {
      if (l.cam) return l.cam;
      if (!l.aim || l.aim.step?.kind !== 'shot') return null;
      return planOf(l.aim, view, k, pill)?.cam ?? fitCamera(view, IMAGE);
    },
    [view, k, pill],
  );

  // 단계가 바뀌면 새 판을 겹친다
  const top = layers[layers.length - 1];
  useLayoutEffect(() => {
    if (top.slide.key === slide.key) return;
    const id = ++seq.current;
    const jump = index !== undefined && lastIndex.current !== undefined && Math.abs(index - lastIndex.current) > 1;
    lastIndex.current = index;
    if (still || reducedMotion()) {
      setLayers([{ id, slide, cam: null, aim: slide, opacity: 1, swap: 'none' }]);
      return;
    }
    setLayers((ls) => {
      // 밑판은 **보이고 있는** 판이다. 빠르게 연달아 넘기면 맨 위가 아직 나타나기 전(투명)일 수 있다 —
      // 그걸 밑판으로 삼으면 두 판이 다 투명해 무대가 한 번 비어 보인다
      const base = [...ls].reverse().find((l) => l.opacity === 1) ?? ls[ls.length - 1];
      if (jump) {
        // 건너뛰기 — 새 판을 제자리에 투명하게 두고, 그림이 준비되면 한 번에 바꾼다(reveal)
        return [base, { id, slide, cam: null, aim: slide, opacity: 0, swap: 'cut' }];
      }
      const same = sameScreen(base.slide, slide);
      const here = camOf(base);
      const start = same && here ? here : overviewCamera(view, IMAGE);
      // 같은 화면이면 밑판도 새 단계를 겨눈다 — 겹쳐 바뀌는 동안 두 그림이 같이 움직여 어긋나지 않는다
      return [
        { ...base, cam: null, aim: same ? slide : base.aim },
        { id, slide, cam: start, aim: null, opacity: 0, swap: same ? 'same' : 'screen' },
      ];
    });
  }, [slide, index, still, top, view, camOf]);

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
          const shown = { ...me, cam: null, aim: me.slide, opacity: 1 };
          return me.swap === 'cut' ? [shown] : ls.map((l) => (l.id === id ? shown : l));
        });
        window.setTimeout(() => setLayers((ls) => (ls[ls.length - 1]?.id === id ? ls.filter((l) => l.id === id) : ls)), 650);
      }),
    );
  }, []);

  // 맨 위 판이 자리를 잡았나 — 그때부터 고리·손·말풍선을 그린다
  const settled = top.slide.key === slide.key && top.opacity === 1 && top.cam === null;
  const plan = useMemo(() => planOf(slide, view, k, pill), [slide, view, k, pill]);
  const step = slide.step;
  const target = targetOf(step);

  // 말풍선 높이는 그린 뒤 다시 잰다 — 어림보다 한 줄 늘면 그 높이로 다시 놓는다(구멍을 덮지 않게)
  const [measured, setMeasured] = useState<{ key: string; w: number; h: number } | null>(null);
  const layout: CoachLayout | null = useMemo(() => {
    if (!plan) return null;
    const h = measured && measured.key === slide.key && measured.w === view.w ? measured.h : null;
    return h ? coachLayout(view, plan.hole, { w: plan.bubbleW, h }, { avoid: plan.avoid, hand: target === 'button' }) : plan.layout;
  }, [plan, measured, slide.key, view, target]);
  const onMeasure = useCallback(
    (h: number) => setMeasured((m) => (m && m.key === slide.key && m.w === view.w && Math.abs(m.h - h) < 0.5 ? m : { key: slide.key, w: view.w, h })),
    [slide.key, view.w],
  );

  // 「다시 알려 주기」 — 이 장에 들어온 뒤로 hint가 바뀌었으면 카메라를 기다리지 않고 바로 다시 움직인다.
  // 장이 바뀐 순간의 hint를 기억해 둔다(앞 렌더의 값을 상태로 들고 있는 React의 관용 — 효과를 거치면 한 번 늦게 그린다)
  const [hintBase, setHintBase] = useState({ key: slide.key, hint });
  if (hintBase.key !== slide.key) setHintBase({ key: slide.key, hint });
  const delay = still || hint !== hintBase.hint ? 0 : top.swap === 'same' || top.swap === 'screen' ? ARRIVE_MS : 60;

  // 눌린 모양 — 구멍을 눌렀을 때(그 자리)와 키로 넘길 때(손끝, 손이 없으면 구멍 가운데)
  const [pressed, setPressed] = useState<Press | null>(null);
  const pressSeq = useRef(0);
  const pressTimer = useRef<number | null>(null);
  const showPress = useCallback(
    (x: number, y: number, ms: number, then?: () => void) => {
      const n = ++pressSeq.current;
      setPressed({ key: slide.key, x, y, n });
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        then?.();
        setPressed((p) => (p?.n === n ? null : p));
      }, ms);
    },
    [slide.key],
  );
  useEffect(() => () => void (pressTimer.current && window.clearTimeout(pressTimer.current)), []);
  // 부모가 `press`를 올렸다 — 손이 누르고 물결. 넘기는 것은 부모가 KEY_PRESS_MS 뒤에 한다
  const lastPress = useRef(press);
  useEffect(() => {
    if (press === lastPress.current) return;
    lastPress.current = press;
    if (still || !plan || !layout) return;
    const at = layout.hand ? { x: layout.hand.tipX, y: layout.hand.tipY } : { x: plan.hole.x + plan.hole.w / 2, y: plan.hole.y + plan.hole.h / 2 };
    showPress(at.x, at.y, KEY_PRESS_MS);
  }, [press, still, plan, layout, showPress]);
  const pressing = pressed && pressed.key === slide.key ? pressed : null;

  const dark = theme === 'dark';
  const pillText = pill ? pillOf(slide) : null;
  const coach = step?.kind === 'shot' || step?.kind === 'message';
  const interactive = !!onClick;
  // 구멍을 눌렀다 — 눌린 모양을 보인 뒤 넘긴다. 눌린 모양이 도는 동안의 두 번째 누르기는 받지 않는다(두 장 넘어간다)
  const onHole = useCallback(
    (x: number, y: number) => {
      if (pressing || !onClick) return;
      showPress(x, y, clickPressMs('cutout'), () => onClick('cutout'));
    },
    [pressing, onClick, showPress],
  );

  return (
    <div
      ref={boxRef}
      onClick={interactive ? () => onClick(coach ? 'dim' : 'card') : undefined}
      data-press={pressing ? '' : undefined}
      className={`@container overflow-hidden select-none ${dark ? 'bg-stage text-canvas' : 'bg-surface-strong text-ink'} ${
        still ? 'coach-still' : ''
      } ${interactive && !coach ? 'cursor-pointer' : ''} ${className}`}
      style={
        {
          '--k': k,
          '--coach-delay': `${delay}ms`,
          // 프로젝터는 검정을 들어 올린다 — 70%가 강당에서는 50%처럼 보였다(2026-10-08 검토). 모니터(혼자 보기)는 70%
          '--coach-dim': dark ? 0.78 : 0.7,
        } as React.CSSProperties
      }
    >
      {view.w > 0 &&
        layers.map((l) => (
          <LayerView
            key={l.id}
            layer={l}
            cam={camOf(l)}
            view={view}
            theme={theme}
            pending={l.opacity === 0}
            onReady={reveal}
            overlay={
              // 알림 카드는 판 안에서 제 카드를 재어 구멍을 낸다 — 맨 위의 자리 잡은 판에만
              l.id === top.id && settled ? { hint, k, interactive, onClick, onHole, pillText } : null
            }
          />
        ))}
      {view.w > 0 && settled && plan && layout && step?.kind === 'shot' && (
        <CoachOverlay
          key={`${slide.key}:${hint}`}
          hole={plan.hole}
          layout={layout}
          label={step.label}
          say={step.say}
          foot={footOf(step.target)}
          interactive={interactive}
          onClick={onClick}
          onHole={onHole}
          onMeasure={onMeasure}
          bubbleW={plan.bubbleW}
        />
      )}
      {pressing && <span key={pressing.n} aria-hidden className="coach-press" style={{ left: pressing.x, top: pressing.y }} />}
      {pillText && <span className="coach-pill">{pillText}</span>}
    </div>
  );
}

interface OverlayProps {
  hint: number;
  k: number;
  interactive: boolean;
  onClick?: (target: StageTarget) => void;
  onHole: (x: number, y: number) => void;
  pillText: string | null;
}

function LayerView({
  layer,
  cam,
  view,
  theme,
  pending,
  onReady,
  overlay,
}: {
  layer: Layer;
  cam: Camera | null;
  view: Size;
  theme: StageTheme;
  /** 아직 나타나기 전 — 준비되면 `onReady(id)` */
  pending: boolean;
  onReady: (id: number) => void;
  /** 맨 위의 자리 잡은 판이면 — 글자 슬라이드의 코치 마크(알림 카드)를 그린다 */
  overlay: OverlayProps | null;
}) {
  const { slide, opacity, id, swap } = layer;
  const step = slide.step;
  const shot = step?.kind === 'shot' ? shotOf(step.id) : null;
  const isShot = !!shot;

  // 글자 슬라이드는 받을 것이 없다 — 바로 나타난다
  useEffect(() => {
    if (pending && !isShot) onReady(id);
  }, [pending, isShot, onReady, id]);

  if (shot && cam) {
    // 구멍 — 누를 곳 둘레 HOLE_PAD(cqw)만큼. 판 안의 좌표(그림 px)로 놓아 카메라와 같이 움직인다
    const pad = (HOLE_PAD * view.w) / 100 / cam.scale;
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
        {/*
          그림 아래 — 카메라가 그림 밑을 비울 때(BOTTOM_SLACK) 그 그림의 바닥색이 이어진다. 검정이면 띠로 보였다.
          그림 **뒤에** 깔고 위로 2px 겹친다 — 맞닿게 두면 배율이 걸린 경계에서 어두운 실선이 비쳤다
        */}
        <span aria-hidden className="guide-ground" style={{ top: IMAGE.h - 2, height: IMAGE.h + 2, background: groundCss(shot.ground) }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- 정적 webp, 크기는 판이 정한다 */}
        <img
          src={shot.src}
          alt={step ? `${step.label}: ${step.say}` : ''}
          width={IMAGE.w}
          height={IMAGE.h}
          draggable={false}
          className="relative block h-full w-full select-none"
          ref={(img) => {
            // 캐시에 있던 그림은 onLoad가 붙기 전에 끝나 있을 수 있다
            if (pending && img?.complete && img.naturalWidth > 0) onReady(id);
          }}
          onLoad={() => pending && onReady(id)}
          onError={() => pending && onReady(id)}
        />
        <span
          aria-hidden
          className="coach-dim"
          style={{ left: shot.focus.x - pad, top: shot.focus.y - pad, width: shot.focus.w + 2 * pad, height: shot.focus.h + 2 * pad }}
        />
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 overflow-hidden motion-reduce:transition-none ${swap === 'cut' ? '' : 'transition-opacity duration-200 ease-out'} ${
        theme === 'light' ? 'bg-surface-soft' : 'bg-stage'
      }`}
      style={{ opacity }}
    >
      <TextSlide slide={slide} theme={theme} view={view} overlay={overlay} />
    </div>
  );
}

/**
 * 고리·손·말풍선 — 무대 좌표. 말풍선 너비는 어림으로 정하고(카메라를 정할 때 쓴 그 너비), 높이는 그린 뒤 재서 부모에게
 * 알린다(`onMeasure`) — 부모가 그 높이로 자리를 다시 잡는다.
 */
function CoachOverlay({
  hole,
  layout,
  label,
  say,
  foot,
  interactive,
  onClick,
  onHole,
  onMeasure,
  bubbleW,
}: {
  hole: Rect;
  layout: CoachLayout;
  label: string;
  say: string;
  foot: string;
  interactive: boolean;
  onClick?: (target: StageTarget) => void;
  onHole: (x: number, y: number) => void;
  onMeasure: (h: number) => void;
  bubbleW: number;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const report = () => onMeasure(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  const { bubble, arrow, hand } = layout;
  const own = labelOwnLine(label);
  return (
    <div className="coach-over">
      <span aria-hidden className="coach-ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />
      {interactive && (
        <button
          type="button"
          aria-label={`${label} — 눌러서 다음 단계로`}
          className="coach-hit"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
          onClick={(e) => {
            e.stopPropagation();
            // 누른 자리(무대 좌표) — 키보드로 누르면(Enter) 좌표가 없어 구멍 가운데
            const stage = e.currentTarget.parentElement?.getBoundingClientRect();
            const byMouse = e.detail > 0 && stage;
            onHole(byMouse ? e.clientX - stage.left : hole.x + hole.w / 2, byMouse ? e.clientY - stage.top : hole.y + hole.h / 2);
          }}
        />
      )}
      {hand && <Hand hand={hand} />}
      <div
        ref={bubbleRef}
        role="note"
        className="coach-bubble"
        style={{ left: bubble.x, top: bubble.y, width: bubbleW }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="coach-text">
          {/* 긴 이름(8자 이상)은 제 줄 — 줄바꿈이 이름 한가운데서 나면 어디까지가 화면의 이름인지 안 보인다 */}
          <strong className={`coach-label ${own ? 'block' : ''}`}>{label}:</strong>
          {own ? '' : ' '}
          {say}
        </p>
        <div className="coach-foot">
          <span>{foot}</span>
          {interactive && (
            <button
              type="button"
              className="coach-next"
              onClick={(e) => {
                e.stopPropagation();
                onClick?.('next');
              }}
            >
              {NEXT_LABEL} →
            </button>
          )}
        </div>
        <span
          aria-hidden
          className="coach-arrow"
          data-edge={arrow.edge}
          style={arrow.edge === 'left' || arrow.edge === 'right' ? { top: arrow.at } : { left: arrow.at }}
        />
      </div>
    </div>
  );
}

/**
 * 누르라는 손 — 집게손가락이 위를 가리키는 그림(손끝 = 상자의 24%·4%, coach.ts HAND)을 손끝을 축으로 20° 기울이고,
 * 말풍선 반대쪽으로 뻗게 뒤집는다(`fx`·`fy`). 손끝에는 두드릴 때마다 흰 물결 — 세 번 두드리고 멈춘다(globals.css)
 */
function Hand({ hand }: { hand: HandBox }) {
  const { box } = hand;
  return (
    <>
      <span aria-hidden className="coach-tap-ripple" style={{ left: hand.tipX, top: hand.tipY }} />
      <svg
        aria-hidden
        viewBox="0 0 34 41"
        className="coach-hand"
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          transform: `scale(${hand.fx}, ${hand.fy}) rotate(${HAND.angle}deg)`,
        }}
      >
        <g className="coach-hand-tap">
          <path d="M5 21 C3.4 26 3.8 31 6.8 35 C9.4 38.6 13 40 18 40 C24 40 28.6 37 29 31 L29.2 21 Z" />
          <path d="M5.4 23.4 C2.4 21.6 0.6 23.4 1.6 26.2 L4.8 32.4 Z" />
          <rect x="22.6" y="16.4" width="6.4" height="11" rx="3.2" />
          <rect x="16.8" y="14.4" width="6.6" height="12.6" rx="3.3" />
          <rect x="11" y="12.6" width="6.6" height="14" rx="3.3" />
          <rect x="4.8" y="1.4" width="6.8" height="25" rx="3.4" />
        </g>
      </svg>
    </>
  );
}

/**
 * 움직이지 않는 한 장 — 좁은 화면과 인쇄용(PG-61). **자바스크립트로 재지 않는다**: 인쇄는 화면을 다시 배치한 뒤
 * 곧바로 찍으므로, 크기를 재서 그리는 무대는 인쇄물에서 빈 상자가 된다. 그림·구멍 모두 비율(%)로 놓는다.
 *
 * 카메라 사각형 둘레를 4:3으로 잘라 보인다(`cropAround`) — 1600px 그림 전체를 360px 폭(휴대폰)이나 A4 반쪽(인쇄)에
 * 그리면 버튼이 10px 남짓이다. 구멍은 잘라 낸 그림의 가장자리에서 12% 넘게 안쪽 — 그림 끝에 붙은 버튼(드로어 바닥의
 * [제출])이면 그림 밖까지 잘라 그 자리를 바닥색(manifest `ground`)으로 칠한다. 누를 곳만 밝고 나머지는 어둡다.
 * 그림 단계가 아니면 아무것도 그리지 않는다.
 */
export function StaticSlide({ slide }: { slide: Slide }) {
  const step = slide.step;
  const shot = step?.kind === 'shot' ? shotOf(step.id) : null;
  if (!shot) return null;
  // 구멍 둘레 여백 — 그림 px로 6px (잘라 낸 그림이 작아도 버튼 테두리가 구멍 끝에 붙지 않게)
  const p = 6;
  const hole = { x: shot.focus.x - p, y: shot.focus.y - p, w: shot.focus.w + 2 * p, h: shot.focus.h + 2 * p };
  const box = cropAround(IMAGE, union(shot.frame, shot.focus), hole);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  // 그림 밖으로 잘린 옆 — 그쪽 끝의 바닥색. 아래는 바닥색 띠가 그대로 이어진다
  const side = box.x + box.w > IMAGE.w ? 1 : box.x < 0 ? 0 : (hole.x + hole.w / 2) / IMAGE.w;
  return (
    <div
      className="relative w-full overflow-hidden [print-color-adjust:exact]"
      style={{ aspectRatio: `${box.w} / ${box.h}`, background: groundAt(shot.ground, side) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 정적 webp */}
      <img
        src={shot.src}
        alt={step ? `${step.label}: ${step.say}` : ''}
        loading="lazy"
        className="absolute block max-w-none"
        style={{ width: pct(IMAGE.w, box.w), left: pct(-box.x, box.w), top: pct(-box.y, box.h) }}
      />
      <span
        aria-hidden
        className="absolute"
        style={{
          left: pct(-box.x, box.w),
          width: pct(IMAGE.w, box.w),
          top: pct(IMAGE.h - box.y, box.h),
          height: pct(box.h, box.h),
          background: groundCss(shot.ground),
        }}
      />
      <span
        aria-hidden
        className="coach-static-hole"
        style={{ left: pct(hole.x - box.x, box.w), top: pct(hole.y - box.y, box.h), width: pct(hole.w, box.w), height: pct(hole.h, box.h) }}
      />
    </div>
  );
}

/** 글자 슬라이드 — 무대 폭 기준 크기(cqw). 1920px 무대에서 1cqw = 19.2px. 큰 줄 하나 + 한 줄 */
function TextSlide({ slide, theme, view, overlay }: { slide: Slide; theme: StageTheme; view: Size; overlay: OverlayProps | null }) {
  const dark = theme === 'dark';
  // 무대 위 흐린 글자는 굵기 500 — 프로젝터에서 가는 글자는 바탕에 번져 사라진다
  const muted = dark ? 'text-stage-muted font-medium' : 'text-muted';
  const accent = dark ? 'text-brand-tint' : 'text-brand';
  const tap = overlay?.interactive ? <p className={`mt-[2.4cqw] text-[1.2cqw] ${muted}`}>눌러서 계속</p> : null;
  const { chapter, step } = slide;

  // 장 카드 — 흰 카드 하나: 「이번엔 부서담당자 차례예요」 + 한 줄 + 다섯 역할 중 지금 자리.
  // 바탕은 그 장의 첫 화면을 흐리고 어둡게 — 검정 위에 카드만 있으면 다음 화면과 끊긴다(2026-10-08 검토).
  // 「1 / 5」 줄과 말풍선 꼬리는 걷었다: 다섯 역할 칩이 이미 자리를 말하고, 꼬리는 허공을 가리켰다
  if (!step) {
    const roles = roleChapters();
    const at = roles.findIndex((c) => c.id === chapter.id);
    const bg = chapterShot(chapter);
    return (
      <div className="relative flex h-full items-center justify-center px-[5cqw]">
        {bg && (
          // eslint-disable-next-line @next/next/no-img-element -- 정적 webp, 흐린 배경
          <img
            src={bg.src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-[1.06] object-cover object-top"
            style={{ filter: 'blur(0.6cqw) brightness(0.35)' }}
          />
        )}
        <div className="relative w-fit max-w-[64cqw] min-w-[44cqw] rounded-[1.6cqw] bg-canvas px-[3.6cqw] py-[3cqw] text-ink shadow-[0_0.6cqw_2.4cqw_rgb(0_0_0/0.45)]">
          <h2 className="text-[3.6cqw] leading-[1.15] font-bold tracking-[-0.02em]" style={{ wordBreak: 'keep-all' }}>
            {chapterHeadline(chapter)}
          </h2>
          {chapter.lede && <p className="mt-[1.2cqw] text-[2cqw] leading-snug font-medium text-body">{chapter.lede}</p>}
          <ol aria-label="한 주의 흐름" className="mt-[2.4cqw] flex flex-wrap gap-[0.6cqw]">
            {roles.map((c, i) => (
              <li
                key={c.id}
                aria-current={i === at ? 'step' : undefined}
                className={`rounded-full px-[1cqw] py-[0.3cqw] text-[1.2cqw] ${
                  i === at ? 'bg-brand font-semibold text-canvas' : i < at ? 'bg-surface-strong text-muted' : 'border border-hairline text-muted'
                }`}
              >
                {c.title}
              </li>
            ))}
          </ol>
          {overlay?.interactive && <p className="mt-[1.6cqw] text-[1.1cqw] text-muted">눌러서 계속</p>}
        </div>
      </div>
    );
  }

  if (step.kind === 'cover') {
    return (
      <div className="relative flex h-full flex-col items-center justify-center px-[5cqw] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG (public/brand/README.md — 최대 64px 높이) */}
        <img src={dark ? '/brand/tincase-lockup-inverse.svg' : '/brand/tincase-lockup.svg'} alt="Tincase" className="h-[3.4cqw] w-auto" />
        <h2 className="mt-[3.4cqw] text-[4.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.label}</h2>
        <p className={`mt-[1.4cqw] text-[2.2cqw] ${muted}`}>{step.say}</p>
        {tap}
        <p className={`absolute right-0 bottom-[3.4cqw] left-0 text-[1.2cqw] ${muted}`}>화면 속 이름과 업무는 모두 지어낸 것이에요</p>
      </div>
    );
  }

  if (step.kind === 'card') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-[6cqw] text-center">
        <h2 className="text-[4cqw] leading-tight font-bold tracking-[-0.02em]" style={{ wordBreak: 'keep-all' }}>
          {step.label}
        </h2>
        <p className={`mt-[1.6cqw] text-[2.2cqw] ${muted}`}>{step.say}</p>
        {tap}
      </div>
    );
  }

  if (step.kind === 'flow') {
    // 다섯 칸에 강조색을 두지 않는다 — 장 카드의 「지금 여기」 줄에서 초록이 「지금」을 뜻한다(CP-105)
    return (
      <div className="flex h-full flex-col items-center justify-center px-[4cqw] text-center">
        <h2 className="text-[3.6cqw] leading-tight font-bold tracking-[-0.02em]">{step.label}</h2>
        <p className={`mt-[1.2cqw] text-[2cqw] ${muted}`}>{step.say}</p>
        <ol className="mt-[3.4cqw] flex items-stretch justify-center gap-[0.6cqw]">
          {step.flow.map((f, i) => (
            <li key={f.who} className="flex items-stretch gap-[0.6cqw]">
              {i > 0 && (
                <span aria-hidden className={`self-center text-[1.6cqw] ${muted}`}>
                  →
                </span>
              )}
              <span className={`flex w-[15cqw] flex-col items-center rounded-[1.2cqw] px-[1cqw] py-[1.4cqw] ${dark ? 'bg-stage-soft' : 'border border-hairline bg-canvas'}`}>
                <span className="text-[2.4cqw] leading-tight font-semibold whitespace-nowrap">{f.who}</span>
                <span className={`mt-[0.5cqw] text-[1.6cqw] leading-snug ${muted}`}>{f.what}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (step.kind === 'buttons') {
    // 가운데 흰 카드에 역할 | 버튼 — 버튼은 **앱의 그 버튼 모양**(줄의 마지막 = 주 버튼은 짙은 초록 채움, 앞의 것은 흰 테두리).
    // 글자 알약으로 늘어놓으면 강당에서 「버튼」으로 안 읽혔고, 왼쪽에 몰린 표는 화면 오른쪽 절반을 비웠다(2026-10-08 검토)
    return (
      <div className="flex h-full flex-col items-center justify-center px-[5cqw] text-center">
        <h2 className="text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.label}</h2>
        <p className={`mt-[0.8cqw] text-[1.8cqw] ${muted}`}>{step.say}</p>
        <dl className="mt-[2.4cqw] grid grid-cols-[auto_auto] items-center gap-x-[2.4cqw] gap-y-[1.1cqw] rounded-[1.6cqw] bg-canvas px-[3cqw] py-[2.4cqw] text-left text-ink shadow-[0_0.6cqw_2.4cqw_rgb(0_0_0/0.35)]">
          {step.rows.map((r) => (
            <Fragment key={r.who}>
              <dt className="text-[1.8cqw] font-semibold whitespace-nowrap text-muted">{r.who}</dt>
              <dd className="flex flex-wrap items-center gap-[0.9cqw]">
                {r.buttons.map((b, i) => (
                  <Fragment key={b}>
                    {i > 0 && (
                      <span aria-hidden={!r.or} className="text-[1.4cqw] text-muted">
                        {r.or ? '또는' : '→'}
                      </span>
                    )}
                    <span
                      className={`inline-flex h-[3.2cqw] items-center rounded-[0.6cqw] px-[1.3cqw] text-[1.6cqw] whitespace-nowrap ${
                        r.or || i === r.buttons.length - 1
                          ? 'bg-brand font-semibold text-canvas'
                          : 'border-[0.1cqw] border-border-strong bg-canvas font-medium text-ink'
                      }`}
                    >
                      {b}
                    </span>
                  </Fragment>
                ))}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
    );
  }

  if (step.kind === 'message') return <MessageSlide slide={slide} view={view} overlay={overlay} />;

  if (step.kind === 'address') return <AddressSlide caption={step.label} line={step.say} muted={muted} accent={accent} />;

  return null;
}

/**
 * 알림 카드 — 사내 메신저 알림함의 한 건(실제 문구 NT-44에서 이름·사번을 뺀 모양). 이 카드가 구멍이다:
 * 그림 단계와 같은 그늘·고리·말풍선 「사내 메신저: 마감 10분 뒤 검토 부탁이 와요」. 카드를 누르면 다음.
 * 뒤에는 그 장의 첫 화면(수합 관리)을 흐려 깐다 — 검정 위에 카드만 두면 그늘이 덮을 것이 없어 「뚫린 곳」이 안 보였다
 * (2026-10-08 검토). 카드 크기는 글자에 달려 있어 그린 뒤 잰다(무대 좌표 — 판은 무대와 같은 상자다).
 */
function MessageSlide({ slide, view, overlay }: { slide: Slide; view: Size; overlay: OverlayProps | null }) {
  const step = slide.step;
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => setCard({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view.w, view.h]);
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  if (step?.kind !== 'message') return null;
  const k = overlay?.k ?? 1;
  const u = view.w / 100;
  const hole = card && { x: card.x - u * 0.5, y: card.y - u * 0.5, w: card.w + u, h: card.h + u };
  const foot = footOf('area');
  const est = estimateBubble(step.label, step.say, foot, view, k);
  const avoid = overlay?.pillText ? [pillRect(view, overlay.pillText, k)] : [];
  const layout = hole && coachLayout(view, hole, { w: est.w, h: measuredH ?? est.h }, { avoid });
  const bg = chapterShot(slide.chapter);
  return (
    <div className="relative h-full">
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element -- 정적 webp, 흐린 배경
        <img
          src={bg.src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-[1.03] object-cover object-top"
          style={{ filter: 'blur(0.25cqw)' }}
        />
      )}
      {hole && <span aria-hidden className="coach-dim" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />}
      <div
        ref={cardRef}
        className="absolute top-[30%] left-[8cqw] w-[48cqw] rounded-[1.4cqw] bg-canvas px-[2.4cqw] py-[2cqw] text-ink shadow-[0_0.6cqw_2.4cqw_rgb(0_0_0/0.35)]"
      >
        <p className="flex items-center gap-[1cqw] text-[1.4cqw]">
          {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG */}
          <img src="/brand/tincase-icon-sm.svg" alt="" className="h-[2cqw] w-[2cqw]" />
          <span className="text-muted">사내 메신저 · {step.message.from}</span>
        </p>
        <p className="mt-[1cqw] text-[2.1cqw] leading-snug font-semibold">{fillWeek(step.message.subject)}</p>
        {step.message.lines.map((l) => (
          <p key={l} className="mt-[0.5cqw] text-[1.7cqw] leading-snug text-body">
            {fillWeek(l)}
          </p>
        ))}
      </div>
      {overlay && hole && layout && (
        <CoachOverlay
          key={`${slide.key}:${overlay.hint}`}
          hole={hole}
          layout={layout}
          label={step.label}
          say={step.say}
          foot={foot}
          interactive={overlay.interactive}
          onClick={overlay.onClick}
          onHole={overlay.onHole}
          onMeasure={setMeasuredH}
          bubbleW={est.w}
        />
      )}
    </div>
  );
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
