'use client';
// CP-101 — 사용 안내의 무대. 발표 모드와 체험하기가 **같은 무대**를 쓴다 — 두 곳의 그림이 갈라지지 않게.
//
// 그림 단계 하나 = 게임 튜토리얼식 코치 마크(2026-10-08 사용자: 「누를 버튼만 빼고 필터를 씌우고 옆에 팝업처럼」):
//   실제 화면 한 장(정지) → 누를 곳만 둥글게 뚫고 나머지는 그늘(55% — PG-82) → 구멍 가장자리 위에 걸친 흰 고리 →
//   버튼 모서리를 세 번 두드리고 멈추는 손 → 구멍 옆 말풍선 「제출: 다 적었으면 눌러요」
// 말풍선 자리·카메라·손은 순수 함수 `coachPlan`(src/lib/guide/coach.ts)이 정한다 — 테스트가 모든 단계를 잰다(PG-T89).
//
// 2026-10-08 v2:
//   - PG-80 말풍선 안의 [다음]이 없다 — 넘기기는 부모의 도크 한 곳이다. 꼬리말은 부모가 원할 때만(`foot` — 체험하기 첫 단계)
//   - PG-81 구멍과 고리는 **한 사각형**: 그늘(판 안)도 계획의 구멍(`holeOf`)을 판 좌표로 되돌려 쓰고, 둥글기는 버튼과 동심
//     (`holeRadius` — manifest `radius`). 고리는 상자 바깥 그림자가 아니라 가장자리 위에 걸친 띠라 그늘의 번진 가장자리를 덮는다.
//     무대 크기는 소수로 재고(`ResizeObserver` contentBoxSize — 1366px 창이면 무대 1365.33), 크기만 바뀐 그리기는 전환 없이
//     바로(전체 화면에 들어갈 때 판만 600ms 미끄러져 고리와 버튼이 어긋났다). 카메라가 도착하고 말풍선을 다시 잰 뒤에
//     무대 뿌리에 `data-settled="1"` — 고리·말풍선은 그때 나타나고, 검사(PG-T140·T141)는 그것을 기다린다
//   - PG-82 무대는 흰 바탕이다(`bg-stage` = #fff, 글자 `stage-ink`). 장 카드는 흰 슬라이드 그대로
//
// 누르기(PG-T90): 구멍을 누르면 **눌린 모양**(구멍이 살짝 들어가고 누른 자리에 흰 물결, 160ms)을 보인 뒤 다음 단계
// (= 그 버튼을 누른 뒤의 화면 — 흉내일 뿐 실제로는 아무것도 안 바뀐다), 어두운 곳을 누르면 넘기지 않고 고리·손을 다시
// 움직인다(`hint`가 바뀌면 처음부터). 프레젠터·키로 넘길 때는 부모가 `press`를 올려 같은 눌린 모양을 200ms 보인 뒤 넘긴다.
// 무엇을 할지는 부모가 정한다(`onClick`). `onClick`이 없으면(발표자 창의 다음 장 그림) 누를 것을 그리지 않는다.
//
// 넘길 때 두 판(이전·새)을 겹쳐 둔다:
//   같은 화면의 다음 단계  둘 다 새 카메라로 **같이** 옮겨 가며 겹쳐 바뀐다(320ms) — 구멍이 다음 버튼으로 미끄러지는 것처럼
//   다른 화면            새 판이 「어느 화면인가」가 보이는 카메라로 나타난 뒤(200ms) 다가간다
//   여러 장 건너뛰기      겹치지 않고 바로 바꾼다 — 목차·번호로 뛰는 중간 화면은 볼 이유가 없다
// 새 그림이 다 받아진 뒤에 바꾼다. 빈 무대가 한 번이라도 비치면 프로젝터에서는 번쩍임이 된다.
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
  holeOf,
  holeRadius,
  pillRect,
  type CoachLayout,
  type CoachPlan,
  type CoachTarget,
  type HandBox,
} from '@/lib/guide/coach';
import { clickPressMs, KEY_PRESS_MS, type StageTarget } from '@/lib/guide/nav';
import { MANIFEST, fillWeek, groundAt, groundCss, shotOf } from '@/lib/guide/manifest';
import { CoachBubble, CoachRing } from './CoachParts';

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
/** 카메라 전환(600ms)이 끝났다는 소식이 오지 않을 때의 안전판 — 탭이 숨겨져 transitionend가 오지 않는 경우 */
const ARRIVE_FALLBACK_MS = 800;

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

/** 장의 첫 그림 — 알림 카드의 흐린 배경(다음에 나올 화면으로 이어지게). 발표에서 빼는 단계는 건너뛴다 */
function chapterShot(chapter: GuideChapter) {
  const step = chapter.steps.find((s) => s.kind === 'shot' && !s.selfOnly);
  return step ? shotOf(step.id) : null;
}

/** 그림 단계의 카메라 + 구멍 + 말풍선 자리 (말풍선 크기는 어림 — 그린 뒤 높이를 다시 재서 놓는다) */
function planOf(
  slide: Slide,
  view: Size,
  k: number,
  withPill: boolean,
  foot: string | null,
): (CoachPlan & { bubbleW: number; avoid: Rect[]; radius: number }) | null {
  const step = slide.step;
  if (!step || step.kind !== 'shot' || view.w <= 0) return null;
  const shot = shotOf(step.id);
  if (!shot) return null;
  const pill = withPill ? pillOf(slide) : null;
  const avoid = pill ? [pillRect(view, pill, k)] : [];
  const plan = coachPlan(view, IMAGE, shot, (maxW) => estimateBubble(step.label, step.say, foot, view, k, maxW), {
    ...CAMERA_OPTS,
    avoid,
    hand: step.target === 'button',
  });
  const radius = holeRadius(shot.radius, plan.cam.scale, (HOLE_PAD * view.w) / 100, plan.hole);
  return { ...plan, bubbleW: plan.bubble.w, avoid, radius };
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
  still = false,
  k = 1,
  hint = 0,
  press = 0,
  pill = true,
  foot = false,
  onClick,
  className = 'relative',
}: {
  slide: Slide;
  /** 부모 목록에서의 번호 — 둘 이상 건너뛰면 겹치지 않고 바로 바꾼다 */
  index?: number;
  /** 움직임 없이 바로 그 자리 (발표자 창의 다음 장 그림) */
  still?: boolean;
  /** 말풍선 배율 — 체험하기는 `SELF_K` (coach.ts) */
  k?: number;
  /** 「여기를 누르세요」를 다시 보인 횟수 — 바뀌면 고리·손·말풍선이 처음부터 다시 움직인다 */
  hint?: number;
  /** 키·프레젠터로 넘기기 직전에 올린다 — 바뀌면 손이 누르고 손끝에 물결이 인다(KEY_PRESS_MS) */
  press?: number;
  /** 구석 알약 「부서원 3/8」 — 발표 무대에만. 체험하기는 도크가 자리를 말한다 */
  pill?: boolean;
  /** 말풍선 꼬리말(「버튼을 눌러 계속」) — 체험하기의 첫 코치 단계에만 (PG-80) */
  foot?: boolean;
  /** 무대를 누른 곳 — 없으면 누를 것을 그리지 않는다 */
  onClick?: (target: StageTarget) => void;
  /** 자리 잡기(relative·absolute)와 크기 — 무대 상자는 부모가 정한다 */
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  /** PG-81 — 단계는 그대로이고 무대 크기만 바뀌는 중이면 판을 전환 없이 바로 옮긴다 */
  const [resizing, setResizing] = useState(false);
  const seq = useRef(0);
  const lastIndex = useRef(index);
  const revealed = useRef(new Set<number>());
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, slide, cam: null, aim: slide, opacity: 1, swap: 'none' }]);

  // 창 크기 — **소수로** 잰다(PG-81 · B5). clientWidth는 반올림이라 1366px 창의 무대(1365.33)에서 구멍이 0.3px씩 어긋났다.
  // 카메라는 상태로 들고 있지 않고 그릴 때마다 창 크기에서 계산한다 — 창이 바뀌면 저절로 따라간다
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let first = true;
    let raf = 0;
    const apply = (w: number, h: number) => {
      setView((v) => (Math.abs(v.w - w) < 0.01 && Math.abs(v.h - h) < 0.01 ? v : { w, h }));
      if (first) {
        first = false;
        return;
      }
      setResizing(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setResizing(false))));
    };
    const r = el.getBoundingClientRect();
    apply(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentBoxSize?.[0];
      if (box) apply(box.inlineSize, box.blockSize);
      else apply(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const footText = foot ? footOf(targetOf(slide.step)) : null;
  const camOf = useCallback(
    (l: Layer): Camera | null => {
      if (l.cam) return l.cam;
      if (!l.aim || l.aim.step?.kind !== 'shot') return null;
      // 판의 카메라는 꼬리말과 상관없이 같다 — 꼬리말이 있는 첫 단계와 그 밑판이 다른 자리를 겨누지 않게 꼬리말 없이 잰다
      return planOf(l.aim, view, k, pill, l.aim.key === slide.key ? footText : null)?.cam ?? fitCamera(view, IMAGE);
    },
    [view, k, pill, slide.key, footText],
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

  // 맨 위 판이 자리를 잡았나(나타났나) — 그 판의 카메라가 도착하면(`arrived`) 고리·손·말풍선을 그린다
  const settled = top.slide.key === slide.key && top.opacity === 1 && top.cam === null;
  const [arrived, setArrived] = useState<string | null>(null);
  const onArrive = useCallback((key: string) => setArrived((a) => (a === key ? a : key)), []);
  const plan = useMemo(() => planOf(slide, view, k, pill, footText), [slide, view, k, pill, footText]);
  const step = slide.step;
  const target = targetOf(step);

  // 말풍선 높이는 그린 뒤 다시 잰다 — 어림보다 한 줄 늘면 그 높이로 다시 놓는다(구멍을 덮지 않게)
  const [measured, setMeasured] = useState<{ key: string; w: number; h: number } | null>(null);
  const layout: CoachLayout | null = useMemo(() => {
    if (!plan) return null;
    const h = measured && measured.key === slide.key && Math.abs(measured.w - view.w) < 0.5 ? measured.h : null;
    return h ? coachLayout(view, plan.hole, { w: plan.bubbleW, h }, { avoid: plan.avoid, hand: target === 'button' }) : plan.layout;
  }, [plan, measured, slide.key, view, target]);
  const onMeasure = useCallback(
    (h: number) =>
      setMeasured((m) => (m && m.key === slide.key && Math.abs(m.w - view.w) < 0.5 && Math.abs(m.h - h) < 0.5 ? m : { key: slide.key, w: view.w, h })),
    [slide.key, view.w],
  );

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

  const here = arrived === slide.key && settled;
  // 검사 손잡이(PG-T140·T141) — 카메라가 도착하고, 그림 단계면 말풍선을 다시 잰 뒤
  const ready = here && (step?.kind !== 'shot' || !plan || (measured?.key === slide.key && Math.abs(measured.w - view.w) < 0.5));

  return (
    <div
      ref={boxRef}
      data-stage=""
      data-settled={ready ? '1' : undefined}
      data-step={slide.key}
      onClick={interactive ? () => onClick(coach ? 'dim' : 'card') : undefined}
      data-press={pressing ? '' : undefined}
      className={`@container overflow-hidden bg-stage text-stage-ink select-none ${still ? 'coach-still' : ''} ${
        interactive && !coach ? 'cursor-pointer' : ''
      } ${className}`}
      style={{ '--k': k } as React.CSSProperties}
    >
      {view.w > 0 &&
        layers.map((l) => (
          <LayerView
            key={l.id}
            layer={l}
            cam={camOf(l)}
            view={view}
            instant={resizing}
            pending={l.opacity === 0}
            onReady={reveal}
            arriveKey={l.id === top.id && settled ? slide.key : null}
            onArrive={onArrive}
            overlay={
              // 알림 카드는 판 안에서 제 카드를 재어 구멍을 낸다 — 맨 위의 도착한 판에만
              l.id === top.id && here ? { hint, k, interactive, onClick, onHole, pillText } : null
            }
          />
        ))}
      {view.w > 0 && here && plan && layout && step?.kind === 'shot' && (
        <CoachOverlay
          key={`${slide.key}:${hint}`}
          hole={plan.hole}
          radius={plan.radius}
          layout={layout}
          label={step.label}
          say={step.say}
          foot={footText}
          interactive={interactive}
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
  instant,
  pending,
  onReady,
  arriveKey,
  onArrive,
  overlay,
}: {
  layer: Layer;
  cam: Camera | null;
  view: Size;
  /** 무대 크기만 바뀌는 중 — 전환 없이 바로 (PG-81) */
  instant: boolean;
  /** 아직 나타나기 전 — 준비되면 `onReady(id)` */
  pending: boolean;
  onReady: (id: number) => void;
  /** 맨 위의 나타난 판이면 그 단계의 열쇠 — 카메라가 도착하면 `onArrive(key)` */
  arriveKey: string | null;
  onArrive: (key: string) => void;
  /** 맨 위의 도착한 판이면 — 글자 슬라이드의 코치 마크(알림 카드)를 그린다 */
  overlay: OverlayProps | null;
}) {
  const { slide, opacity, id, swap } = layer;
  const step = slide.step;
  const shot = step?.kind === 'shot' ? shotOf(step.id) : null;
  const isShot = !!shot;
  const tf = shot && cam ? `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})` : '';

  // 글자 슬라이드는 받을 것이 없다 — 바로 나타난다
  useEffect(() => {
    if (pending && !isShot) onReady(id);
  }, [pending, isShot, onReady, id]);

  /*
   * 카메라 도착. 판의 transform이 바뀌었으면 그 전환(600ms)이 끝날 때(transitionend), 안 바뀌었거나 전환이 없으면(건너뛰기·크기 변화·
   * 줄인 움직임) 다음 프레임. 예전에는 480ms를 기다리는 어림이었다 — 탭을 옮기거나 느린 PC에서는 고리가 판보다 먼저 섰다
   */
  const lastTf = useRef<string | null>(null);
  useLayoutEffect(() => {
    const moved = lastTf.current !== null && lastTf.current !== tf;
    lastTf.current = tf;
    if (!arriveKey) return;
    if (!moved || instant || swap === 'cut' || reducedMotion()) {
      const r = requestAnimationFrame(() => onArrive(arriveKey));
      return () => cancelAnimationFrame(r);
    }
    const t = window.setTimeout(() => onArrive(arriveKey), ARRIVE_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [tf, arriveKey, instant, swap, onArrive]);

  if (shot && cam) {
    // PG-81 — 그늘 구멍은 **계획의 구멍**(무대 좌표, 무대 끝에서 잘린 것까지)을 판 좌표로 되돌린 것이다. 고리도 같은 사각형을
    // 무대 좌표로 그린다 — 둘이 한 사각형·한 둥글기라 가장자리가 갈라지지 않는다
    const pad = (HOLE_PAD * view.w) / 100;
    const hole = holeOf(cam, shot.focus, view);
    const r = holeRadius(shot.radius, cam.scale, pad, hole);
    return (
      <div
        className="guide-layer"
        data-swap={instant ? 'cut' : swap}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform' && arriveKey) onArrive(arriveKey);
        }}
        style={
          {
            width: IMAGE.w,
            height: IMAGE.h,
            opacity,
            transform: tf,
            '--cam-scale': cam.scale,
          } as React.CSSProperties
        }
      >
        {/*
          그림 아래 — 카메라가 그림 밑을 비울 때(BOTTOM_SLACK) 그 그림의 바닥색이 이어진다.
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
          style={{
            left: (hole.x - cam.x) / cam.scale,
            top: (hole.y - cam.y) / cam.scale,
            width: hole.w / cam.scale,
            height: hole.h / cam.scale,
            borderRadius: r / cam.scale,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-stage motion-reduce:transition-none ${swap === 'cut' ? '' : 'transition-opacity duration-200 ease-out'}`}
      style={{ opacity }}
    >
      <TextSlide slide={slide} view={view} overlay={overlay} />
    </div>
  );
}

/**
 * 고리·손·말풍선 — 무대 좌표. 말풍선 너비는 어림으로 정하고(카메라를 정할 때 쓴 그 너비), 높이는 그린 뒤 재서 부모에게
 * 알린다(`onMeasure`) — 부모가 그 높이로 자리를 다시 잡는다. [다음]은 없다(PG-80)
 */
function CoachOverlay({
  hole,
  radius,
  layout,
  label,
  say,
  foot,
  interactive,
  onHole,
  onMeasure,
  bubbleW,
}: {
  hole: Rect;
  radius: number;
  layout: CoachLayout;
  label: string;
  say: string;
  foot: string | null;
  interactive: boolean;
  onHole: (x: number, y: number) => void;
  onMeasure: (h: number) => void;
  bubbleW: number;
}) {
  const { hand } = layout;
  return (
    <div className="coach-over">
      <CoachRing hole={hole} radius={radius} />
      {interactive && (
        <button
          type="button"
          aria-label={`${label} — 눌러서 다음 단계로`}
          className="coach-hit"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, ['--hole-r' as string]: `${radius}px` }}
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
      <CoachBubble layout={layout} width={bubbleW} label={label} say={say} foot={foot} onMeasure={onMeasure} />
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
 * 그리면 버튼이 10px 남짓이다. 구멍은 잘라 낸 그림의 가장자리에서 12% 넘게 안쪽. 누를 곳만 밝고 나머지는 45% 그늘(PG-82).
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

/** 글자 슬라이드 — 무대 폭 기준 크기(cqw). 1920px 무대에서 1cqw = 19.2px. 흰 바탕에 짙은 글자(PG-82). 큰 줄 하나 + 한 줄 */
function TextSlide({ slide, view, overlay }: { slide: Slide; view: Size; overlay: OverlayProps | null }) {
  // 무대 위 흐린 글자는 굵기 500 — 프로젝터에서 가는 글자는 바탕에 번져 사라진다. 흰 바탕 7.46:1(stage-muted)
  const muted = 'text-stage-muted font-medium';
  const tap = overlay?.interactive ? <p className={`mt-[2.4cqw] text-[1.2cqw] ${muted}`}>눌러서 계속</p> : null;
  const { chapter, step } = slide;

  // 장 카드 — **흰 슬라이드 그대로**(PG-82): 「이번엔 부서담당자 차례예요」 + 한 줄 + 다섯 역할 중 지금 자리.
  // 검은 무대에서는 흐린 그림 위 흰 카드였다(검정 위에 카드만 있으면 다음 화면과 끊겨서). 무대가 흰 앱 화면과 같은 바탕이 되면서
  // 끊김이 없어졌다 — 상자·그림을 걷고 글만 둔다
  if (!step) {
    const roles = roleChapters();
    const at = roles.findIndex((c) => c.id === chapter.id);
    return (
      <div className="flex h-full flex-col items-center justify-center px-[6cqw] text-center">
        <h2 className="text-[3.8cqw] leading-[1.15] font-bold tracking-[-0.02em]" style={{ wordBreak: 'keep-all' }}>
          {chapterHeadline(chapter)}
        </h2>
        {chapter.lede && <p className="mt-[1.4cqw] text-[2.1cqw] leading-snug font-medium text-body">{chapter.lede}</p>}
        <ol aria-label="한 주의 흐름" className="mt-[3cqw] flex flex-wrap justify-center gap-[0.7cqw]">
          {roles.map((c, i) => (
            <li
              key={c.id}
              aria-current={i === at ? 'step' : undefined}
              className={`rounded-full px-[1.2cqw] py-[0.4cqw] text-[1.4cqw] ${
                i === at ? 'bg-brand font-semibold text-canvas' : i < at ? 'bg-stage-soft text-stage-muted' : 'border-[0.1cqw] border-stage-line text-stage-muted'
              }`}
            >
              {c.title}
            </li>
          ))}
        </ol>
        {tap}
      </div>
    );
  }

  if (step.kind === 'cover') {
    return (
      <div className="relative flex h-full flex-col items-center justify-center px-[5cqw] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG (public/brand/README.md — 흰 바탕에는 검은 글자 판) */}
        <img src="/brand/tincase-lockup.svg" alt="Tincase" className="h-[3.4cqw] w-auto" />
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
    // 다섯 칸에 강조색을 두지 않는다 — 장 카드의 「지금 여기」 칩에서 초록이 「지금」을 뜻한다(CP-105)
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
              <span className="flex w-[15cqw] flex-col items-center rounded-[1.2cqw] bg-stage-soft px-[1cqw] py-[1.4cqw]">
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
    // 역할 | 버튼 — 버튼은 **앱의 그 버튼 모양**(줄의 마지막 = 주 버튼은 짙은 초록 채움, 앞의 것은 테두리).
    // 흰 무대에서 앞 버튼의 테두리는 stage-muted(7.46:1) — border-strong(2.81:1)은 강당에서 「버튼」으로 안 읽혔다
    return (
      <div className="flex h-full flex-col items-center justify-center px-[5cqw] text-center">
        <h2 className="text-[3.4cqw] leading-tight font-bold tracking-[-0.02em]">{step.label}</h2>
        <p className={`mt-[0.8cqw] text-[1.8cqw] ${muted}`}>{step.say}</p>
        <dl className="mt-[2.4cqw] grid grid-cols-[auto_auto] items-center gap-x-[2.4cqw] gap-y-[1.1cqw] rounded-[1.6cqw] border-[0.1cqw] border-stage-line bg-canvas px-[3cqw] py-[2.4cqw] text-left">
          {step.rows.map((r) => (
            <Fragment key={r.who}>
              <dt className="text-[1.8cqw] font-semibold whitespace-nowrap text-stage-muted">{r.who}</dt>
              <dd className="flex flex-wrap items-center gap-[0.9cqw]">
                {r.buttons.map((b, i) => (
                  <Fragment key={b}>
                    {i > 0 && (
                      <span aria-hidden={!r.or} className="text-[1.4cqw] text-stage-muted">
                        {r.or ? '또는' : '→'}
                      </span>
                    )}
                    <span
                      className={`inline-flex h-[3.2cqw] items-center rounded-[0.6cqw] px-[1.3cqw] text-[1.6cqw] whitespace-nowrap ${
                        r.or || i === r.buttons.length - 1
                          ? 'bg-brand font-semibold text-canvas'
                          : 'border-[0.1cqw] border-stage-muted bg-canvas font-medium text-stage-ink'
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

  if (step.kind === 'address') return <AddressSlide caption={step.label} line={step.say} muted={muted} />;

  return null;
}

/** 알림 카드의 둥글기(cqw) — 구멍 둥글기 = 이것 + 여백(동심, PG-81) */
const CARD_R = 1.4;

/**
 * 알림 카드 — 사내 메신저 알림함의 한 건(실제 문구 NT-44에서 이름·사번을 뺀 모양). 이 카드가 구멍이다:
 * 그림 단계와 같은 그늘·고리·말풍선 「사내 메신저: 마감 10분 뒤 검토 부탁이 와요」. 카드를 누르면 다음.
 * 뒤에는 그 장의 첫 화면(수합 관리)을 흐려 깐다 — 그늘이 덮을 것이 있어야 「뚫린 곳」이 보인다.
 * 카드 크기는 글자에 달려 있어 그린 뒤 잰다 — **무대 기준 `getBoundingClientRect`(소수)**로(PG-81 · B3 — offset*은 반올림이라
 * 구멍이 카드와 최대 1px 엇갈렸다). 구멍이 된 카드는 제 그림자를 끈다 — 그림자가 구멍 안에서 번진 띠로 보였다.
 */
function MessageSlide({ slide, view, overlay }: { slide: Slide; view: Size; overlay: OverlayProps | null }) {
  const step = slide.step;
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => {
      const stage = el.closest('[data-stage]')?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!stage) return;
      setCard((c) => {
        const n = { x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height };
        return c && Math.abs(c.x - n.x) < 0.05 && Math.abs(c.y - n.y) < 0.05 && Math.abs(c.w - n.w) < 0.05 && Math.abs(c.h - n.h) < 0.05 ? c : n;
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view.w, view.h]);
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  if (step?.kind !== 'message') return null;
  const k = overlay?.k ?? 1;
  const u = view.w / 100;
  const pad = HOLE_PAD * u;
  const hole = card && { x: card.x - pad, y: card.y - pad, w: card.w + 2 * pad, h: card.h + 2 * pad };
  const radius = (CARD_R + HOLE_PAD) * u;
  const est = estimateBubble(step.label, step.say, null, view, k);
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
      {hole && <span aria-hidden className="coach-dim" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: radius }} />}
      <div
        ref={cardRef}
        className="absolute top-[30%] left-[8cqw] w-[48cqw] bg-canvas px-[2.4cqw] py-[2cqw] text-stage-ink"
        style={{ borderRadius: `${CARD_R}cqw` }}
      >
        <p className="flex items-center gap-[1cqw] text-[1.4cqw]">
          {/* eslint-disable-next-line @next/next/no-img-element -- 브랜드 SVG */}
          <img src="/brand/tincase-icon-sm.svg" alt="" className="h-[2cqw] w-[2cqw]" />
          <span className="text-stage-muted">사내 메신저 · {step.message.from}</span>
        </p>
        <p className="mt-[1cqw] text-[2.1cqw] leading-snug font-semibold">{fillWeek(step.message.subject)}</p>
        {step.message.lines.map((l) => (
          <p key={l} className="mt-[0.5cqw] text-[1.7cqw] leading-snug text-body">
            {fillWeek(l)}
          </p>
        ))}
      </div>
      {overlay && hole && layout && (
        <div className="coach-over" key={`${slide.key}:${overlay.hint}`}>
          <CoachRing hole={hole} radius={radius} />
          {overlay.interactive && (
            <button
              type="button"
              aria-label={`${step.label} — 눌러서 다음 단계로`}
              className="coach-hit"
              style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, ['--hole-r' as string]: `${radius}px` }}
              onClick={(e) => {
                e.stopPropagation();
                overlay.onHole(hole.x + hole.w / 2, hole.y + hole.h / 2);
              }}
            />
          )}
          <CoachBubble layout={layout} width={est.w} label={step.label} say={step.say} onMeasure={setMeasuredH} />
        </div>
      )}
    </div>
  );
}

/**
 * PG-59 — 주소는 실행할 때 읽는다. 코드에 적으면 공개 저장소에 내부 주소가 남는다.
 * `https://`는 빼고 호스트만 — 강당에서 받아 적을 글자가 줄고, 브라우저가 알아서 붙인다
 */
function AddressSlide({ caption, line, muted }: { caption: string; line: string; muted: string }) {
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
        <span className="text-brand">/guide</span>
      </p>
      <p className={`mt-[2.4cqw] text-[2cqw] ${muted}`}>{line}</p>
    </div>
  );
}
