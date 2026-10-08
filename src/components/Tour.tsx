'use client';
// CP-122 · CP-123 · PG-84 — 첫 로그인 **화면 둘러보기**. 실제 화면 위에 체험하기와 같은 말풍선·고리(CoachParts)를 놓는다.
//
// 사용자(2026-10-08): 「처음이시죠? 30초 둘러보기 [시작] [괜찮아요]」 — 구석의 작은 카드, **방해하지 않게.** 그래서:
//   - 카드는 오른쪽 아래에 작게, 초점을 가져가지 않는다. 드로어(aria-modal)가 열린 동안은 감춘다 — 작성 드로어 바닥의 [제출] 위다
//   - 어느 쪽을 골라도 다시는 저절로 안 뜬다(서버 기록 — DM-25). 새 역할이 생기면 그 장만 한 번 더 권한다(제안은 서버가 계산)
//   - **실제 동작은 일어나지 않는다.** 덮개는 `body`의 포털이고, 그동안 나머지 `body` 자식 전부에 `inert` — 클릭·키보드 초점·
//     화면 읽기가 실제 화면에 닿지 않는다. 구멍은 누를 수 없다(실제 단추처럼 보이는데 눌러도 아무 일이 없으면 「낸 줄」 안다 —
//     특히 [제출]·[승인]). 구멍·그늘을 누르면 고리만 다시 퍼진다. 넘기기는 도크로만. 둘러보기가 보내는 요청은 기록 하나
//     (`POST /api/me/tour`)와 장이 바뀔 때 그 페이지로 가는 GET뿐이다
//   - 앵커가 없거나 크기가 0이면 조용히 건너뛴다 — 그 사람에게 그려지지 않은 단추는 짚지 않는다(TACP-9가 거른 화면 그대로)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { BUBBLE_WIDTHS, coachLayout, estimateBubble, type CoachLayout } from '@/lib/guide/coach';
import type { Rect, Size } from '@/lib/guide/camera';
import {
  chaptersAt,
  isTourChapter,
  labelFromText,
  pickSteps,
  tourChapterOf,
  tourPath,
  type TourChapterId,
  type TourOutcome,
  type TourStep,
} from '@/lib/guide/tour';
import type { TourProp } from '@/server/tour';
import { CoachBubble, CoachDock, CoachRing } from './CoachParts';

/** 둘러보기의 길이 단위(px) — 말풍선 이름 18.9px · 문장 14.4px · 가장자리 27px (CP-120) */
const UNIT = 9;
/** 구멍 둘레 여백(px) */
const PAD = 8;
/** 카드가 뜨기까지 — 페이지를 먼저 보게 */
const OFFER_DELAY_MS = 1200;
const SCROLL_WAIT_MS = 450;
/** 장을 열 때 앵커가 그려지기를 기다리는 한도 — 페이지를 옮겨 온 직후의 `loading.tsx` */
const ANCHOR_WAIT_MS = 6000;

function record(chapters: readonly TourChapterId[], outcome: TourOutcome) {
  if (!chapters.length) return;
  // 기록이 실패해도 둘러보기는 그대로 — 다음에 카드가 한 번 더 뜰 뿐이다
  // keepalive — [괜찮아요]를 누르고 바로 다른 페이지로 가도 기록이 끊기지 않게
  void fetch('/api/me/tour', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chapters, outcome }),
  }).catch(() => {});
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 이 화면에 그려진 앵커 — 보이는 첫 것. 덮개 안의 것은 세지 않는다 */
function findAnchor(id: string, inside: HTMLElement | null): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-guide="${id}"]`)) {
    if (inside?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    return el;
  }
  return null;
}

interface Run {
  /** 이 페이지에서 볼 장 + 그 뒤 장들 (이야기 순서) */
  queue: TourChapterId[];
  /** queue 안의 지금 장 */
  at: number;
}

/**
 * CP-123 — 머리(AppHeader) 곁에 둔다. 서버가 준 `tour`(장 목록 · 제안 · 내 부서 슬러그)로 카드를 띄우고, 둘러보기를 연다.
 * 시작하는 길: 카드 [시작] · 주소 `?tour=<장>[&then=<장,…>]`(장이 바뀌어 옮겨 온 페이지 · 사용 안내 목차의 「화면에서」) ·
 * 사용자 메뉴 「화면 둘러보기」(`ask`가 바뀐다)
 */
export function TourHost({ tour, ask = 0 }: { tour: TourProp; ask?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  // 포털은 브라우저에서만 — 서버 그림에는 카드가 없다(1.2초 뒤에 뜨는 카드라 깜빡일 것도 없다)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [run, setRun] = useState<Run | null>(null);
  const [offerGone, setOfferGone] = useState(false);

  const go = useCallback(
    (queue: TourChapterId[]) => {
      const [first, ...rest] = queue;
      if (!first) return;
      const path = tourPath(first, tour.slug);
      if (path === pathname) {
        setRun({ queue, at: 0 });
        return;
      }
      setRun(null);
      router.push(`${path}?tour=${first}${rest.length ? `&then=${rest.join(',')}` : ''}`);
    },
    [pathname, router, tour.slug],
  );

  // 주소의 ?tour= — 장이 바뀌어 옮겨 왔거나 사용 안내의 「화면에서」로 왔다. 시작하면 주소에서 지운다(새로 고쳐도 다시 뜨지 않게)
  useEffect(() => {
    const fromUrl = () => {
      const q = new URLSearchParams(window.location.search);
      const first = q.get('tour');
      if (!first) return;
      q.delete('tour');
      const then = (q.get('then') ?? '').split(',').filter(isTourChapter);
      q.delete('then');
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${q.size ? `?${q}` : ''}${window.location.hash}`);
      if (!isTourChapter(first) || !tour.chapters.includes(first)) return;
      const queue = [first, ...then.filter((c) => c !== first && tour.chapters.includes(c))];
      if (tourPath(first, tour.slug) === pathname) setRun({ queue, at: 0 });
    };
    fromUrl();
  }, [pathname, tour.chapters, tour.slug]);

  // 사용자 메뉴 「화면 둘러보기」 — 지금 페이지의 장, 없으면 홈의 부서원 장. 기록과 상관없이 시작한다
  const lastAsk = useRef(ask);
  useEffect(() => {
    if (ask === lastAsk.current) return;
    lastAsk.current = ask;
    const here = chaptersAt(pathname, tour.slug, tour.chapters);
    go(here.length ? here : tour.chapters.slice(0, 1));
  }, [ask, pathname, tour.chapters, tour.slug, go]);

  const offer = tour.offer && !offerGone && !run ? tour.offer : null;

  const finishChapter = useCallback(
    (r: Run, outcome: 'done' | 'skipped') => {
      const cur = r.queue[r.at];
      if (outcome === 'skipped') {
        record(r.queue.slice(r.at), 'skipped');
        setRun(null);
        return;
      }
      record([cur], 'done');
      const next = r.queue[r.at + 1];
      if (!next) {
        setRun(null);
        return;
      }
      if (tourPath(next, tour.slug) === pathname) setRun({ ...r, at: r.at + 1 });
      else go(r.queue.slice(r.at + 1));
    },
    [go, pathname, tour.slug],
  );

  if (!mounted) return null;
  return (
    <>
      {offer && (
        <TourOffer
          title={offer.title}
          onStart={() => {
            setOfferGone(true);
            record(offer.chapters, 'started');
            go(offer.chapters);
          }}
          onNo={() => {
            setOfferGone(true);
            record(offer.chapters, 'dismissed');
          }}
        />
      )}
      {run && (
        <TourOverlay
          key={`${run.queue.join(',')}:${run.at}`}
          chapter={run.queue[run.at]}
          more={run.at < run.queue.length - 1}
          onEnd={(outcome) => finishChapter(run, outcome)}
        />
      )}
    </>
  );
}

/**
 * CP-122 — 구석 카드 「처음이시죠? 30초 둘러보기 [시작] [괜찮아요]」. 초점을 가져가지 않고(`role="region"`), 화면에
 * `aria-modal` 층이 있는 동안은 숨는다 — 작성 드로어의 [제출]이 오른쪽 아래에 있다. 1.2초 뒤에 나타난다 — 페이지를 먼저 보게
 */
function TourOffer({ title, onStart, onNo }: { title: string; onStart: () => void; onNo: () => void }) {
  const [late, setLate] = useState(false);
  const [modal, setModal] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), OFFER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    const check = () => setModal(!!document.querySelector('[aria-modal="true"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => mo.disconnect();
  }, []);
  if (!late || modal) return null;
  return createPortal(
    <div
      role="region"
      aria-label="화면 둘러보기 제안"
      data-tour-offer=""
      className="tour-offer fixed right-4 bottom-4 z-[60] w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-hairline bg-canvas p-4 shadow-[0_8px_24px_rgb(0_0_0/0.14)] print:hidden"
    >
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="text-sm text-muted">30초 둘러보기</p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onStart} className="btn-primary btn-sm">
          시작
        </button>
        <button type="button" onClick={onNo} className="btn-ghost">
          괜찮아요
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface Placed {
  step: TourStep;
  label: string;
  hole: Rect;
  radius: number;
}

/**
 * CP-123 — 한 장의 둘러보기 덮개. 앵커를 창 가운데로 스크롤하고(스크롤은 잠갔지만 코드로는 움직인다), 그 사각형 + 8px을 구멍으로,
 * 앵커의 둥글기 + 8px을 구멍 둥글기로(버튼과 동심 — PG-81) 그린다. 말풍선 자리는 무대와 같은 순수 함수(`coachLayout`)가
 * 창 크기·구멍·도크를 보고 정한다(단위 9px).
 */
function TourOverlay({ chapter, more, onEnd }: { chapter: TourChapterId; more: boolean; onEnd: (outcome: 'done' | 'skipped') => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const def = tourChapterOf(chapter);
  /*
   * 이 화면에 그려진 단계만 — 장을 열 때 고른다. 페이지를 막 옮겨 왔으면(장이 바뀌어 수합 관리로) 아직 `loading.tsx`가 떠 있을 수 있다 —
   * 앵커가 나타나고 수가 두 번 연달아 같을 때까지 기다린다(최대 ANCHOR_WAIT_MS). 그래도 없으면 그 장은 건너뛴다
   */
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  useEffect(() => {
    let last = -1;
    const started = Date.now();
    const look = () => {
      const found = pickSteps(def.steps, (a) => !!findAnchor(a, rootRef.current));
      if ((found.length > 0 && found.length === last) || Date.now() - started > ANCHOR_WAIT_MS) {
        setSteps(found);
        return true;
      }
      last = found.length;
      return false;
    };
    if (look()) return;
    const t = window.setInterval(() => {
      if (look()) window.clearInterval(t);
    }, 200);
    return () => window.clearInterval(t);
  }, [def]);
  const [i, setI] = useState(0);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  const [dock, setDock] = useState<Rect | null>(null);
  const [hint, setHint] = useState(0);
  const [bubbleH, setBubbleH] = useState<{ key: string; h: number } | null>(null);

  // 끝은 한 번만 알린다 — 키·도크·빈 장이 겹쳐 두 번 오면 다음 장을 건너뛴다
  const ended = useRef(false);
  const end = useCallback(
    (outcome: 'done' | 'skipped') => {
      if (ended.current) return;
      ended.current = true;
      onEnd(outcome);
    },
    [onEnd],
  );
  // 그릴 단계가 없으면 이 장은 건너뛴다(기록은 그대로 — 끝까지 본 것으로)
  useEffect(() => {
    if (steps && steps.length === 0) end('done');
  }, [steps, end]);

  // 덮개 밖은 inert + 문서 스크롤 잠금 — 끝나면 되돌린다
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const touched: [Element, boolean][] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === root || el.contains(root)) continue;
      touched.push([el, (el as HTMLElement).inert]);
      (el as HTMLElement).inert = true;
    }
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      for (const [el, was] of touched) (el as HTMLElement).inert = was;
      html.style.overflow = before;
    };
  }, []);

  const step = steps?.[i];
  const measure = useCallback(() => {
    setView({ w: window.innerWidth, h: window.innerHeight });
    // 도크는 덮개 바닥에 뜬 칸(.coach-dock) — 감싼 div가 아니라 그 칸을 잰다
    const d = dockRef.current?.querySelector('.coach-dock')?.getBoundingClientRect();
    if (d) setDock({ x: d.left, y: d.top, w: d.width, h: d.height });
    if (!step) return;
    const el = findAnchor(step.anchor, rootRef.current);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hole = { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
    const own = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    setPlaced({
      step,
      label: step.fromAnchor ? labelFromText(el.innerText, step.label) : step.label,
      hole,
      radius: Math.min(own + PAD, hole.h / 2, hole.w / 2),
    });
  }, [step]);

  // 단계마다: 앵커를 창 가운데로 스크롤 → 멈추면 잰다. 창 크기·글꼴이 바뀌면 다시 잰다
  useEffect(() => {
    if (!step) return;
    const el = findAnchor(step.anchor, rootRef.current);
    if (!el) {
      // 그새 사라졌다 — 다음으로
      setI((n) => n + 1);
      return;
    }
    setPlaced(null);
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      measure();
    };
    const t = window.setTimeout(settle, SCROLL_WAIT_MS);
    window.addEventListener('scrollend', settle, { once: true });
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(document.documentElement);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('scrollend', settle);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [step, measure]);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [i, steps]);

  const last = !steps || i >= steps.length - 1;
  const next = useCallback(() => {
    if (!steps) return; // 앵커를 기다리는 중
    if (last) end('done');
    else setI((n) => n + 1);
  }, [steps, last, end]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // 키 — → · Enter 다음, ← 이전, Esc 끝. 실제 화면은 inert라 키가 거기 닿지 않는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const onButton = e.target instanceof HTMLElement && e.target.closest('button');
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') end('skipped');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev, end]);

  // 말풍선 자리 — 넓은 것부터(38 → 31 → 24u), 도크를 피해서. 그린 뒤 잰 높이로 다시 놓는다
  const layout: (CoachLayout & { w: number }) | null = useMemo(() => {
    if (!placed || view.w <= 0) return null;
    const avoid = dock ? [dock] : [];
    let first: (CoachLayout & { w: number }) | null = null;
    for (const maxW of BUBBLE_WIDTHS) {
      const est = estimateBubble(placed.label, placed.step.say, null, view, 1, Math.min(maxW, (view.w - 6 * UNIT) / UNIT), UNIT);
      const key = `${placed.step.anchor}:${est.w}`;
      const size = { w: est.w, h: bubbleH?.key === key ? bubbleH.h : est.h };
      const l = { ...coachLayout(view, placed.hole, size, { avoid, unit: UNIT }), w: est.w };
      if (l.fits) return l;
      first ??= l;
    }
    return first;
  }, [placed, view, dock, bubbleH]);

  const onMeasure = useCallback(
    (h: number) => {
      if (!placed || !layout) return;
      const key = `${placed.step.anchor}:${layout.w}`;
      setBubbleH((b) => (b && b.key === key && Math.abs(b.h - h) < 0.5 ? b : { key, h }));
    },
    [placed, layout],
  );

  // 그릴 단계가 없는 장 — 곧 다음 장으로 넘어간다
  if (steps && steps.length === 0) return null;
  const labelId = 'tour-bubble-label';
  const here = placed && step && placed.step === step ? placed : null;
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      data-tour=""
      data-tour-step={`${chapter}:${i + 1}`}
      data-settled={here && layout ? '1' : undefined}
      className="fixed inset-0 z-[70] print:hidden"
      style={{ ['--cu' as string]: `${UNIT}px` }}
      // 구멍·그늘 어디를 눌러도 실제 화면에는 닿지 않는다 — 고리만 다시 퍼진다
      onClick={() => setHint((h) => h + 1)}
    >
      {here ? (
        <>
          <span
            aria-hidden
            className="tour-dim pointer-events-none absolute"
            style={{
              left: here.hole.x,
              top: here.hole.y,
              width: here.hole.w,
              height: here.hole.h,
              borderRadius: here.radius,
              boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.55)',
            }}
          />
          <CoachRing key={hint} hole={here.hole} radius={here.radius} />
          {layout && <CoachBubble layout={layout} width={layout.w} label={here.label} say={here.step.say} onMeasure={onMeasure} labelId={labelId} />}
        </>
      ) : (
        // 앵커를 기다리거나 스크롤하는 동안 — 그늘만. 고리·말풍선은 멈춘 뒤에
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[rgb(0_0_0/0.55)]" />
      )}
      <div ref={dockRef}>
        <CoachDock
          float
          count={steps ? `${def.title} ${i + 1}/${steps.length}` : def.title}
          onPrev={prev}
          onNext={next}
          canPrev={i > 0}
          canNext={!!steps}
          nextLabel={last ? (more ? '다음 장 →' : '끝') : '다음 →'}
          onSkip={() => end('skipped')}
          nextRef={nextRef}
        />
      </div>
      {!here && (
        <span id={labelId} className="sr-only">
          {def.title}
        </span>
      )}
    </div>,
    document.body,
  );
}
