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
| `cross_origin` | 403 | 다른 출처에서 온 상태 변경 요청 (API-56 · AU-33) |
| `slot_locked` | 409 | 부서 마감 지남 |
| `upload_closed` | 410 | hwp 올리기가 닫힘 — 「전사」 섹션 [올리기](RU-60a)만 낸다. 부서원 업로드 라우트(API-54)는 2026-10-08에 없어졌다(WA-39) |
| `no_submissions` | 409 | 대상 0건 |
| `edited` | 409 | 사람이 고친 병합본 — 확인 없이 다시 병합하지 않는다 (API-55 · HM-49) |
| `merging` | 409 | 같은 부서·주차 병합을 **다른 프로세스**가 돌리고 있다 — 「이미 병합 중입니다」 (API-31 · HM-58, 2026-10-08 2단계부터 같은 프로세스 안은 줄에 합류 — HM-60b) |
| `too_large` | 413 | 본문이 너무 큼 — 읽기 전에 `Content-Length`로 거른다 (ST-04) |
| `invalid_file` | 422 | 파일 검증 실패 (reason: ST-09) |
| `invalid_rule` | 422 | 병합 규칙 검증 실패 (Phase 2) |
| `conflict` | 409 | 버전 경합 |
| `not_implemented` | 501 | Phase 2 예약 |
| `internal` | 500 | 서버 오류 |

### API-56 — 상태를 바꾸는 요청은 **같은 출처**에서만 (AU-33)

`GET`·`HEAD`가 아닌 모든 요청은 공통 래퍼(`handler()`)가 출처를 먼저 본다. 다른 출처면 본문을 읽기 전에
**403 `cross_origin`** 「다른 사이트에서 보낸 요청은 받지 않습니다 …」. 판정 규칙과 이유는 [AU-33](03-auth.md).
`Origin`도 `Sec-Fetch-Site`도 없는 요청(스크립트·curl·테스트)은 통과한다 — 브라우저가 아니면 쿠키를 훔쳐 쓸 수 없다.

### API-04 — 시각 ISO 8601 `+09:00` · API-05 — 캐시 금지 `no-store` · API-06 — 마감은 서버 최종 판정

(v1과 동일. 마감 판정은 `deadlineFor(slot, division)` — WS-13)

---

## 2. 공통 (member + lead)

### ~~`GET /api/me`~~ — 폐지 2026-10-08

신원·부서·현재 슬롯·본인 제출을 한 번에 주던 엔드포인트. **화면이 부른 적이 없어** 지웠다(기능 정리 R2) — 페이지는 서버에서
`requirePageScope`·`getDivisionView`로 같은 것을 직접 읽는다. 시험이 「세션으로 신원이 풀리나」를 이것으로 봤는데,
그 시험은 게이트(`requireScope`)를 직접 부르거나 `GET /api/my/previous`로 본다.

| ID | 요구사항 |
|---|---|
| ~~API-07~~ | ~~슬롯은 호출 시점 upsert 보장 (WS-11)~~ — 폐지 2026-10-08 (엔드포인트와 함께) |
| ~~API-08~~ | ~~응답에 타인 정보 없음~~ — 폐지 2026-10-08 (엔드포인트와 함께). 「본인 것만」은 `GET /api/my/previous`가 같은 식으로 지킨다. 「member 화면의 부서 현황은 `/api/division/status` 축소판을 따로 쓴다」도 그 라우트와 함께 걷었다(TACP-11 v1.8) |

### 제출 저장 — `POST /api/submissions/compose`와 `uploadSubmission()` (2026-10-08 개정)

> **2026-10-08 — `POST /api/submissions`(멀티파트 업로드) 라우트를 지웠다** (WA-39 · R19 · [ADR-0014](../adr/0014-web-only-submission.md) 완료).
> 그 주소에는 이제 라우트가 없다(404). 제출물을 만드는 HTTP 문은 웹 작성 `POST /api/submissions/compose`(JSON 본문, WA-04) 하나이고,
> 그 라우트가 저장 함수 `uploadSubmission()`을 부른다. 아래 API-09~14는 원래 업로드 라우트의 요구사항이었지만 **저장의 성질**이라
> 웹 작성에 그대로 걸린다 — 그래서 남긴다. 업로드 라우트에만 있던 것(API-54 · 멀티파트 본문 · 업로드 속도 제한)만 폐지한다.

| ID | 요구사항 |
|---|---|
| API-09 | 제출자·부서는 신원에서 도출. 본문의 `userId`/`divisionId`류는 **무시** (AU-05, DM-12 · TACP-6) — 웹 작성 본문(`DocInput`)에는 그런 칸이 없고, 붙여 보내도 읽지 않는다(API-T03) |
| API-10 | 대상 슬롯은 **현재 슬롯 고정** — 과거·미래 슬롯 지정 불가 |
| API-11 | `now > deadlineFor(slot, division)` → 409 `slot_locked`. 예외는 담당자가 문을 잠시 연 때뿐(TACP-18) |
| API-12 | 검증 순서: 인증→사용자→부서 활성→잠금→크기→확장자(.hwp)→매직→구조(표 파싱 포함). 웹 작성이 만든 hwp도 같은 검증을 거친다(WA-05) |
| API-13 | 버전 부여·`isLatest` 전환 단일 트랜잭션 (DM-05) · 감사 로그 · 실패 시 tmp 정리 |
| API-14 | 저장 결과에 `sameAsPrevious`(직전 버전과 sha256 동일) 포함 (DM-07) |
| ~~API-54~~ | ~~`SUBMIT_HWP_UPLOAD=off`면 **410 `upload_closed`** — 인증 다음, 속도 제한·본문 읽기보다 먼저. 파일·DB 행·감사 기록을 남기지 않는다. 권한이 아니라 누구에게나 닫힌 길이라 404가 아니다 (WA-30~34)~~ — **폐지 2026-10-08** → WA-39 (라우트가 없다. 같은 스위치·410은 「전사」 [올리기]에만 남는다 — RU-60a) |

### API-60 — `POST /api/me/tour` — 화면 둘러보기 기록 (2026-10-08 · PG-84 · DM-25)

```
요청  { "chapters": ["member", "lead"], "outcome": "dismissed" | "started" | "done" | "skipped" }
응답  200 { "ok": true, "seen": [{ "chapter": "member", "outcome": "started" }, …] }
      401 로그인 없음 · 422 모르는 장·결과, 빈 목록, 6개 이상
```

- 대상은 **세션의 사람뿐**(`requireScope` → `scope.user.id`). 본문의 `userId`류는 읽지 않는다(TACP-1·6)
- 이 사람이 갖지 않은 장(`tourChapters(guideCaps(scope))` 밖)은 **조용히 뺀다** — 역할이 빠진 뒤 남은 탭이 보내도 오류가 아니다
- 덮어쓰기: `done`은 끝 — 뒤의 `started`·`skipped`·`dismissed`로 바꾸지 않는다. 나머지는 마지막 것이 이긴다. 같은 요청을 두 번 보내도 같다
- 감사 기록은 남기지 않는다 — 문서·권한·경계를 넘는 접근이 아니라 안내 표시 기록이다(TACP-10의 대상이 아니다)
- GET은 없다 — 제안은 서버가 페이지를 그릴 때 계산해 머리에 넘긴다(`getTour` — `src/server/tour.ts`)
- 시험 `[PG-T151]` (`tests/guide-tour.test.ts`)

### `GET /api/submissions/:id/download`

| ID | 요구사항 |
|---|---|
| API-15 | ST-15 권한 매트릭스. 스코프 밖은 404 |
| API-16 | 구버전도 id 지정으로 다운로드 가능 · RFC 5987 파일명 (ST-13) |

### `DELETE /api/submissions/:id` — 제출 취소 (v1.7.0)

권한 근거는 [TACP-14](../../TACP.md) · [ADR-0007](../adr/0007-submission-deletion.md).

| ID | 요구사항 |
|---|---|
| API-40 | 판정은 `requireDeletableSubmission` 하나로. 본인(마감 전) · operator(무조건). **lead·coordinator는 404** |
| API-41 | id는 손잡이일 뿐 — 그 사람의 **그 주차 전 버전**이 함께 삭제된다 (부분 삭제 없음) |
| API-42 | 마감 후 본인 요청 → **409 `slot_locked`**. 권한 없음(404)과 구별한다 — 존재는 이미 아는 사실이라 누출이 아니다 |
| API-43 | 감사 로그 `delete` 필수. 파일명·크기·sha256·버전 목록을 **파일이 지워지기 전에** 기록 |
| API-44 | 속도 제한 20회 / 5분 (업로드 10회보다 넉넉 — 정리 작업은 연속으로 일어난다) |

응답 `200 {removedVersions, slotLabel, ownerName}`

### API-45 — 명단 밖은 제출할 수 없다

| ID | 요구사항 |
|---|---|
| API-45 | `onRoster=false`는 **업로드·웹작성 둘 다 403 `not_on_roster`**. 게이트는 `requireSubmitter` 하나 |
| API-46 | 판정은 **본문을 읽기 전에**. 낼 수 없는 사람에게 "내용을 적어 주세요"(422)는 엉뚱한 안내다 |
| API-47 | `uploadSubmission`에도 같은 검사가 남아 있다 — 게이트가 아니라 **도메인 불변식**(스크립트도 이 함수를 부른다) |

404가 아니라 403인 이유: 자기 자신에 대한 사실이라 누출이 아니다 (TACP-5).
이유를 안 알려주면 당사자는 화면이 고장 난 줄 안다 — 실제로는 명단 등록을 요청해야 한다.

**왜 막는가**: 현황(`divisionStatus`)도 병합(대상 인원 조회)도 `onRoster`만 본다.
그래서 명단 밖 제출물은 담당자 눈에 안 띄고 병합에도 안 들어가는 **유령 제출물**이 된다.
조용히 사라지는 것보다 분명히 거절하는 편이 낫다.

### `GET·PUT /api/division/merged/content` — 병합본 보기·고치기 (v1.12.0)

담당자의 실제 동선은 «병합본 받기 → 한글로 열기 → 표 복사 → 게시판 붙여넣기»다.
중간에 이상한 행 하나를 고치려고 한글을 연다. **한글을 여는 유일한 이유가 그것**이라면
화면에서 보고 고칠 수 있어야 한다.

| ID | 요구사항 |
|---|---|
| API-48 | `GET` — 저장된 병합본 hwp를 파싱해 표 3개 반환. 권한은 `requireMergedAccess` (담당자부터) |
| API-49 | 응답에 **게시판 답변 제목**을 함께 준다 — 주간 `8월3주차 연구운영회의 주간업무(부서)` · 월간 `8월 연구운영회의 월간업무(부서)` |
| API-50 | `PUT` — 고친 표로 병합본을 **다시 쓴다**. `requireLead` + 신원의 부서만 (TACP-6). 본문에 `GET`이 준 판(`runId`·`sha256`)을 싣는다 — 그 사이 바뀌었으면 409 (HM-47). 칸의 **줄바꿈은 남기고**, 500자를 넘는 칸은 자르지 않고 422 |
| API-51 | 구분 채번은 저장할 때 시스템이 다시 만든다 (ABS-5). 사람이 고친 번호는 버린다 |
| API-52 | **제출자가 올린 원본은 건드리지 않는다.** 다시 병합하면 수정 내용은 사라진다 — 그래서 저장마다 바뀐 곳을 남기고(`reviewJson.edits`), 다시 병합은 확인을 받는다 (HM-49 · API-55) |

병합과 수정은 `composeMergedHwp` 하나를 쓴다 (HM-27) — 두 곳이 각자 조립하면
표를 지우는 조건·채번 방식이 갈라진다.

| ID | 요구사항 |
|---|---|
| API-58 | **(2026-10-08 채택 · `feat/auto-flow` 합친 뒤 구현)** `GET` 응답의 `review`(승인자 이름·바뀐 줄)는 lead·head(내 부서)·readAll에게만 담는다 — 그 밖에는 `null`. TACP-17이 작성자를 보내지 않는 것과 같은 판정(`canSeeAuthors`)이다. `canApprove`는 처음부터 그 부서의 head에게만 참이다. 같은 이유로 3단계 「위로」 상태(`GET /api/rollup/report?level=unit`)의 `sent.by`(승인한 부서장·비상구로 올린 담당자의 이름)도 행방을 보는 사람(`canSeeHandoff` — 내 부서 lead·head)에게만 담고 member에게는 `null`이다(상태·시각은 그대로, TACP-21 「제출 상태 보기」). 응답이 줄어드는 쪽이라 TACP 표는 고치지 않는다. 부서원 홈의 읽기 전용 드로어(`variant="view"`, CP-114)는 받은 것과 상관없이 승인 띠를 그리지 않는다. 시험 API-T16 |

### `GET /api/template` — 부서 양식 다운로드

| ID | 요구사항 |
|---|---|
| API-17 | **자기 부서의 active 양식** 반환 (DM-14). 없으면 404 + "담당자에게 양식 등록을 요청하세요" |
| API-18 | 파일명 `{주차라벨}_{부서명}_주간업무.hwp` — 주차 주입 |
| API-19 | 잠김 상태에서도 다운로드 가능 (다음 주 대비) |

### ~~`GET /api/my/history`~~ — **폐지 2026-10-08** (R2 · PG-70)

~~최근 26주 본인 제출 이력. 본인 것만 (API-08 원칙).~~ 화면이 부른 적이 없었다. 내 지난 주는 부서원 홈의
지난 주차(PG-68)가 서버 렌더로 그린다(`src/server/my-weeks.ts`). 라우트 파일을 지웠다 — 404.

---

## 3. 부서 스코프 (권한은 엔드포인트별 표기)

lead 전용 표기가 있는 엔드포인트는 member에게 **404**.

### ~~`GET /api/division/status`~~ — **폐지 2026-10-08** (R2 · TACP-11 v1.8 · [ADR-0016](../adr/0016-division-status-visibility.md))

부서원에게 이름·시각 축소판을 주던 **마지막 경로**였다(화면 호출 0). 부서원 홈에서 명단이 빠지면서(PG-66) 라우트를 지웠다 — 404.
담당자의 현황은 수합 관리 페이지가 서버 함수 `divisionStatus`를 직접 부른다(그 앞에 `canManage` — PG-T08). 아래 계약은 기록으로 남긴다.

~~member 응답은 축소판: `members[].{user.name, status, uploadedAt}` 만 —
버전 수·크기·다운로드 링크는 lead부터 (AU-06).~~

```jsonc
// 200 (lead 응답) — ?slot=2026-W33 지원 (기본: 현재)
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
| API-20 | 분모 = `isActive && onRoster` (DM-04). 미제출자 포함 전원 — `divisionStatus`가 그대로 지킨다 |
| API-21 | 정렬 `sortOrder → name` — 위와 같다 |

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
| API-23 | 권한: 본인 · lead(자기 부서) · coordinator/operator(전 부서, 감사 로그). 그 외 404 |
| API-24 | 감사 로그 `preview` 기록 |
| API-25 | 원문 텍스트 그대로 반환 — 요약·가공하지 않는다 (내용 검토가 목적) |
| API-57 | `tables[].rows`에서 **본문 칸이 모두 빈 행**은 뺀다 — 병합본 보기(UX-03)와 같은 조건(`row.slice(1).some(c => c.trim())`). 양식의 빈 번호 줄(3-1~3-4)이 「잘못 냈나?」로 읽혔다. 머리행은 남긴다. 글자는 건드리지 않는다(API-25). `rowsByTable`은 원래 빈 행이 없고 [고치기]는 그것을 쓰므로 자리가 어긋날 일이 없다 (2026-10-08) |

### ~~`GET /api/submissions/:id/versions`~~ — **폐지 2026-10-08** (R9 · PG-73)

~~드로어 버전 전환용 (CP-73). `:id`가 속한 (사용자, 주차)의 전체 버전 목록.
권한 판정은 `:id` 접근 판정과 동일 (findAccessibleSubmission).~~ 2판 이상인 제출이 0건이었다. 드로어는 최신 판만 연다 — 라우트 파일을 지웠다(404).
옛 판은 DB·저장소에 남는다(ST-19). 첨삭이 만든 새 판은 저장 뒤 드로어가 그 판으로 옮겨 연다.

### ~~`GET /api/division/download-zip`~~ — **폐지 2026-10-08** (R1 · PG-73)

~~ST-16. `?slot=` 지원, 0건 409, 스트리밍, 감사 로그.~~ `download_zip` 0건(파일럿 8주). 라우트 파일을 지웠다(404).
옛 감사 기록의 `download_zip`은 감사 로그 화면이 그대로 읽는다.

### ~~`GET /api/division/slots`~~ — **폐지 2026-10-08** (R2 · PG-72)

~~부서 관점 주차 목록 (최신 26개): `{isoKey, label, submitted, roster, locked}`.~~ 화면이 부른 적이 없었다.
수합 관리의 주차 목록은 서버 함수 `divisionWeeks`(PG-72)가 만든다 — 근거 있는 주만, 상한 없이, 명단 기준 수. 라우트 파일을 지웠다.

### ~~`PUT /api/division/roster`~~ → **`PUT /api/ops/roster`로 이동 (v2.1)**

인원 배치(onRoster·sortOrder·역할)는 **운영자 전용**이다 — 사용자 확정 (DM-04).
lead에게는 이 엔드포인트가 존재하지 않는다(404).

| ID | 요구사항 |
|---|---|
| API-26 | `PUT /api/ops/roster` — operator만. `{updates:[{userId,onRoster?,sortOrder?}]}` |
| API-27 | 부분 적용 없음(하나라도 무효면 전체 409) · 감사 로그 |

### `PUT /api/division/rule` — 병합 규칙 (Phase 2 활성)

`GET`은 폐지 2026-10-08 — 부서 설정 화면은 서버에서 그리고 이 GET을 부르지 않았다(R2).

```jsonc
// PUT 요청: { "categories": "AI-홍보-시스템" }          // 2026-10-08 — 이 키 하나 (API-59)
// PUT 200:  { "ok": true, "parsedCategories": ["AI","홍보","시스템"] }
// PUT 422:  { "error": "invalid_rule", "message": "…" }  // 문자열이 아님 · 500B 초과 · categories 없음
```

| ID | 요구사항 |
|---|---|
| ~~API-28~~ | ~~저장 전 문법 검증 (S-08 §6). 절대 규칙과 충돌하는 지시는 저장 거부~~ — **폐지 2026-10-08** (문법은 HM-18 v3에서 없앴다 — 길이·타입만 본다) |
| ~~API-29~~ | ~~Phase 1에서는 GET/PUT 모두 동작하되(저장만), 병합에는 쓰이지 않음을 UI에 명시~~ — **폐지 2026-10-08** (병합은 가동 중) |
| ~~HM-48~~ | ~~`sort: "input"\|"date"`, `undated: "last"\|"first"` — 그 밖의 값은 422. 감사 로그에 바꾼 값이 남는다~~ — **폐지 2026-10-08** (R3 · HM-51) |
| API-59 | **받는 키는 `categories` 하나** (2026-10-08 — R3·R5·S7, [ADR-0018](../adr/0018-manage-settings-trim.md)). 문자열, 500B 이하. 다른 키(`ruleText`·`guideText`·`emptyWords`·`emphasisWords`·`dedupe`·`dropNotes`·`sort`·`undated`)는 **읽지 않는다** — 띄워 둔 옛 화면이 보내도 그 열은 바뀌지 않는다. `categories`가 없으면 422. 쓰기 대상은 신원의 부서(TACP-6), 감사 `rule_update { fields: ["mergeCategories"] }` |

### `POST /api/division/template` — 부서 양식 교체

`multipart/form-data`. ST-19 절차.

| ID | 요구사항 |
|---|---|
| API-40 | 검증 = 제출물과 동일 + 표 구조 파싱 필수 + **양식 모양(5칸 표 셋 — ST-19a)과 시험 작성·병합(ST-19b), 아니면 422 `invalid_template`**(2026-10-10). 성공 시 새 active, 이전 버전 보관 |
| API-41 | 응답에 파싱된 표 구조 요약(`{tables:[{rows,cols}…]}`) 포함 — 담당자가 즉시 확인 |

### `POST /api/division/merge` · `GET /api/division/merge?jobId=` — 병합 줄 (2026-10-08 2단계 · HM-59·60)

```jsonc
// POST { "isoKey": "2026-W42", "overwriteEdits"?: true }
// 202 — 줄에 넣었다(또는 같은 부서·주차 작업에 합류했다). 병합을 기다리지 않는다
{ "jobId": "c…", "position": 3, "joined": false, "status": "queued", "etaMinutes": 2 }
// GET ?jobId=c…  — 대기 → 병합 중 → 끝
{ "jobId": "c…", "status": "running", "position": 1, "etaMinutes": 1, "startedAt": "…+09:00", "finishedAt": null, "run": null }
{ "jobId": "c…", "status": "done", "position": null, "run": { "id": "c…", "status": "succeeded", "errorText": null } }
{ "jobId": "c…", "status": "failed", "position": null, "errorText": "병합하는 동안 고친 판이 있어 덮지 않았어요", "run": { "id": "c…", "status": "failed", "errorText": "…" } }
```

| ID | 요구사항 |
|---|---|
| API-30 | Phase 1: 501. 버튼 비활성 + `준비 중 (Phase 2)` |
| API-31 | 부서·슬롯당 동시 실행 1개 · 원본 불변 (HM-20) · `ruleSnapshot` 저장 (DM-13). **2026-10-08 — 실제로 막는다 (HM-58):** 멈추지 않은 running(기본 10분 안, HM-55)이 있거나 같은 프로세스에서 시작 중이면 409 `merging` 「이미 병합 중입니다」 · `detail: { runId, startedAt }`. `edited`(API-55)보다 먼저 본다. 시작하지 않으므로 기록·감사 로그가 없다 |
| API-31a | **(2026-10-08 2단계 — HM-60b) 202로 줄에 넣는다.** 409 `edited`(API-55)를 먼저 묻고, 그 뒤 `enqueueMerge`(HM-59b) — 같은 부서·주차 작업이 대기 중이면 합류(`joined: true`), 병합 중이면 합류하거나(바뀐 것 없음) 대기 하나를 더 세운다(새 제출 · `overwriteEdits`). 응답 `{ jobId, position, joined, status, etaMinutes }` — `position`은 병합 중인 작업이 1, 대기가 2, 3 …(HM-59f). 감사 로그(`merge`)는 넣을 때 `{ status: 'queued', jobId, joined }`(+ 덮은 곳 수). 409 `merging`은 다른 프로세스가 돌리는 running이 있고 줄에 작업이 없을 때만. 병합 실패는 이제 422가 아니라 상태 조회의 `failed`다 |
| API-65 | **`GET /api/division/merge?jobId=`** (2026-10-08 — HM-59f) — 그 작업의 `status`(`queued` · `running` · `done` · `failed` · `cancelled`) · `position` · `etaMinutes` · 시각 · 끝났으면 `run: { id, status, errorText }`. 게이트는 실행과 같다(`requireManager`) · 작업은 **신원의 부서**(`resolveTargetDivision` — 슬러그 없음)의 것이어야 한다 — 남의 부서 작업 id · 없는 id는 404(TACP-5 · TACP-30). 화면(CP-130)이 2초마다 묻는다 |
| API-55 | 그 주차의 최신 병합본을 **사람이 고쳤으면** 409 `edited` — 본문에 `overwriteEdits: true`가 있을 때만 다시 병합한다 (HM-49). 감사 로그에 덮은 곳 수 |

```jsonc
// 409 — 화면은 이것으로 확인 창을 띄운다
{ "error": "edited", "message": "병합본에 사람이 고친 곳이 3곳 있어요 (홍길동 실장). 다시 병합하면 고친 내용이 사라져요.",
  "detail": { "edits": { "places": 3, "saves": 1, "by": ["홍길동 실장"], "lastAtKst": "10-08 14:12" }, "runId": "c…" } }
// 확인한 뒤: POST { "isoKey": "…", "overwriteEdits": true }
```

---

## 4. 운영자 (operator 전용)

### `GET /api/ops/divisions` · `PUT /api/ops/divisions`

테넌트 목록·활성화·부서 알림·마감정책·별칭(shortSlug)·게시판 이력 변경. 부서를 만드는 경로(`POST`)는 없다 — 부서는 시드·인원 최신화가 만든다. `id`는 본문에 싣는다.

```jsonc
// PUT — 바꿀 칸만. 운영자가 아니면 404 · 없는 id 404 · 바꿀 칸이 없으면 422
{ "id": "c…", "isActive": true, "notifyEnabled": true, "deadlineDow": 4, "deadlineTime": "14:00", "shortSlug": "aiprd", "boardStatus": "confirmed" }
// 200
{ "ok": true, "division": { "id": "c…", "isActive": true, "notifyEnabled": true } }
```

| ID | 요구사항 |
|---|---|
| API-66 | **`notifyEnabled`** (2026-10-09 — NT-61): 불리언만 받는다 — 그 밖의 값(`null`·`"true"`·`1` …)은 422 `invalid_request`. 켜짐(`isActive`)과 따로 저장한다 — 꺼진 부서에도 켤 수 있고 켜기 전까지는 효과가 없다(NT-30). 감사 `rule_update`의 `detail`에 `changed`(`notifyEnabled` 포함)와 바뀐 값 `notifyEnabled`. GET의 부서마다 `notifyEnabled`. 문은 그대로 `requireOperator` |

### `GET·POST·PUT /api/ops/users` · `PUT /api/ops/roster`

사용자 배정·역할(lead/coordinator)·활성화·onRoster·정렬. 시드 재적용(`sync-seed`) 포함.

### `DELETE /api/ops/notify-sink` — 가짜 알림 수신함 비우기 (2026-10-08 · NT-56 · TACP-26)

수신함이 닫힌 서버(운영)면 누구에게나 404(신원보다 먼저) → `requireOperator`(밖이면 404). `{ ok, removed }`. 감사 기록 없음 — 부서 경계를 넘지 않고, 지우는 것은 시험 서버의 가짜 알림뿐이다(로그 한 줄).

### ~~`GET /api/overview`~~ — 폐지 2026-10-08

계약만 예약해 두고 만들지 않은 엔드포인트(R21). 총괄의 전 부서 화면은 「전사」(`/org`, PG-49f)가 되었고 그 화면은 서버에서 읽는다.

| ID | 요구사항 |
|---|---|
| API-32 | operator·coordinator의 타 부서 조회는 전부 감사 로그 (AU-15·16) |
| API-33 | 모든 변경 감사 로그 · coordinator에게 쓰기 엔드포인트는 404 (AU-T18) |

---

## 5. 시스템

### `GET /api/health` — 무인증

v1 유지 + `/data` 마운트 쓰기 확인. **부서명·사용자 정보 노출 금지.**

- `checks.template` — 활성 부서마다 양식 **파일**이 있는가 (OPS-41 `templateStates`). 행만 있고 파일이 없는 부서가
  하나라도 있으면 `fail: N active division(s) without template file` → `ok:false`. 부서 이름은 적지 않는다 — 누구나 부르는 주소다.
- `checks.rootDisk` · 맨 위 `warnings[]` — 루트 디스크 여유. 판정은 [OPS-19](09-deployment-ops.md)

### `POST·GET /api/dev/messenger-sink` — 가짜 알림 수신함 (2026-10-08 · NT-56 · TACP-26 · 시험·시연 서버만)

메신저 클라이언트가 사내 메신저에 보내는 요청 그대로 받는다 — `application/x-www-form-urlencoded`, 필드 16개(messenger.md §6), 머리 `x-tincase-kind`(종류).
응답 `200 text/plain` `send ok` · `CMD=ALERT`·`RecvId`가 없으면 422 · 본문 64KB 넘으면 413. 신원을 묻지 않는다(TACP §6 넷째) — 쓰기만 하고 기록을 내주지 않는다.
`GET`은 `{ sink: 'on' }`만(리허설이 「열려 있나」를 묻는다). `TINCASE_ENV`가 test·demo이고 `MESSENGER_SINK=on`일 때만 — 그 밖에서는 어느 방법이든 404.

### API-34 — 속도 제한

~~업로드 5분당 10회/사용자~~(2026-10-08 — 업로드 라우트와 함께 폐지, WA-39) · ~~zip 분당 3회~~(zip 폐지 2026-10-08) · preview 분당 30회 · 그 외 분당 120회.

### 지운 엔드포인트 (2026-10-08 기능 정리)

화면이 부르지 않는 경로는 지운다 — 남겨 두면 게이트를 하나 더 지켜야 하고, 아무도 쓰지 않으니 깨져도 모른다.
같은 파일의 쓰기(`PUT`·`POST`·`DELETE`)는 남겼다.

| 경로 | 무엇이었나 | 대신 |
|---|---|---|
| `GET /api/me` | 신원·슬롯·본인 제출 | 페이지가 서버에서 읽는다 |
| `PUT /api/me/notify` | 본인 알림 켜고 끄기 (NT-21) | 운영자 인원 드로어의 알림 칸 (NT-22, `PUT /api/ops/roster`) |
| `GET /api/my/history` | 본인 이력 26주 | 부서원 홈의 지난 주차 (PG-68, 서버 렌더) |
| `GET /api/division/slots` | 부서 주차 목록 | 서버 함수 `divisionWeeks` (PG-72) |
| `GET /api/division/rule` | 병합 설정 읽기 | 부서 설정 페이지가 서버에서 읽는다 |
| `GET /api/schedule/deadline` | 이번 주·다음 주 마감 상태 (WS-19l) | 「전사」 화면이 `deadlineStatus()`를 직접 부른다 |

같은 날 **기능과 함께** 지운 것 (PG-73 · [ADR-0018](../adr/0018-manage-settings-trim.md) · [ADR-0016](../adr/0016-division-status-visibility.md) · [ADR-0014](../adr/0014-web-only-submission.md)):

| 경로 | 무엇이었나 | 대신 |
|---|---|---|
| `GET /api/division/download-zip` | 그 주 제출물 전체 zip (R1) | 줄의 [열기] → 드로어 [원본 다운로드] |
| `GET /api/submissions/:id/versions` | 드로어의 버전 목록 (R9) | 드로어는 최신 판만 |
| `GET /api/division/status` | 부서 제출 현황 (부서원 축소판 포함) | 부서원은 받지 않는다(TACP-11 v1.8). lead 이상은 수합 관리가 서버에서 읽는다 |
| `POST /api/submissions` | hwp 업로드 제출 (R19 · WA-39) | 웹 작성 `POST /api/submissions/compose` |

남긴 것: `/api/rollup/*`의 GET(3단계 흐름을 다시 짜는 중이라 그 작업에서 정한다), `GET /api/health`, `POST /api/template/standard`
(운영자가 화면 없이 쓴다).

같은 날 3단계 자동 진행([12 §2a](12-org-rollup.md) · RU-84 · [ADR-0015](../adr/0015-approval-is-handoff.md))으로 **좁힌** 쓰기 — 화면에서
[본부에 제출]·[이어 붙이기]·[총괄에 제출]·[전사 취합본 만들기]·[제출 취소]가 없어진 것과 짝이다:

| 경로 | 지금 | 예전 |
|---|---|---|
| `POST /api/rollup/report` | 비상구 「승인 없이 올리기」 전용 — `{level, isoKey, withoutApproval: true}`, lead만(`requireHandoffEscape`), 기한 15분 전부터 「본부 → 총괄」 기한 + 24시간까지(RU-77). 그 밖의 본문은 404 | lead·head의 [제출] |
| `DELETE /api/rollup/report` | 누구에게나 404 — 처리기는 남아 있다는 것도 알리지 않는다(TACP-5 · RU-T118) | [제출 취소] |
| `POST /api/rollup/hq` · `POST /api/rollup/org` | 실패했을 때 [다시 시도] 전용 — 입력을 고르지 못하고, 마지막이 성공이고 입력 열쇠가 같으면 아무것도 하지 않는다(RU-76 · RU-T121) | [이어 붙이기] · [전사 취합본 만들기] |
| `POST /api/rollup/hq/approve` | 본부장 승인 = 총괄로 제출. 화면이 그린 판(`runId`·`sha256`)에만 — 다르면 409(RU-55 · `requireHqReviewer`) | 「가장 최근 본부본」에 붙던 승인 |
| `POST /api/division/merged/approve` · `PUT /api/division/merged/content` | 응답에 `handedOff: { target, at } \| null` — 3단계면 부서장의 승인(고쳐 저장 포함)이 곧 위로 가는 제출이다(HM-47 · RU-70) | 승인만 |

---

## 6. 계약 테스트

| ID | 내용 |
|---|---|
| API-T01 | 마감 후 제출 저장 → 409 `slot_locked` (dow=3 부서는 수요일 기준으로 판정) (2026-10-08 — 예전 「업로드」. 저장 함수로 본다, WA-39) |
| API-T02 | 마감 후 조회·다운로드는 정상 |
| API-T03 | 본문 `divisionId`·`userId` 위조 → 신원의 부서·본인으로 저장 (DM-12) — 2026-10-08부터 웹 작성 문(`compose`)에 보낸다(예전: 업로드 멀티파트 필드) |
| API-T04 | 다시 내면 → v2, 이전 `isLatest=false` |
| ~~API-T05~~ | ~~member가 `/api/division/status` → 200 축소판(링크·크기 없음)~~ — **폐지 2026-10-08**: 라우트가 없어 AU-T87(부서원은 현황을 받는 길이 없다)로 뒤집었다. zip/preview → 404는 AU-T13·ST-15가 본다 |
| API-T06 | 수합 관리의 현황(`divisionStatus`)에 미제출자 `missing` 포함, `onRoster=false`는 분모 제외 |
| API-T07 | preview 응답의 rows가 픽스처 실측값과 일치 (`sample-filled-w2` → 실적 9행) |
| API-T08 | coordinator가 PUT 계열 호출 → 404 (「GET /api/overview → 200」은 엔드포인트와 함께 폐지 2026-10-08) |
| API-T09 | 전 엔드포인트 `no-store` · 시각 `+09:00` |
| API-T10 | health 200/503 + 민감정보 없음 |
| ~~API-T11~~ | ~~규칙 PUT: 절대 규칙 위반 지시 → 422 `invalid_rule` (Phase 2)~~ — **폐지 2026-10-08** (API-28) → API-T17 |
| API-T12 | 양식 교체: 깨진 파일 → 422, active 유지 (ST-T17와 연동) |
| API-T13 | health — 활성 부서의 양식 파일이 없으면 `checks.template` fail · 503, 응답에 부서명 없음 · `warnings` 배열은 늘 있다 |
| API-T14 | 병합 재실행 — 고친 병합본이면 409 `edited` + `detail.edits`, `overwriteEdits: true`면 실행 (API-55, HM-T136) |
| API-T18 | 병합 실행 중이면 409 `merging` 「이미 병합 중입니다」(기록 없음) · 10분 넘은 running은 막지 않음 · 같은 순간 두 요청은 하나만 실행 (API-31, HM-T157). 2026-10-08 2단계부터 409는 **다른 프로세스**의 running일 때만 — 같은 프로세스의 겹침은 줄에 합류한다(API-T25) |
| API-T25 | [지금 병합] → 202 `{ jobId, position, joined }` · `GET ?jobId=`로 끝까지 · 같은 순간 두 요청은 작업 하나(둘째 `joined`) · 남의 부서 작업 id · member → 404 (API-31a · API-65, HM-T165 · HM-T171) |
| API-T26 | `PUT /api/ops/divisions`의 `notifyEnabled` — 운영자 200 · DB에 저장 · 감사 `changed`에 `notifyEnabled`와 바뀐 값 · 꺼진 부서에도 켜짐(`isActive`는 그대로) · 불리언이 아니면 422(바뀐 것 없음) · 담당·부서장·부서원·총괄 404 · 없는 id 404 · GET에 `notifyEnabled` (API-66, `tests/ops-notify.test.ts`) |
| API-T15 | 제출물 열람 — 빈 번호 줄은 `rows`에 없고 머리행은 남는다 · `rowsByTable`은 그대로 (API-57) |
| API-T16 | 병합본 보기 — member는 `review`가 `null`(승인자 이름이 응답에 없다)·`canApprove` 거짓, lead는 `review`를 받는다 · 「위로」 상태의 `sent.by`는 member에게 `null`, lead에게는 이름 (API-58) |
| API-T17 | 규칙 PUT — `categories`만 저장 · 옛 키(`ruleText`·`guideText`·`emptyWords`·`sort` …)는 열을 바꾸지 않는다 · `categories`가 없거나 500B 초과면 422 · member 404 · 쓰기는 신원의 부서 (API-59, `tests/sprint2.test.ts`) |
