// PG-59 · CP-102 — 발표 키·무대 클릭 → 슬라이드 번호. **순수 함수 하나**가 정한다.
//
// 강당에서 쓰는 손은 넷이다: 키보드, 무선 프레젠터, 발표자 창의 버튼, 그리고 무대를 누르는 마우스. 프레젠터는 제조사마다
// 보내는 키가 다르지만 거의 다 PageDown/PageUp이고, 검은 화면 버튼은 「.」이나 「B」다(PowerPoint 관례). 키마다 조건을
// 컴포넌트에 흩어 두면 어느 손이 무엇을 하는지 테스트할 곳이 없다 — 그래서 여기 하나에 모으고 표로 고정한다(PG-T85·T90).
//
// 무대 클릭은 게임 튜토리얼과 같다(2026-10-08): **밝게 뚫린 곳(누를 곳)을 누르면 다음**(그 버튼을 누른 뒤의 화면이
// 다음 단계다 — 흉내일 뿐 실제로는 아무것도 바뀌지 않는다), **어두운 곳을 누르면 넘기지 않고 「여기를 누르세요」를 다시
// 보인다**(테두리가 다시 퍼지고 손이 다시 두드린다). 어두운 곳을 눌렀다고 넘어가면 아무 데나 눌러도 되는 화면이 되어,
// 「어디를 누르는가」를 익히는 안내가 아니게 된다. v2(PG-80) — 말풍선의 [다음]은 없다. 넘기기 단추는 화면마다 한 곳의 도크다.

export interface DeckNavState {
  /** 0부터 */
  index: number;
  /** 검은 화면 — 청중의 눈을 발표자에게 돌릴 때 */
  black: boolean;
  /** 숫자 + Enter로 이동할 때 모으는 숫자 */
  buffer: string;
  /** 「여기를 누르세요」를 다시 보인 횟수 — 바뀌면 무대가 테두리·손을 처음부터 다시 움직인다. 창끼리 나누지 않는다 */
  hint: number;
}

/**
 * 무대에서 누른 곳.
 *   cutout  밝게 뚫린 곳(누를 곳)
 *   dim     어둡게 덮인 곳
 *   card    글자 슬라이드(표지·장 카드·정리) — 누를 곳이 따로 없다
 */
export type StageTarget = 'cutout' | 'dim' | 'card';

/** PG-T90 — 누른 곳 → 할 일. 어두운 곳만 「다시 알려 주기」, 나머지는 다음 장 */
export function stageClick(target: StageTarget): 'next' | 'hint' {
  return target === 'dim' ? 'hint' : 'next';
}

/*
 * 눌린 모양 (2026-10-08 검토 — 컷만 바뀌면 「그 버튼을 눌러서 이 화면이 됐다」가 안 보였다). 넘기기 **전에** 무대가
 * 누른 것을 잠깐 보인다: 구멍을 마우스로 누르면 그 자리에 흰 물결과 살짝 들어간 구멍(160ms), 버튼 단계에서 프레젠터·키로
 * 넘기면 손이 누르고 손끝에 물결(200ms). 그 밖의 넘기기(도크·이전·숫자 이동·글자 슬라이드)는 기다리지 않는다 —
 * 도크는 안내의 단추지 화면의 버튼이 아니다.
 */
export const CLICK_PRESS_MS = 160;
export const KEY_PRESS_MS = 200;

/** PG-T90 — 이 클릭이 넘기기 전에 눌린 모양을 몇 ms 보이나 */
export function clickPressMs(target: StageTarget): number {
  return target === 'cutout' ? CLICK_PRESS_MS : 0;
}

/** PG-T90 — 이 키가 넘기기 전에 눌린 모양을 몇 ms 보이나. 버튼 단계에서 실제로 다음 장으로 넘어가는 키만 */
export function keyPressMs(state: DeckNavState, key: string, total: number, buttonStep: boolean): number {
  if (!buttonStep || state.black || state.buffer || !NEXT_KEYS.includes(key)) return 0;
  return state.index < total - 1 ? KEY_PRESS_MS : 0;
}

export type DeckNavAction =
  | { type: 'key'; key: string }
  | { type: 'goto'; index: number }
  /** 다른 창이 알려 온 상태 — 그대로 받는다 (번호만 범위 안으로) */
  | { type: 'sync'; index: number; black: boolean }
  /** 무대를 눌렀다 (`stageClick`) */
  | { type: 'click'; target: StageTarget };

export const NEXT_KEYS: readonly string[] = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'];
export const PREV_KEYS: readonly string[] = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
const BLACK_KEYS: readonly string[] = ['b', 'B', '.'];

/** 리듀서가 다루는 키인가 — 다루는 키만 브라우저 기본 동작(스크롤·뒤로 가기)을 막는다 */
export function isDeckKey(key: string): boolean {
  return (
    NEXT_KEYS.includes(key) ||
    PREV_KEYS.includes(key) ||
    BLACK_KEYS.includes(key) ||
    key === 'Home' ||
    key === 'End' ||
    key === 'Escape' ||
    /^[0-9]$/.test(key)
  );
}

const clamp = (i: number, total: number) => Math.max(0, Math.min(total - 1, i));

export function deckNav(state: DeckNavState, action: DeckNavAction, total: number): DeckNavState {
  if (total <= 0) return state;

  if (action.type === 'goto') {
    const index = clamp(action.index, total);
    return index === state.index && !state.black && !state.buffer ? state : { ...state, index, black: false, buffer: '' };
  }
  if (action.type === 'click') {
    // 검은 화면 위의 클릭은 키와 같다 — 넘기지 않고 화면만 돌아온다
    if (state.black) return { ...state, black: false, buffer: '' };
    if (stageClick(action.target) === 'hint') return { ...state, hint: state.hint + 1, buffer: '' };
    return state.index < total - 1 ? { ...state, index: state.index + 1, buffer: '' } : state;
  }
  if (action.type === 'sync') {
    const index = clamp(action.index, total);
    return index === state.index && action.black === state.black ? state : { ...state, index, black: action.black };
  }

  const { key } = action;

  // 숫자 + Enter — 「12 Enter」면 12번째 장. 세 자리면 충분하다(단계는 마흔 장이 안 된다)
  if (/^[0-9]$/.test(key)) return { ...state, buffer: (state.buffer + key).slice(-3) };
  if (state.buffer) {
    if (key === 'Enter') {
      const n = Number(state.buffer);
      return { ...state, index: n >= 1 ? clamp(n - 1, total) : state.index, black: false, buffer: '' };
    }
    if (key === 'Backspace') return { ...state, buffer: state.buffer.slice(0, -1) };
    if (key === 'Escape') return { ...state, buffer: '' };
  }

  if (BLACK_KEYS.includes(key)) return { ...state, black: !state.black, buffer: '' };

  /*
   * 검은 화면 중에 넘기기 키를 누르면 **넘기지 않고 돌아오기만** 한다 (PowerPoint와 같다).
   * 청중을 보며 말하다가 프레젠터를 한 번 누르는 것은 「다시 보여 달라」는 뜻이다 —
   * 그때 한 장이 건너뛰면 발표자는 무엇을 놓쳤는지도 모른 채 다음 장을 설명한다.
   */
  if (state.black && (NEXT_KEYS.includes(key) || PREV_KEYS.includes(key) || key === 'Escape')) {
    return { ...state, black: false };
  }

  if (NEXT_KEYS.includes(key)) return state.index < total - 1 ? { ...state, index: state.index + 1 } : state;
  if (PREV_KEYS.includes(key)) return state.index > 0 ? { ...state, index: state.index - 1 } : state;
  if (key === 'Home') return state.index === 0 ? state : { ...state, index: 0 };
  if (key === 'End') return state.index === total - 1 ? state : { ...state, index: total - 1 };
  return state;
}
