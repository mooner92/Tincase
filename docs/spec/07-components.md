# S-07. 컴포넌트 스펙

구현: `src/components/**`
v2: 드로어·규칙 에디터·양식/명단 관리 추가 — [ADR-0005](../adr/0005-multi-division-tenancy.md)

---

## 1. 원칙

### CP-01 — 서버/클라이언트 경계를 명시

각 컴포넌트는 아래 중 하나로 분류되고, 파일 상단에 표기한다.

| 종류 | 표기 | 기준 |
|---|---|---|
| Server | (기본) | 상호작용 없음. 데이터 표시 전용 |
| Client | `'use client'` | 상태·이벤트·타이머 필요 |

**클라이언트 컴포넌트는 최소화한다.** 클라이언트는 아래 9개뿐이다.

```
UploadDropzone · DeadlineCountdown · SlotSelector · CopyMissingButton
VersionHistoryPopover · FileDrawer · RuleEditor · TemplateManager · RosterEditor(/ops)
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
| CP-18 | `GET /api/template` 링크 — 자기 부서 active 양식 (API-17) |
| CP-19 | 파일명에 주차·부서명 포함 (API-18) |
| CP-20 | 잠김 상태에서도 활성 (다음 주 대비 미리 받기 허용) |

---

### `<GuideNotice>` · Server

작성 관례 안내. v2: **부서 데이터에서 온다 — 전역 상수 금지** (PG-10).

```ts
interface GuideNoticeProps {
  guideLines: string[];   // 부서 설정 (Division.guideText를 줄 단위 분해)
}
```

| ID | 요구사항 |
|---|---|
| CP-21 | 문구 출처는 부서 설정. 비어 있으면 섹션 자체를 렌더하지 않음 |
| CP-22 | 코드로 강제하지 않는다 — 안내만 |

> AI홍보전략실의 관례("AI → 홍보(정간물) → 시스템 → 도서관", "상시 업무 일자 공란")는
> **그 부서의 시드 값**으로 들어간다. 다른 부서는 자기 관례를 적는다.
> 병합 순서와 안내 문구가 어긋나지 않도록, Phase 2에서 규칙 텍스트와 같은
> 설정 화면(`/manage/settings`)에 둔다.

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
| CP-24 | `accept=".hwp"` — 다만 신뢰하지 않고 서버 재검증 (ST-05~06) |
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
| `invalid_file` / `hwpx_not_allowed` | .hwpx는 받지 않습니다. [다른 이름으로 저장] → [한글 문서(*.hwp)]로 저장 후 올려주세요. |
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

## 4. 담당자 화면 컴포넌트 (lead)

### `<SlotSelector>` · **Client**

| ID | 요구사항 |
|---|---|
| CP-40 | 최신 26주 목록 |
| CP-41 | 각 항목에 `8월 2주차 (9/12)` 형태로 제출 수 표시 |
| CP-42 | 선택 시 `/{slug}/manage/[isoKey]`로 이동 |
| CP-43 | 현재 주차에 `이번 주` 배지 |

---

### `<StatusSummary>` · Server

| ID | 요구사항 |
|---|---|
| CP-44 | `9 / 12 제출` 대형 표시 (분모 = onRoster) |
| CP-45 | 진행 막대. `aria-valuenow` 등 ARIA 속성 포함 |
| CP-46 | 마감 상태 배지 |
| CP-47 | 전원 제출 시 축하 표시(체크) — 상태 확인이 1초에 끝나게 |

---

### `<SubmissionTable>` · Server

```ts
interface SubmissionTableProps {
  members: MemberStatus[];   // 미제출 포함 onRoster 전원 (API-20)
  locked: boolean;
  onOpenDrawer: (submissionId: string) => void;   // 열람 열 → FileDrawer
}
```

| ID | 요구사항 |
|---|---|
| CP-48 | 열: 이름 / 상태 / 버전 / 제출시각 / **열람** / 받기 |
| CP-49 | 미제출 행: 연한 배경 + `○ 미제출` |
| CP-50 | 열람 버튼은 제출자에게만. 클릭 → `onOpenDrawer(latest.id)` (PG-19) |
| CP-51 | 버전 ≥2면 `<VersionHistoryPopover>` 노출 |
| CP-52 | 768px 이하 카드 레이아웃 (PG-32) |
| CP-53 | `<caption>` + `scope` 속성으로 스크린리더 대응 |

---

### ~~`<VersionHistoryPopover>`~~ → **FileDrawer 버전 셀렉터로 통합 (v1.0.0 구현)**

별도 팝오버 대신 드로어 헤더의 버전 드롭다운으로 구현했다 — 이력 확인과 내용 열람이
한 동선이 되어 팝오버보다 낫다. CP-54~56 요구는 드로어에서 충족:

| ID | 충족 방식 |
|---|---|
| CP-54/55 | `GET /api/submissions/:id/versions` + 드로어 버전 선택 → 해당 버전 열람·다운로드 |
| CP-56 | 셀렉터에 `(현재본)` 표시 |
| CP-57 | 드로어 자체의 Esc·배경 클릭 닫기 (CP-75) |

---

### `<BulkActions>` · Server + Client 혼합

| ID | 요구사항 |
|---|---|
| CP-58 | `전체 zip 받기 (N개)` — N은 실제 대상 수 |
| CP-59 | N=0이면 비활성 + 사유 툴팁 |
| CP-60 | `자동 병합` 버튼 — Phase 1 비활성, `준비 중 (Phase 2)` (PG-22) |
| CP-61 | zip 생성 중 로딩 표시 (대용량 시 수 초) |

---

### `<CopyMissingButton>` · **Client**

| ID | 요구사항 |
|---|---|
| CP-62 | 미제출자 이름을 `김OO, 이OO` 형태(쉼표 구분)로 클립보드 복사 |
| CP-63 | 복사 후 2초간 `복사됨` 표시 |
| CP-64 | 미제출 0명이면 렌더 안 함 |
| CP-65 | `navigator.clipboard` 미지원 환경 폴백 (`textarea` + `execCommand`) |

> PG-27 참조. 사내망 브라우저가 구형일 수 있으므로 CP-65는 생략하지 말 것.

---

## 4.5 담당자 화면 신규 컴포넌트 (v2)

### `<FileDrawer>` · **Client** ★

제출물 열람 사이드 패널. 담당자 화면의 핵심 (PG-19~21).

```ts
interface FileDrawerProps {
  submissionId: string | null;      // null이면 닫힘
  memberList: { id: string; name: string; latestId: string | null }[];  // ←→ 이동용
  onClose: () => void;
  onNavigate: (submissionId: string) => void;
}
```

| ID | 요구사항 |
|---|---|
| CP-70 | 열릴 때 `GET /api/submissions/:id/preview` 호출, 로딩 스켈레톤 표시 |
| CP-71 | 표 3개를 **원본 열 구성 그대로** HTML `<table>`로 렌더. 셀 내 줄바꿈(`\n`) 유지 |
| CP-72 | 빈 3번 표는 `기타 특이사항 없음 (표 삭제됨 — 관례상 정상)` 안내로 표기 |
| CP-73 | 헤더: 부서원명 · v버전 · 제출시각 · `원본 다운로드` · 버전 드롭다운(구버전 열람) |
| CP-74 | `←`/`→` 키·버튼으로 이전/다음 **제출자** 이동. 미제출자는 건너뜀 |
| CP-75 | `role="dialog"` + 포커스 트랩 + Esc 닫기 + 닫힐 때 트리거 행으로 포커스 복귀 |
| CP-76 | 읽기 전용 — 어떤 편집 UI도 없다 (PG-21) |
| CP-77 | preview 실패(500) 시: 오류 안내 + `원본 다운로드`는 계속 제공 (열람 실패가 수합을 막지 않게) |

### `<RuleEditor>` · **Client**

부서 병합 규칙 텍스트 편집 (PG-25~27, API-28).

| ID | 요구사항 |
|---|---|
| CP-78 | monospace textarea + 저장 버튼. 저장 성공 시 파싱 결과 요약 표시 |
| CP-79 | 422 응답의 `problems[]`를 행 번호와 함께 표시 |
| CP-80 | 절대 규칙 안내 패널 상시 노출 (PG-26 문구) |
| CP-81 | 저장 전 이탈 시 confirm (편집 유실 방지) |

### `<TemplateManager>` · **Client**

부서 양식 관리 (PG-28~30, API-40~41).

| ID | 요구사항 |
|---|---|
| CP-82 | 현재 양식 카드(버전·등록일·등록자·다운로드) + 교체 드롭존(UploadDropzone 재사용) |
| CP-83 | 교체 성공 → 파싱 요약(표·행수) 즉시 표시 (API-41) |
| CP-84 | 교체 실패 → 기존 양식 유지 명시 (`기존 양식은 그대로입니다`) |

### `<RosterEditor>` · **Client** — `/ops` 전용 (v2.1)

제출 대상·정렬 관리. **운영자 화면에만 존재** (DM-04). lead 설정 화면에는 읽기 전용 목록만.

| ID | 요구사항 |
|---|---|
| CP-85 | 부서 선택 → 부서원 목록 + onRoster 토글 + ↑↓ 정렬 (API-26~27) |
| CP-86 | 변경은 명시적 `저장` 버튼으로 일괄 반영, 저장 후 토스트 |

### `<DivisionStatusList>` · Server — member용 부서 현황 (v2.1)

| ID | 요구사항 |
|---|---|
| CP-87 | 이름 · `● 제출됨(시각)` / `○ 아직` 목록. **파일 링크·버전·크기 없음** (AU-06) |
| CP-88 | 본인 행 강조. 정렬은 lead 현황과 동일 |
| CP-89 | 업로드 영역보다 시각적 우선순위 낮게 (업로드가 주인공) |

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
| CP-T10 | SubmissionTable | onRoster=false 인원은 본 목록에서 제외 |
| CP-T11 | CopyMissingButton | 미제출 0명 → 렌더 안 됨 |
| CP-T12 | StatusSummary | 12/12 → 완료 표시 |
| CP-T13 | SubmissionStatus | `null` → 렌더 안 됨 |
| CP-T14 | FileDrawer | 픽스처 preview 응답 → 표 3개 렌더, 셀 값 일치 |
| CP-T15 | FileDrawer | 3번 표 없음 → "관례상 정상" 안내 |
| CP-T16 | FileDrawer | Esc → 닫히고 트리거로 포커스 복귀 |
| CP-T17 | FileDrawer | `→` 키 → 다음 제출자, 미제출자 건너뜀 |
| CP-T18 | FileDrawer | preview 500 → 오류 + 다운로드 버튼 유지 |
| CP-T19 | RuleEditor | 422 problems 행 번호 표시 |
| CP-T20 | TemplateManager | 교체 실패 → "기존 양식 유지" 문구 |
| CP-T21 | RosterEditor | 토글 후 저장 전 이탈 → confirm |

---

## 6. 스타일 — 디자인 시스템 (v1.3)

원본: [docs/design-system.md](../design-system.md) (Clay 분석 문서). 사내 도구에 맞게 이식했다.

### CP-66 — Tailwind v4 `@theme` 토큰 단일 출처

색·폰트는 `src/app/globals.css`의 `@theme`에만 정의한다.
**컴포넌트에 hex 하드코딩 금지** — 토큰 클래스(`bg-canvas`, `text-muted`)만 쓴다.

### CP-67 — 외부 UI 라이브러리 없음

shadcn/ui 도입 계획은 폐기. `@layer components`의 유틸 클래스
(`.btn-primary` `.card` `.badge-pill` `.input` `.tab-pill`)로 충분하다.
의존성을 늘리지 않고 토큰과 1:1로 붙는다.

### CP-68 — 색 팔레트

| 역할 | 토큰 | 용도 |
|---|---|---|
| 캔버스 | `canvas` #fffaf0 | 페이지 바닥. **크림 틴트가 이 시스템의 정체성** — 쿨그레이로 바꾸지 않는다 |
| 표면 | `surface-soft` / `surface-card` / `surface-strong` | 보조 카드·비활성 영역 |
| 잉크 | `ink` #0a0a0a | 헤드라인·기본 CTA |
| 본문 | `body` / `muted` / `muted-soft` | 본문·부가·캡션 |
| 헤어라인 | `hairline` / `hairline-soft` | 1px 경계 (그림자 대신) |
| 포인트 | `brand-teal` `brand-peach` `brand-mint` `brand-lavender` `brand-ochre` `brand-coral` | 피처 카드 |
| 의미 | `success` `warning` `error` | 상태 |

**포인트 색은 의미를 갖는다** — teal은 요약/집계(featured), peach는 행동 유도(양식 받기),
mint는 완료, ochre는 주의, coral은 임박. 같은 색을 연속으로 두지 않는다.

### CP-69 — 깊이는 그림자가 아니라 색 대비로

카드는 `border-hairline` 1px + 배경색 차이로 분리한다. 그림자는 오버레이(드로어)에만.

### CP-70b — 라운드 스케일

버튼·입력 `rounded-xl`(12px) · 콘텐츠 카드 `rounded-2xl`(16px) ·
피처 카드 `rounded-3xl`(24px) · 배지·탭 `rounded-full`.

### CP-71b — 타이포

`.display` = 600 무게 + `-0.03em` 자간. 헤드라인 전용이며 본문에 쓰지 않는다.
섹션 라벨은 12px/600/대문자+`tracking-[0.12em]`.
