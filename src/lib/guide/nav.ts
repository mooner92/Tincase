// PG-59 · CP-102 — 발표 키 → 슬라이드 번호. **순수 함수 하나**가 정한다.
//
// 강당에서 쓰는 손은 셋이다: 키보드, 무선 프레젠터, 발표자 창의 버튼. 프레젠터는 제조사마다 보내는 키가 다르지만
// 거의 다 PageDown/PageUp이고, 검은 화면 버튼은 「.」이나 「B」다(PowerPoint 관례). 키마다 조건을 컴포넌트에
// 흩어 두면 어느 손이 무엇을 하는지 테스트할 곳이 없다 — 그래서 여기 하나에 모으고 표로 고정한다(PG-T85).

export interface DeckNavState {
  /** 0부터 */
  index: number;
  /** 검은 화면 — 청중의 눈을 발표자에게 돌릴 때 */
  black: boolean;
  /** 숫자 + Enter로 이동할 때 모으는 숫자 */
  buffer: string;
}

export type DeckNavAction =
  | { type: 'key'; key: string }
  | { type: 'goto'; index: number }
  /** 다른 창이 알려 온 상태 — 그대로 받는다 (번호만 범위 안으로) */
  | { type: 'sync'; index: number; black: boolean };

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
    return index === state.index && !state.black && !state.buffer ? state : { index, black: false, buffer: '' };
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
      return { index: n >= 1 ? clamp(n - 1, total) : state.index, black: false, buffer: '' };
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
