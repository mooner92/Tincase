# S-07. 컴포넌트 스펙

구현: `src/components/**`

---

## 1. 원칙

### CP-01 — 서버/클라이언트 경계를 명시

각 컴포넌트는 아래 중 하나로 분류되고, 파일 상단에 표기한다.

| 종류 | 표기 | 기준 |
|---|---|---|
| Server | (기본) | 상호작용 없음. 데이터 표시 전용 |
| Client | `'use client'` | 상태·이벤트·타이머 필요 |

**클라이언트 컴포넌트는 최소화한다.** 아래 5개만 클라이언트다.

```
UploadDropzone · DeadlineCountdown · SlotSelector · CopyMissingButton · VersionHistoryPopover
```

### CP-02 — 데이터는 props로 내려받는다

컴포넌트 안에서 `fetch`하지 않는다 (업로드 제외). 서버 컴포넌트가 조회해 전달한다.
테스트가 쉬워지고 워터폴이 사라진다.

### CP-03 — 표시 로직과 판정 로직 분리

`locked` 여부를 컴포넌트가 계산하지 않는다. 서버가 준 boolean을 쓴다.
`isLocked()` 호출은 서버 코드에만 존재한다.

---

## 2. 공통

### `<AppHeader>`  · Server

| 항목 | 내용 |
|---|---|
| props | `{ user: { name, isAdmin } }` |
| 렌더 | 서비스명, `{이름} 님`, 관리자면 `수합 관리` 링크, 로그아웃 |
| 요구 | CP-04 로그아웃은 Cloudflare 경로 (AU-08) |

### `<Badge>` · Server

| props | `{ tone: 'neutral'\|'success'\|'warning'\|'muted', children }` |
|---|---|
| 요구 | CP-05 색 + 텍스트 동시 표기 (색만으로 의미 전달 금지) |

### `<EmptyState>` · Server

| props | `{ title, description, action? }` |
|---|---|
| 요구 | CP-06 무엇을 하면 되는지 한 문장으로 안내 |

---

## 3. 업로드 화면 컴포넌트

### `<WeekBanner>` · Server

주차·마감 표시.

```ts
interface WeekBannerProps {
  label: string;            // "8월 2주차"
  year: number;
  deadlineAt: string;       // ISO+09:00
  locked: boolean;
  nextOpensAt: string;
}
```

| ID | 요구사항 |
|---|---|
| CP-07 | `2026년 8월 2주차` 형식으로 제목 |
| CP-08 | 마감 `8월 11일(화) 14:00` 형식 |
| CP-09 | 내부에 `<DeadlineCountdown>` 배치 |
| CP-10 | 잠김이면 `마감됨` 배지 + 다음 개시 시각 |

---

### `<DeadlineCountdown>` · **Client**

```ts
interface DeadlineCountdownProps {
  deadlineAt: string;
  onExpire?: () => void;
}
```

| ID | 요구사항 |
|---|---|
| CP-11 | 남은 시간 `22시간 14분` 형식. 1시간 미만이면 `43분 20초`(초 단위) |
| CP-12 | 갱신 주기: 1시간 초과 시 60초, 이하 시 1초 |
| CP-13 | 0 도달 시 `onExpire()` 1회 호출 → 페이지에서 `router.refresh()` (PG-14) |
| CP-14 | 3시간 이내 경고색 |
| CP-15 | **서버가 준 `deadlineAt`만 신뢰.** 로컬 시계 오차는 최초 1회 서버 시각으로 보정 |
| CP-16 | 언마운트 시 타이머 정리 |
| CP-17 | 탭 백그라운드 복귀(`visibilitychange`) 시 즉시 재계산 |

> CP-17이 없으면 브라우저가 타이머를 스로틀해 몇 시간 뒤진 값을 보여준다.

---

### `<TemplateDownload>` · Server

| ID | 요구사항 |
|---|---|
| CP-18 | `GET /api/template` 링크 |
| CP-19 | 파일명에 주차 포함 안내 (API-20) |
| CP-20 | 잠김 상태에서도 활성 (다음 주 대비 미리 받기 허용) |

---

### `<GuideNotice>` · Server

스펙 §3 작성 관례 표시. **하드코딩하지 않고 상수 모듈에서 가져온다.**

```ts
// src/lib/guide.ts
export const WRITING_GUIDE = [
  '항목 순서: AI → 홍보(정간물 포함) → 시스템 → 도서관',
  '상시 반복 업무는 일자를 공란으로 둡니다',
  '특정 일자가 있는 업무만 날짜를 적습니다',
] as const;
```

| ID | 요구사항 |
|---|---|
| CP-21 | 문구는 `src/lib/guide.ts` 단일 출처 |
| CP-22 | 코드로 강제하지 않는다 (스펙 §3) — 안내만 |

> 이 상수는 Phase 2 병합 정렬 순서(`TEAM_ORDER`)와 **같은 사실**을 표현한다.
> 두 곳이 어긋나지 않도록 `TEAM_ORDER`에서 문구를 파생시키는 것을 검토한다.

---

### `<UploadDropzone>` · **Client** ★

가장 복잡한 컴포넌트.

```ts
interface UploadDropzoneProps {
  disabled: boolean;         // 잠김 시 애초에 렌더 안 됨 (PG-09)
  onUploaded: (r: UploadResult) => void;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'dragover' }
  | { kind: 'validating'; fileName: string }
  | { kind: 'uploading'; fileName: string; percent: number }
  | { kind: 'success';  result: UploadResult }
  | { kind: 'error';    code: string; message: string };
```

| ID | 요구사항 |
|---|---|
| CP-23 | 드래그앤드롭 + 클릭 선택 **둘 다** 지원 |
| CP-24 | `accept=".hwp,.hwpx"` — 다만 신뢰하지 않고 서버 재검증 (ST-06) |
| CP-25 | 전송 전 클라이언트 1차 검증: 확장자, 20MB. **즉시 피드백용** |
| CP-26 | 업로드 진행률 표시 (`XMLHttpRequest.upload.onprogress`) |
| CP-27 | 업로드 중 중복 제출 차단 (버튼 비활성 + 드롭 무시) |
| CP-28 | 서버 오류 코드 → 한국어 메시지 매핑 |
| CP-29 | `slot_locked` 응답 시 전용 메시지 + 페이지 새로고침 유도 (PG-16) |
| CP-30 | 성공 시 `onUploaded` 호출 → 부모가 `router.refresh()` |
| CP-31 | 다중 파일 드롭 시 첫 번째만 사용 + `한 개만 올릴 수 있습니다` 안내 |
| CP-32 | 폴더 드롭 거부 |
| CP-33 | 네트워크 실패 시 재시도 버튼 (자동 재시도 **안 함** — 중복 버전 생성 방지) |

> CP-33: 자동 재시도는 위험하다. 서버가 저장에 성공하고 응답만 유실된 경우
> 재시도가 v2를 하나 더 만든다. **재시도는 사용자가 결정하게 한다.**

**오류 메시지 매핑 (CP-28)**

| 코드 | 화면 문구 |
|---|---|
| `slot_locked` | 마감되어 제출되지 않았습니다. 다음 주차에 제출해 주세요. |
| `invalid_file` / `not_hwp` | 한글 파일이 아닙니다. 한글에서 저장한 .hwp 파일을 올려주세요. |
| `invalid_file` / `too_large` | 파일이 너무 큽니다 (최대 20MB). |
| `invalid_file` / `corrupt_structure` | 파일을 읽을 수 없습니다. 한글에서 다시 저장한 뒤 올려주세요. |
| `not_registered` | 등록되지 않은 사용자입니다. 담당자에게 문의해 주세요. |
| `internal` | 일시적인 오류입니다. 다시 시도해 주세요. |

`XMLHttpRequest`를 쓰는 이유는 **진행률** 때문이다. `fetch`는 업로드 진행률을 주지 않는다.

---

### `<SubmissionStatus>` · Server

```ts
interface SubmissionStatusProps {
  submission: { id, version, uploadedAt, byteSize, originalName } | null;
  locked: boolean;
}
```

| ID | 요구사항 |
|---|---|
| CP-34 | `null`이면 렌더하지 않는다 (업로드 영역이 주인공) |
| CP-35 | `제출 완료 (v2)` · 제출시각 · 크기 표시 |
| CP-36 | `내 파일 받기` 버튼 |
| CP-37 | 잠기지 않았으면 `다시 올리기` (스크롤 이동 + 드롭존 포커스) |
| CP-38 | 크기는 `74.4 KB` 형식 |
| CP-39 | 시각은 `8월 11일 09:12` 형식 |

---

## 4. 관리자 화면 컴포넌트

### `<SlotSelector>` · **Client**

| ID | 요구사항 |
|---|---|
| CP-40 | 최신 26주 목록 |
| CP-41 | 각 항목에 `8월 2주차 (5/8)` 형태로 제출 수 표시 |
| CP-42 | 선택 시 `/admin/[isoKey]`로 이동 |
| CP-43 | 현재 주차에 `이번 주` 배지 |

---

### `<StatusSummary>` · Server

| ID | 요구사항 |
|---|---|
| CP-44 | `5 / 8 제출` 대형 표시 |
| CP-45 | 진행 막대. `aria-valuenow` 등 ARIA 속성 포함 |
| CP-46 | 마감 상태 배지 |
| CP-47 | 전원 제출 시 축하 표시(체크) — 상태 확인이 1초에 끝나게 |

---

### `<SubmissionTable>` · Server

```ts
interface SubmissionTableProps {
  members: MemberStatus[];   // 미제출 포함 전원 (API-22)
  locked: boolean;
}
```

| ID | 요구사항 |
|---|---|
| CP-48 | 열: 이름 / 팀 / 상태 / 버전 / 제출시각 / 받기 |
| CP-49 | 미제출 행: 연한 배경 + `○ 미제출` |
| CP-50 | `team`이 비어 있어도 정상 렌더 (Phase 1에서 미배정 가능, DM-09) |
| CP-51 | 버전 ≥2면 `<VersionHistoryPopover>` 노출 |
| CP-52 | 768px 이하 카드 레이아웃 (PG-32) |
| CP-53 | `<caption>` + `scope` 속성으로 스크린리더 대응 |

---

### `<VersionHistoryPopover>` · **Client**

| ID | 요구사항 |
|---|---|
| CP-54 | 해당 사용자·주차의 전 버전 목록 |
| CP-55 | 각 버전 다운로드 링크 |
| CP-56 | 최신 버전에 `현재본` 표시 |
| CP-57 | Esc·외부 클릭으로 닫기 |

---

### `<BulkActions>` · Server + Client 혼합

| ID | 요구사항 |
|---|---|
| CP-58 | `전체 zip 받기 (N개)` — N은 실제 대상 수 |
| CP-59 | N=0이면 비활성 + 사유 툴팁 |
| CP-60 | `자동 병합` 버튼 — Phase 1 비활성, `준비 중 (Phase 2)` (PG-26) |
| CP-61 | zip 생성 중 로딩 표시 (대용량 시 수 초) |

---

### `<CopyMissingButton>` · **Client**

| ID | 요구사항 |
|---|---|
| CP-62 | 미제출자 이름을 `장혜정, 홍길동` 형태로 클립보드 복사 |
| CP-63 | 복사 후 2초간 `복사됨` 표시 |
| CP-64 | 미제출 0명이면 렌더 안 함 |
| CP-65 | `navigator.clipboard` 미지원 환경 폴백 (`textarea` + `execCommand`) |

> PG-27 참조. 사내망 브라우저가 구형일 수 있으므로 CP-65는 생략하지 말 것.

---

## 5. 컴포넌트 테스트

| ID | 대상 | 내용 |
|---|---|---|
| CP-T01 | DeadlineCountdown | 남은 2시간 → `2시간 0분` |
| CP-T02 | DeadlineCountdown | 남은 45초 → 초 단위 표시 |
| CP-T03 | DeadlineCountdown | 0 도달 시 `onExpire` **정확히 1회** |
| CP-T04 | DeadlineCountdown | 언마운트 후 타이머 미실행 |
| CP-T05 | UploadDropzone | `.txt` 선택 → 전송 없이 즉시 오류 |
| CP-T06 | UploadDropzone | 업로드 중 두 번째 드롭 무시 |
| CP-T07 | UploadDropzone | 409 `slot_locked` → 전용 문구 |
| CP-T08 | UploadDropzone | 파일 2개 드롭 → 첫 번째만, 안내 표시 |
| CP-T09 | SubmissionTable | 미제출자 행 렌더됨 |
| CP-T10 | SubmissionTable | `team` 없어도 렌더 |
| CP-T11 | CopyMissingButton | 미제출 0명 → 렌더 안 됨 |
| CP-T12 | StatusSummary | 8/8 → 완료 표시 |
| CP-T13 | SubmissionStatus | `null` → 렌더 안 됨 |

---

## 6. 스타일

### CP-66 — Tailwind CSS

유틸리티 우선. 별도 CSS 파일 최소화.

### CP-67 — shadcn/ui 선별 도입

`Button`, `Dialog`, `Popover`, `Badge`, `Progress`, `Table`만 가져온다.
전체 설치하지 않는다. 8명용 사내 도구에 디자인 시스템 전체는 과하다.

### CP-68 — 색 토큰

```
success  녹색   제출 완료
warning  주황   마감 임박(3시간 이내)
muted    회색   미제출 · 마감됨
danger   빨강   오류
```

색상 값은 `tailwind.config.ts` 단일 정의. 컴포넌트에 hex 하드코딩 금지.
