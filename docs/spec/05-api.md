# S-05. API 계약

구현: `src/app/api/**/route.ts` · Next.js App Router Route Handlers

---

## 1. 공통 규약

### API-01 — 모든 엔드포인트는 인증 필수

`/api/health`를 제외한 전부. 미인증 401. ([S-03](03-auth.md))

### API-02 — 오류 형식 통일

```jsonc
{
  "error":   "machine_readable_code",
  "message": "사용자에게 보여줄 한국어 문장",
  "detail":  { }        // 선택
}
```

| 코드 | HTTP | 의미 |
|---|---|---|
| `unauthenticated` | 401 | JWT 없음/무효 |
| `not_registered` | 403 | Access 통과했으나 DB에 없음 |
| `forbidden` | 403 | 권한 부족 |
| `not_found` | 404 | 리소스 없음 / 관리자 라우트 은닉 |
| `slot_locked` | 409 | 마감 지남 |
| `slot_not_open` | 409 | 아직 안 열림 |
| `no_submissions` | 409 | 대상 0건 |
| `invalid_file` | 422 | 파일 검증 실패 |
| `conflict` | 409 | 버전 경합 |
| `internal` | 500 | 서버 오류 |

### API-03 — 시각은 ISO 8601 + 오프셋

```json
{ "deadlineAt": "2026-08-11T14:00:00+09:00" }
```

UTC `Z` 표기 대신 KST 오프셋을 준다. 클라이언트가 재계산하지 않도록.

### API-04 — 캐시 금지

전 엔드포인트 `Cache-Control: no-store`.
마감 상태가 캐시되면 잠긴 뒤에도 열려 보인다.

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

### API-05 — 마감은 서버가 최종 판정

클라이언트의 카운트다운은 **표시용**이다.
`POST /api/submissions`는 항상 서버 시각으로 재확인한다. 시계 조작 방어.

---

## 2. 엔드포인트

### `GET /api/me`

현재 신원과 현재 슬롯 상태.

```jsonc
// 200
{
  "user": { "id": "c…", "name": "최명헌", "email": "…@kei.re.kr", "isAdmin": true },
  "slot": {
    "id": "c…", "isoKey": "2026-W33", "label": "8월 2주차",
    "year": 2026,
    "opensAt":    "2026-08-10T00:00:00+09:00",
    "deadlineAt": "2026-08-11T14:00:00+09:00",
    "locked": false,
    "msUntilDeadline": 81234000,
    "nextOpensAt": "2026-08-17T00:00:00+09:00"
  },
  "mySubmission": {
    "id": "c…", "version": 2,
    "uploadedAt": "2026-08-11T09:12:33+09:00",
    "originalName": "주간업무_최명헌.hwp",
    "byteSize": 76123
  }
}
```

`mySubmission`이 `null`이면 미제출.
슬롯은 **호출 시점에 upsert로 보장**된다 (WS-11).

| ID | 요구사항 |
|---|---|
| API-06 | 현재 슬롯이 없으면 생성 후 반환 |
| API-07 | `locked`는 서버 시각 기준 |

---

### `POST /api/submissions`

파일 업로드. `multipart/form-data`, 필드 `file` 하나.

```
POST /api/submissions
Content-Type: multipart/form-data
  file: (binary)
```

```jsonc
// 201
{
  "submission": { "id": "c…", "version": 2, "uploadedAt": "…", "byteSize": 76123 },
  "replacedVersion": 1,
  "sameAsPrevious": false     // 직전 버전과 sha256 동일 (DM-07)
}
```

| ID | 요구사항 |
|---|---|
| API-08 | 업로더는 JWT 신원에서 도출. 본문의 사용자 지정 필드는 **무시** (AU-05) |
| API-09 | 대상 슬롯은 **현재 슬롯 고정**. 클라이언트가 슬롯을 고를 수 없다 |
| API-10 | `now > deadlineAt` → 409 `slot_locked` |
| API-11 | 검증 순서: 인증 → 사용자 → 슬롯 잠금 → 크기 → 확장자 → 매직 → 구조 → 저장 |
| API-12 | 버전 부여·`isLatest` 전환은 단일 트랜잭션 (DM-05) |
| API-13 | 성공 시 `AuditLog` 기록 |
| API-14 | 실패 시 `tmp/` 정리 |

> **API-09가 중요하다.** 슬롯을 파라미터로 받으면 마감된 과거 슬롯에 밀어 넣을 수 있다.
> 스펙 §4.3의 "어떤 방식으로도 업로드 불가"를 만족시키려면 슬롯 선택 자체를 없애야 한다.

---

### `GET /api/submissions/:id/download`

| ID | 요구사항 |
|---|---|
| API-15 | 본인 것이거나 관리자여야 함. 아니면 404 (ST-15) |
| API-16 | 구버전도 다운로드 가능 (id 지정이므로) |
| API-17 | `Content-Disposition` RFC 5987 (ST-13) |
| API-18 | 파일이 실제로 없으면 500 `internal` + 에러 로그 (ST-10 정합성 이탈) |

---

### `GET /api/template`

빈 마스터 양식 다운로드.

| ID | 요구사항 |
|---|---|
| API-19 | `templates/master-template.hwp` 반환 |
| API-20 | 파일명 `{label}_업무실적_및_계획_AI홍보전략실.hwp` — 주차 라벨 주입 |
| API-21 | 인증 필요 (외부 유출 방지) |

> **양식 파일명에 주차를 넣어 준다.** 현재 관례가 `8월_2주차_…`이므로,
> 받자마자 올바른 이름이면 사용자가 이름을 고칠 필요가 없다. 작은 개선이지만 8명 × 52주다.
>
> 나아가 **문서 안의 주차 표기까지 채워서 내려줄 수 있다** ([S-08 HM-14](08-hwp-merge-engine.md)).
> Phase 2 엔진이 준비되면 적용.

---

### `GET /api/admin/status`  🔒 Admin

이번 주차 제출 현황.

```jsonc
// 200
{
  "slot": { "label": "8월 2주차", "locked": false, "deadlineAt": "…" },
  "summary": { "total": 8, "submitted": 5, "missing": 3 },
  "members": [
    { "user": { "id": "c…", "name": "최명헌", "team": "AI" },
      "status": "submitted",
      "latest": { "id": "c…", "version": 2, "uploadedAt": "…", "byteSize": 76123 },
      "versionCount": 2 },
    { "user": { "id": "c…", "name": "장혜정", "team": "홍보" },
      "status": "missing", "latest": null, "versionCount": 0 }
  ]
}
```

| ID | 요구사항 |
|---|---|
| API-22 | `isActive = true`인 사용자 전원 포함. 미제출자도 행으로 나온다 |
| API-23 | 정렬: `team` 순(`AI→홍보→시스템→도서관`) → `sortOrder` → `name` |
| API-24 | 쿼리 `?slot=2026-W33`로 과거 주차 조회 가능 |

> **API-22가 이 화면의 존재 이유다.** "누가 안 냈는지"가 핵심 정보이므로
> 제출자 목록이 아니라 **전원 목록 + 상태**여야 한다.

---

### `GET /api/admin/download-zip`  🔒 Admin

| ID | 요구사항 |
|---|---|
| API-25 | 해당 슬롯 `isLatest = true` 전부 (ST-16) |
| API-26 | 0건이면 409 `no_submissions` |
| API-27 | 스트리밍 생성 |
| API-28 | `?slot=` 지원. 기본은 현재 슬롯 |
| API-29 | `AuditLog`에 `download_zip` 기록 |

---

### `GET /api/admin/slots`  🔒 Admin

과거 주차 목록 (드롭다운용).

```jsonc
{ "slots": [ { "isoKey": "2026-W33", "label": "8월 2주차", "year": 2026,
               "submitted": 5, "total": 8, "locked": false } ] }
```

| ID | 요구사항 |
|---|---|
| API-30 | 최신순. 기본 26개, `?limit=` |

---

### `GET /api/health`

인증 불필요. 모니터링용.

```jsonc
// 200
{ "ok": true, "version": "1.0.0", "uptimeSec": 84213,
  "checks": { "db": "ok", "storage": "ok", "template": "ok" },
  "now": "2026-08-13T15:47:02+09:00", "currentSlot": "8월 2주차" }
```

| ID | 요구사항 |
|---|---|
| API-31 | DB 쿼리 1회, 저장소 쓰기 가능 여부, 마스터 양식 존재 확인 |
| API-32 | 하나라도 실패 시 503 + 실패 항목 명시 |
| API-33 | **민감정보 금지** — 사용자 이메일·이름·경로 노출 안 함 |

---

### `POST /api/admin/merge`  🔒 Admin · **Phase 2**

계약만 미리 고정한다. Phase 1에서는 501 `not_implemented`.

```jsonc
// 202
{ "mergeRunId": "c…", "status": "running" }
```

`GET /api/admin/merge/:id` 로 폴링.

```jsonc
{ "status": "succeeded",
  "rowCounts": { "t1": 24, "t2": 19, "t3": 0 },
  "warnings": ["장혜정: 3번 표 내용 없음"],
  "downloadUrl": "/api/admin/merge/c…/download" }
```

| ID | 요구사항 |
|---|---|
| API-34 | Phase 1: 501 반환. 화면 버튼은 비활성 + `준비 중` 툴팁 |
| API-35 | 슬롯당 동시 실행 1개 |
| API-36 | 실패해도 원본 제출물은 절대 변경 없음 |

---

## 3. 속도 제한

### API-37

| 대상 | 제한 |
|---|---|
| 업로드 | 5분당 10회/사용자 |
| zip | 분당 3회/사용자 |
| 그 외 | 분당 120회/사용자 |

8명 규모라 남용 위험은 낮지만, 실수로 인한 폭주(자동 재시도 루프)를 막는다.
메모리 기반 토큰 버킷으로 충분하다.

---

## 4. 계약 테스트

| ID | 내용 |
|---|---|
| API-T01 | 마감 후 업로드 → 409 `slot_locked` |
| API-T02 | 마감 후에도 `GET /api/me` 정상 (조회는 가능) |
| API-T03 | 마감 후 다운로드 정상 |
| API-T04 | 업로드 본문에 `userId` 위조 → JWT 신원으로 저장 |
| API-T05 | 재업로드 → `version=2`, 이전 `isLatest=false` |
| API-T06 | 비관리자 `/api/admin/status` → 404 |
| API-T07 | 미제출자가 현황 응답에 `status:"missing"`으로 포함 |
| API-T08 | 0건 zip → 409 |
| API-T09 | 전 엔드포인트 `Cache-Control: no-store` |
| API-T10 | 응답 시각에 `+09:00` 오프셋 포함 |
| API-T11 | `/api/health` 무인증 200 |
| API-T12 | `/api/health` 응답에 이메일 문자열 없음 |
