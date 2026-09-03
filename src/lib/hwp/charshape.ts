// S-08 L1.5 — 글자 색 (HM-37).
//
// **왜 필요한가.** 기획조정실 작성 규칙에 「전체 공유·전달이 필요한 주요 사항에는
// '파란색'으로 작성」이 있다. 그 표시는 문서에서 가장 중요한 신호인데, 지금 병합은
// 셀마다 서식을 하나로 통일해서(`normalizeCharShape`) **파란색을 검정으로 뭉갠다.**
// 낸 사람이 «이건 꼭 보셔야 합니다»라고 표시한 것을 시스템이 지우고 있었다.
//
// ── 구조 ────────────────────────────────────────────────────
// 본문(BodyText)에는 색이 없다. 문단마다 `PARA_CHAR_SHAPE`가
// `(글자위치, 서식번호)` 쌍의 목록을 들고 있고, 실제 색은 `DocInfo`의
// `CHAR_SHAPE` 레코드에 있다. 그래서 색을 알려면 **두 스트림을 같이** 읽어야 한다.
//
// ── 실측 (2026-09-03, fixtures 3종) ─────────────────────────
// CHAR_SHAPE 레코드는 74바이트이고 배치는 이렇다:
//
//   0..41   글꼴·장평·자간·크기비율·오프셋 (7종 언어 × 5필드)
//   42..45  기준 크기      46..49  속성(굵게·기울임…)     50..51  그림자 간격
//   52..55  **글자색**     56..59  밑줄색   60..63  음영색   64..67  그림자색
//   68..69  테두리채우기   70..73  취소선색
//
// 42/46/50/52 배치는 **길이 74에 정확히 들어맞는 유일한 조합**이라 이렇게 확정했다.
// 처음에 59로 잡았을 때는 세 파일 전부 `0xffffff00`이 나왔는데, 그건 밑줄색 끝바이트와
// 음영색이 걸쳐 읽힌 값이었다 — 「모든 파일이 같은 값」은 오프셋이 틀렸다는 신호다.
//
// ── 색의 바이트 순서 ────────────────────────────────────────
// `COLORREF`는 윈도우 관례대로 **0x00BBGGRR**이다. 즉 `0x0000ff`가 빨강,
// `0xff0000`이 파랑이다. 헷갈리기 딱 좋은 자리라 근거를 남긴다:
//
//   · fixtures 3종 **전부**에 `0x0000ff` 서식이 정의돼 있다. 셋의 공통 조상은 전사 표준
//     양식이고, 그 양식에서 눈에 보이는 색 글자는 **빨간 ※ 안내문**이다.
//   · 제출본 하나(`sample-filled-w1`)에만 `0xff0000`이 더 있다 — 낸 사람이 규칙대로
//     쓴 **파란색**이다.
//
// 두 사실이 같은 방향을 가리킨다. 그래도 이건 실물로 한 번 더 확인할 값이라
// [HM-T60]이 상수를 고정해 둔다.
import { HwpRecord } from './record';

/** DocInfo 레코드 태그 */
export const DI_TAG = {
  ID_MAPPINGS: 17,
  CHAR_SHAPE: 21,
} as const;

/** CHAR_SHAPE 레코드 안 글자색 위치 */
const TEXT_COLOR_OFFSET = 52;
/** CHAR_SHAPE 레코드 최소 길이 — 이보다 짧으면 색 필드가 없는 옛 판이다 */
const MIN_LEN = TEXT_COLOR_OFFSET + 4;

/**
 * `ID_MAPPINGS`(72B = 18칸)에서 CHAR_SHAPE 개수가 든 칸.
 * 실측: `[9]`가 CHAR_SHAPE 레코드 수와 정확히 일치한다 (양식 17개, 제출본 20개).
 * 서식을 새로 넣으면 **이 숫자도 같이 올려야** 한글이 문서를 온전히 읽는다.
 */
const CHAR_SHAPE_COUNT_SLOT = 9;

/** COLORREF(0x00BBGGRR) — 파랑 */
export const BLUE: number = 0xff0000;

/** 사람이 읽는 `#RRGGBB`로. BGR 순서를 뒤집는 유일한 자리다 */
export function colorToHex(colorref: number): string {
  const b = (colorref >>> 16) & 0xff;
  const g = (colorref >>> 8) & 0xff;
  const r = colorref & 0xff;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * 서식번호 → 글자색 표. 배열 자리가 곧 서식번호다.
 *
 * 색 필드가 없는 짧은 레코드는 **검정으로 친다** — 모르는 것을 「강조」로 올리면
 * 아무 표시도 안 한 사람의 줄이 파랗게 나간다. 모를 때는 조용한 쪽이 안전하다.
 */
export function charShapeColors(docInfoRecords: readonly HwpRecord[]): number[] {
  return docInfoRecords
    .filter((r) => r.tag === DI_TAG.CHAR_SHAPE)
    .map((r) => (r.data.length >= MIN_LEN ? r.data.readUInt32LE(TEXT_COLOR_OFFSET) : 0));
}

/**
 * HM-37 — **강조로 볼 것인가.**
 *
 * 규칙은 「파란색」이지만 판정은 **「검정이 아니면 강조」**로 넓게 잡는다. 이유가 둘이다:
 *
 *   1. 사람은 규칙대로만 쓰지 않는다. 빨강·진파랑·남색이 다 온다. 색을 정확히 맞춰야
 *      알아본다면 대부분 놓치고, 놓친 강조는 **낸 사람이 표시한 뜻이 사라지는 것**이다.
 *   2. 틀렸을 때의 값이 싸다 — 병합본에서 한 줄이 파랗게 나오고, 담당자가 화면에서 보고
 *      끄면 된다. 반대로 못 알아보면 아무도 모르게 지워진다.
 *
 * 아주 옅은 회색까지 강조로 세지는 않는다. 검정 근처는 「색을 안 쓴 것」이다.
 */
export function isEmphasis(colorref: number): boolean {
  const b = (colorref >>> 16) & 0xff;
  const g = (colorref >>> 8) & 0xff;
  const r = colorref & 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // 무채색(회색 계열)은 강조가 아니다 — 색이 있어야 강조다
  if (max - min < 40) return false;
  return true;
}

/**
 * HM-37 — `baseShapeId`와 **글자색만 다른** 서식을 DocInfo에서 찾고, 없으면 만든다.
 *
 * 새로 짓지 않고 **복제해서 한 필드만 바꾸는** 것이 핵심이다. 글꼴·크기·굵기가 본문과
 * 어긋나면 파란 줄만 다른 글씨가 되어, 강조가 아니라 사고로 보인다 (HM-ABS-1과 같은 이유).
 *
 * 이미 같은 것이 있으면 재사용한다 — 매번 병합할 때마다 서식이 하나씩 불어나면
 * 몇 달 뒤 DocInfo가 쓰레기로 찬다.
 *
 * `records`를 **그 자리에서 고친다** (레코드 추가 + ID_MAPPINGS 증가).
 * 반환값은 쓸 서식번호.
 */
export function ensureColorShape(
  records: HwpRecord[],
  baseShapeId: number,
  colorref: number,
): number | null {
  const shapeIdx: number[] = [];
  records.forEach((r, i) => {
    if (r.tag === DI_TAG.CHAR_SHAPE) shapeIdx.push(i);
  });
  const base = shapeIdx[baseShapeId];
  if (base === undefined || records[base].data.length < MIN_LEN) return null;

  const want = Buffer.from(records[base].data);
  want.writeUInt32LE(colorref >>> 0, TEXT_COLOR_OFFSET);

  // 이미 있으면 그것을 쓴다
  const found = shapeIdx.findIndex((i) => records[i].data.equals(want));
  if (found >= 0) return found;

  // 없으면 **마지막 CHAR_SHAPE 바로 뒤에** 넣는다. 서식번호는 등장 순서이므로
  // 중간에 끼우면 기존 번호가 전부 밀린다 — 본문이 가리키는 번호가 어긋난다
  const last = shapeIdx[shapeIdx.length - 1];
  records.splice(last + 1, 0, { ...records[base], data: want });

  const idm = records.findIndex((r) => r.tag === DI_TAG.ID_MAPPINGS);
  if (idm < 0) return null;
  const slot = CHAR_SHAPE_COUNT_SLOT * 4;
  if (records[idm].data.length < slot + 4) return null;
  const d = Buffer.from(records[idm].data);
  d.writeUInt32LE(shapeIdx.length + 1, slot);
  records[idm] = { ...records[idm], data: d };

  return shapeIdx.length; // 새 서식의 번호 = 기존 개수
}

/** `ID_MAPPINGS`가 말하는 CHAR_SHAPE 개수 — 실제 레코드 수와 맞는지 확인하는 데 쓴다 */
export function declaredCharShapeCount(records: readonly HwpRecord[]): number | null {
  const idm = records.find((r) => r.tag === DI_TAG.ID_MAPPINGS);
  const slot = CHAR_SHAPE_COUNT_SLOT * 4;
  if (!idm || idm.data.length < slot + 4) return null;
  return idm.data.readUInt32LE(slot);
}
