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
/** 사각형 둘레에 남길 여백 (사각형 크기 대비) — 스포트라이트 테두리가 창 끝에 붙지 않게 */
export const PAD = 0.12;
/** 사각형 가운데를 둘 높이 (무대 높이 대비) — 정가운데(0.5)보다 조금 위 */
export const AIM_Y = 0.46;
/** 사각형 아래 끝을 이보다 내리지 않는다 (무대 높이 대비) — 키 큰 사각형(로그인 카드)은 가운데에 두면 바닥에 닿는다 */
export const FOCUS_BOTTOM = 0.85;
/**
 * 그림 아래 끝 밑으로 비워 둘 수 있는 높이 (무대 높이 대비). 드로어 바닥에 붙은 [제출]처럼 그림 맨 아래의 버튼은
 * 이것 없이는 무대 맨 아래에 놓인다(가린다). 그림 끝은 바탕색으로 흐려져 잘린 것처럼 보이지 않는다(CP-101)
 */
export const BOTTOM_SLACK = 0.14;
/** 앱 머리(AppHeader `h-16` + 테두리 1px) — 모든 그림의 맨 위 띠 */
export const APP_HEADER = 65;

export interface CameraOptions {
  /** 그림을 찍은 배율 (manifest.scale) — 최대 배율을 정한다 */
  captureScale?: number;
  /** 그림 맨 위 앱 머리의 높이 — 보이는 위 끝이 이 띠 안에 걸리지 않게 */
  header?: number;
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
  const ceiling = Math.max(cover, Math.min(fit * MAX_ZOOM, (opts.captureScale ?? Infinity) * OVERZOOM));
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

/** 두 사각형을 다 담는 사각형 — 스포트라이트가 카메라 사각형 밖으로 삐져나와도 둘 다 보이게 */
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
