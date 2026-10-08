'use client';
// CP-102 · PG-59·60 — 발표 모드와 발표자 창. 11/2 운영회의, 강당 프로젝터 앞에서 발표자가 한 장씩 넘긴다.
//
// 이 화면에서 조작하는 손은 무선 프레젠터다 — 마우스는 거의 안 쓴다. 그래서:
//   - 키 → 번호는 리듀서 하나(`deckNav`)가 정하고, 프레젠터가 보내는 PageDown/PageUp을 반드시 받는다
//   - 커서는 2초 가만있으면 감춘다 — 화면 한가운데 화살표가 떠 있으면 청중이 그걸 본다
//   - 다음 그림은 미리 받아 둔다 — 강당 와이파이에서 넘길 때마다 빈 무대가 비치면 발표가 끊긴다
//   - 전체 화면은 브라우저가 「사용자가 누른 순간」에만 열어 준다 → 첫 화면에 [발표 시작]
//
// 발표자 창(?view=notes)은 같은 슬라이드 목록을 노트북 화면에 띄운다: 지금 장 · 다음 장 · 메모 · 지난 시간.
// 두 창은 BroadcastChannel로 어느 쪽에서 넘겨도 같이 넘어간다 — 프레젠터가 어느 창에 초점이 있든 상관없게.
//
// 2026-10-08 — 무대는 게임 튜토리얼식 코치 마크다(CP-101). 마우스로 밝게 뚫린 곳(누를 곳)이나 말풍선 [다음]을 누르면
// 다음 장, 어두운 곳을 누르면 넘기지 않고 「여기를 누르세요」를 다시 보인다 — 이것도 리듀서 하나(`deckNav`의 click)가 정한다.
// 프레젠터·키로 **버튼 단계**에서 넘길 때는 무대에 눌린 모양(손이 누르고 손끝에 물결)을 200ms 보인 뒤 넘긴다 — 컷만 바뀌면
// 「그 버튼을 눌러서 이 화면이 됐다」가 안 보였다(2026-10-08 검토). 눌린 모양은 두 창이 같이 보인다(`press` 알림).
// 메모(발표자가 말할 것)는 발표자 창에만 있다 — 강당 화면에는 말풍선 한 문장뿐이다.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DECK, presentSlides, type Slide } from '@/lib/guide/deck';
import { deckNav, isDeckKey, keyPressMs, type DeckNavAction, type DeckNavState, type StageTarget } from '@/lib/guide/nav';
import { shotOf } from '@/lib/guide/manifest';
import { GuideStage, pressable } from './GuideStage';

const CHANNEL = 'tincase-guide';
type Msg =
  | { t: 'hello'; from: string }
  | { t: 'state'; from: string; index: number; black: boolean }
  /** 넘기기 직전의 눌린 모양 — 받은 창도 같은 장에서 손이 누른다(넘기는 것은 곧 오는 state가 한다) */
  | { t: 'press'; from: string; index: number };

function indexFromHash(slides: Slide[]): number {
  if (typeof window === 'undefined') return 0;
  const key = decodeURIComponent(window.location.hash.slice(1));
  const i = slides.findIndex((s) => s.key === key);
  return i >= 0 ? i : 0;
}

/** 다음 두 장과 이전 한 장의 그림을 미리 받아 풀어 둔다 (`decode`) — 넘기는 순간 그릴 것만 남게 */
function usePreload(slides: Slide[], index: number) {
  const keep = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const i of [index + 1, index + 2, index - 1]) {
      const step = slides[i]?.step;
      if (step?.kind !== 'shot') continue;
      const shot = shotOf(step.id);
      if (!shot || keep.current.has(shot.src)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = shot.src;
      img.decode?.().catch(() => {});
      keep.current.set(shot.src, img);
    }
  }, [slides, index]);
}

/** 두 창 동기화 — 바뀐 쪽이 알리고, 받은 쪽은 다시 알리지 않는다. 돌려주는 함수는 눌린 모양을 상대 창에 알린다 */
function useDeckSync(state: DeckNavState, dispatch: (a: DeckNavAction) => void, onPress: (index: number) => void) {
  // 내 창의 이름 — 내가 보낸 것을 내가 다시 받지 않게. 그릴 때 만들지 않고 채널을 열 때 만든다
  const me = useRef('');
  const chan = useRef<BroadcastChannel | null>(null);
  /*
   * 상대 창이 알고 있는 상태. 이것과 다를 때만 알린다 — 그래서 받은 것을 되돌려 보내지 않고,
   * **막 열린 창이 제 첫 화면(0번)을 알리지도 않는다.** 발표 도중에 발표자 창을 열었는데 그 창이 「0번」을 알리면
   * 강당 화면이 표지로 튄다. 새 창은 `hello`로 물어서 맞춘다.
   */
  const known = useRef({ index: state.index, black: state.black });
  const latest = useRef(state);
  const pressRef = useRef(onPress);
  useEffect(() => {
    latest.current = state;
    pressRef.current = onPress;
  }, [state, onPress]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    me.current ||= Math.random().toString(36).slice(2);
    const from = me.current;
    const c = new BroadcastChannel(CHANNEL);
    chan.current = c;
    c.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (!m || m.from === from) return;
      if (m.t === 'hello') {
        const s = latest.current;
        c.postMessage({ t: 'state', from, index: s.index, black: s.black } satisfies Msg);
      } else if (m.t === 'state') {
        known.current = { index: m.index, black: m.black };
        dispatch({ type: 'sync', index: m.index, black: m.black });
      } else if (m.t === 'press') {
        pressRef.current(m.index);
      }
    };
    // 새로 연 창은 지금 어디인지 묻는다 — 발표 도중에 발표자 창을 열어도 같은 장에서 시작한다
    c.postMessage({ t: 'hello', from } satisfies Msg);
    return () => {
      c.close();
      chan.current = null;
    };
  }, [dispatch]);

  useEffect(() => {
    const k = known.current;
    if (k.index === state.index && k.black === state.black) return;
    known.current = { index: state.index, black: state.black };
    chan.current?.postMessage({ t: 'state', from: me.current, index: state.index, black: state.black } satisfies Msg);
  }, [state.index, state.black]);

  return useCallback((index: number) => chan.current?.postMessage({ t: 'press', from: me.current, index } satisfies Msg), []);
}

function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
    };
  }, [ms]);
  return idle;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

export function GuidePresent({ view }: { view: 'stage' | 'notes' }) {
  const slides = useMemo(() => presentSlides(), []);
  const total = slides.length;
  const [state, dispatch] = useReducer(
    (s: DeckNavState, a: DeckNavAction) => deckNav(s, a, total),
    undefined,
    () => ({ index: 0, black: false, buffer: '', hint: 0 }),
  );
  const [started, setStarted] = useState(view === 'notes');
  /*
   * 열 때 주소에서 읽은 번호. 그 번호로 옮겨 가기 전(첫 그리기 — 번호 0)에는 주소를 고쳐 쓰지 않는다.
   * 먼저 `#intro-1`을 써 버리면 개발 모드(StrictMode)가 효과를 한 번 더 돌릴 때 그것을 읽어,
   * #lead-3으로 연 발표가 표지로 돌아갔다(2026-10-08 검증). 다른 창의 상태가 먼저 와서 0이 아닌 곳으로 갔으면 그대로 쓴다
   */
  const opening = useRef<number | null>(null);

  // 주소의 #lead-3에서 시작 — 새로고침해도 그 장. 주소창에 #org-2를 고쳐 넣어도 그 장으로 간다
  useEffect(() => {
    const go = () => {
      const i = indexFromHash(slides);
      if (i || window.location.hash) dispatch({ type: 'goto', index: i });
      return i;
    };
    opening.current = go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [slides]);
  useEffect(() => {
    if (opening.current !== null) {
      if (opening.current !== 0 && state.index === 0) return;
      opening.current = null;
    }
    const key = slides[state.index]?.key;
    if (key && window.location.hash !== `#${key}`) window.history.replaceState(null, '', `#${key}`);
  }, [slides, state.index]);

  // 지금 상태 — 키 처리기가 기다렸다 넘길 때 그 순간의 장을 본다
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  // 눌린 모양 — 올라가면 무대의 손이 누른다(GuideStage `press`). 다른 창이 알려 와도 같은 장이면 같이 누른다
  const [press, setPress] = useState(0);
  const onRemotePress = useCallback((index: number) => {
    if (index === latest.current.index) setPress((p) => p + 1);
  }, []);
  const sendPress = useDeckSync(state, dispatch, onRemotePress);
  usePreload(slides, state.index);

  /*
   * 넘기기 키 — 버튼 단계면 눌린 모양을 KEY_PRESS_MS 보인 뒤 넘긴다. 기다리는 동안 또 누르면(프레젠터 연타) 기다리던 것을
   * 바로 넘기고 이번 키도 바로 처리한다 — 연타가 200ms씩 밀려 쌓이면 발표자는 몇 장 넘어갔는지 모른다
   */
  const pending = useRef<{ timer: number; key: string } | null>(null);
  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return false;
    window.clearTimeout(p.timer);
    pending.current = null;
    dispatch({ type: 'key', key: p.key });
    return true;
  }, []);
  useEffect(() => () => void (pending.current && window.clearTimeout(pending.current.timer)), []);
  const advance = useCallback(
    (key: string) => {
      if (flush()) {
        dispatch({ type: 'key', key });
        return;
      }
      const s = latest.current;
      const ms = keyPressMs(s, key, slides.length, pressable(slides[s.index]));
      if (ms > 0) {
        setPress((p) => p + 1);
        sendPress(s.index);
        pending.current = {
          key,
          timer: window.setTimeout(() => {
            pending.current = null;
            dispatch({ type: 'key', key });
          }, ms),
        };
        return;
      }
      dispatch({ type: 'key', key });
    },
    [flush, sendPress, slides],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setStarted(true);
        toggleFullscreen();
        return;
      }
      if (!isDeckKey(e.key)) return;
      if (!started) {
        // 시작 화면에서는 초점이 간 버튼([발표 시작]·[발표자 창])을 Enter·Space로 누를 수 있어야 한다 — 막으면 키보드로 시작하지 못한다
        if ((e.key === 'Enter' || e.key === ' ') && t instanceof Element && t.closest('button, a')) return;
        // 첫 키는 시작 화면만 닫고 넘기지 않는다 — 「처음부터 발표합니다」를 띄워 둔 채 프레젠터를 누르면 표지를 건너뛰었다
        e.preventDefault();
        setStarted(true);
        return;
      }
      // 버튼에 초점이 있을 때 Space·Enter가 그 버튼을 누르지 않게 — 발표 중의 Space는 언제나 「다음」이다
      e.preventDefault();
      // 키를 오래 누르고 있으면(자동 반복) 눌린 모양 없이 그대로 넘긴다
      if (e.repeat) {
        flush();
        dispatch({ type: 'key', key: e.key });
        return;
      }
      advance(e.key);
    },
    [dispatch, started, advance, flush],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const idle = useIdle(2000);
  const slide = slides[state.index];
  const go = advance;
  const click = useCallback(
    (target: StageTarget) => {
      flush();
      dispatch({ type: 'click', target });
    },
    [flush],
  );

  if (view === 'notes') {
    return (
      <NotesView slides={slides} state={state} press={press} go={go} click={click} jump={(index) => dispatch({ type: 'goto', index })} />
    );
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-stage text-canvas ${idle || state.black ? 'cursor-none' : ''}`}
    >
      <div className="w-[min(100vw,calc(100dvh*16/9))]">
        <PresentFrame slides={slides} index={state.index} hint={state.hint} press={press} onStageClick={started ? click : undefined} />
      </div>

      {/* 숫자 + Enter — 누르는 중인 숫자를 구석에 보인다 */}
      {state.buffer && (
        <p className="fixed bottom-4 left-4 rounded-lg bg-stage-soft px-3 py-1.5 text-lg font-semibold text-canvas tabular-nums">
          {state.buffer} <span className="text-stage-muted">Enter로 이동</span>
        </p>
      )}

      {/* 마우스를 움직일 때만 — 프레젠터만 쓰는 동안에는 아무것도 떠 있지 않다 */}
      {started && !idle && !state.black && (
        <div className="fixed right-4 bottom-4 flex items-center gap-2 text-sm">
          <span className="hidden text-stage-muted md:inline">밝은 곳 누르기 · → 다음 · ← 이전 · B 검은 화면 · F 전체 화면</span>
          <button onClick={openNotes} className="rounded-lg border border-stage-line bg-stage-soft px-3 py-1.5 text-canvas hover:border-stage-muted">
            발표자 창
          </button>
          <button onClick={toggleFullscreen} className="rounded-lg border border-stage-line bg-stage-soft px-3 py-1.5 text-canvas hover:border-stage-muted">
            전체 화면
          </button>
        </div>
      )}

      {!started && (
        <StartPanel
          onStart={() => {
            setStarted(true);
            document.documentElement.requestFullscreen().catch(() => {});
          }}
          onClose={() => setStarted(true)}
          slide={slide}
          index={state.index}
        />
      )}

      {/* B · . — 검은 화면. 아무 넘기기 키나 누르면 같은 장으로 돌아온다 (넘기지 않는다) */}
      {state.black && <div aria-label="검은 화면" className="fixed inset-0 z-50 bg-stage" />}
    </div>
  );
}


function openNotes() {
  window.open('/guide/present?view=notes', 'tincase-guide-notes', 'width=1280,height=800');
}

/** 시작 화면의 키 표 — 「+」는 키가 아니라 「함께」 */
const KEYS: [string, string[]][] = [
  ['다음', ['→', '↓', 'Space', 'PageDown']],
  ['이전', ['←', '↑', 'PageUp']],
  ['검은 화면', ['B']],
  ['전체 화면', ['F']],
  ['번호로 이동', ['숫자', '+', 'Enter']],
  ['처음·끝', ['Home', 'End']],
];

function StartPanel({ onStart, onClose, slide, index }: { onStart: () => void; onClose: () => void; slide: Slide; index: number }) {
  // 바탕을 92%로 덮는다 — 80%면 뒤의 표지 로고가 패널 위로 비쳐 두 겹으로 보였다
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stage/92 p-6">
      <div className="w-full max-w-xl rounded-2xl border border-stage-line bg-stage-soft p-8">
        <p className="text-sm font-semibold text-brand-tint">사용 안내 · 발표 모드</p>
        <h1 className="mt-1 text-[26px] leading-tight font-semibold">
          {index === 0 ? '처음부터' : `${index + 1}번째 장(${slide.chapter.title})부터`} 발표합니다
        </h1>
        <table className="mt-5 w-full text-[15px]">
          <tbody>
            {KEYS.map(([what, keys]) => (
              <tr key={what}>
                <th scope="row" className="w-32 py-1.5 pr-4 text-left align-middle font-medium text-stage-muted">
                  {what}
                </th>
                <td className="py-1.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {keys.map((k) =>
                      k === '+' ? (
                        <span key={k} className="text-stage-muted">
                          +
                        </span>
                      ) : (
                        <kbd key={k} className="rounded-md border border-stage-line bg-stage px-1.5 py-0.5 font-sans text-[13px] text-canvas">
                          {k}
                        </kbd>
                      ),
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[15px] text-stage-muted">
          무선 프레젠터의 넘김 버튼도 그대로 됩니다. 마우스로는 밝게 뚫린 곳(누를 버튼)을 누르면 다음 장, 어두운 곳을 누르면 「여기를
          누르세요」를 다시 보입니다.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <button
            onClick={openNotes}
            className="inline-flex h-11 items-center rounded-lg border border-stage-line px-5 text-[15px] font-medium text-canvas hover:border-stage-muted"
          >
            발표자 창
          </button>
          <button onClick={onStart} className="btn-primary border border-brand-tint">
            발표 시작
          </button>
          <button onClick={onClose} className="ml-auto text-sm text-stage-muted underline-offset-2 hover:text-canvas hover:underline">
            전체 화면 없이 보기
          </button>
        </div>
        <p className="mt-4 text-xs leading-5 text-stage-muted">
          발표자 창은 노트북 화면에 두세요. 지금 장·다음 장·메모·시간이 보이고, 어느 창에서 넘겨도 같이 넘어갑니다.
        </p>
      </div>
    </div>
  );
}

/**
 * 16:9 무대 한 장 — 발표 화면·발표자 창·혼자 보기의 「크게 보기」가 같은 것을 쓴다.
 *
 * 2026-10-08 — 위의 검은 제목 띠를 걷었다. 글은 무대 안의 말풍선이 맡고(「제출: 다 적었으면 여기를 눌러요」),
 * 장·순번은 구석의 작은 알약(「부서원 3/8」, GuideStage)이 맡는다 — 띠가 화면을 깎아 먹고 「발표 자료」처럼 읽혔다.
 * 맨 아래 얇은 진행 막대만 남는다. 초록은 이 막대와 작은 글자에만 (CP-105)
 */
export function PresentFrame({
  slides,
  index,
  still = false,
  hint = 0,
  press = 0,
  onStageClick,
}: {
  slides: Slide[];
  index: number;
  still?: boolean;
  hint?: number;
  /** 넘기기 직전의 눌린 모양 (GuideStage `press`) */
  press?: number;
  /** 무대를 누른 곳 — 없으면 누를 것을 그리지 않는다(다음 장 그림·시작 화면 뒤) */
  onStageClick?: (target: StageTarget) => void;
}) {
  const slide = slides[index];
  const pct = ((index + 1) / slides.length) * 100;
  return (
    <div className="@container relative aspect-video w-full overflow-hidden bg-stage text-canvas">
      <GuideStage
        slide={slide}
        index={index}
        theme="dark"
        still={still}
        hint={hint}
        press={press}
        onClick={onStageClick}
        className="absolute inset-0"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[0.32cqw] bg-stage-soft/80" aria-hidden>
        <div className="h-full bg-brand-tint transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function useElapsed() {
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  return { secs, now, reset: () => setStart(Date.now()) };
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** 발표자 메모를 문장으로 — 한 줄에 한 문장, 첫 문장은 굵게. 발표 중에는 한 덩어리 글보다 줄의 첫머리가 눈에 잡힌다 */
export function sentencesOf(notes: string): string[] {
  return notes
    .split(/(?<=[.?!])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** PG-60 — 발표자 창. 노트북 화면에 둔다 */
function NotesView({
  slides,
  state,
  press,
  go,
  click,
  jump,
}: {
  slides: Slide[];
  state: DeckNavState;
  press: number;
  go: (key: string) => void;
  click: (target: StageTarget) => void;
  jump: (index: number) => void;
}) {
  const slide = slides[state.index];
  const next = slides[state.index + 1];
  const { secs, now, reset } = useElapsed();
  // 목표 시간(분) — 운영회의에서 받은 시간 안에 끝내려면 남은 시간이 보여야 한다. 0이면 재기만
  const [target, setTarget] = useState(25);
  const clock = new Date(now).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const notes = slide.step ? slide.step.notes : (slide.chapter.notes ?? slide.chapter.lede ?? '');
  // 강당 화면에 지금 떠 있는 말풍선 — 메모와 함께 보여 발표자가 화면과 다른 말을 하지 않게
  const bubble = slide.step ? `${slide.step.label}: ${slide.step.say}` : slide.chapter.lede ?? '';
  const left = target * 60 - secs;
  // 질의응답 때 「담당자 화면 다시 보여 주세요」에 바로 가도록 — 장마다 첫 장(역할 장이면 장 제목)으로
  const starts = DECK.map((c) => ({ c, i: slides.findIndex((s) => s.chapter.id === c.id) })).filter((x) => x.i >= 0);
  const btn =
    'inline-flex h-12 items-center justify-center rounded-lg border border-stage-line bg-stage-soft px-5 text-[16px] font-medium text-canvas hover:border-stage-muted';

  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-5 bg-stage p-5 text-canvas">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-[34px] leading-none font-semibold tabular-nums">{mmss(secs)}</p>
        {target > 0 && (
          <p className={`text-lg tabular-nums ${left < 0 ? 'font-semibold text-canvas' : 'text-stage-muted'}`}>
            {left < 0 ? `${mmss(-left)} 넘음` : `남은 ${mmss(left)}`}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-stage-muted">
          목표
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="rounded-md border border-stage-line bg-stage-soft px-2 py-1 text-canvas"
          >
            <option value={0}>없음</option>
            {[15, 20, 25, 30, 40].map((m) => (
              <option key={m} value={m}>
                {m}:00
              </option>
            ))}
          </select>
        </label>
        <button onClick={reset} className="text-sm text-stage-muted underline-offset-2 hover:text-canvas hover:underline">
          다시 재기
        </button>
        <p className="text-lg text-stage-muted tabular-nums">지금 {clock}</p>
        <p className="ml-auto text-lg tabular-nums">
          <span className="font-semibold">{state.index + 1}</span>
          <span className="text-stage-muted"> / {slides.length}</span>
          {slide.n > 0 && (
            <span className="ml-3 text-brand-tint">
              {slide.chapter.title} · {slide.n}/{slide.of}
            </span>
          )}
        </p>
        {state.black && <span className="rounded-full bg-stage-soft px-3 py-1 text-sm font-semibold text-brand-tint">검은 화면 중</span>}
      </header>

      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section aria-label="지금 장" className="self-start overflow-hidden rounded-xl border border-stage-line">
          <PresentFrame slides={slides} index={state.index} hint={state.hint} press={press} onStageClick={click} />
        </section>
        <aside className="flex min-h-0 flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-stage-muted tabular-nums">
              {next ? `다음 · ${state.index + 2} ${next.chapter.title} ${next.n > 0 ? `${next.n}/${next.of}` : '장 카드'}` : '다음'}
            </p>
            {next ? (
              <div className="overflow-hidden rounded-xl border border-stage-line opacity-90">
                <PresentFrame slides={slides} index={state.index + 1} still />
              </div>
            ) : (
              <p className="rounded-xl border border-stage-line px-4 py-8 text-center text-stage-muted">마지막 장입니다</p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-stage-soft p-5">
            {bubble && <p className="mb-3 text-sm text-stage-muted">화면 · {bubble}</p>}
            <p className="text-sm font-semibold text-stage-muted">메모</p>
            <div className="mt-2 space-y-2 text-[24px] leading-[1.55]">
              {sentencesOf(notes).map((t, i) => (
                <p key={i} className={i === 0 ? 'font-semibold' : ''}>
                  {t}
                </p>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <footer className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => go('ArrowLeft')} className={btn}>
            ← 이전
          </button>
          <button onClick={() => go('ArrowRight')} className={`${btn} border-brand-tint`}>
            다음 →
          </button>
          <button onClick={() => go('b')} className={btn}>
            {state.black ? '화면 다시 보이기' : '검은 화면'}
          </button>
          <p className="ml-auto text-sm text-stage-muted">이 창에서 넘겨도 발표 화면이 같이 넘어갑니다 · 키는 발표 화면과 같습니다</p>
        </div>
        <nav aria-label="장으로 이동" className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-stage-muted">장으로</span>
          {starts.map(({ c, i }) => {
            const here = slide.chapter.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => jump(i)}
                aria-current={here ? 'true' : undefined}
                className={`rounded-full border px-3 py-1.5 ${
                  here ? 'border-brand-tint font-semibold text-canvas' : 'border-stage-line text-stage-muted hover:border-stage-muted hover:text-canvas'
                }`}
              >
                {c.title}
              </button>
            );
          })}
        </nav>
      </footer>
    </div>
  );
}
