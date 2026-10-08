// CP-101 · PG-58 — 게임 튜토리얼식 「코치 마크」의 자리. 말풍선을 어디에 둘지는 **순수 함수 하나**가 정한다.
//
// 2026-10-08 사용자: 「거창한 설명보다, 게임에서 어디 누르라고 그 버튼만 빼고 검은 필터를 씌우고 옆에 팝업처럼
// 『인벤토리: 습득한 아이템은 여기서 확인할 수 있어요』 — 그렇게 직관적으로」. 그래서 한 단계는
//   화면 전체를 어둡게 덮고 → 누를 곳만 둥글게 뚫고(구멍) → 그 옆에 말풍선 「이름: 한 문장」 → 누르라는 손
// 이다. 말풍선이 구멍을 가리거나 무대 밖으로 삐져나가면 그 단계는 망가진 것인데, 그림이 서른 장이고 무대 크기는
// 발표 화면·발표자 창·혼자 보기마다 다르다 — 눈으로는 다 못 본다. 그래서 자리 계산을 여기 떼어 두고, 테스트가
// 모든 단계를 1080p·720p 무대에서 잰다(PG-T89).
//
// 길이는 모두 **무대 폭의 1%(cqw)** 를 단위로 쓴다. 무대의 글자도 cqw라, 1920px 프로젝터든 발표자 창의 작은 그림이든
// 같은 모양이 나온다 — 자리 계산도 무대 크기와 상관없이 같은 답을 낸다. 실제 화면 위의 둘러보기(PG-84)는 같은 말풍선을
// 창 위에 놓는데, 창 폭의 1%면 휴대폰에서 글자가 4px이 된다 — 그래서 단위를 인자(`unit`)로 받는다(둘러보기는 9px).
//
// 2026-10-08 v2(PG-80) — 말풍선 안의 [다음]을 없앴다. 구멍 옆에 높이 가운데 맞춤으로 놓이는 말풍선 속 단추는 글 양·구멍 자리마다
// 움직였다(사용자: 「버튼은 같은 위치에 있어야 연속적으로 누를 때 피로가 덜하다」). 넘기기는 화면마다 한 곳의 도크가 맡는다.
import { cameraFor, union, type Camera, type CameraOptions, type Rect, type Size } from './camera';

/**
 * 말풍선 치수 (cqw). 1920px 무대에서 이름 40px · 문장 31px · 꼬리말 21px — 강당 뒤에서 읽히는 크기(PG-59).
 * 너비는 38cqw(약 730px)까지 — 대부분의 「이름: 문장」이 **한 줄**에 들어간다. 2026-10-08 검토: 한 줄짜리(「제출: 다 적었으면
 * 여기를 눌러요」)가 가장 게임 말풍선처럼 읽혔고, 31cqw에서는 「…복사: 복사해서 / 메신저에…」처럼 이름과 문장이 섞여 끊겼다.
 */
export const BUBBLE = {
  label: 2.1,
  say: 1.6,
  foot: 1.1,
  lineHeight: 1.3,
  padX: 1.4,
  padY: 1.1,
  /** 문장과 꼬리말 사이 */
  footGap: 0.7,
  maxW: 38,
  /** 꼬리(구멍 쪽을 가리키는 세모)의 크기 — 말풍선 변에서 튀어나오는 길이 (2.0cqw 마름모의 반 대각선) */
  arrow: 1.4,
  radius: 1.0,
} as const;

/**
 * 이름이 이 글자 수 이상이면 말풍선에서 **제 줄**에 놓고 문장은 그 밑에 둔다. 「미제출 2명 이름 복사: 메신저에…」를 한 줄에
 * 이어 쓰면 줄바꿈이 이름과 문장 사이 아무 데서나 나서, 어디까지가 화면의 이름인지 안 보였다
 */
export const LABEL_OWN_LINE = 8;
export const labelOwnLine = (label: string) => [...label].length >= LABEL_OWN_LINE;

/** 구멍 둘레 여백 (cqw) — 버튼 테두리가 구멍 끝에 붙어 잘려 보이지 않을 만큼만 */
export const HOLE_PAD = 0.5;
/** 구멍(과 손)에서 말풍선까지 (cqw) — 꼬리(1.4cqw)가 들어가고도 조금 남게 */
export const GAP = 2.0;
/** 말풍선은 무대 가장자리에서 이만큼 안쪽 (cqw) — 프로젝터가 가장자리를 2~3% 먹어도(오버스캔) 글자가 남는다 */
export const MARGIN = 3;
/**
 * 누르라는 손 (cqw). 그림 상자 안에서 손끝의 자리(`tipX`·`tipY`, 비율)와, 손끝을 구멍의 어디에 두나(`atX`·`atY`, 구멍 비율).
 * 손끝은 버튼의 **오른쪽 아래 모서리 쪽**(0.78·0.90)에 얹고 손은 20° 기울여(`angle`) 구멍 **밖**으로 뻗는다 — 2026-10-08 검토:
 * 손끝이 버튼 가운데(0.62·0.66)를 짚으니 손가락이 「이름」·「(새 버전)」·「만들기」 글자를 가렸다
 */
export const HAND = { w: 3.4, h: 4.1, tipX: 0.24, tipY: 0.04, angle: -20, atX: 0.78, atY: 0.9 } as const;
/** 구석의 「부서원 3/8」 알약 (cqw) — 말풍선이 이 위에 놓이지 않는다. 발표 무대에만 있다(혼자 보기는 목차가 자리를 말한다) */
export const PILL = { x: 2.4, y: 2.2, h: 2.8, font: 1.25, padX: 1.2 } as const;
/**
 * 카메라가 다가가는 한도 — 전체가 보이는 배율의 몇 배까지. 앞에서부터 해 보고, 말풍선 놓을 자리가 없으면 덜 다가간다.
 * 예전(제목 띠 판)은 2.2배까지 다가가 앱 글자를 30px로 키웠다 — 글은 이제 말풍선이 맡으므로 화면은 「어디쯤인가」가
 * 보일 만큼만(게임 카메라처럼) 키운다. 1.5배면 1080p 무대에서 앱의 15px 글자가 27px이다
 */
export const ZOOM_STEPS: readonly number[] = [1.5, 1.35, 1.2, 1];

/**
 * 말풍선 너비의 한도들 (cqw, 말풍선 배율 전). 넓은 것부터 해 보고 — 넓으면 한 줄에 들어간다 — 옆에 자리가 모자라면 좁고 키 큰
 * 말풍선으로. 24cqw면 가장 긴 이름(「계획 2줄을 이번 주 실적으로」)도 제 줄 하나다
 */
export const BUBBLE_WIDTHS: readonly number[] = [BUBBLE.maxW, 31, 24];

/** 구멍이 무엇인가 — 누르는 것(버튼·고쳐 적는 칸)이면 손이 붙는다. 보기만 하는 칩·합계·칸 묶음은 손이 없다 */
export type CoachTarget = 'button' | 'area';

/**
 * 말풍선 꼬리말 — 무엇을 누르면 넘어가나. 체험하기의 **첫 코치 단계에만** 붙는다(PG-80 — 매 단계 같은 줄이면 읽히지 않고,
 * 말풍선 높이가 단계마다 달라진다). 발표·둘러보기에는 없다
 */
export const footOf = (target: CoachTarget) => (target === 'button' ? '버튼을 눌러 계속' : '밝은 곳을 눌러 계속');

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 두 사각형이 겹치나 (변이 닿기만 하면 겹치지 않는다) */
export function intersects(a: Rect, b: Rect, eps = 0.5): boolean {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

/** `inner`가 `outer` 안에 있나 */
export function inside(inner: Rect, outer: Rect, eps = 0.5): boolean {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

// ── 글자 너비 어림 ─────────────────────────────────────────────────────────────
// 자리를 정하려면 말풍선 크기가 먼저 있어야 한다. 브라우저에서는 그린 뒤에 높이를 다시 재지만(GuideStage),
// 카메라는 그 전에 정해야 하고 테스트에는 브라우저가 없다 — 그래서 글자 너비를 조금 넉넉하게 어림한다.
// 값은 앱 글꼴(페이퍼로지)을 브라우저에서 잰 것이다(2026-10-08, 100px 글자): 한글 88 · 숫자 67 · 영문 59–62 ·
// 띄어쓰기 22 · 「·:,」 24–33 · 「()[]」 31–35 · 「「」」 40–41 · 「—」 111. 어림이 실제보다 작으면 말풍선이 한 줄 늘어나
// 아래로 길어질 뿐(그린 뒤 다시 재서 놓는다), 구멍을 덮지는 않는다.

function glyphEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f)) return 0.9;
  if (ch === '—') return 1.12;
  if ('…→○'.includes(ch)) return 1;
  if ('「」『』'.includes(ch)) return 0.42;
  if (ch === ' ') return 0.23;
  if ('·:,.!?\'"'.includes(ch)) return 0.34;
  if ('()[]'.includes(ch)) return 0.36;
  if (/[0-9]/.test(ch)) return 0.68;
  return 0.63;
}

/** 글자 줄의 너비 (px) — `px`는 글자 크기 */
export function textWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) em += glyphEm(ch);
  return em * px;
}

/** 어림에 얹는 여유 — 굵은 글꼴·글꼴이 뜨기 전의 대체 글꼴(Pretendard·맑은 고딕은 한글이 조금 넓다) */
const SAFETY = 1.05;

/**
 * 말풍선 크기 어림 — 「**이름:** 문장」을 낱말 단위로 줄에 채운다(CSS `word-break: keep-all` — 한글도 띄어쓰기에서만
 * 줄을 바꾼다. 낱말 가운데서 잘리면 「눌러/요」가 된다). 이름이 길면(`labelOwnLine`) 이름 줄과 문장 줄을 따로 채운다.
 * 꼬리말(`foot`)이 있으면 마지막 줄 — 없으면(`null`) 그 줄의 높이도 없다.
 *
 * `k`는 말풍선 배율 — 혼자 보기 무대는 모니터 안의 800px 남짓이라 1.2배로 키운다(같은 cqw면 문장이 13px이다).
 * `unit`은 길이 단위(px) — 무대는 무대 폭의 1%, 둘러보기는 9px(CP-120).
 */
export function estimateBubble(
  label: string,
  say: string,
  foot: string | null,
  stage: Size,
  k = 1,
  maxW: number = BUBBLE.maxW,
  unit: number = stage.w / 100,
): Size {
  const u = unit * k;
  const fl = BUBBLE.label * u;
  const fs = BUBBLE.say * u;
  const ff = BUBBLE.foot * u;
  const inner = (maxW - 2 * BUBBLE.padX) * u;
  const own = labelOwnLine(label);
  const words = [
    ...`${label}:`.split(' ').map((t) => ({ t, px: fl, brk: false })),
    ...say
      .split(' ')
      .filter(Boolean)
      .map((t, i) => ({ t, px: fs, brk: own && i === 0 })),
  ];
  const lines: { w: number; big: boolean }[] = [];
  let cur = { w: 0, big: false };
  for (const { t, px, brk } of words) {
    const ww = textWidth(t, px) * SAFETY;
    const sp = textWidth(' ', px);
    if (cur.w > 0 && (brk || cur.w + sp + ww > inner)) {
      lines.push(cur);
      cur = { w: 0, big: false };
    }
    // 한 낱말이 한 줄보다 길면 그 낱말이 줄을 넘긴다 — 몇 줄인지 센다
    const extra = Math.max(0, Math.ceil(ww / inner) - 1);
    for (let i = 0; i < extra; i++) lines.push({ w: inner, big: px === fl });
    cur = { w: cur.w + (cur.w > 0 ? sp : 0) + Math.min(ww, inner), big: cur.big || px === fl };
  }
  lines.push(cur);
  // 꼬리말 줄 — 글자만(PG-80: [다음]은 도크로 갔다). 없으면 그 줄과 위 여백이 없다
  const footW = foot ? textWidth(foot, ff) * SAFETY : 0;
  const footH = foot ? BUBBLE.footGap * u + ff * BUBBLE.lineHeight : 0;
  const contentW = Math.min(inner, Math.max(footW, ...lines.map((l) => l.w)));
  const textH = lines.reduce((h, l) => h + (l.big ? fl : fs) * BUBBLE.lineHeight, 0);
  return {
    w: contentW + 2 * BUBBLE.padX * u,
    h: textH + footH + 2 * BUBBLE.padY * u,
  };
}

/** 구석 알약의 사각형 (무대 좌표) — 자리는 무대 기준, 크기는 말풍선 배율 `k`를 따른다 */
export function pillRect(stage: Size, text: string, k = 1): Rect {
  const u = stage.w / 100;
  return { x: PILL.x * u, y: PILL.y * u, w: (textWidth(text, PILL.font * u * k) * SAFETY + 2 * PILL.padX * u * k), h: PILL.h * u * k };
}

/** 혼자 보기 무대의 말풍선 배율 — 모니터 안의 800px 남짓 무대에서 문장이 15px이 되게(발표 무대 1920px에서는 31px) */
export const SELF_K = 1.2;

// ── 구멍·손·말풍선 ────────────────────────────────────────────────────────────

/**
 * PG-81 — 구멍의 둥글기 (무대 px). 찍을 때 잰 앵커의 둥글기(`radius`, 그림 px)에 배율을 곱하고 여백을 더하면 버튼과 **동심**이다 —
 * 늘 같은 둥글기(0.9cqw)를 쓰던 때는 모서리에서만 틈이 넓어 고리가 버튼에서 비껴 보였다. 높이 절반을 넘지 않는다(알약 모양까지)
 */
export function holeRadius(radius: number | undefined, scale: number, pad: number, hole: Rect): number {
  const r = (radius ?? 8) * scale + pad;
  return Math.max(0, Math.min(r, hole.h / 2, hole.w / 2));
}

/** 카메라를 거친 누를 곳 = 구멍 (무대 좌표, 둘레 여백 포함, 무대 안으로 자른다) */
export function holeOf(cam: Camera, focus: Rect, stage: Size): Rect {
  const p = HOLE_PAD * (stage.w / 100);
  const x0 = Math.max(0, cam.x + focus.x * cam.scale - p);
  const y0 = Math.max(0, cam.y + focus.y * cam.scale - p);
  const x1 = Math.min(stage.w, cam.x + (focus.x + focus.w) * cam.scale + p);
  const y1 = Math.min(stage.h, cam.y + (focus.y + focus.h) * cam.scale + p);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export interface HandBox extends Rect {
  /** 손끝 (무대 좌표) */
  tipX: number;
  tipY: number;
  /** 거울 — 1이면 손이 오른쪽(아래)으로, -1이면 왼쪽(위)으로 뻗는다 */
  fx: 1 | -1;
  fy: 1 | -1;
  /** 돌리기 전의 그림 상자 (무대 좌표) — 그릴 때는 이 상자에 놓고 손끝을 축으로 `scale(fx, fy) rotate(angle)` */
  box: Rect;
}

/**
 * 누르라는 손의 자리. `x·y·w·h`는 돌리고 뒤집은 **뒤의** 바깥 상자 — 말풍선·알약이 이것을 피한다.
 * 손끝은 구멍의 오른쪽 아래 모서리 쪽(`HAND.atX`·`atY`), 거울(`fx`·`fy`)이면 그 반대 모서리 쪽을 짚는다.
 * 손은 손끝에서 바깥(오른쪽 아래)으로 뻗는다 — 버튼 글자를 덮지 않고, 「저 모서리를 누르라」가 아니라 「이 버튼」으로 읽힌다
 */
export function handOf(hole: Rect, u: number, fx: 1 | -1 = 1, fy: 1 | -1 = 1): HandBox {
  const w = HAND.w * u;
  const h = HAND.h * u;
  const tipX = hole.x + hole.w * (fx === 1 ? HAND.atX : 1 - HAND.atX);
  const tipY = hole.y + hole.h * (fy === 1 ? HAND.atY : 1 - HAND.atY);
  const box: Rect = { x: tipX - HAND.tipX * w, y: tipY - HAND.tipY * h, w, h };
  // CSS transform-origin = 손끝, transform = scale(fx, fy) rotate(angle) — 먼저 돌리고 그다음 뒤집는다
  const a = (HAND.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [
    [box.x, box.y],
    [box.x + w, box.y],
    [box.x, box.y + h],
    [box.x + w, box.y + h],
  ].map(([px, py]) => {
    const dx = px - tipX;
    const dy = py - tipY;
    return [tipX + fx * (dx * cos - dy * sin), tipY + fy * (dx * sin + dy * cos)];
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, tipX, tipY, fx, fy, box };
}

export type Side = 'right' | 'left' | 'below' | 'above';
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface CoachLayout {
  side: Side;
  /** 말풍선 (무대 좌표) */
  bubble: Rect;
  /** 꼬리 — 말풍선의 어느 변에서(`edge`), 그 변의 시작(왼쪽·위 끝)에서 몇 px(`at`)에 */
  arrow: { edge: Edge; at: number };
  /** 누르라는 손 — 보기만 하는 영역이면 없다 */
  hand: HandBox | null;
  /** 무대 안 · 구멍과 손을 덮지 않음 · 알약을 덮지 않음 — 넷 다 지켰나 */
  fits: boolean;
}

/** 오른쪽 → 왼쪽 → 아래 → 위. 버튼은 대개 옆에 자리가 있고, 가로로 넓은 칸은 위아래에 남는다 */
export const SIDES: readonly Side[] = ['right', 'left', 'below', 'above'];

/**
 * 말풍선 쪽마다 손을 뻗을 방향(거울)의 차례 — 손은 **말풍선 반대쪽**으로 뻗는다. 말풍선이 오른쪽이면 손은 왼쪽 아래로,
 * 아래면 손이 위에서 내려온다. 같은 쪽으로 뻗으면 말풍선이 손을 피해 멀리 밀려나 꼬리가 허공을 가리켰다
 */
const HAND_WAYS: Record<Side, readonly (readonly [1 | -1, 1 | -1])[]> = {
  right: [[-1, 1], [-1, -1], [1, 1], [1, -1]],
  left: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  below: [[1, -1], [-1, -1], [1, 1], [-1, 1]],
  above: [[1, 1], [-1, 1], [1, -1], [-1, -1]],
};

export interface CoachOptions {
  /** 말풍선(과 손)이 덮지 않을 것 — 구석 알약, 둘러보기의 도크 */
  avoid?: readonly Rect[];
  /** 누르라는 손을 그리나 — 누르는 것(`target: 'button'`)일 때 */
  hand?: boolean;
  /** 길이 단위(px) — 기본 무대 폭의 1%. 둘러보기는 9px (CP-120) */
  unit?: number;
}

/**
 * PG-T89 — 말풍선의 자리. 구멍 옆의 빈 쪽(오른쪽 → 왼쪽 → 아래 → 위)에 두고, 구멍 가운데를 향해 꼬리를 낸다.
 * 무대 가장자리에서 `MARGIN` 안쪽으로 밀어 넣되, 구멍과 손 쪽으로는 밀지 않는다(그쪽은 `GAP`을 지킨다) —
 * 그래서 말풍선은 무대 밖으로도, 구멍 위로도 가지 않는다. 네 쪽 다 안 되면 `fits: false`(카메라가 덜 다가가 다시 해 본다).
 */
export function coachLayout(stage: Size, hole: Rect, bubble: Size, opts: CoachOptions = {}): CoachLayout {
  const avoid = opts.avoid ?? [];
  const u = opts.unit ?? stage.w / 100;
  const m = MARGIN * u;
  const g = GAP * u;
  const area: Rect = { x: m, y: m, w: stage.w - 2 * m, h: stage.h - 2 * m };
  const all: Rect = { x: 0, y: 0, w: stage.w, h: stage.h };
  const cx = hole.x + hole.w / 2;
  const cy = hole.y + hole.h / 2;
  const r = BUBBLE.radius * u;
  const a = BUBBLE.arrow * u;

  const place = (side: Side, hand: HandBox | null): CoachLayout => {
    const keep = hand ? union(hole, hand) : hole;
    const { w, h } = bubble;
    let x: number;
    let y: number;
    if (side === 'right' || side === 'left') {
      x = side === 'right' ? keep.x + keep.w + g : keep.x - g - w;
      y = clamp(cy - h / 2, area.y, area.y + area.h - h);
      // 알약과 겹치면 알약 밑으로 내린다
      for (const o of avoid) {
        if (intersects({ x, y, w, h }, o)) y = clamp(o.y + o.h + g, area.y, area.y + area.h - h);
      }
    } else {
      y = side === 'below' ? keep.y + keep.h + g : keep.y - g - h;
      x = clamp(cx - w / 2, area.x, area.x + area.w - w);
      for (const o of avoid) {
        if (intersects({ x, y, w, h }, o)) x = clamp(o.x + o.w + g, area.x, area.x + area.w - w);
      }
    }
    const box: Rect = { x, y, w, h };
    const edge: Edge = side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'below' ? 'top' : 'bottom';
    const along = edge === 'left' || edge === 'right' ? clamp(cy - y, r + a, h - r - a) : clamp(cx - x, r + a, w - r - a);
    const fits =
      inside(box, area) && !intersects(box, hole) && !(hand && intersects(box, hand)) && avoid.every((o) => !intersects(box, o));
    return { side, bubble: box, arrow: { edge, at: along }, hand, fits };
  };

  const tries = SIDES.flatMap((side) => {
    if (!opts.hand) return [place(side, null)];
    // 무대 안에 들고 알약을 덮지 않는 손만 — 말풍선 반대쪽으로 뻗는 것부터
    const hands = HAND_WAYS[side]
      .map(([fx, fy]) => handOf(hole, u, fx, fy))
      .filter((hd) => inside(hd, all) && avoid.every((o) => !intersects(hd, o)));
    return (hands.length ? hands : [handOf(hole, u)]).map((hd) => place(side, hd));
  });
  const ok = tries.find((t) => t.fits);
  if (ok) return ok;
  // 어디에도 안 들어간다 — 구멍을 가장 덜 덮는 쪽 (카메라가 덜 다가가 다시 해 본다)
  const cover = (t: CoachLayout) => {
    const b = t.bubble;
    const ox = Math.max(0, Math.min(b.x + b.w, hole.x + hole.w) - Math.max(b.x, hole.x));
    const oy = Math.max(0, Math.min(b.y + b.h, hole.y + hole.h) - Math.max(b.y, hole.y));
    return ox * oy;
  };
  return tries.reduce((best, t) => (cover(t) < cover(best) ? t : best));
}

export interface CoachPlan {
  cam: Camera;
  hole: Rect;
  /** 이 계획이 쓴 말풍선 크기(어림) — 무대는 이 너비로 그리고, 높이는 그린 뒤 다시 잰다 */
  bubble: Size;
  layout: CoachLayout;
}

/**
 * 그림 단계 하나의 카메라 + 구멍 + 말풍선. 카메라는 `cameraFor`(누를 곳 둘레를 담는다)를 `ZOOM_STEPS`의 한도로 차례로
 * 해 보고, 한도마다 말풍선을 넓은 것부터(`BUBBLE_WIDTHS`) 놓아 본다 — 들어가는 첫 조합을 쓴다. 버튼은 대개 첫 한도(1.5배)
 * 에서 옆에 한 줄 말풍선이 들어가고, 넓은 칸은 덜 다가가야 위아래에 자리가 난다. `bubble`은 너비 한도(cqw)를 받아 크기를 주는 함수다.
 */
export function coachPlan(
  stage: Size,
  image: Size,
  shot: { focus: Rect; frame: Rect },
  bubble: (maxW: number) => Size,
  opts: CameraOptions & CoachOptions = {},
): CoachPlan {
  let first: CoachPlan | null = null;
  const sizes = BUBBLE_WIDTHS.map(bubble);
  for (const maxZoom of ZOOM_STEPS) {
    const cam = cameraFor(stage, image, union(shot.frame, shot.focus), { ...opts, maxZoom });
    const hole = holeOf(cam, shot.focus, stage);
    for (const size of sizes) {
      const layout = coachLayout(stage, hole, size, opts);
      const plan = { cam, hole, bubble: size, layout };
      if (layout.fits) return plan;
      first ??= plan;
    }
  }
  return first!;
}
