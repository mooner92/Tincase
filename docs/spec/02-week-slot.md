# S-02. 주차 계산 (WeekSlot)

> 시스템 전체에서 **가장 버그가 나기 쉬운 부분**이자, 가장 테스트하기 쉬운 부분.
> 전부 **순수 함수**로 구현하고 DB·시간대에 의존하지 않게 만든다.

구현 위치: `src/lib/week.ts` · 테스트: `src/lib/week.test.ts`

---

## 1. 규칙 정의

### WS-01 — 주의 기준일은 월요일

한 주는 **월요일 00:00 KST에 시작**한다. 임의 시각 `t`가 속한 주의 월요일을 `mondayOf(t)`라 한다.

### WS-02 — 라벨 형식

```
{월}월 {N}주차          예) "8월 2주차"
```

- `월` = 그 주 **월요일**의 월 (일요일 기준 아님)
- `N` = 그 월요일이 **해당 월의 몇 번째 월요일**인지 (1-based)

### WS-03 — N 계산식

한 달 안의 월요일은 항상 7일 간격이므로:

```ts
N = Math.floor((monday.getDate() - 1) / 7) + 1
```

`Date` 순회 불필요. O(1).

### WS-04 — 월 경계 처리

주가 달을 걸치면 **월요일이 속한 달**을 따른다.

예) 2026-08-31(월)~09-04(금) → 월요일이 8월 → `8월 5주차`.
9월 첫 주차는 2026-09-07(월)부터 → `9월 1주차`.

> 결과적으로 한 달에 4주차 또는 5주차까지 생긴다. 정상이다.

### WS-05 — 슬롯 시각

| 필드 | 값 |
|---|---|
| `opens_at` | 그 주 **월요일 00:00:00 KST** |
| `deadline_at` | 그 주 **화요일 14:00:00 KST** |

### WS-06 — 잠금 판정

```
locked  ⟺  now > deadline_at
```

`opens_at ≤ now ≤ deadline_at` 인 동안에만 업로드 가능.
마감 후 다음 주 월요일 00:00까지는 **어떤 경로로도** 업로드 불가 (스펙 §4.3).

### WS-07 — 시간대

- **저장**: 전부 UTC (`DateTime` / SQLite ISO-8601)
- **판정·표시**: `Asia/Seoul`
- 서버 로컬 시간대에 의존하지 **않는다**. 컨테이너 `TZ=Asia/Seoul`을 설정하되, 코드는 그것 없이도 옳아야 한다.
- 한국은 DST가 없으므로 KST = UTC+9 고정. 그래도 오프셋을 하드코딩하지 말고 IANA 타임존을 쓴다.

### WS-08 — 활성 슬롯

임의 시각에 **"현재 슬롯"은 정확히 하나**다: `mondayOf(now)`가 만드는 슬롯.
마감이 지났어도 다음 월요일 전까지는 그 슬롯이 현재 슬롯이며, 단지 `locked`일 뿐이다.

---

## 2. 근거 — 실데이터 검증 ★

스펙 §10의 미결 항목 "N주차 규칙이 실제 관례와 맞는가"는 **해소되었다**.

`8월_2주차_업무실적_및_계획_AI홍보전략실.hwp` 실측 내용:

| 항목 | 기입된 일자 |
|---|---|
| 주요 업무실적 | `8/12`(수), `8/14`(금) |
| 주요 업무계획 | `8/19`(수) |

2026년 8월의 월요일: **3, 10, 17, 24, 31**

- 실적 주간 = 8/10 주 → 8월의 **2번째** 월요일 → `8월 2주차` ✔ 파일명과 일치
- 계획 주간 = 8/17 주 (차주) ✔

→ **WS-02/WS-03 규칙이 조직 관례와 일치함이 실제 제출물로 확인됨.**
(상세: [R-001 §5.3](../research/001-hwp-format-findings.md))

부수 확인: 문서는 **금주 실적 + 차주 계획** 구조다. 화요일 14:00 마감과 모순 없다
(실적란에 8/14 같은 주중 예정 업무를 미리 적는 것이 관례).

---

## 3. 공개 API

```ts
// src/lib/week.ts
export const KST = 'Asia/Seoul';

/** t가 속한 주의 월요일 00:00 KST (UTC Date로 반환) */
export function mondayOf(t: Date): Date;

/** 월요일 → 슬롯 서술자 */
export function describeWeek(monday: Date): WeekDescriptor;

/** 지금 기준 현재 슬롯 서술자 */
export function currentWeek(now?: Date): WeekDescriptor;

/** 잠금 여부 */
export function isLocked(slot: {deadlineAt: Date}, now?: Date): boolean;

/** 남은 시간(ms). 음수면 마감 지남 */
export function msUntilDeadline(slot: {deadlineAt: Date}, now?: Date): number;

export interface WeekDescriptor {
  year: number;          // 2026
  month: number;         // 8   (월요일 기준)
  weekOfMonth: number;   // 2
  label: string;         // "8월 2주차"
  isoKey: string;        // "2026-W33"  ← DB 유니크 키
  opensAt: Date;         // 2026-08-10T00:00+09:00
  deadlineAt: Date;      // 2026-08-11T14:00+09:00
}
```

### WS-09 — 식별 키는 `isoKey`

`label`("8월 2주차")은 **연도 정보가 없어** 유니크 키로 부적합하다.
DB 유니크 제약은 ISO 주차 키 `YYYY-Www`(예 `2026-W33`)를 쓴다.
`label`은 표시 전용이다.

---

## 4. 구현 지침

### WS-10 — 시간대 처리는 라이브러리로

`Date`의 로컬 시간대 메서드(`getDate()`, `getMonth()`)를 **직접 쓰지 않는다.**
서버 TZ가 UTC면 KST 자정 근처에서 하루가 어긋난다.

권장: `date-fns` + `@date-fns/tz` (경량, 트리셰이킹) 또는 `Temporal` 폴리필.

```ts
import { TZDate } from '@date-fns/tz';

export function mondayOf(t: Date): Date {
  const k = new TZDate(t, KST);
  const dow = k.getDay();                 // 0=일 … 1=월
  const diff = (dow + 6) % 7;             // 월요일까지 되돌릴 일수
  const m = new TZDate(k.getFullYear(), k.getMonth(), k.getDate() - diff, 0, 0, 0, 0, KST);
  return new Date(m.getTime());
}
```

> `(dow + 6) % 7` — 일요일(0)이 **직전 월요일**에 붙도록 하는 표준 기법. 6일 되돌린다.

---

## 5. 테스트 사양 (필수)

`src/lib/week.test.ts` — 아래는 전부 통과해야 한다.

### 5.1 라벨 계산

| ID | 입력 (KST) | 기대 라벨 | 근거 |
|---|---|---|---|
| WS-T01 | 2026-08-03 (월) | `8월 1주차` | 1번째 월요일 |
| WS-T02 | 2026-08-10 (월) | `8월 2주차` | **실데이터 검증됨** |
| WS-T03 | 2026-08-17 (월) | `8월 3주차` | 스펙 §4.1 명시 예시 |
| WS-T04 | 2026-08-31 (월) | `8월 5주차` | 5번째 월요일 존재 |
| WS-T05 | 2026-09-07 (월) | `9월 1주차` | 9/1은 화요일 → 9/7이 첫 월요일 |

### 5.2 주 소속 판정

| ID | 입력 (KST) | 기대 |
|---|---|---|
| WS-T06 | 2026-08-13 목 15:30 | `8월 2주차` |
| WS-T07 | 2026-08-16 **일** 23:59 | `8월 2주차` ← 일요일은 직전 월요일 주 |
| WS-T08 | 2026-08-17 월 00:00:00 | `8월 3주차` ← 경계 |
| WS-T09 | 2026-08-16 일 23:59:59.999 | `8월 2주차` ← 경계 직전 |

### 5.3 월 경계

| ID | 입력 | 기대 |
|---|---|---|
| WS-T10 | 2026-09-02 수 | `8월 5주차` ← 월요일(8/31)이 8월 |
| WS-T11 | 2026-03-01 일 | `2월 4주차` ← 2/23 주 |

### 5.4 마감 판정

| ID | 시각 (KST) | `8월 2주차` 슬롯 | 기대 |
|---|---|---|---|
| WS-T12 | 08-10 00:00:00 | opens 경계 | 열림 |
| WS-T13 | 08-11 13:59:59 | 마감 1초 전 | 열림 |
| WS-T14 | 08-11 14:00:00 | 마감 정각 | **열림** (`>` 비교이므로 정각은 허용) |
| WS-T15 | 08-11 14:00:01 | 1초 후 | **잠김** |
| WS-T16 | 08-16 23:59:59 | 주 마지막 | **잠김** |

> WS-T14는 의도적 결정이다. "14:00까지"를 포함으로 해석한다.
> 반대 해석을 원하면 [OPEN-QUESTIONS Q-06](../../OPEN-QUESTIONS.md) 참조.

### 5.5 시간대 견고성

| ID | 시나리오 | 기대 |
|---|---|---|
| WS-T17 | `TZ=UTC`로 실행 | 모든 위 테스트 동일 통과 |
| WS-T18 | `TZ=America/New_York`로 실행 | 동일 통과 |
| WS-T19 | UTC 2026-08-09T15:00Z (=KST 8/10 00:00) | `8월 2주차` 열림 |

> **CI에서 최소 2개 TZ로 테스트 스위트를 돌린다.** WS-07의 실질적 보증 수단.

### 5.6 속성 기반 테스트 (권장)

```
∀ t : mondayOf(t).getDay() === 1 (KST)
∀ t : mondayOf(t) ≤ t < mondayOf(t) + 7일
∀ t : 1 ≤ weekOfMonth(mondayOf(t)) ≤ 5
∀ t : opensAt < deadlineAt < opensAt + 7일
```

---

## 6. 슬롯 생성 전략

### WS-11 — 크론이 아니라 지연 생성(lazy)

스펙 §4.1은 "월요일 00:00에 자동 생성"이라 했지만, **크론을 두지 않는다.**

이유: 크론은 서버가 그 순간 죽어 있으면 슬롯이 안 생긴다. 조용한 실패다.

대신 **요청이 올 때 필요한 슬롯을 보장**한다.

```ts
async function ensureCurrentSlot(now = new Date()) {
  const w = currentWeek(now);
  return prisma.weekSlot.upsert({
    where:  { isoKey: w.isoKey },
    update: {},
    create: { isoKey: w.isoKey, label: w.label, year: w.year,
              month: w.month, weekOfMonth: w.weekOfMonth,
              opensAt: w.opensAt, deadlineAt: w.deadlineAt },
  });
}
```

효과:
- 슬롯은 **누가 처음 접속하는 순간 존재하게 된다**. 관측 가능한 차이 없음
- 서버 다운타임에 영향받지 않음
- `upsert`라 동시 요청에도 안전 (유니크 제약 + 재시도)

### WS-12 — 과거 슬롯은 소급 생성하지 않는다

시스템 도입 이전 주차는 만들지 않는다. 첫 실행 시점부터 시작한다.

---

## 7. 표시 규약

| 맥락 | 표기 |
|---|---|
| 화면 제목 | `2026년 8월 2주차` |
| 파일명/폴더 | `8월_2주차` (기존 관례 유지 — [S-04](04-storage.md)) |
| 마감 안내 | `8월 11일(화) 14:00까지` |
| 잠김 상태 | `마감됨 · 다음 주차는 8월 17일(월) 00:00에 열립니다` |
