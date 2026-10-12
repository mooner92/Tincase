// CP-101 — 안내 무대의 카메라. 그림의 어느 사각형을 창 안 어디에 얼마나 크게 놓을지.
//
// 순수 계산으로 떼어 둔 이유: 「사각형이 창 밖으로 잘린다」·「그림 바깥의 빈 곳이 보인다」·「글자가 강당 뒤에서 안 읽힌다」는
// 눈으로만 잡히는데, 그림이 서른 장이고 창 크기는 발표·모니터·발표자 창마다 다르다. 규칙을 테스트로 고정한다(PG-T88).
//
// 2026-10-08 디자인 검토에서 바꾼 것 — 앱의 15px 글자가 1080p 무대에서 15–22px로밖에 안 보였다(강당 뒤에서 못 읽는다):
//   - 최소 배율을 「다 보이는 배율(fit)」이 아니라 「무대를 다 덮는 배율(cover)」로 — 발표 무대는 16:9보다 낮아서(제목 띠)
//     fit이면 양옆에 147px 검은 띠가 생겼다. 혼자 보기의 무대는 16:9라 둘이 같다
//   - 최대 배율은 찍은 배율의 1.15배까지 — 그 이상은 그림을 늘려 그리는 것이라 글자가 번진다
//   - 사각형 가운데를 무대 높이 46%에 — 정가운데보다 조금 위. 강당에서 화면 아래쪽은 앞사람 머리에 가린다
//   - 보이는 위 끝이 앱 머리(메뉴 줄)를 반쯤 자르지 않게 — 반 잘린 메뉴는 화면이 깨진 것처럼 읽힌다
//
// 같은 날 게임 튜토리얼식 코치 마크로 바꾸며(coach.ts) 다가가는 한도를 `maxZoom`으로 낮춰 부른다 — 글은 말풍선이 맡으므로
// 화면은 「어디쯤인가」가 보일 만큼만 키우고 말풍선 놓을 자리를 남긴다. 위의 규칙(덮는 배율·번짐 한도·높이·앱 머리)은 그대로다.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** `translate(x, y) scale(scale)` — transform-origin 0 0 */
export interface Camera {
  scale: number;
  x: number;
  y: number;
}

/** 전체가 보이는 배율의 몇 배까지 다가가나 */
export const MAX_ZOOM = 2.2;
/** 찍은 배율(manifest.scale)의 몇 배까지 키우나 — 그 이상은 그림을 늘려 그려 글자가 번진다 */
export const OVERZOOM = 1.15;
/** 사각형 둘레에 남길 여백 (사각형 크기 대비) — 구멍 테두리가 창 끝에 붙지 않게 */
export const PAD = 0.12;
/** 사각형 가운데를 둘 높이 (무대 높이 대비) — 정가운데(0.5)보다 조금 위 */
export const AIM_Y = 0.46;
/** 사각형 아래 끝을 이보다 내리지 않는다 (무대 높이 대비) — 키 큰 사각형(로그인 카드)은 가운데에 두면 바닥에 닿는다 */
export const FOCUS_BOTTOM = 0.85;
/**
 * 그림 아래 끝 밑으로 비워 둘 수 있는 높이 (무대 높이 대비). 드로어 바닥에 붙은 [제출]처럼 그림 맨 아래의 버튼은
 * 이것 없이는 무대 맨 아래에 놓인다(가린다). 비운 곳은 그 그림의 **바닥색**(manifest `ground` — 그림 맨 아래 한 줄의 색)으로
 * 칠한다 — 그늘 밑에서 같은 앱이 조금 더 이어진 것으로 읽힌다(CP-101). 2026-10-08 검토 전에는 무대 바탕(검정)으로 흐렸는데,
 * 가장 중요한 [제출] 단계에서 화면 아래 14%가 검은 띠로 남았다
 */
export const BOTTOM_SLACK = 0.14;
/** 앱 머리(AppHeader `h-16` + 테두리 1px) — 모든 그림의 맨 위 띠 */
export const APP_HEADER = 65;

export interface CameraOptions {
  /** 그림을 찍은 배율 (manifest.scale) — 최대 배율을 정한다 */
  captureScale?: number;
  /** 그림 맨 위 앱 머리의 높이 — 보이는 위 끝이 이 띠 안에 걸리지 않게 */
  header?: number;
  /**
   * 전체가 보이는 배율의 몇 배까지 다가가나 (기본 `MAX_ZOOM`). 코치 마크(coach.ts)는 더 덜 다가간다 —
   * 말풍선이 글을 맡으니 화면은 「어디쯤인가」가 보일 만큼만 키우고, 말풍선 놓을 자리를 남긴다(2026-10-08)
   */
  maxZoom?: number;
}

/** 그림 전체가 창 안에 들어오는 카메라 (가운데 맞춤) — 줌을 끈 무대 */
export function fitCamera(view: Size, image: Size): Camera {
  const scale = Math.min(view.w / image.w, view.h / image.h);
  return { scale, x: (view.w - image.w * scale) / 2, y: (view.h - image.h * scale) / 2 };
}

/** 그림이 창을 다 덮는 가장 작은 배율 — 빈 띠가 생기지 않는다 */
export function coverScale(view: Size, image: Size): number {
  return Math.max(view.w / image.w, view.h / image.h);
}

/**
 * 「어느 화면인가」를 먼저 보이는 카메라 — 창을 다 덮는 배율, 위쪽(앱 머리·페이지 제목)에 맞춘다.
 * 다른 화면으로 넘어갈 때 여기서 시작해 다가간다(PG-58)
 */
export function overviewCamera(view: Size, image: Size): Camera {
  const scale = coverScale(view, image);
  return { scale, x: (view.w - image.w * scale) / 2, y: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * `frame`을 창 안에 담는 카메라.
 *
 * - 배율: 사각형(+여백)이 창에 다 들어오는 가장 큰 값. 단 창을 다 덮는 배율보다 작아지지 않고,
 *   전체 배율의 `MAX_ZOOM`배와 찍은 배율의 `OVERZOOM`배 중 작은 것을 넘지 않는다
 * - 가로: 사각형 가운데를 창 가운데로. 그림 끝이 창 안으로 들어오지 않게 민다
 * - 세로: 사각형 가운데를 창 높이 `AIM_Y`에 — 그러면 아래 끝이 `FOCUS_BOTTOM`을 넘는 키 큰 사각형은 위 끝이 창에
 *   닿을 때까지 올린다. 위로는 그림 끝까지, 아래로는 `BOTTOM_SLACK`만큼만 비울 수 있다.
 *   보이는 위 끝이 앱 머리 띠 안이면, 사각형이 잘리지 않는 쪽으로 머리를 다 보이거나 다 감춘다
 */
export function cameraFor(view: Size, image: Size, frame: Rect | null | undefined, opts: CameraOptions = {}): Camera {
  if (!frame || frame.w <= 0 || frame.h <= 0 || view.w <= 0 || view.h <= 0) return overviewCamera(view, image);

  const fit = Math.min(view.w / image.w, view.h / image.h);
  const cover = coverScale(view, image);
  const want = Math.min(view.w / (frame.w * (1 + 2 * PAD)), view.h / (frame.h * (1 + 2 * PAD)));
  const ceiling = Math.max(cover, Math.min(fit * (opts.maxZoom ?? MAX_ZOOM), (opts.captureScale ?? Infinity) * OVERZOOM));
  const scale = clamp(want, cover, ceiling);

  const shownW = image.w * scale;
  const shownH = image.h * scale;
  const x = shownW <= view.w ? (view.w - shownW) / 2 : clamp(view.w / 2 - (frame.x + frame.w / 2) * scale, view.w - shownW, 0);

  if (shownH <= view.h) return { scale, x, y: (view.h - shownH) / 2 };
  const lowest = view.h * (1 - BOTTOM_SLACK) - shownH; // 그림 아래 끝이 이보다 위로 올라가지 않는다
  let y = view.h * AIM_Y - (frame.y + frame.h / 2) * scale;
  y = Math.min(y, Math.max(-frame.y * scale, view.h * FOCUS_BOTTOM - (frame.y + frame.h) * scale));
  y = clamp(y, lowest, 0);

  const header = opts.header ?? 0;
  const top = -y / scale; // 보이는 위 끝 (그림 좌표)
  if (header > 0 && top > 0.5 && top < header) {
    const fits = (yy: number) => (frame.y * scale + yy >= -0.5) && ((frame.y + frame.h) * scale + yy <= view.h + 0.5);
    const hide = -header * scale; // 머리를 다 감춘다
    if (hide >= lowest && fits(hide)) y = hide;
    else if (fits(0)) y = 0; // 머리를 다 보인다
  }
  return { scale, x, y };
}

/** 두 사각형을 다 담는 사각형 — 구멍(누를 곳)이 카메라 사각형 밖으로 삐져나와도 둘 다 보이게 */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * 좁은 화면·인쇄의 잘라 보기 — 카메라 사각형 둘레에 여백(`PAD`)을 두고 4:3으로 넓힌 뒤 그림 안으로 민다.
 * 휴대폰 폭(약 360px)에 1600px 그림 전체를 그리면 버튼 글자가 3–4px이 된다(PG-61)
 */
export function cropFor(image: Size, frame: Rect, aspect = 4 / 3): Rect {
  let w = frame.w * (1 + 2 * PAD);
  let h = frame.h * (1 + 2 * PAD);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  if (w > image.w) {
    w = image.w;
    h = w / aspect;
  }
  if (h > image.h) {
    h = image.h;
    w = h * aspect;
  }
  const x = clamp(frame.x + frame.w / 2 - w / 2, 0, image.w - w);
  const y = clamp(frame.y + frame.h / 2 - h / 2, 0, image.h - h);
  return { x, y, w, h };
}

/** 잘라 보기에서 구멍이 가장자리에서 떨어져 있어야 할 몫 (잘라 낸 폭·높이 대비) */
export const CROP_MARGIN = 0.12;

/**
 * 휴대폰·인쇄의 잘라 보기 (PG-61). `cropFor`처럼 카메라 사각형 둘레를 4:3으로 자르되, 구멍(`hole`)이 가장자리에서
 * `CROP_MARGIN` 넘게 안쪽에 오게 민다 — 그러느라 그림 밖으로 나가도 된다(그 자리는 그림의 바닥색으로 칠한다).
 * 2026-10-08 검토: 드로어 바닥 오른쪽 끝의 [제출]은 그림 안으로만 자르면 고리가 오른쪽·아래 끝에서 잘렸다
 */
export function cropAround(image: Size, frame: Rect, hole: Rect, aspect = 4 / 3, margin = CROP_MARGIN): Rect {
  let { x, y, w, h } = cropFor(image, frame, aspect);
  // 구멍이 여백을 두고 들어갈 만큼 크게
  const need = Math.max(hole.w / (1 - 2 * margin), (hole.h / (1 - 2 * margin)) * aspect);
  if (need > w) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    w = need;
    h = w / aspect;
    x = cx - w / 2;
    y = cy - h / 2;
  }
  x = clamp(x, hole.x + hole.w + margin * w - w, hole.x - margin * w);
  y = clamp(y, hole.y + hole.h + margin * h - h, hole.y - margin * h);
  return { x, y, w, h };
}
