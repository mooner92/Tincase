// PG-62 — 찍은 그림의 목록. `node scripts/guide-capture.cjs`가 그림과 함께 다시 쓴다 — 손으로 고치지 않는다.
//
// 사각형은 **그림 좌표(CSS px)** 다. 그림은 1600×900 창을 배율 2로 찍은 것이라 실제 픽셀은 3200×1800이지만,
// 무대는 그림을 CSS px 크기의 판 위에 놓고 그 판을 옮기므로 사각형도 CSS px로 둔다(CP-101).
import raw from '../../../public/guide/deck/manifest.json';
import type { Rect } from './camera';

export interface ShotInfo {
  /** `public/guide/deck/` 아래 파일 이름 */
  file: string;
  /** 실제 픽셀 크기 (배율이 곱해진 것) */
  width: number;
  height: number;
  /** 구멍 — 누를 곳 (코치 마크에서 밝게 뚫리는 곳) */
  focus: Rect;
  /** 카메라가 담을 곳 */
  frame: Rect;
  /** 찍을 때 쓴 앵커 — 단계의 anchor와 다르면 낡은 그림이다 (PG-T84) */
  anchor: string;
  /**
   * 바닥색 — 그림 맨 아래 한 줄을 왼쪽부터 색 토막으로(`x` = 토막이 시작하는 자리, 그림 폭 대비 0–1). 카메라가 그림 아래를
   * 비우면(camera.ts BOTTOM_SLACK) 그 자리를 이 색으로 칠한다 — 드로어 바닥의 [제출]이면 왼쪽은 회색 바탕, 오른쪽은 흰 드로어가
   * 그대로 밑으로 이어진다. 검정으로 두면 가장 중요한 단계에서 화면 아래가 검은 띠였다(2026-10-08 검토)
   */
  ground: GroundStop[];
}

export interface GroundStop {
  x: number;
  /** `#rrggbb` */
  color: string;
}

export interface DeckManifest {
  /** 찍은 시각 — 그림 주소 뒤에 붙여 브라우저가 예전 그림을 쓰지 않게 한다 */
  version: string;
  /** 찍을 때의 주차 (「10월 2주차」) — 알림 모양 슬라이드의 `{week}` */
  week: string;
  /** 찍은 창 크기 (CSS px) — 사각형의 좌표계 */
  viewport: { width: number; height: number };
  scale: number;
  shots: Record<string, ShotInfo>;
}

export const MANIFEST = raw as DeckManifest;

/** 그림 주소. 없으면 null — 아직 안 찍은 단계(새로 넣은 단계)는 글자로만 그린다 */
export function shotOf(id: string): (ShotInfo & { src: string }) | null {
  const s = MANIFEST.shots[id];
  if (!s) return null;
  return { ...s, src: `/guide/deck/${s.file}${MANIFEST.version ? `?v=${MANIFEST.version}` : ''}` };
}

/** 바닥색을 CSS 배경으로 — 한 색이면 그 색, 여럿이면 경계가 딱 떨어지는 가로 띠 */
export function groundCss(ground: readonly GroundStop[] | undefined): string {
  if (!ground?.length) return 'var(--color-ground)';
  if (ground.length === 1) return ground[0].color;
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  const stops = ground.map((g, i) => `${g.color} ${pct(g.x)} ${pct(ground[i + 1]?.x ?? 1)}`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** 그림 폭의 `fx`(0–1) 자리의 바닥색 — 잘라 보기(휴대폰·인쇄)가 그림 밖으로 나간 곳을 칠할 때 */
export function groundAt(ground: readonly GroundStop[] | undefined, fx: number): string {
  if (!ground?.length) return 'var(--color-ground)';
  let c = ground[0].color;
  for (const g of ground) if (g.x <= fx) c = g.color;
  return c;
}

/** `{week}` → 찍은 주차. 찍기 전이면 「이번 주」 */
export function fillWeek(text: string): string {
  return text.replaceAll('{week}', MANIFEST.week || '이번 주');
}
