'use client';
// CP-120 · CP-121 — 코치 마크의 부품 셋: 말풍선(`CoachBubble`) · 고리(`CoachRing`) · 도크(`CoachDock`).
//
// 무대(GuideStage — 그림 위)와 실제 화면 위의 둘러보기(TourOverlay — PG-84)가 **같은 부품**을 쓴다. 두 곳의 말풍선이 따로
// 생기면 하나만 고쳐지고 다른 하나는 낡는다(사용 안내가 조용히 낡던 것과 같은 이야기 — PG-63). 크기 단위는 CSS 변수
// `--cu`(무대 = 1cqw, 둘러보기 = 9px)라 모양은 같고 크기만 그 자리에 맞는다.
import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { labelOwnLine, type CoachLayout } from '@/lib/guide/coach';
import type { Rect } from '@/lib/guide/camera';

/**
 * 고리 — 구멍 가장자리 위에 걸친 흰 띠 + 퍼지는 고리(globals.css `.coach-ring`). 둥글기 `radius`는 버튼과 동심인 값이다(PG-81 —
 * `holeRadius`). 그늘 구멍과 **같은 사각형·같은 둥글기**를 받아야 이중 테두리가 생기지 않는다
 */
export function CoachRing({ hole, radius }: { hole: Rect; radius: number }) {
  return (
    <span
      aria-hidden
      className="coach-ring"
      style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, ['--hole-r' as string]: `${radius}px` }}
    />
  );
}

/**
 * 말풍선 「**이름:** 한 문장」 — 이름이 8자 이상이면 제 줄(`labelOwnLine`). 꼬리말은 있을 때만(체험하기 첫 단계 — PG-80).
 * 너비는 자리 계산에 쓴 어림 너비 그대로, 높이는 그린 뒤 재서 부모에게 알린다(`onMeasure` — 부모가 그 높이로 자리를 다시 잡는다).
 * **[다음] 단추는 없다** — 넘기기는 도크 한 곳이다(PG-80)
 */
export function CoachBubble({
  layout,
  width,
  label,
  say,
  foot = null,
  onMeasure,
  labelId,
}: {
  layout: CoachLayout;
  width: number;
  label: string;
  say: string;
  foot?: string | null;
  onMeasure?: (h: number) => void;
  /** 둘러보기 덮개의 `aria-labelledby` */
  labelId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    // 소수까지 — 반올림한 높이로 다시 놓으면 꼬리가 0.5px씩 흔들린다(PG-81)
    const report = () => onMeasure(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  const { bubble, arrow } = layout;
  const own = labelOwnLine(label);
  return (
    <div ref={ref} role="note" className="coach-bubble" style={{ left: bubble.x, top: bubble.y, width }} onClick={(e) => e.stopPropagation()}>
      <p className="coach-text">
        <strong id={labelId} className={`coach-label ${own ? 'block' : ''}`}>
          {label}:
        </strong>
        {own ? '' : ' '}
        {say}
      </p>
      {foot && <p className="coach-foot">{foot}</p>}
      <span
        aria-hidden
        className="coach-arrow"
        data-edge={arrow.edge}
        style={arrow.edge === 'left' || arrow.edge === 'right' ? { top: arrow.at } : { left: arrow.at }}
      />
    </div>
  );
}

/**
 * PG-80 — 도크 `[← 이전] [장 n/m] [다음 →]` (+ 둘러보기 [건너뛰기]). 칸 폭·높이는 CSS가 고정한다(`.coach-dock`) — 글자가 바뀌어도
 * 단추 상자는 그대로다. 없는 쪽은 지우지 않고 비활성으로 둔다(지우면 옆 칸이 밀린다). `data-dock`은 검사 손잡이(PG-T140)
 */
export function CoachDock({
  count,
  onPrev,
  onNext,
  canPrev,
  canNext,
  nextLabel = '다음 →',
  onSkip,
  float = false,
  nextRef,
  className = '',
}: {
  count: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** 마지막 단계의 「끝」·장이 바뀌는 「다음 장 →」 — 칸 폭은 그대로다 */
  nextLabel?: string;
  /** 둘러보기의 [건너뛰기] — 있으면 네 번째 칸 */
  onSkip?: () => void;
  /** 덮개 바닥 가운데에 뜬다 (크게 보기·둘러보기) */
  float?: boolean;
  nextRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const cell = 'w-full min-w-0 px-0';
  return (
    <div
      role="group"
      aria-label="넘기기"
      className={`coach-dock ${float ? 'coach-dock-float' : ''} ${onSkip ? 'coach-dock-skip' : ''} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" data-dock="prev" onClick={onPrev} disabled={!canPrev} className={`btn-secondary ${cell}`}>
        ← 이전
      </button>
      <span data-dock="count" className="coach-dock-count" aria-live="polite">
        {count}
      </span>
      <button ref={nextRef} type="button" data-dock="next" onClick={onNext} disabled={!canNext} className={`btn-primary ${cell}`}>
        {nextLabel}
      </button>
      {onSkip && (
        <button type="button" data-dock="skip" onClick={onSkip} className={`btn-ghost h-full ${cell}`}>
          건너뛰기
        </button>
      )}
    </div>
  );
}
