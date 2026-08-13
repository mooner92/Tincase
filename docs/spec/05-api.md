# S-05. API 계약

구현: `src/app/api/**/route.ts` · Next.js App Router Route Handlers
v2: 부서 스코프 재편 — [ADR-0005](../adr/0005-multi-division-tenancy.md)

---

## 1. 공통 규약

### API-01 — 인증 필수

`/api/health` 제외 전부. 미인증 401. 스코프 해석은 `requireDivisionScope` (AU-13) 하나로 시작한다.

### API-02 — 부서는 URL이 아니라 신원에서 나온다 ★

**API 경로에 부서 슬러그가 없다.** 모든 부서 스코프 연산은 JWT 신원 → `user.divisionId`로
스코프를 얻는다. 페이지 URL(`/{slug}/…`)은 표시용이고, 데이터 접근은 신원 기반이다.

> 슬러그를 API 파라미터로 받는 순간 "검증을 깜빡한 핸들러 하나"가 격리 구멍이 된다.
> 파라미터 자체를 없애면 그 실수가 **표현 불가능**해진다. (AU-05와 같은 원리)

### API-03 — 오류 형식 (v1 유지 + 추가)

```jsonc
{ "error": "code", "message": "한국어 안내", "detail": {} }
```

| 코드 | HTTP | 의미 |
|---|---|---|
| `unauthenticated` | 401 | JWT 없음/무효 |
| `not_registered` | 403 | DB에 없음 |
| `division_not_onboarded` | 403 | 부서 미온보딩 (AU-04b) |
| `not_found` | 404 | 없거나 **권한 없음** (격리 — 구별 불가) |
| `slot_locked` | 409 | 부서 마감 지남 |
| `no_submissions` | 409 | 대상 0건 |
| `invalid_file` | 422 | 파일 검증 실패 (reason: ST-09) |
| `invalid_rule` | 422 | 병합 규칙 검증 실패 (Phase 2) |
| `conflict` | 409 | 버전 경합 |
| `not_implemented` | 501 | Phase 2 예약 |
| `internal` | 500 | 서버 오류 |

### API-04 — 시각 ISO 8601 `+09:00` · API-05 — 캐시 금지 `no-store` · API-06 — 마감은 서버 최종 판정

(v1과 동일. 마감 판정은 `deadlineFor(slot, division)` — WS-13)

---

## 2. 공통 (member + lead)

### `GET /api/me`

```jsonc
// 200
{
  "user": { "id","name","divisionRole":"member|lead","isOperator":false },
  "division": { "slug","nameKo","deadlineDow":2,"deadlineTime":"14:00" },
  "slot": {
    "isoKey":"2026-W33","label":"8월 2주차","year":2026,
    "opensAt":"2026-08-10T00:00:00+09:00",
    "deadlineAt":"2026-08-11T14:00:00+09:00",   // 이 부서의 유효 마감 (계산값)
    "locked":false,"msUntilDeadline":81234000,
    "nextOpensAt":"2026-08-17T00:00:00+09:00"
  },
  "mySubmission": { "id","version":2,"uploadedAt","originalName","byteSize" } | null
}
```

| ID | 요구사항 |
|---|---|
| API-07 | 슬롯은 호출 시점 upsert 보장 (WS-11). `deadlineAt`은 부서 정책 계산값 |
| API-08 | 응답에 **타인 정보 없음** — member 화면은 이 엔드포인트 하나로 그린다 |

### `POST /api/submissions` — 업로드

`multipart/form-data`, 필드 `file` 하나.

| ID | 요구사항 |
|---|---|
| API-09 | 업로더·부서는 JWT 신원에서 도출. 본문의 `userId`/`divisionId`류는 **무시** (AU-05, DM-12) |
| API-10 | 대상 슬롯은 **현재 슬롯 고정** — 과거·미래 슬롯 지정 불가 |
| API-11 | `now > deadlineFor(slot, division)` → 409 `slot_locked`. 예외 경로 없음 |
| API-12 | 검증 순서: 인증→사용자→부서 활성→잠금→크기→확장자(.hwp)→매직→구조(표 파싱 포함) |
| API-13 | 버전 부여·`isLatest` 전환 단일 트랜잭션 (DM-05) · 감사 로그 · 실패 시 tmp 정리 |
| API-14 | 응답에 `sameAsPrevious`(직전 버전과 sha256 동일) 포함 (DM-07) |

### `GET /api/submissions/:id/download`

| ID | 요구사항 |
|---|---|
| API-15 | ST-15 권한 매트릭스. 스코프 밖은 404 |
| API-16 | 구버전도 id 지정으로 다운로드 가능 · RFC 5987 파일명 (ST-13) |

### `GET /api/template` — 부서 양식 다운로드

| ID | 요구사항 |
|---|---|
| API-17 | **자기 부서의 active 양식** 반환 (DM-14). 없으면 404 + "담당자에게 양식 등록을 요청하세요" |
| API-18 | 파일명 `{주차라벨}_{부서명}_주간업무.hwp` — 주차 주입 |
| API-19 | 잠김 상태에서도 다운로드 가능 (다음 주 대비) |

### `GET /api/my/history`

최근 26주 본인 제출 이력. 본인 것만 (API-08 원칙).

---

## 3. 담당자 (lead 전용) — 자기 부서 스코프

lead가 아니면 전부 **404**.

### `GET /api/division/status`

```jsonc
// 200 — ?slot=2026-W33 지원 (기본: 현재)
{
  "slot": { "isoKey","label","deadlineAt","locked" },
  "summary": { "roster": 12, "submitted": 9, "missing": 3 },
  "members": [
    { "user": {"id","name","sortOrder"},
      "status": "submitted", "latest": {"id","version","uploadedAt","byteSize"},
      "versionCount": 2 },
    { "user": {"id","name"}, "status": "missing", "latest": null, "versionCount": 0 }
  ],
  "offRoster": [ {"id","name"} ]          // isActive이나 onRoster=false인 인원 (참고 표시)
}
```

| ID | 요구사항 |
|---|---|
| API-20 | 분모 = `isActive && onRoster` (DM-04). 미제출자 포함 전원 |
| API-21 | 정렬 `sortOrder → name` |

### `GET /api/submissions/:id/preview` — 드로어 데이터 ★

제출 hwp를 **서버에서 파싱해** 구조화된 내용으로 반환한다. 원본 전송이 아니다.

```jsonc
// 200
{
  "submission": { "id","version","uploadedAt","userName" },
  "tables": [
    { "title": "1. 주요 업무실적",
      "columns": ["구분","업무실적 내용","일자","장소","참석자"],
      "rows": [ ["1-1","인포그래픽 제작","","",""], … ] },
    { "title": "2. 주요 업무계획", … },
    { "title": "3. 기타 특이사항", "rows": [] }        // 표 삭제된 경우 빈 배열
  ],
  "warnings": []                                        // 예: "3번 표 없음(정상 관례)"
}
```

| ID | 요구사항 |
|---|---|
| API-22 | 파싱은 S-08 reader 재사용. 업로드 시 이미 검증됐으므로 실패는 500 (정합성 이탈로 로그) |
| API-23 | 권한: lead(자기 부서) 또는 본인. 그 외 404 |
| API-24 | 감사 로그 `preview` 기록 |
| API-25 | 원문 텍스트 그대로 반환 — 요약·가공하지 않는다 (내용 검토가 목적) |

### `GET /api/division/download-zip`

ST-16. `?slot=` 지원, 0건 409, 스트리밍, 감사 로그.

### `GET /api/division/slots`

부서 관점 주차 목록 (최신 26개): `{isoKey, label, submitted, roster, locked}`.

### `PUT /api/division/roster` — 제출 대상 관리

```jsonc
// 요청
{ "updates": [ {"userId":"c…","onRoster":false}, … ] }
```

| ID | 요구사항 |
|---|---|
| API-26 | 자기 부서 사용자만 대상. 타 부서 userId 섞이면 전체 409 (부분 적용 없음) |
| API-27 | `sortOrder` 변경도 동일 엔드포인트. 감사 로그 |

### `GET·PUT /api/division/rule` — 병합 규칙 (Phase 2 활성)

```jsonc
// GET 200: { "ruleText": "...", "updatedAt": "..." }
// PUT 요청: { "ruleText": "..." }
// PUT 200:  { "ok": true, "parsed": {…} }        // 검증 결과 에코
// PUT 422:  { "error": "invalid_rule", "problems": ["3행: 알 수 없는 지시어 …"] }
```

| ID | 요구사항 |
|---|---|
| API-28 | 저장 전 문법 검증 (S-08 §6). 절대 규칙과 충돌하는 지시는 저장 거부 |
| API-29 | Phase 1에서는 GET/PUT 모두 동작하되(저장만), 병합에는 쓰이지 않음을 UI에 명시 |

### `POST /api/division/template` — 부서 양식 교체

`multipart/form-data`. ST-19 절차.

| ID | 요구사항 |
|---|---|
| API-40 | 검증 = 제출물과 동일 + 표 구조 파싱 필수. 성공 시 새 active, 이전 버전 보관 |
| API-41 | 응답에 파싱된 표 구조 요약(`{tables:[{rows,cols}…]}`) 포함 — 담당자가 즉시 확인 |

### `POST /api/division/merge` — **Phase 2** (계약 예약)

```jsonc
// 202: { "mergeRunId": "c…" }   → GET /api/division/merge/:id 폴링
// 완료: { "status":"succeeded", "rowCounts":{…}, "warnings":[…],
//        "downloadUrl":"/api/division/merge/:id/download" }
```

| ID | 요구사항 |
|---|---|
| API-30 | Phase 1: 501. 버튼 비활성 + `준비 중 (Phase 2)` |
| API-31 | 부서·슬롯당 동시 실행 1개 · 원본 불변 (HM-20) · `ruleSnapshot` 저장 (DM-13) |

---

## 4. 운영자 (operator 전용)

### `GET·POST /api/ops/divisions` · `PUT /api/ops/divisions/:id`

테넌트 목록·생성·활성화·마감정책 변경. **제출 현황·내용은 반환하지 않는다** (AU-15).

### `GET·POST·PUT /api/ops/users`

사용자 배정·역할·활성화. 시드 재적용(`POST /api/ops/users/sync-seed`) 포함.

| ID | 요구사항 |
|---|---|
| API-32 | ops 응답 어디에도 Submission 계열 데이터가 없다 — repo 계층에서 import 자체가 없음 (AU-13) |
| API-33 | 모든 변경 감사 로그 |

---

## 5. 시스템

### `GET /api/health` — 무인증

v1 유지 + `/data` 마운트 쓰기 확인. **부서명·사용자 정보 노출 금지.**

### API-34 — 속도 제한

업로드 5분당 10회/사용자 · zip 분당 3회 · preview 분당 30회 · 그 외 분당 120회.

---

## 6. 계약 테스트

| ID | 내용 |
|---|---|
| API-T01 | 마감 후 업로드 → 409 `slot_locked` (dow=3 부서는 수요일 기준으로 판정) |
| API-T02 | 마감 후 조회·다운로드는 정상 |
| API-T03 | 본문 `divisionId` 위조 → JWT 신원의 부서로 저장 (DM-12) |
| API-T04 | 재업로드 → v2, 이전 `isLatest=false` |
| API-T05 | member가 `/api/division/*` → 404 |
| API-T06 | lead 현황에 미제출자 `missing` 포함, `onRoster=false`는 분모 제외 |
| API-T07 | preview 응답의 rows가 픽스처 실측값과 일치 (`sample-filled-w2` → 실적 9행) |
| API-T08 | ops API 응답 전체에 submission 필드 부재 (스냅샷 테스트) |
| API-T09 | 전 엔드포인트 `no-store` · 시각 `+09:00` |
| API-T10 | health 200/503 + 민감정보 없음 |
| API-T11 | 규칙 PUT: 절대 규칙 위반 지시 → 422 `invalid_rule` (Phase 2) |
| API-T12 | 양식 교체: 깨진 파일 → 422, active 유지 (ST-T17와 연동) |
